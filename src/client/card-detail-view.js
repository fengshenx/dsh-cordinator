/**
 * 卡片详情浮层的内容分段。
 *
 * 浮层只读，展示什么由卡片决定：说明、当前进展、下一步、阻塞、链接。哪几段
 * 该出现是纯判定，拆出来是为了能直接断言「没有进展就不出现「当前进展」段」，
 * 而不是靠肉眼数 DOM。
 *
 * @module dsh-coordinator/client/card-detail-view
 */

/** 卡片没写说明时的占位文案。 */
export const DETAIL_SPEC_EMPTY = '这张卡还没有写说明。'

/**
 * 状态徽章文案。
 *
 * @param {string} status - 卡片状态
 * @returns {string} 徽章文案
 */
export function statusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'archived') return '已归档'
  return '进行中'
}

/**
 * 详情浮层的分段内容。
 *
 * @param {object} card - 卡片
 * @returns {{ spec: string | null, checkpoint: { title: string, text: string }[], links: object[] }} 分段
 */
export function detailSections(card) {
  const spec = typeof card?.spec === 'string' && card.spec !== '' ? card.spec : null
  const checkpoint = card?.checkpoint
  const sections = []
  for (const [title, text] of [
    ['当前进展', checkpoint?.summary],
    ['下一步', checkpoint?.nextAction],
    ['阻塞', checkpoint?.blocker],
  ]) {
    if (typeof text === 'string' && text !== '') sections.push({ title, text })
  }
  return {
    spec,
    checkpoint: sections,
    links: Array.isArray(card?.links) ? card.links : [],
  }
}
