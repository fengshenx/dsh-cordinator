/**
 * dsh-coordinator 的宿主侧插件。
 *
 * 贡献九件事：bundle 内置 skill 的发现（协议层）、项目初始化工具、后台派工工具、
 * worker 续聊（登记表落盘 + `message_worker` 工具 + 续聊轮完成唤醒）、派工完成后
 * 的自动唤醒、任务看板卡片存储与卡片工具、项目注册表与项目作用域工具、项目数据
 * 的 Typert 远程通道，以及角色槽位到系统提示词的注入。
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
import { createMessageWorkerTool } from './tools/message-worker.js'
import { createCreateCardTool, createUpdateCardTool, createListCardsTool } from './tools/cards.js'
import {
  createListProjectsTool,
  createAddProjectTool,
  createSwitchProjectTool,
  createRemoveProjectTool,
} from './tools/projects.js'
import { createNotificationStore, resolveDshHome } from './notification-store.js'
import { createWorkerRegistry } from './worker-registry.js'
import { createCardStore } from './cards/store.js'
import { createProjectStore } from './projects/store.js'
import { createProjectService } from './projects/service.js'
import { createProjectRemote } from './projects/remote.js'
import { createDispatcher } from './dispatch.js'
import { applyToolGate } from './tools/gate.js'
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

  // 项目注册表：编排语境的容器。目录是代码语境，项目是编排语境，二者不合并。
  const projects = createProjectStore({ home: resolveDshHome(), logger })
  const projectService = createProjectService({ store: projects, ctx, logger })

  // 工具面按角色分配：协调者拿到编排与全库查询，worker 再少掉项目注册表的
  // 读写，普通会话两者都没有。裁剪在 `agent/created` 时对 agent 作用域做
  // （见 `applyToolGate`）。
  const isCoordinatorSession = (sessionId) => projectService.isCoordinatorSession(sessionId)

  ctx.tools.register(
    createInitProjectTool({
      conventionsPath: join(bundleRoot, 'skills', 'init-project', 'references', 'conventions.md'),
    }),
  )

  ctx.tools.register(createListProjectsTool({ service: projectService }))
  ctx.tools.register(createAddProjectTool({ service: projectService }))
  ctx.tools.register(createSwitchProjectTool({ service: projectService }))
  ctx.tools.register(createRemoveProjectTool({ service: projectService }))

  const cards = createCardStore({ home: resolveDshHome(), logger })
  // 卡片按项目归属：归属由宿主按调用方会话判定，模型不传项目参数。
  const resolveProject = (sessionId) => projectService.resolveProjectOfSession(sessionId)

  // 浏览器侧要读项目、也要建项目，走 dsh 官方的 Typert 远程调用（`/api`
  // 共享通道），与工作区控制器同构。
  createProjectRemote({ service: projectService, cards, ctx })

  const store = createNotificationStore({ logger })
  const workers = createWorkerRegistry({ home: resolveDshHome(), logger })
  const dispatcher = createDispatcher({
    ctx,
    store,
    workers,
    // worker 跑在项目目录里：协调者不能指定 worker 的工作目录。
    resolveWorkerCwd: (sessionId) => projectService.directoryOfCoordinator(sessionId),
    // 派工前要确认调用方是协调者，且索引真的读出来了，不能靠工具面的宽松放行。
    coordinatorIndex: projectService,
    logger,
  })

  ctx.tools.register(createSpawnWorkerTool({ dispatcher }))
  ctx.tools.register(createMessageWorkerTool({ dispatcher }))

  // 建卡与改卡对所有会话开放：worker 边干活边把状态写回卡片，普通会话也能为
  // 项目登记待办；查全库卡片只给协调者。
  ctx.tools.register(createCreateCardTool({ store: cards, resolveProject }))
  ctx.tools.register(createUpdateCardTool({ store: cards, resolveProject }))
  ctx.tools.register(createListCardsTool({ store: cards, resolveProject }))

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
  // 项目索引失败会永久停在「未就绪」，而那个状态下所有会话都被当作协调者。
  // 重启进程代价太大，退避重试几次；最终失败则由派工路径上的 awaitIndex 拒绝。
  const loadProjectIndex = async (attempt) => {
    try {
      await projectService.loadIndex()
    } catch (error) {
      logger(`dsh-coordinator: 重建项目索引失败（第 ${attempt} 次）：${error instanceof Error ? error.message : String(error)}`)
      if (attempt >= 3) return
      setTimeout(() => { void loadProjectIndex(attempt + 1) }, 2000 * attempt)
    }
  }
  void loadProjectIndex(1)

  // 父会话注册后补投此前未送达的完成通知（进程崩溃窗口）。
  //
  // 工具面也在这里裁：`agent/created` 早于首轮请求组装，作用域是新建的，每次
  // 会话创建（含冷恢复）都重算一遍，不会带着上一次的限制。
  ctx.on('agent/created', ({ agent }) => {
    applyToolGate({ agent, isCoordinatorSession })
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
  // 宿主的 subagent 结算通知先经派工器甄别：被移除的续聊通知不是外部输入，
  // 不该重置计数；移除失败时它兜底透传，同样不算人工介入。
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (dispatcher.maybeSwallowSettlementNotice(agent, message)) return
    if (!dispatcher.isInjected(message.id)) {
      dispatcher.resetResumeCount(agent.id)
    }
  })

  // 续聊轮的完成信号：宿主在子会话结算时发出，负载带子会话 id、终态原因与
  // 最后一次 assistant 输出（见 dispatch.js 的续聊说明）。
  ctx.on('subagent/end', (info) => {
    dispatcher.onSubagentEnd(info)
  })

  // 空闲检测的定时器随插件卸载一起停掉。
  ctx.on('dispose', () => {
    dispatcher.dispose()
  })
}
