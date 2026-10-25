/**
 * dsh-coordinator 的宿主侧插件。
 *
 * 贡献八件事：bundle 内置 skill 的发现（协议层）、项目初始化工具、后台派工工具、
 * 派工完成后的自动唤醒、任务看板卡片存储与卡片工具、项目注册表与项目作用域工具、
 * 项目数据的 Typert 远程通道，以及角色槽位到系统提示词的注入。
 *
 * 客户端侧（交付看板 UI 与左栏项目区块）在 `src/client/`，跑在浏览器进程，与本
 * 模块不共处。
 *
 * @module dsh-coordinator/host
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createSkillProvider } from './skills.js'
import { createInitProjectTool } from './tools/init-project.js'
import { createSpawnWorkerTool } from './tools/spawn-worker.js'
import { createCreateCardTool, createUpdateCardTool, createListCardsTool } from './tools/cards.js'
import {
  createListProjectsTool,
  createAddProjectTool,
  createSwitchProjectTool,
  createRemoveProjectTool,
} from './tools/projects.js'
import { createNotificationStore, resolveDshHome } from './notification-store.js'
import { createCardStore } from './cards/store.js'
import { createProjectStore } from './projects/store.js'
import { createProjectService } from './projects/service.js'
import { createProjectRemote } from './projects/remote.js'
import { createDispatcher } from './dispatch.js'
import { applyRoleContext } from './slots/index.js'

const here = dirname(fileURLToPath(import.meta.url))

/** bundle 根目录（src/host 的上两级）。 */
const bundleRoot = join(here, '..', '..')

export const name = 'dsh-coordinator-host'
// `systemPrompt` 必须声明：角色槽位靠它注册运行时上下文，服务不在作用域内时
// 注入静默失效（实测：不声明时上下文不进组装结果）。该服务由 base bundle 提供，
// 官方各 profile 都有。
// `sessionQuery`、`sessionController`、`agents` 与 `webServer` 都走 `ctx.get()`
// 惰性获取：前者由 sqlite 引擎提供（引擎可能被部署替换），后两者只挂在 web-app
// bundle 上。声明成必需依赖会让不含该服务的 profile 整个插件挂起。
export const inject = ['skills', 'tools', 'subagents', 'systemPrompt']

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

  // 项目注册表：编排语境的容器。目录是代码语境，项目是编排语境，二者不合并。
  const projects = createProjectStore({ home: resolveDshHome(), logger })
  const projectService = createProjectService({ store: projects, ctx, logger })

  ctx.tools.register(createListProjectsTool({ service: projectService }))
  ctx.tools.register(createAddProjectTool({ service: projectService }))
  ctx.tools.register(createSwitchProjectTool({ service: projectService }))
  ctx.tools.register(createRemoveProjectTool({ service: projectService }))

  // 浏览器侧要读项目、也要建项目，走 dsh 官方的 Typert 远程调用（`/api`
  // 共享通道），与工作区控制器同构。
  createProjectRemote({ service: projectService, ctx })

  const store = createNotificationStore({ logger })
  const dispatcher = createDispatcher({
    ctx,
    store,
    // worker 跑在项目目录里：协调者不能指定 worker 的工作目录。
    resolveWorkerCwd: (sessionId) => projectService.directoryOfCoordinator(sessionId),
    logger,
  })

  ctx.tools.register(createSpawnWorkerTool({ dispatcher }))

  const cards = createCardStore({ home: resolveDshHome(), logger })
  ctx.tools.register(createCreateCardTool({ store: cards }))
  ctx.tools.register(createUpdateCardTool({ store: cards }))
  ctx.tools.register(createListCardsTool({ store: cards }))

  // 角色槽位注入：会话被卡片绑到某个槽位时，每轮 turn 注入该槽位在项目
  // `SLOTS.md` 里的正文。槽位不注册工具、不改工具可见性。
  applyRoleContext({
    ctx,
    slotIndex: cards.slotIndex,
    // 手册属于项目：协调者会话按项目注册表反查项目目录，worker 的会话 cwd 就是
    // 项目目录。都不是时回落会话自己的目录。
    resolveDirectory: (sessionId) => projectService.directoryOfCoordinator(sessionId)
      ?? ctx.get('sessions')?.get(sessionId)?.header?.cwd,
    logger,
  })

  // 两份反查索引都是进程内的，崩溃后不会留下：启动时从各自的库重建。
  void cards.loadSlotIndex().catch((error) => {
    logger(`dsh-coordinator: 重建槽位索引失败：${error instanceof Error ? error.message : String(error)}`)
  })
  void projectService.loadIndex().catch((error) => {
    logger(`dsh-coordinator: 重建项目索引失败：${error instanceof Error ? error.message : String(error)}`)
  })

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
