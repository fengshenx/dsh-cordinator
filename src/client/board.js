/**
 * 看板面板：项目维度的任务看板。
 *
 * 看板是**项目**的看板：一个项目一个看板。面板先按自己所属的会话解析出项目，
 * 再从宿主取该项目的全部卡片（`src/client/project-board-data.js`）——协调者建的
 * 卡与 worker 建的卡在同一处，不再是「卡建在哪个会话就只能在哪看到」。
 *
 * 卡面视觉与交互对齐 Telov 的看板（`components/board/`）：卡面零操作铬，
 * active 卡三层、done 卡单行并收进折叠区，空态与骨架同款。见
 * `.agents/notes/2026-10-27-board-card-visual-and-interaction.md`。
 *
 * 信号灯不落存储：等你输入/需注意/执行中/未读/空闲由槽位绑定的会话状态实时
 * 推导。运行态取宿主的会话状态存储（`useSessionStatus`），那是宿主按
 * `api-session/status` 事件维护的权威值；会话列表对未保留的 subagent 子会话给
 * 的是兜底值，据此说「空闲」是撒谎。失败原因只在会话快照里，保留会话取它。
 *
 * @module dsh-coordinator/client/board
 */

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mergeSessionState,
  slotBindingsOf,
  sortActiveCards,
  sortDoneCards,
} from './board-projection.js'
import { BOARD_REFRESH_MS, fetchBoardCards, resolveProject } from './project-board-data.js'
import { SlotRetention } from './slot-retain.js'
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
 * @param {(method: string, args: unknown[]) => Promise<unknown>} props.callRemote - 项目通道调用
 * @param {Function} [props.useSessionStatus] - 宿主会话状态 hook（宿主未挂载
 *   ui-session 时不存在）
 * @returns {object} React 元素
 */
export function BoardBody(props) {
  const { sessionId, getSessions, getUiWorkspace, useSessionStatus, callRemote } = props
  return createElement(BoardPanel, {
    sessionId,
    getSessions,
    getUiWorkspace,
    useSessionStatus,
    callRemote,
  })
}

/**
 * 宿主没挂 ui-session 时的占位 hook。
 *
 * 保持 hook 调用顺序稳定：同一个渲染路径上，状态 hook 的个数不能变。
 */
function useNoSessionStatus() {
  return undefined
}

/**
 * 两个状态快照是否等价。
 *
 * 宿主每次发布都会重建状态对象，引用比较会让每次发布都触发重渲染。
 *
 * @param {ReadonlyMap<string, object>} left - 左快照
 * @param {ReadonlyMap<string, object>} right - 右快照
 * @returns {boolean} 是否等价
 */
function sameStatuses(left, right) {
  if (left.size !== right.size) return false
  for (const [sessionId, status] of left) {
    const other = right.get(sessionId)
    if (other === undefined
      || other.running !== status.running
      || other.pendingInteraction !== status.pendingInteraction
      || other.completionUnread !== status.completionUnread) {
      return false
    }
  }
  return true
}

/**
 * 槽位会话的状态表。
 *
 * 状态有两个来源，合并后成一个表：
 *
 * - **宿主会话状态**（`useSessionStatus`）：权威运行态、等你输入、未读确认。
 *   运行时状态由宿主的 `api-session/status` 事件驱动，会话列表对未保留的
 *   subagent 子会话给的是兜底值，据此说「空闲」是撒谎。
 * - **保留会话的快照**：最后一次执行失败的原因只在会话快照里，宿主会话状态
 *   不带这一项。保留同时让会话不被宿主回收。
 *
 * 宿主没挂 ui-session 时没有会话状态 hook，退回读会话快照：运行态会不准
 * （子会话给兜底值），等你输入与未读无从表达，此时档位如实收敛。
 *
 * @param {object[]} cards - 当前卡片
 * @param {() => object | undefined} getSessions - 取会话服务的延迟取值器
 * @param {Function} [useSessionStatus] - 宿主会话状态 hook
 * @returns {Map<string, object>} 会话 id 到状态
 */
function useSlotStates(cards, getSessions, useSessionStatus) {
  const [snapshots, setSnapshots] = useState(() => new Map())
  const retention = useRef(undefined)
  const latest = useRef(getSessions)
  latest.current = getSessions

  const needed = useMemo(() => {
    const ids = new Set()
    for (const card of cards) {
      for (const binding of slotBindingsOf(card)) {
        if (binding.sessionId !== '') ids.add(binding.sessionId)
      }
    }
    return ids
  }, [cards])

  const useStatuses = useSessionStatus ?? useNoSessionStatus
  const statuses = useStatuses(
    (state) => {
      const next = new Map()
      for (const sessionId of needed) {
        const status = state.get(sessionId)
        if (status !== undefined) next.set(sessionId, status)
      }
      return next
    },
    sameStatuses,
  )

  // 构造本身没有副作用（只是建一张账本表），所以在渲染期惰性创建即可——放进
  // effect 反而要多一个「尚未就绪」的分支。
  if (retention.current === undefined) {
    retention.current = new SlotRetention({
      retain: (sessionId) => {
        const sessions = latest.current()
        if (sessions === undefined || sessions === null) throw new Error('会话服务不可用')
        return sessions.retain(sessionId, { source: 'dshCoordinatorBoard' })
      },
      onState: (sessionId, state) => {
        setSnapshots((previous) => {
          const current = previous.get(sessionId)
          // 宿主每次发布都重建快照对象，值没变就不必换表——换表会让整棵看板重渲染
          if (current !== undefined
            && current.running === state.running
            && current.failed === state.failed) {
            return previous
          }
          const next = new Map(previous)
          next.set(sessionId, state)
          return next
        })
      },
      onDrop: (sessionId) => {
        setSnapshots((previous) => {
          if (!previous.has(sessionId)) return previous
          const next = new Map(previous)
          next.delete(sessionId)
          return next
        })
      },
    })
  }

  useEffect(() => {
    // 释放先于保留，且不受会话服务可用与否影响：保留的副作用正是阻止宿主回收
    // 会话，服务不可用这段时间里也得把不再需要的会话放掉
    retention.current.sync(needed)
  }, [needed, getSessions])

  useEffect(() => () => {
    retention.current.dispose()
  }, [])

  return useMemo(() => {
    const merged = new Map()
    for (const sessionId of needed) {
      merged.set(sessionId, mergeSessionState(
        statuses?.get(sessionId),
        snapshots.get(sessionId),
      ))
    }
    return merged
  }, [needed, statuses, snapshots])
}

/**
 * 空态。
 *
 * @param {object} props - 组件属性
 * @param {boolean} props.allDone - 是否全部完成
 * @param {string} [props.projectName] - 项目名；看板是项目维度的，空态要说清是谁的
 * @returns {object} React 元素
 */
function BoardEmpty({ allDone, projectName }) {
  const whose = projectName === undefined ? '本项目' : `「${projectName}」`
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
      allDone ? `${whose}的卡片都已完成` : '协调者调用 create_card 后，卡片会出现在这里',
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
 * @param {(method: string, args: unknown[]) => Promise<unknown>} props.callRemote - 项目通道调用
 * @param {Function} [props.useSessionStatus] - 宿主会话状态 hook
 * @returns {object} React 元素
 */
function BoardPanel({ sessionId, getSessions, getUiWorkspace, useSessionStatus, callRemote }) {
  const [project, setProject] = useState(undefined)
  // 项目解析完成与否要和「解析出来是不属于项目」分开：解析是个异步往返，中间
  // 不能先闪一句「不属于任何项目」——那是还没问完就下的结论。
  const [resolved, setResolved] = useState(false)
  const [cards, setCards] = useState(() => [])
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)
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

  // 看板是项目维度的：先按面板所属的会话解析出项目。会话换了（面板随之重挂载）
  // 就重新解析。
  useEffect(() => {
    let cancelled = false
    setError(null)
    setResolved(false)
    // 换了会话就是换了项目，上一个项目的卡片不能留在面板里。
    setCards([])
    setLoaded(false)
    resolveProject(callRemote, sessionId)
      .then((resolvedProject) => {
        if (cancelled) return
        setProject(resolvedProject)
        setResolved(true)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(`读取项目失败：${cause instanceof Error ? cause.message : String(cause)}`)
      })
    return () => { cancelled = true }
  }, [sessionId, callRemote])

  // 卡片取数：挂载时拉一次，之后定时刷新，窗口重新聚焦时立刻刷一次。
  // 定时刷新是必要的——卡片可能由别的会话（worker）建，那边的事件流不在本面板
  // 的窗口里，等不到它的变化。
  useEffect(() => {
    if (project === undefined) return undefined
    let cancelled = false
    const refresh = () => {
      fetchBoardCards(callRemote, project.id)
        .then((next) => {
          if (cancelled) return
          setCards(next)
          setLoaded(true)
        })
        .catch((cause) => {
          if (cancelled) return
          setError(`读取卡片失败：${cause instanceof Error ? cause.message : String(cause)}`)
        })
    }
    refresh()
    const timer = setInterval(refresh, BOARD_REFRESH_MS)
    const onFocus = () => { refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [project, callRemote])

  const cardList = cards
  const states = useSlotStates(cardList, getSessions, useSessionStatus)

  const { active, done } = useMemo(() => ({
    active: sortActiveCards(
      cardList.filter((card) => card.status === 'active'),
      states,
    ),
    done: sortDoneCards(cardList.filter((card) => card.status === 'done')),
  }), [cardList, states])

  const openSession = useCallback((targetSessionId) => {
    const uiWorkspace = getUiWorkspace?.()
    if (uiWorkspace === undefined || uiWorkspace === null) return
    uiWorkspace.openSession(targetSessionId)
  }, [getUiWorkspace])

  const openDetail = useCallback((card, anchor) => { setDetail({ card, anchor }) }, [])

  if (error !== null) {
    return createElement(
      'div',
      { className: 'dsh-coordinator-board-empty' },
      createElement('div', { className: 'dsh-coordinator-board-empty-title' }, error),
    )
  }

  // 会话不属于任何项目：没有项目看板可看。这不是错误状态，是「这里没有看板」。
  // 解析还没回来时先给骨架——早闪一句「不属于任何项目」是还没问完就下的结论。
  if (project === undefined) {
    return createElement(
      'div',
      { className: 'dsh-coordinator-board-list' },
      resolved
        ? createElement(
            'div',
            { className: 'dsh-coordinator-board-empty' },
            createElement(
              'div',
              { className: 'dsh-coordinator-board-empty-title' },
              '当前会话不属于任何项目',
            ),
            createElement(
              'div',
              { className: 'dsh-coordinator-board-empty-hint' },
              '看板按项目组织：在项目协调者会话里打开它。',
            ),
          )
        : createElement(
            'div',
            { className: 'dsh-coordinator-board-group' },
            createElement('div', { className: 'dsh-coordinator-board-skeleton' }),
            createElement('div', { className: 'dsh-coordinator-board-skeleton' }),
            createElement('div', { className: 'dsh-coordinator-board-skeleton' }),
          ),
    )
  }

  if (!loaded) {
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
      createElement(BoardEmpty, { allDone: false, projectName: project.name }),
    )
  }

  return createElement(
    'div',
    { className: 'dsh-coordinator-board' },
    createElement(
      'div',
      { className: 'dsh-coordinator-board-list' },
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
      active.length === 0 ? createElement(BoardEmpty, { allDone: true, projectName: project.name }) : null,
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
