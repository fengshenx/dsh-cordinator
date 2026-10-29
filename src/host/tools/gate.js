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
 * - **worker**：本 bundle 派出的根会话，判定依据是 `worker-sessions.js` 的内存集合
 *   （会话由 `agents.create` 建，会话头没有 `origin` 标记，只能按登记判）；
 * - **普通会话**：其余会话。
 *
 * 协调者拿到全部工具；普通会话与 worker 都没有 worker 编排与全库查询，worker
 * 另可交作业。
 */

/** 只有协调者能用的工具：worker 编排与全库卡片查询。 */
export const COORDINATOR_ONLY_TOOLS = Object.freeze([
  'list_cards',
  'spawn_worker',
  'message_worker',
])

/** 只有 worker 能用的工具：收尾交作业。 */
export const WORKER_ONLY_TOOLS = Object.freeze([
  'worker_done',
])

/**
 * 协调者不该看到的三件宿主工具：它们只作用在 subagent 体系上。
 *
 * 协调者的 worker 由本 bundle 用 `agents.create` 建成普通根会话，因此在宿主那三
 * 件工具里都不是合法目标——`list_agents` 列不到、`send_message` 过不了血统校验、
 * `interrupt_agent` 找不到目标却仍返回成功。留着它们只会让模型照描述去用，拿到
 * 一个假回执（中止尤其危险：以为停了，其实还在跑）。协议层也写了不要用，这里是
 * 从工具面结构上消除诱因。
 *
 * 只裁协调者：普通会话可能真的用官方 subagent，那时这三件是有效的。
 */
export const COORDINATOR_UNUSABLE_TOOLS = Object.freeze([
  'list_agents',
  'send_message',
  'interrupt_agent',
])

/**
 * 算出某个会话要禁掉的工具名。
 *
 * @param {object} options - 选项
 * @param {object} options.agent - 即将开始工作的 agent
 * @param {(sessionId: string) => boolean} options.isCoordinatorSession - 协调者判定
 * @param {(sessionId: string) => boolean} [options.isWorkerSession] - worker 判定
 * @returns {string[]} 要禁掉的工具名
 */
export function deniedToolsFor({ agent, isCoordinatorSession, isWorkerSession }) {
  const worker = typeof isWorkerSession === 'function' && isWorkerSession(agent?.id) === true
  if (worker) return [...COORDINATOR_ONLY_TOOLS]
  if (isCoordinatorSession(agent?.id)) return [...WORKER_ONLY_TOOLS, ...COORDINATOR_UNUSABLE_TOOLS]
  return [...COORDINATOR_ONLY_TOOLS, ...WORKER_ONLY_TOOLS]
}

/**
 * 把工具面裁剪应用到某个 agent 的作用域。
 *
 * 会话每次创建（含冷恢复）都会发 `agent/created`，这里跟着重算一次：作用域是
 * 新建的，上一次的限制不会留下。
 *
 * `COORDINATOR_UNUSABLE_TOOLS` 来自宿主的 subagent 组合，那个组合可以被部署禁用；
 * 而 `restrict()` 遇到没注册过的名字会直接报错，所以只 deny 当前确实存在的。
 * 探测用 `get(name)` 而不传 scope（即全局视图）——这三件正是全局工具，不必也不该
 * 猜 agent 的 scope key（那是不透明的内部键）。`definitions()` 是 0.2.2-alpha.2
 * 才加的方法，`engines.dsh` 下限 0.2.1-rc.2 上没有它，别在裁剪路径上引入。
 * 本 bundle 自己注册的工具不走这一步——那些缺失是装配错误，应该大声报出来。
 *
 * @param {object} options - 选项
 * @param {object} options.agent - 刚创建的 agent
 * @param {(sessionId: string) => boolean} options.isCoordinatorSession - 协调者判定
 * @param {(sessionId: string) => boolean} [options.isWorkerSession] - worker 判定
 * @returns {string[]} 实际禁掉的工具名
 */
export function applyToolGate({ agent, isCoordinatorSession, isWorkerSession }) {
  const denied = deniedToolsFor({ agent, isCoordinatorSession, isWorkerSession })
  if (denied.length === 0) return denied
  const present = denied.filter((name) => !COORDINATOR_UNUSABLE_TOOLS.includes(name)
    || agent.ctx.tools.get(name) !== undefined)
  if (present.length === 0) return present
  agent.ctx.tools.restrict({ deny: present })
  return present
}
