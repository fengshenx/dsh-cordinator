/**
 * 看板的纯投影逻辑。
 *
 * 从会话事件窗口还原卡片列表，以及补齐未加载的历史。两部分都不碰 React，
 * 便于单测——面板组件只负责渲染。
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
