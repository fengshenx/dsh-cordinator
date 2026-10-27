/**
 * 看板面板：从会话事件里重建任务卡片。
 *
 * 卡片数据不在浏览器侧另存一份，而是由宿主在卡片工具执行后随 `tool/result`
 * 事件的 `meta` 投影出来（见 `src/host/tools/cards.js`）。面板因此只需读本会话
 * 的事件窗口：按事件顺序重放卡片投影，全量投影清空视图、单卡投影覆盖一张卡。
 *
 * 卡面视觉与交互对齐 Telov 的看板（`components/board/`）：卡面零操作铬，
 * active 卡三层、done 卡单行并收进折叠区，空态与骨架同款。见
 * `.agents/notes/2026-10-27-board-card-visual-and-interaction.md`。
 *
 * 信号灯不落存储：推进/需注意/空闲由槽位绑定的会话状态实时推导。子会话的
 * `running` 只有在保留该会话后从 `SessionSnapshot` 读才准（会话列表对未保留的
 * subagent 子会话给的是默认值），保留失败就显示未知，不谎称空闲。
 *
 * @module dsh-coordinator/client/board
 */

import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectCards,
  loadHistory,
  slotBindingsOf,
  sortActiveCards,
  sortDoneCards,
} from './board-projection.js'
import { BoardCard } from './board-card.js'
import { CardDetail } from './card-detail.js'
import { ensureBoardStyles } from './board-styles.js'
import { productIcon } from './icons.js'

/**
 * 看板面板主体。
 *
 * @param {object} props - slot 注入的运行时属性
 * @param {string} props.sessionId - 面板所属会话
 * @param {() => object | undefined} props.getSessions - 取会话服务的延迟取值器
 * @param {() => object | undefined} props.getUiWorkspace - 取导航服务的延迟取值器
 * @returns {object} React 元素
 */
export function BoardBody(props) {
  const { sessionId, getSessions, getUiWorkspace } = props
  return createElement(BoardPanel, { sessionId, getSessions, getUiWorkspace })
}

/**
 * 槽位会话的状态表。
 *
 * 保留会话是为了读 `SessionSnapshot.running` 与 `lastAgentError`——会话列表对
 * 未保留的 subagent 子会话给的是默认 `false`，据此说「空闲」是撒谎。保留失败
 * （宿主不认识该会话 id）时状态表里没有这一项，槽位显示为「未知」。
 *
 * @param {object[]} cards - 当前卡片
 * @param {() => object | undefined} getSessions - 取会话服务的延迟取值器
 * @returns {Map<string, { running: boolean, failed: boolean }>} 会话 id 到状态
 */
function useSlotStates(cards, getSessions) {
  const [states, setStates] = useState(() => new Map())
  const retained = useRef(new Map())

  useEffect(() => {
    const sessions = getSessions()
    if (sessions === undefined || sessions === null) return undefined

    const needed = new Set()
    for (const card of cards) {
      for (const binding of slotBindingsOf(card)) {
        if (binding.sessionId !== '') needed.add(binding.sessionId)
      }
    }

    for (const [sessionId, entry] of retained.current) {
      if (needed.has(sessionId)) continue
      entry.unsubscribe?.()
      entry.reference.release()
      retained.current.delete(sessionId)
      setStates((previous) => {
        const next = new Map(previous)
        next.delete(sessionId)
        return next
      })
    }

    for (const sessionId of needed) {
      if (retained.current.has(sessionId)) continue
      let reference
      try {
        reference = sessions.retain(sessionId, { source: 'dshCoordinatorBoard' })
      } catch {
        // 宿主不认识这个会话 id：状态保持未知，不谎称空闲
        continue
      }
      const entry = { reference, unsubscribe: undefined }
      retained.current.set(sessionId, entry)
      reference.ready
        .then((binding) => {
          // 保留期间卡片撤掉了该槽位：会话已被释放，不再订阅它的快照
          if (retained.current.get(sessionId) !== entry) return
          const read = () => {
            const snapshot = binding.session.getSnapshot()
            setStates((previous) => {
              const next = new Map(previous)
              next.set(sessionId, {
                running: snapshot.running === true,
                failed: typeof snapshot.lastAgentError === 'string' && snapshot.lastAgentError !== '',
              })
              return next
            })
          }
          read()
          entry.unsubscribe = binding.session.subscribe(read)
        })
        .catch(() => {
          // 保留失败：状态表里不出现这一项，槽位显示为未知
        })
    }
    return undefined
  }, [cards, getSessions])

  useEffect(() => () => {
    for (const entry of retained.current.values()) {
      entry.unsubscribe?.()
      entry.reference.release()
    }
    retained.current.clear()
  }, [])

  return states
}

/**
 * 空态。
 *
 * @param {object} props - 组件属性
 * @param {boolean} props.allDone - 是否全部完成
 * @returns {object} React 元素
 */
function BoardEmpty({ allDone }) {
  return createElement(
    'div',
    { className: 'dsh-coordinator-board-empty' },
    createElement(
      'div',
      {
        className: allDone
          ? 'dsh-coordinator-board-empty-icon dsh-coordinator-board-empty-icon-success'
          : 'dsh-coordinator-board-empty-icon',
      },
      allDone
        ? productIcon('check-circle-outline', { size: 24 })
        : productIcon('checklist-outline', { size: 24 }),
    ),
    createElement(
      'div',
      { className: 'dsh-coordinator-board-empty-title' },
      allDone ? '全部完成' : '还没有卡片',
    ),
    createElement(
      'div',
      { className: 'dsh-coordinator-board-empty-hint' },
      allDone ? '本会话的卡片都已完成' : '协调者调用 create_card 后，卡片会出现在这里',
    ),
  )
}

/**
 * 看板面板主体实现。
 *
 * @param {object} props - 组件属性
 * @param {string} props.sessionId - 面板所属会话
 * @param {() => object | undefined} props.getSessions - 取会话服务的延迟取值器
 * @param {() => object | undefined} props.getUiWorkspace - 取导航服务的延迟取值器
 * @returns {object} React 元素
 */
function BoardPanel({ sessionId, getSessions, getUiWorkspace }) {
  const [cards, setCards] = useState([])
  const [error, setError] = useState(null)
  const [history, setHistory] = useState('loading')
  const [detail, setDetail] = useState(null)
  const [doneOpen, setDoneOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    ensureBoardStyles()
  }, [])

  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const sessions = getSessions()
    if (sessions === undefined || sessions === null) {
      setError('会话服务不可用，看板无法读取卡片')
      return undefined
    }
    let cancelled = false
    let unsubscribe
    let reference
    try {
      reference = sessions.retain(sessionId, { source: 'dshCoordinatorBoard' })
    } catch (cause) {
      setError(`读取会话失败：${cause instanceof Error ? cause.message : String(cause)}`)
      return undefined
    }
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
  }, [sessionId, getSessions])

  const states = useSlotStates(cards, getSessions)

  const { active, done } = useMemo(() => ({
    active: sortActiveCards(
      cards.filter((card) => card.status === 'active'),
      states,
    ),
    done: sortDoneCards(cards.filter((card) => card.status === 'done')),
  }), [cards, states])

  const openSession = (targetSessionId) => {
    const uiWorkspace = getUiWorkspace?.()
    if (uiWorkspace === undefined || uiWorkspace === null) return
    uiWorkspace.openSession(targetSessionId)
  }

  if (error !== null) {
    return createElement(
      'div',
      { className: 'dsh-coordinator-board-empty' },
      createElement('div', { className: 'dsh-coordinator-board-empty-title' }, error),
    )
  }

  if (cards.length === 0 && history !== 'complete') {
    return createElement(
      'div',
      { className: 'dsh-coordinator-board-list' },
      createElement(
        'div',
        { className: 'dsh-coordinator-board-group' },
        createElement('div', { className: 'dsh-coordinator-board-skeleton' }),
        createElement('div', { className: 'dsh-coordinator-board-skeleton' }),
        createElement('div', { className: 'dsh-coordinator-board-skeleton' }),
      ),
    )
  }

  if (cards.length === 0) {
    return createElement(
      'div',
      { className: 'dsh-coordinator-board-list' },
      createElement(BoardEmpty, { allDone: false }),
    )
  }

  const openDetail = (card, anchor) => { setDetail({ card, anchor }) }

  return createElement(
    'div',
    { className: 'dsh-coordinator-board' },
    createElement(
      'div',
      { className: 'dsh-coordinator-board-list' },
      history === 'partial'
        ? createElement(
            'div',
            { className: 'dsh-coordinator-board-empty-hint' },
            '仅显示已加载的历史片段，更早的记录未加载。',
          )
        : null,
      active.length > 0
        ? createElement(
            'div',
            { className: 'dsh-coordinator-board-group' },
            active.map((card) => createElement(BoardCard, {
              key: card.id,
              card,
              states,
              now,
              onOpenDetail: openDetail,
              onOpenSession: openSession,
            })),
          )
        : null,
      active.length === 0 ? createElement(BoardEmpty, { allDone: true }) : null,
      done.length > 0
        ? createElement(
            'div',
            { className: 'dsh-coordinator-board-done-section' },
            createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-coordinator-board-done-toggle',
                'aria-expanded': doneOpen,
                onClick: () => { setDoneOpen(!doneOpen) },
              },
              createElement(
                'span',
                {
                  className: doneOpen
                    ? 'dsh-coordinator-board-done-chevron dsh-coordinator-board-done-chevron-open'
                    : 'dsh-coordinator-board-done-chevron',
                },
                productIcon('chevron-right-outline', { size: 14 }),
              ),
              '已完成',
              createElement('span', { className: 'dsh-coordinator-board-done-count' }, String(done.length)),
            ),
            doneOpen
              ? createElement(
                  'div',
                  { className: 'dsh-coordinator-board-group' },
                  done.map((card) => createElement(BoardCard, {
                    key: card.id,
                    card,
                    states,
                    now,
                    onOpenDetail: openDetail,
                    onOpenSession: openSession,
                  })),
                )
              : null,
          )
        : null,
    ),
    detail === null
      ? null
      : createElement(CardDetail, {
          card: detail.card,
          onClose: () => { setDetail(null) },
          restoreFocus: detail.anchor,
        }),
  )
}
