/**
 * dsh-coordinator 的宿主侧插件。
 *
 * 贡献五件事：bundle 内置 skill 的发现（协议层）、项目初始化工具、后台派工工具、
 * 派工完成后的自动唤醒，以及任务看板卡片存储与卡片工具。
 *
 * 客户端侧（交付看板 UI）在 `src/client/`，跑在浏览器进程，与本模块不共处。
 *
 * @module dsh-coordinator/host
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createSkillProvider } from './skills.js'
import { createInitProjectTool } from './tools/init-project.js'
import { createSpawnWorkerTool } from './tools/spawn-worker.js'
import { createCreateCardTool, createUpdateCardTool, createListCardsTool } from './tools/cards.js'
import { createNotificationStore, resolveDshHome } from './notification-store.js'
import { createCardStore } from './cards/store.js'
import { createDispatcher } from './dispatch.js'

const here = dirname(fileURLToPath(import.meta.url))

/** bundle 根目录（src/host 的上两级）。 */
const bundleRoot = join(here, '..', '..')

export const name = 'dsh-coordinator-host'
export const inject = ['skills', 'tools', 'subagents']

/**
 * 挂载本 bundle 的能力。
 * @param {object} ctx - Cordis 上下文
 * @returns {void}
 */
export function apply(ctx) {
  const logger = (message) => {
    ctx.logger?.warn?.(message)
  }

  ctx.skills.registerProvider(() =>
    createSkillProvider({
      skillsRoot: join(bundleRoot, 'skills'),
      providerName: 'dsh-coordinator',
    }),
  )

  ctx.tools.register(
    createInitProjectTool({
      conventionsPath: join(bundleRoot, 'skills', 'init-project', 'references', 'conventions.md'),
    }),
  )

  const store = createNotificationStore({ logger })
  const dispatcher = createDispatcher({ ctx, store, logger })

  ctx.tools.register(createSpawnWorkerTool({ dispatcher }))

  const cards = createCardStore({ home: resolveDshHome(), logger })
  ctx.tools.register(createCreateCardTool({ store: cards }))
  ctx.tools.register(createUpdateCardTool({ store: cards }))
  ctx.tools.register(createListCardsTool({ store: cards }))

  // 父会话注册后补投此前未送达的完成通知（进程崩溃窗口）。
  ctx.on('agent/created', ({ agent }) => {
    dispatcher.markAlive(agent.id)
    void dispatcher.redeliverPending(agent).catch((error) => {
      logger(`dsh-coordinator: 补投完成通知失败：${error instanceof Error ? error.message : String(error)}`)
    })
  })

  // 失活的 agent 会静默接受 followup，投递前必须知道会话已销毁。
  ctx.on('agent/disposed', ({ agent }) => {
    dispatcher.markDisposed(agent.id)
  })

  // 外部输入抵达即重置该会话的自动续行计数——人工介入后护栏应重新开始计数。
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (!dispatcher.isInjected(message.id)) {
      dispatcher.resetResumeCount(agent.id)
    }
  })
}
