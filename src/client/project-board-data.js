/**
 * 项目看板的数据通道：客户端读项目看板卡片。
 *
 * 看板是**项目**的看板：一个项目一个看板，跨会话聚合（协调者建的卡与 worker
 * 建的卡在同一处）。因此取数走宿主侧的项目通道，而不是会话事件流——
 *
 * - 事件流是会话维度的，一个项目下的卡片散在多个会话里，重放多个会话的事件
 *   窗口既慢又会漏（worker 会话被宿主回收后窗口就没了）；
 * - 卡片的真源本就在宿主的卡片库里，读它才是读事实。
 *
 * 卡片仍然随 `tool/result` 事件的 `meta` 投影进 session log（历史完整），但那
 * 是历史，不是看板的数据源。
 *
 * @module dsh-coordinator/client/project-board-data
 */

/** 看板刷新间隔（毫秒）。 */
export const BOARD_REFRESH_MS = 2000

/**
 * 解析会话所属项目。
 *
 * @param {(method: string, args: unknown[]) => Promise<unknown>} callRemote - 远程调用
 * @param {string} sessionId - 会话 id
 * @returns {Promise<object | undefined>} 项目摘要；不归属任何项目时 undefined
 */
export async function resolveProject(callRemote, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const project = await callRemote('resolveProject', [sessionId])
  if (project === null || typeof project !== 'object') return undefined
  return project
}

/**
 * 这个会话是不是该项目的协调者。
 *
 * 项目归属按 cwd 判定，同一个项目目录里的普通会话与 worker 也会解析到项目；
 * 看板只给项目会话看（协调者与该项目派出的 worker），同目录的普通会话在项目里
 * 干活，但不拥有这个看板的呈现面。
 *
 * @param {object | undefined} project - 项目摘要（含 `coordinatorSessionId`）
 * @param {string} sessionId - 当前面板所属会话
 * @returns {boolean} 是否为该项目的协调者会话
 */
export function isCoordinatorProject(project, sessionId) {
  const coordinator = project?.coordinatorSessionId
  return typeof coordinator === 'string' && coordinator !== '' && coordinator === sessionId
}

/**
 * 看板面板该显示什么。
 *
 * 把「归属、身份、协调者存活」三件事收敛成一个判定，面板的取卡条件与
 * 展示分支都读它，避免两处守卫各写一套。
 *
 * 看板属于**项目会话**：协调者与该项目派出的 worker 都能看，同一目录里的
 * 普通会话不能——它们在项目目录里干活，但不拥有这个项目的呈现面。
 *
 * - `no-project`：会话不属于任何项目；
 * - `coordinator-dead`：项目在，但绑定的协调者会话已失效（归档或被替换）；
 * - `not-viewable`：项目里能解析到，但当前会话既不是协调者也不是 worker
 *   （同目录的普通会话）；
 * - `coordinator` / `worker`：当前会话是协调者或该项目的 worker，可展示卡片。
 *
 * `coordinatorAlive` 为 `undefined`（不知道）时按「还在」处理，不误报失效。
 *
 * @param {object | undefined} project - 项目摘要
 * @param {string} sessionId - 当前面板所属会话
 * @param {boolean} [isWorker] - 当前会话是否是该项目的 worker
 * @returns {'no-project' | 'coordinator-dead' | 'not-viewable' | 'coordinator' | 'worker'} 视图状态
 */
export function boardViewState(project, sessionId, isWorker = false) {
  if (project === undefined) return 'no-project'
  if (project.coordinatorAlive === false) return 'coordinator-dead'
  if (isCoordinatorProject(project, sessionId)) return 'coordinator'
  if (isWorker) return 'worker'
  return 'not-viewable'
}

/**
 * 这个会话当前能不能看项目看板。
 *
 * @param {object | undefined} project - 项目摘要
 * @param {string} sessionId - 当前面板所属会话
 * @param {boolean} [isWorker] - 当前会话是否是该项目的 worker
 * @returns {boolean} 是否可展示看板
 */
export function isBoardViewable(project, sessionId, isWorker = false) {
  const view = boardViewState(project, sessionId, isWorker)
  return view === 'coordinator' || view === 'worker'
}

/**
 * 这个会话的右栏「看板」入口该不该出现。
 *
 * 入口跟着项目会话走：协调者与 worker 有，同目录的普通会话没有。协调者失效
 * 时入口仍然保留——点开是「去左栏换新协调者」的引导，藏起来等于把出口一起
 * 藏掉。
 *
 * @param {object | undefined} project - 项目摘要
 * @param {string} sessionId - 当前会话
 * @param {boolean} [isWorker] - 当前会话是否是该项目的 worker
 * @returns {boolean} 是否显示入口
 */
export function isBoardEntryVisible(project, sessionId, isWorker = false) {
  const view = boardViewState(project, sessionId, isWorker)
  return view !== 'no-project' && view !== 'not-viewable'
}

/**
 * 取每个项目下的 worker 会话。
 *
 * worker 是普通根会话，会话头里没有身份标记；谁是 worker 只有宿主侧的登记表
 * 知道，因此走项目通道一次问全量，比按会话逐个问省往返。
 *
 * @param {(method: string, args: unknown[]) => Promise<unknown>} callRemote - 远程调用
 * @returns {Promise<Map<string, Set<string>>>} 项目 id 到 worker 会话 id
 */
export async function fetchProjectWorkers(callRemote) {
  const groups = await callRemote('sessionsByProject', [])
  const table = new Map()
  if (!Array.isArray(groups)) return table
  for (const group of groups) {
    if (typeof group?.projectId !== 'string' || !Array.isArray(group.sessionIds)) continue
    const ids = group.sessionIds.filter((id) => typeof id === 'string' && id !== '')
    table.set(group.projectId, new Set(ids))
  }
  return table
}

/**
 * 这个会话是不是某个项目的 worker。
 *
 * @param {string} projectId - 项目 id
 * @param {string} sessionId - 会话 id
 * @param {Map<string, Set<string>>} workers - {@link fetchProjectWorkers} 的结果
 * @returns {boolean} 是否为该项目的 worker
 */
export function isProjectWorker(projectId, sessionId, workers) {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  const ids = workers?.get?.(projectId)
  return ids instanceof Set && ids.has(sessionId)
}

/**
 * 两份项目摘要是否描述同一个可展示状态。
 *
 * 面板每 30 秒复核一次项目：内容没变时保持旧对象引用，否则卡片取数的
 * effect 会跟着重启轮询。名字、协调者或存活状态变了才算变化——项目重命名后
 * 看板空态与提示文案要跟着换。
 *
 * @param {object | undefined} left - 旧摘要
 * @param {object | undefined} right - 新摘要
 * @returns {boolean} 是否等价
 */
export function sameProjectSummary(left, right) {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return left.id === right.id
    && left.name === right.name
    && left.coordinatorSessionId === right.coordinatorSessionId
    && left.coordinatorAlive === right.coordinatorAlive
}

/**
 * 取项目的看板卡片。
 *
 * @param {(method: string, args: unknown[]) => Promise<unknown>} callRemote - 远程调用
 * @param {string} projectId - 项目 id
 * @returns {Promise<object[]>} 卡片数组
 */
export async function fetchBoardCards(callRemote, projectId) {
  if (typeof projectId !== 'string' || projectId === '') return []
  const cards = await callRemote('boardCards', [projectId])
  return Array.isArray(cards) ? cards : []
}

/**
 * 两组卡片的 id 集合差：后出现的前者没有的 id。
 *
 * 判据是**新增**而不是内容变化：改卡不该把看板弹出来，只有项目里多了一张卡
 * 才值得打断用户。
 *
 * @param {readonly object[]} previous - 上一轮的卡片
 * @param {readonly object[]} next - 这一轮的卡片
 * @returns {string[]} 新增的卡片 id
 */
export function newCardIds(previous, next) {
  const known = new Set()
  for (const card of previous) {
    if (typeof card?.id === 'string') known.add(card.id)
  }
  const added = []
  for (const card of next) {
    if (typeof card?.id !== 'string' || known.has(card.id)) continue
    known.add(card.id)
    added.push(card.id)
  }
  return added
}
