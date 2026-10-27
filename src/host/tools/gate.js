/**
 * 工具面分配：按调用方角色决定这个会话能看见哪些工具。
 *
 * 宿主（0.2.1-rc.2）的 `tools.register()` 不接受按步条件，`tools.restrict()`
 * 才是可用的裁剪面——它要求 scoped context（`agent.ctx`），所以裁剪必须在
 * 会话创建时对该 agent 的上下文调用一次。
 *
 * 三种角色：
 *
 * - **协调者**：项目注册表里 `coordinatorSessionId` 指向的会话，建项目时就定下；
 * - **worker**：子会话，会话头带 `origin: 'subagent'`；
 * - **普通会话**：其余会话。
 *
 * 协调者拿到全部工具；普通会话不碰 worker 编排与全库查询；worker 再少掉项目
 * 注册表的增删改查——它建项目时已经拿到目录与任务，改项目表只会制造并发写。
 */

/** 只有协调者能用的工具：worker 编排与全库卡片查询。 */
export const COORDINATOR_ONLY_TOOLS = Object.freeze([
  'list_cards',
  'spawn_worker',
  'message_worker',
])

/** worker 也不该碰的工具：项目注册表的读写。 */
export const WORKER_HIDDEN_TOOLS = Object.freeze([
  'list_projects',
  'add_project',
  'switch_project',
  'remove_project',
  'init_project',
])

/**
 * worker 会话判定。
 *
 * 子会话由宿主建在父会话之下，会话头带 `origin: 'subagent'`；用户在项目目录
 * 里手动开的会话没有这个标记，算普通会话。
 *
 * @param {object} agent - 调用方 agent
 * @returns {boolean} 是否 worker 会话
 */
export function isWorkerAgent(agent) {
  return agent?.session?.header?.origin === 'subagent'
}

/**
 * 算出某个会话要禁掉的工具名。
 *
 * @param {object} options - 选项
 * @param {object} options.agent - 即将开始工作的 agent
 * @param {(sessionId: string) => boolean} options.isCoordinatorSession - 协调者判定
 * @returns {string[]} 要禁掉的工具名；协调者返回空数组
 */
export function deniedToolsFor({ agent, isCoordinatorSession }) {
  if (isWorkerAgent(agent)) return [...COORDINATOR_ONLY_TOOLS, ...WORKER_HIDDEN_TOOLS]
  if (isCoordinatorSession(agent?.id)) return []
  return [...COORDINATOR_ONLY_TOOLS]
}

/**
 * 把工具面裁剪应用到某个 agent 的作用域。
 *
 * 会话每次创建（含冷恢复）都会发 `agent/created`，这里跟着重算一次：作用域是
 * 新建的，上一次的限制不会留下。
 *
 * @param {object} options - 选项
 * @param {object} options.agent - 刚创建的 agent
 * @param {(sessionId: string) => boolean} options.isCoordinatorSession - 协调者判定
 * @returns {string[]} 实际禁掉的工具名
 */
export function applyToolGate({ agent, isCoordinatorSession }) {
  const denied = deniedToolsFor({ agent, isCoordinatorSession })
  if (denied.length === 0) return denied
  agent.ctx.tools.restrict({ deny: denied })
  return denied
}
