/**
 * 看板面板：从会话事件里重建任务卡片。
 *
 * 卡片数据不在浏览器侧另存一份，而是由宿主在卡片工具执行后随 `tool/result`
 * 事件的 `meta` 投影出来（见 `src/host/tools/cards.js`）。面板因此只需读本会话
 * 的事件窗口：按事件顺序重放卡片投影，全量投影清空视图、单卡投影覆盖一张卡。
 *
 * @module dsh-coordinator/client/board
 */

import { createElement, useEffect, useState } from 'react'

/** 宿主投影的卡片数据标记。 */
const META_KIND = 'dsh-coordinator-cards'

/**
 * 补齐历史时最多翻的页数。每页按 Turn 对齐，最少 50 条事件；设上限是为了在
 * `loadOlder` 失败（宿主只记日志不抛错）时不会无限循环。
 */
const MAX_HISTORY_PAGES = 20

/**
 * 逐页加载更早的历史，直到窗口没有更早记录。
 *
 * 事件窗口初始只装最近一页，早期建卡/改卡的投影不在其中——只重放窗口内的
 * 投影会把「全量投影是权威快照」的前提打破：窗口内若有 `list_cards` 的全量
 * 投影，它代表的是完整列表，却被窗口内的部分视图覆盖。
 *
 * @param {object} binding - 会话绑定
 * @returns {Promise<boolean>} 是否已加载到最早的历史
 */
async function loadHistory(binding) {
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    if (!binding.eventSource.getSnapshot().hasMore) return true
    await binding.session.loadOlder()
  }
  return !binding.eventSource.getSnapshot().hasMore
}

/**
 * 重放事件窗口里的卡片投影。
 * @param {readonly object[]} entries - 会话事件窗口条目
 * @returns {object[]} 按编号升序排列的卡片
 */
function collectCards(entries) {
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
 * 状态徽标配色。
 * @param {string} status - 卡片状态
 * @returns {string} 徽标颜色
 */
function statusColor(status) {
  if (status === 'done') return '#3fb950'
  if (status === 'archived') return '#8b949e'
  return '#d29922'
}

/**
 * 状态中文名。
 * @param {string} status - 卡片状态
 * @returns {string} 状态显示名
 */
function statusLabel(status) {
  if (status === 'done') return '已完成'
  if (status === 'archived') return '已归档'
  return '进行中'
}

/**
 * 看板面板主体。
 * @param {object} props - slot 注入的运行时属性
 * @param {string} props.sessionId - 面板所属会话
 * @param {() => object | undefined} props.getSessions - 取会话服务的延迟取值器
 * @returns {object} React 元素
 */
export function BoardBody(props) {
  const { sessionId, getSessions } = props
  const [cards, setCards] = useState([])
  const [error, setError] = useState(null)
  const [history, setHistory] = useState('loading')

  useEffect(() => {
    const sessions = getSessions()
    if (sessions === undefined || sessions === null) {
      setError('会话服务不可用，看板无法读取卡片')
      return undefined
    }
    let cancelled = false
    let unsubscribe
    const reference = sessions.retain(sessionId, { source: 'dshCoordinatorBoard' })
    reference.ready
      .then((binding) => {
        if (cancelled) return
        const read = () => { setCards(collectCards(binding.eventSource.getSnapshot().entries)) }
        read()
        unsubscribe = binding.eventSource.subscribe(read)
        return loadHistory(binding).then((complete) => {
          if (cancelled) return
          setHistory(complete ? 'complete' : 'partial')
          read()
        })
      })
      .catch((cause) => {
        if (!cancelled) setError(`读取会话失败：${cause instanceof Error ? cause.message : String(cause)}`)
      })
    return () => {
      cancelled = true
      if (unsubscribe !== undefined) unsubscribe()
      reference.release()
    }
  }, [sessionId])

  if (error !== null) {
    return createElement('div', { style: { padding: '12px', color: '#f85149', fontSize: '13px' } }, error)
  }

  const notice = history === 'loading'
    ? '正在加载更早的历史…'
    : history === 'partial'
      ? '仅显示已加载的历史片段，更早的记录未加载。'
      : null

  if (cards.length === 0 && history !== 'complete') {
    return createElement('div', { style: { padding: '12px', color: '#8b949e', fontSize: '13px' } }, notice)
  }

  if (cards.length === 0) {
    return createElement(
      'div',
      { style: { padding: '12px', color: '#8b949e', fontSize: '13px', lineHeight: '1.6' } },
      '本会话还没有卡片。',
      createElement('br'),
      '协调者调用 create_card 后，卡片会出现在这里。',
    )
  }

  return createElement(
    'div',
    { style: { padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' } },
    notice === null
      ? null
      : createElement(
          'div',
          { style: { fontSize: '12px', color: '#8b949e', padding: '0 2px' } },
          notice,
        ),
    cards.map((card) => createElement(
      'div',
      {
        key: card.id,
        style: {
          border: '1px solid rgba(125, 133, 144, 0.35)',
          borderRadius: '6px',
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        },
      },
      createElement(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        createElement('span', { style: { fontSize: '12px', color: '#8b949e' } }, `#${card.number ?? '?'}`),
        createElement('span', { style: { fontSize: '13px', fontWeight: 600, flex: 1 } }, card.title ?? ''),
        createElement(
          'span',
          { style: { fontSize: '11px', color: statusColor(card.status), border: `1px solid ${statusColor(card.status)}`, borderRadius: '10px', padding: '0 6px' } },
          statusLabel(card.status),
        ),
      ),
      typeof card.spec === 'string' && card.spec !== ''
        ? createElement('div', { style: { fontSize: '12px', color: '#8b949e', whiteSpace: 'pre-wrap' } }, card.spec)
        : null,
      card.checkpoint?.summary
        ? createElement(
            'div',
            { style: { fontSize: '12px', color: '#c9d1d9', borderLeft: '2px solid rgba(125, 133, 144, 0.5)', paddingLeft: '6px' } },
            card.checkpoint.summary,
          )
        : null,
    )),
  )
}
