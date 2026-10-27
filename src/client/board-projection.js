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
 * - `running`：槽位会话正在执行；
 * - `attention`：槽位会话最后一次执行失败；
 * - `idle`：槽位会话已知且空闲；
 * - `empty`：槽位没有绑定会话（未派工）；
 * - `unknown`：绑定了会话但客户端读不到它的状态（会话不可达）。
 *
 * `empty` 与 `unknown` 都不谎称空闲：前者根本没派活，后者状态不可知。
 */
export const SLOT_STATES = Object.freeze(['running', 'attention', 'idle', 'empty', 'unknown'])

/**
 * 卡片级信号灯档位。聚合规则见 {@link cardSignal}。
 */
export const CARD_SIGNALS = Object.freeze(['attention', 'running', 'idle', 'unknown', 'none'])

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
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type !== 'tool/result') continue
    const meta = event.data?.meta
    if (meta === undefined || meta.kind !== META_KIND) continue
    const projected = Array.isArray(meta.cards) ? meta.cards : []
    if (meta.scope === 'all') {
      cards.clear()
    }
    for (const card of projected) {
      if (card !== null && typeof card === 'object' && typeof card.id === 'string') {
        cards.set(card.id, card)
      }
    }
  }
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
 * @property {'running'|'attention'|'idle'|'empty'|'unknown'} state - 槽位状态
 */

/**
 * 会话的看板可见状态。
 *
 * @typedef {object} BoardSessionState
 * @property {boolean} running - 会话正在执行
 * @property {boolean} failed - 会话最后一次执行失败
 */

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
 * 等于在卡面上撒一个不实的信号。
 *
 * @param {string} sessionId - 绑定的会话 id
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @returns {'running'|'attention'|'idle'|'empty'|'unknown'} 槽位状态
 */
function slotStateOf(sessionId, states) {
  if (sessionId === '') return 'empty'
  const state = states.get(sessionId)
  if (state === undefined) return 'unknown'
  if (state.failed) return 'attention'
  if (state.running) return 'running'
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
 */
export function slotViewsForCard(card, states) {
  return slotBindingsOf(card).map(({ name, sessionId }) => ({
    name,
    sessionId,
    state: slotStateOf(sessionId, states),
  }))
}

/**
 * 卡片信号灯：由名下槽位会话聚合。
 *
 * 优先级：需注意 > 推进中 > 空闲 > 状态未知 > 未派工。
 * 「需注意」压过「推进中」：失败是更该先看的事实，worker 可能还在跑但已经错了。
 * 卡片本体不存信号——信号由会话状态实时推导。
 *
 * @param {object} card - 卡片
 * @param {ReadonlyMap<string, BoardSessionState>} states - 会话 id 到状态
 * @returns {'attention'|'running'|'idle'|'unknown'|'none'} 信号档位
 */
export function cardSignal(card, states) {
  if (card?.status === 'done') return 'none'
  const slots = slotViewsForCard(card, states)
  if (slots.length === 0) return 'none'
  if (slots.some((slot) => slot.state === 'attention')) return 'attention'
  if (slots.some((slot) => slot.state === 'running')) return 'running'
  if (slots.some((slot) => slot.state === 'idle')) return 'idle'
  if (slots.some((slot) => slot.state === 'unknown')) return 'unknown'
  return 'none'
}

/**
 * 信号档位的排序权重（值越小越靠前）。未派工与不可知都收在末尾。
 *
 * @param {string} signal - 信号档位
 * @returns {number} 权重
 */
function signalRank(signal) {
  switch (signal) {
    case 'attention': return 0
    case 'running': return 1
    case 'idle': return 2
    case 'unknown': return 3
    default: return 4
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
  const running = bound.some((binding) => states.get(binding.sessionId)?.running === true)
  if (running) return false
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
