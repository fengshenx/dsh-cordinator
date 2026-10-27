/**
 * 看板的纯投影逻辑。
 *
 * 三部分都不碰 React，便于单测——面板组件只负责渲染：
 *
 * - **事件重放**：从会话事件窗口还原卡片列表，并补齐未加载的历史；
 * - **看板投影**：把卡片与槽位会话状态投影成信号灯、排序与停滞判定；
 * - **排布计算**：链接 chip 一行放得下几个。
 *
 * 信号灯是实时投影零存储：推进/需注意/空闲/未知全部由槽位绑定的会话状态推导，
 * 卡片本体只存显式状态（active/done/archived）。发现任何「可从会话推导的字段落进
 * 卡片存储」即为设计缺陷。
 *
 * @module dsh-coordinator/client/board-projection
 */

/** 宿主投影的卡片数据标记。 */
export const META_KIND = 'dsh-coordinator-cards'

/**
 * 补齐历史时最多翻的页数。每页按 Turn 对齐，最少 50 条事件；设上限是为了在
 * `loadOlder` 失败（宿主只记日志不抛错）时不会无限循环。
 */
export const MAX_HISTORY_PAGES = 20

/**
 * 停滞阈值：名下有会话但 24h 无活动。照抄 Telov 的 `STALLED_THRESHOLD_MS`。
 */
export const STALLED_THRESHOLD_MS = 24 * 60 * 60 * 1000

/**
 * 槽位状态。
 *
 * - `waiting`：槽位会话在等用户交互（宿主发布了待处理交互请求）；
 * - `attention`：槽位会话最后一次执行失败；
 * - `running`：槽位会话正在执行；
 * - `unread`：槽位会话已停下，且这次停止还没被主视图确认；
 * - `idle`：槽位会话已知且空闲；
 * - `empty`：槽位没有绑定会话（未派工）；
 * - `unknown`：绑定了会话但客户端读不到它的状态（会话不可达）。
 *
 * `empty` 与 `unknown` 都不谎称空闲：前者根本没派活，后者状态不可知。
 */
export const SLOT_STATES = Object.freeze([
  'waiting', 'attention', 'running', 'unread', 'idle', 'empty', 'unknown',
])

/**
 * 卡片级信号灯档位。聚合规则见 {@link cardSignal}。
 */
export const CARD_SIGNALS = Object.freeze([
  'waiting', 'attention', 'running', 'unread', 'idle', 'unknown', 'none',
])

/**
 * 把一段事件条目里的卡片投影写进卡片表。
 *
 * 全量投影（`scope:'all'`）是权威快照，会清空此前的视图；单卡投影
 * （`scope:'card'`）覆盖同 id 的那一张。
 *
 * @param {Map<string, object>} cards - 卡片表（原地修改）
 * @param {readonly object[]} entries - 会话事件窗口条目
 * @returns {boolean} 卡片表是否变化
 */
function applyEntries(cards, entries) {
  let changed = false
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type !== 'tool/result') continue
    const meta = event.data?.meta
    if (meta === undefined || meta.kind !== META_KIND) continue
    const projected = Array.isArray(meta.cards) ? meta.cards : []
    if (meta.scope === 'all') {
      if (cards.size > 0) changed = true
      cards.clear()
    }
    for (const card of projected) {
      if (card === null || typeof card !== 'object' || typeof card.id !== 'string') continue
      const previous = cards.get(card.id)
      // 卡片带 revision 时才算同一版本；没有 revision 的卡片按后写覆盖
      if (previous !== undefined
        && previous.revision !== undefined
        && previous.revision === card.revision) {
        continue
      }
      cards.set(card.id, card)
      changed = true
    }
  }
  return changed
}

/**
 * 两张卡片表是否等价。
 *
 * 卡片带 `revision`（卡片存储保证单调递增），同 id 同 revision 即同一版本。
 *
 * @param {ReadonlyMap<string, object>} left - 左表
 * @param {ReadonlyMap<string, object>} right - 右表
 * @returns {boolean} 是否等价
 */
function sameCardTable(left, right) {
  if (left.size !== right.size) return false
  for (const [id, card] of left) {
    const other = right.get(id)
    if (other === undefined || other.revision !== card.revision) return false
  }
  return true
}

/**
 * 用宿主的事件增量更新卡片表。
 *
 * 宿主的事件窗口「每接受一次变更就同步发布一次」（`packages/api/session-controller/
 * src/client/contract/events.ts:119`），流式输出时每个 chunk 都是一次 append。
 * 每次都全量重放整个窗口，等于把「窗口有多大」乘上「chunk 有多少」——这是看板
 * 在协调者流式输出时卡顿的主因。
 *
 * 增量的边界按宿主给的 `change` 分派：`append` 与 `settle-assistant` 只处理增量
 * 条目；`replace` 与 `prepend` 全量重建——`prepend` 往窗口前面补历史，早到的
 * 投影与后到的投影谁作数取决于窗口顺序，只有全量重放能定。卡片表为空时同样
 * 全量重建：增量条目只覆盖增量部分，空表靠增量拼不出完整的视图。
 *
 * @param {ReadonlyMap<string, object>} previous - 上一轮的卡片表
 * @param {object} change - 宿主事件窗口的增量
 * @param {readonly object[]} entries - 当前窗口的全部条目
 * @returns {{ cards: Map<string, object>, changed: boolean }} 更新后的卡片表与是否变化
 */
export function applyEventChange(previous, change, entries) {
  const full = change === undefined
    || change.kind === 'replace'
    || change.kind === 'prepend'
    || previous.size === 0
  if (full) {
    const cards = new Map()
    applyEntries(cards, entries)
    return { cards, changed: !sameCardTable(previous, cards) }
  }
  const delta = change.kind === 'append'
    ? change.entries
    : (change.entry === undefined ? [] : [change.entry])
  if (delta.length === 0) return { cards: previous, changed: false }
  const cards = new Map(previous)
  const changed = applyEntries(cards, delta)
  // 增量条目里没有卡片投影时保持原引用：换了引用等于告诉渲染层「卡片变了」，
  // 整棵看板会白重渲染一次。settle-assistant 带 entry 的情形正是如此。
  if (!changed) return { cards: previous, changed: false }
  return { cards, changed }
}

/**
 * 重放事件窗口里的卡片投影。
 *
 * 全量投影（`scope:'all'`）是权威快照，会清空此前的视图；单卡投影
 * （`scope:'card'`）覆盖同 id 的那一张。
 *
 * @param {readonly object[]} entries - 会话事件窗口条目
 * @returns {object[]} 按编号升序排列的卡片
 */
export function collectCards(entries) {
  const cards = new Map()
  applyEntries(cards, entries)
  return [...cards.values()].sort((left, right) => (left.number ?? 0) - (right.number ?? 0))
}

/**
 * 逐页加载更早的历史，直到窗口没有更早记录。
 *
 * 事件窗口初始只装最近一页，早期建卡/改卡的投影不在其中——只重放窗口内的
 * 投影会把「全量投影是权威快照」的前提打破：窗口内若有 `list_cards` 的全量
 * 投影，它代表的是完整列表，却被窗口内的部分视图覆盖。
 *
 * @param {object} binding - 会话绑定
 * @param {number} [maxPages] - 最多翻的页数
 * @returns {Promise<boolean>} 是否已加载到最早的历史
 */
export async function loadHistory(binding, maxPages = MAX_HISTORY_PAGES) {
  for (let page = 0; page < maxPages; page += 1) {
    if (!binding.eventSource.getSnapshot().hasMore) return true
    await binding.session.loadOlder()
  }
  return !binding.eventSource.getSnapshot().hasMore
}

/**
 * 槽位的看板状态。
 *
 * @typedef {object} BoardSlotView
 * @property {string} name - 槽位名
 * @property {string} sessionId - 绑定的会话 id；未绑定时为空串
 * @property {'waiting'|'attention'|'running'|'unread'|'idle'|'empty'|'unknown'} state - 槽位状态
 */

/**
 * 会话的看板可见状态。
 *
 * @typedef {object} BoardSessionState
 * @property {boolean} known - 是否读到了该会话的状态
 * @property {boolean} running - 会话正在执行
 * @property {boolean} waiting - 会话在等用户交互
 * @property {boolean} unread - 会话已停下且未被主视图确认
 * @property {boolean} failed - 会话最后一次执行失败
 */

/**
 * 合并两个来源的会话状态。
 *
 * `status` 是宿主客户端状态存储给的会话状态（`SessionStatus`：权威运行态、
 * 待处理交互、未读确认），`snapshot` 是保留会话后从 `SessionSnapshot` 读到的
 * 失败信息——宿主没有在会话状态里带失败原因，那一项只能从会话快照取。
 *
 * 宿主给出运行态但它还没建立基线（`running` 为 `undefined`）时，状态判为未知：
 * 快照里的 `running` 对 subagent 子会话是列表兜底值，据此说「空闲」是撒谎。
 *
 * @param {object|undefined} status - 宿主会话状态
 * @param {object|undefined} snapshot - 保留会话的快照状态
 * @returns {BoardSessionState} 合并后的状态
 */
export function mergeSessionState(status, snapshot) {
  if (status !== undefined) {
    return {
      known: status.running !== undefined,
      running: status.running === true,
      waiting: status.pendingInteraction !== undefined,
      unread: status.completionUnread === true,
      failed: snapshot?.failed === true,
    }
  }
  return {
    known: snapshot !== undefined,
    running: snapshot?.running === true,
    waiting: false,
    unread: false,
    failed: snapshot?.failed === true,
  }
}

/**
 * 取卡片绑定的槽位。
 *
 * 槽位绑定是 `{ 槽位名: { sessionId } }`；结构不对的条目整体跳过，不猜。
 * 槽位存在但没有可用 sessionId 时保留该槽位（状态为 `empty`）：「这个角色还没
 * 派工」本身就是要显示的状态。
 *
 * @param {object} card - 卡片
 * @returns {Array<{ name: string, sessionId: string }>} 槽位名与绑定会话 id
 */
export function slotBindingsOf(card) {
  const slots = card?.slots
  if (slots === null || typeof slots !== 'object' || Array.isArray(slots)) return []
  const bindings = []
  for (const [name, binding] of Object.entries(slots)) {
    if (binding === null || typeof binding !== 'object' || Array.isArray(binding)) continue
    const sessionId = typeof binding.sessionId === 'string' && binding.sessionId !== ''
      ? binding.sessionId
      : ''
    bindings.push({ name, sessionId })
  }
  return bindings
}

/**
 * 单个槽位的状态。
 *
 * 绑定了会话但状态读不到时是 `unknown` 而不是 `idle`：把不可知说成空闲，
 * 等于在卡面上撒一个不实的信号。档位顺序照抄 Telov 的 `sessionSignalRank`
 * （等你输入 > 需注意 > 执行中 > 未读 > 空闲）。
 *
 * @param {string} sessionId - 绑定的会话 id
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @returns {'waiting'|'attention'|'running'|'unread'|'idle'|'empty'|'unknown'} 槽位状态
 */
function slotStateOf(sessionId, states) {
  if (sessionId === '') return 'empty'
  const state = states.get(sessionId)
  if (state === undefined || !state.known) return 'unknown'
  if (state.waiting) return 'waiting'
  if (state.failed) return 'attention'
  if (state.running) return 'running'
  if (state.unread) return 'unread'
  return 'idle'
}

/**
 * 卡片的全部槽位视图（声明序 = 卡片 `slots` 的键序）。
 *
 * 只列卡片自己声明的槽位：dsh 的槽位集合由项目 `SLOTS.md` 决定，客户端不知道，
 * 渲染没声明的槽位等于宣称存在一个不存在的 worker。
 *
 * @param {object} card - 卡片
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @returns {BoardSlotView[]} 槽位视图
 */export function slotViewsForCard(card, states) {
  return slotBindingsOf(card).map(({ name, sessionId }) => ({
    name,
    sessionId,
    state: slotStateOf(sessionId, states),
  }))
}

/**
 * 卡片信号灯：由名下槽位会话聚合。
 *
 * 取名下槽位里档位最高的一档。优先级：等你输入 > 需注意 > 执行中 > 未读 >
 * 空闲 > 未派工 > 状态未知。等你输入压过需注意——有人在等你，别的都不急；
 * 需注意压过执行中：失败是更该先看的事实，worker 可能还在跑但已经错了。
 * 卡片本体不存信号——信号由会话状态实时推导。
 *
 * @param {object} card - 卡片
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @returns {'waiting'|'attention'|'running'|'unread'|'idle'|'unknown'|'none'} 信号档位
 */
export function cardSignal(card, states) {
  if (card?.status === 'done') return 'none'
  const slots = slotViewsForCard(card, states)
  if (slots.length === 0) return 'none'
  let best = 'none'
  let bestRank = signalRank('none')
  for (const slot of slots) {
    const rank = signalRank(slot.state)
    if (rank < bestRank) {
      best = slot.state
      bestRank = rank
    }
  }
  return best
}

/**
 * 信号档位的排序权重（值越小越靠前）。
 *
 * 未派工与不可知都收在末尾；未派工与「无信号」同权重——卡片有槽位但都没派活，
 * 卡片级的说法就是「无信号」，把「未派工」抬到卡片级等于宣称存在一个状态档。
 *
 * @param {string} signal - 信号档位
 * @returns {number} 权重
 */
function signalRank(signal) {
  switch (signal) {
    case 'waiting': return 0
    case 'attention': return 1
    case 'running': return 2
    case 'unread': return 3
    case 'idle': return 4
    case 'unknown': return 6
    default: return 7
  }
}

/**
 * 收件箱序排序 active 卡：信号档位升序 → 显式 sortOrder 升序（未设置排后）→
 * 最后活动降序 → 编号升序。与 Telov 的 `sortActiveCards` 同序，档位按 dsh 可得状态收敛。
 *
 * @param {readonly object[]} cards - 卡片列表
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @returns {object[]} 排好序的卡片
 */
export function sortActiveCards(cards, states) {
  return [...cards].sort((left, right) => {
    const rank = signalRank(cardSignal(left, states)) - signalRank(cardSignal(right, states))
    if (rank !== 0) return rank
    if (left.sortOrder !== right.sortOrder) {
      if (left.sortOrder === undefined) return 1
      if (right.sortOrder === undefined) return -1
      return left.sortOrder - right.sortOrder
    }
    const activity = (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    if (activity !== 0) return activity
    return (left.number ?? 0) - (right.number ?? 0)
  })
}

/**
 * done 卡按完成时间倒序（折叠区展示序）。
 *
 * @param {readonly object[]} cards - 卡片列表
 * @returns {object[]} 排好序的卡片
 */
export function sortDoneCards(cards) {
  return [...cards].sort((left, right) => {
    const activity = (right.doneAt ?? right.updatedAt ?? 0) - (left.doneAt ?? left.updatedAt ?? 0)
    if (activity !== 0) return activity
    return (left.number ?? 0) - (right.number ?? 0)
  })
}

/**
 * 停滞判定：名下有会话、会话都不在跑、且超过阈值没有更新。
 *
 * 没有绑定会话的卡不参与停滞计时——那是「没开始」不是「卡住」。会话正在跑的卡
 * 同样不算停滞——它正在干活，只是协调者没更新卡片。
 *
 * 状态不可知的会话也不算停滞：读不到运行态不等于它停了，断言「卡住」同样是
 * 撒谎。这与信号灯的口径一致——状态不可知显示「状态未知」，不冒充空闲。
 *
 * 活动的度量只能用卡片自己的 `updatedAt`：dsh 会话列表的 `updatedAt` 是「最后一次
 * 被提示的时间」（`packages/api/session-controller/src/list.ts:360`），不是会话的
 * 最后活动时间，拿它当活动度量会把「在跑」误判成「卡住」。
 *
 * @param {object} card - 卡片
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @param {number} now - 当前时间戳
 * @returns {boolean} 是否停滞
 */
export function isCardStalled(card, states, now) {
  if (card?.status !== 'active') return false
  const bound = slotBindingsOf(card).filter((binding) => binding.sessionId !== '')
  if (bound.length === 0) return false
  const boundStates = bound.map((binding) => states.get(binding.sessionId))
  if (boundStates.some((state) => state === undefined || state.known !== true)) return false
  if (boundStates.some((state) => state.running === true)) return false
  return now - (card.updatedAt ?? 0) > STALLED_THRESHOLD_MS
}

/**
 * 时长展示（Xd / Xh）。
 *
 * 差值钳制非负：完成瞬间 `doneAt` 可能领先渲染层的 `now`，负数一律显示 0h。
 *
 * @param {number} since - 起始时间戳
 * @param {number} now - 当前时间戳
 * @returns {string} 时长文案
 */
export function formatDuration(since, now) {
  const hours = Math.floor(Math.max(0, now - since) / (60 * 60 * 1000))
  return hours >= 24 ? `${Math.floor(hours / 24)}d` : `${hours}h`
}

/**
 * 一行放得下几个链接 chip。
 *
 * 宽度没量出来时返回全部：测量发生在布局之后，首帧还没有布局数据，此时全量展示
 * 而不是藏链接。只有「放不下全部」才为「+N」预留一格；预留后连第一个都放不下
 * 则返回 0，让唯一可见入口是自己。
 *
 * @param {object} input - 输入
 * @param {number} input.availableWidth - 链接行可用宽度（已扣掉左侧缩进）
 * @param {readonly number[]} input.chipWidths - 各 chip 的实测宽度，按渲染顺序
 * @param {number} input.overflowWidth - 「+N」chip 的实测宽度
 * @param {number} input.gap - 相邻 chip 间距
 * @returns {number} 可见 chip 数
 */
export function fitLinkChips({ availableWidth, chipWidths, overflowWidth, gap }) {
  const total = chipWidths.length
  if (total === 0) return 0
  const usable = (value) => Number.isFinite(value) && value > 0
  if (
    !usable(availableWidth)
    || !Number.isFinite(overflowWidth)
    || overflowWidth < 0
    || !Number.isFinite(gap)
    || gap < 0
    || chipWidths.some((width) => !usable(width))
  ) {
    return total
  }
  let used = 0
  let visible = 0
  for (const [index, width] of chipWidths.entries()) {
    const next = used + (index > 0 ? gap : 0) + width
    // 这一格放下之后，若还有剩余 chip，还得容得下「间距 + +N」
    const fitsOverflowAfter = index === chipWidths.length - 1 || next + gap + overflowWidth <= availableWidth
    if (next > availableWidth || !fitsOverflowAfter) break
    used = next
    visible = index + 1
  }
  return visible
}
