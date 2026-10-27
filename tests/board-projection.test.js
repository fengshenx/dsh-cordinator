import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  STALLED_THRESHOLD_MS,
  applyEventChange,
  cardSignal,
  collectCards,
  fitLinkChips,
  formatDuration,
  isCardStalled,
  loadHistory,
  mergeSessionState,
  slotBindingsOf,
  slotViewsForCard,
  sortActiveCards,
  sortDoneCards,
} from '../src/client/board-projection.js'

/**
 * 造一条带卡片投影的 `tool/result` 事件条目。
 * @param {string} scope - 投影范围
 * @param {object[]} cards - 投影的卡片
 * @returns {object} 事件窗口条目
 */
function cardEvent(scope, cards) {
  return {
    type: 'event',
    event: {
      type: 'tool/result',
      data: { meta: { kind: 'dsh-coordinator-cards', scope, cards } },
    },
  }
}

test('单卡投影按 id 覆盖同 id 的卡片，全量投影清空视图', () => {
  const entries = [
    cardEvent('card', [{ id: 'a', number: 1, title: '一' }]),
    cardEvent('card', [{ id: 'b', number: 2, title: '二' }]),
    cardEvent('card', [{ id: 'a', number: 1, title: '一改' }]),
  ]
  assert.deepEqual(
    collectCards(entries).map((card) => card.title),
    ['一改', '二'],
  )
  const withAll = [...entries, cardEvent('all', [{ id: 'c', number: 3, title: '三' }])]
  assert.deepEqual(collectCards(withAll).map((card) => card.title), ['三'])
})

test('卡片按编号升序排列，无关事件被忽略', () => {
  const entries = [
    { type: 'event', event: { type: 'assistant/message', data: {} } },
    { type: 'transient', event: { type: 'assistant/message' } },
    cardEvent('card', [{ id: 'b', number: 5, title: '五' }]),
    cardEvent('card', [{ id: 'a', number: 2, title: '二' }]),
  ]
  assert.deepEqual(collectCards(entries).map((card) => card.number), [2, 5])
})

test('缺 kind 标记的 meta 不被当作卡片投影', () => {
  const entries = [
    { type: 'event', event: { type: 'tool/result', data: { meta: { kind: '别的投影', cards: [] } } } },
    { type: 'event', event: { type: 'tool/result', data: {} } },
  ]
  assert.deepEqual(collectCards(entries), [])
})

test('历史已加载完时不再翻页', async () => {
  let calls = 0
  const binding = {
    eventSource: { getSnapshot: () => ({ hasMore: false }) },
    session: { loadOlder: async () => { calls += 1 } },
  }
  assert.equal(await loadHistory(binding), true)
  assert.equal(calls, 0)
})

test('还有更早历史时逐页加载到没有为止', async () => {
  let calls = 0
  const binding = {
    eventSource: {
      getSnapshot: () => ({ hasMore: calls < 3 }),
    },
    session: {
      loadOlder: async () => { calls += 1 },
    },
  }
  assert.equal(await loadHistory(binding), true)
  assert.equal(calls, 3)
})

test('翻页到上限仍有更早历史时，如实报告未加载完', async () => {
  let calls = 0
  const binding = {
    eventSource: { getSnapshot: () => ({ hasMore: true }) },
    session: { loadOlder: async () => { calls += 1 } },
  }
  assert.equal(await loadHistory(binding, 3), false)
  assert.equal(calls, 3)
})

test('loadOlder 失败会抛出，不打断加载流程，也不无限循环', async () => {
  let calls = 0
  const binding = {
    eventSource: { getSnapshot: () => ({ hasMore: true }) },
    session: {
      loadOlder: async () => {
        calls += 1
        throw new Error('宿主加载失败')
      },
    },
  }
  await assert.rejects(() => loadHistory(binding, 2), /宿主加载失败/)
  assert.equal(calls, 1)
})

/**
 * 造一张带槽位绑定的卡。
 * @param {object} [overrides] - 覆盖字段
 * @returns {object} 卡片
 */
function card(overrides = {}) {
  return { id: 'c', number: 1, title: '标题', status: 'active', ...overrides }
}

/**
 * 造一份会话状态表。
 * @param {Array<[string, object]>} entries - 会话 id 到状态
 * @returns {Map<string, object>} 状态表
 */
function states(entries) {
  return new Map(entries)
}

/**
 * 构造一份会话状态，字段与 `mergeSessionState` 的产出同形。
 *
 * @param {object} overrides - 覆盖的字段
 * @returns {object} 会话状态
 */
function sessionState(overrides = {}) {
  return {
    known: true,
    running: false,
    waiting: false,
    unread: false,
    failed: false,
    ...overrides,
  }
}

test('槽位绑定取 sessionId，结构非法的条目被跳过', () => {
  const bindings = slotBindingsOf(card({
    slots: {
      dev: { sessionId: 's1' },
      review: {},
      broken: 'nope',
      arr: [],
    },
  }))
  assert.deepEqual(bindings, [
    { name: 'dev', sessionId: 's1' },
    { name: 'review', sessionId: '' },
  ])
  assert.deepEqual(slotBindingsOf(card({ slots: null })), [])
  assert.deepEqual(slotBindingsOf(card({ slots: [] })), [])
  assert.deepEqual(slotBindingsOf(card()), [])
})

test('槽位状态按会话状态映射，读不到状态时是 unknown 而不是空闲', () => {
  const views = slotViewsForCard(card({
    slots: {
      dev: { sessionId: 's1' },
      review: { sessionId: 's2' },
      idleSlot: { sessionId: 's3' },
      failedSlot: { sessionId: 's4' },
      freeSlot: {},
    },
  }), states([
    ['s1', sessionState({ running: true })],
    ['s3', sessionState()],
    ['s4', sessionState({ failed: true })],
  ]))
  assert.deepEqual(
    views.map((view) => [view.name, view.state]),
    [
      ['dev', 'running'],
      ['review', 'unknown'],
      ['idleSlot', 'idle'],
      ['failedSlot', 'attention'],
      ['freeSlot', 'empty'],
    ],
  )
})

test('卡片信号按等你输入 > 需注意 > 推进中 > 未读 > 空闲 > 未知 > 未派工聚合', () => {
  assert.equal(cardSignal(card({ slots: { a: { sessionId: 's1' } } }), states([
    ['s1', sessionState({ running: true })],
  ])), 'running')
  assert.equal(cardSignal(card({ slots: {
    a: { sessionId: 's1' },
    b: { sessionId: 's2' },
  } }), states([
    ['s1', sessionState({ running: true })],
    ['s2', sessionState({ failed: true })],
  ])), 'attention')
  assert.equal(cardSignal(card({ slots: { a: { sessionId: 's1' } } }), states([
    ['s1', sessionState()],
  ])), 'idle')
  assert.equal(cardSignal(card({ slots: { a: { sessionId: 's1' } } }), new Map()), 'unknown')
  assert.equal(cardSignal(card({ slots: { a: {} } }), new Map()), 'none')
  assert.equal(cardSignal(card(), new Map()), 'none')
  assert.equal(cardSignal(card({ status: 'done', slots: { a: { sessionId: 's1' } } }), states([
    ['s1', sessionState({ running: true, failed: true })],
  ])), 'none')
})

test('等你输入压过需注意，未读压过空闲', () => {
  assert.equal(cardSignal(card({ slots: { a: { sessionId: 's1' } } }), states([
    ['s1', sessionState({ waiting: true, failed: true })],
  ])), 'waiting')
  assert.equal(cardSignal(card({ slots: { a: { sessionId: 's1' } } }), states([
    ['s1', sessionState({ unread: true })],
  ])), 'unread')
  assert.equal(cardSignal(card({ slots: {
    a: { sessionId: 's1' },
    b: { sessionId: 's2' },
  } }), states([
    ['s1', sessionState({ running: true })],
    ['s2', sessionState({ unread: true })],
  ])), 'running')
})

test('未派工的槽位不抬高卡片信号', () => {
  assert.equal(cardSignal(card({ slots: {
    a: { sessionId: 's1' },
    b: {},
  } }), states([
    ['s1', sessionState()],
  ])), 'idle')
})

test('会话状态合并：宿主状态优先，未建立基线不谎称空闲', () => {
  assert.deepEqual(
    mergeSessionState(
      { running: true, pendingInteraction: undefined, completionUnread: false },
      { running: false, failed: true },
    ),
    { known: true, running: true, waiting: false, unread: false, failed: true },
  )
  assert.deepEqual(
    mergeSessionState(
      { running: false, pendingInteraction: { key: 'k', kind: 'approval', sessionId: 's1' }, completionUnread: true },
      undefined,
    ),
    { known: true, running: false, waiting: true, unread: true, failed: false },
  )
  // 宿主给了条目但运行态还没建立基线：判未知，不拿快照里的兜底值说空闲
  assert.deepEqual(
    mergeSessionState(
      { running: undefined, pendingInteraction: undefined, completionUnread: false },
      { running: false, failed: false },
    ),
    { known: false, running: false, waiting: false, unread: false, failed: false },
  )
  // 宿主没给状态（未挂 ui-session）：退回快照，等你输入与未读无从表达
  assert.deepEqual(
    mergeSessionState(undefined, { running: true, failed: false }),
    { known: true, running: true, waiting: false, unread: false, failed: false },
  )
  assert.deepEqual(
    mergeSessionState(undefined, undefined),
    { known: false, running: false, waiting: false, unread: false, failed: false },
  )
})

test('active 卡排序按信号档位、sortOrder、最后活动、编号依次决胜', () => {
  const table = states([
    ['running', sessionState({ running: true })],
    ['failed', sessionState({ failed: true })],
  ])
  const cards = [
    card({ id: 'idle', number: 1, slots: { a: { sessionId: 'idle' } } }),
    card({ id: 'none', number: 2 }),
    card({ id: 'attention', number: 3, slots: { a: { sessionId: 'failed' } } }),
    card({ id: 'running', number: 4, slots: { a: { sessionId: 'running' } } }),
  ]
  assert.deepEqual(
    sortActiveCards(cards, table).map((entry) => entry.id),
    ['attention', 'running', 'idle', 'none'],
  )
  const pinned = [
    card({ id: 'noOrder', number: 1, updatedAt: 100 }),
    card({ id: 'order2', number: 2, sortOrder: 2, updatedAt: 300 }),
    card({ id: 'order1', number: 3, sortOrder: 1, updatedAt: 200 }),
  ]
  assert.deepEqual(
    sortActiveCards(pinned, new Map()).map((entry) => entry.id),
    ['order1', 'order2', 'noOrder'],
  )
  const sameLevel = [
    card({ id: 'older', number: 1, updatedAt: 100 }),
    card({ id: 'newer', number: 2, updatedAt: 200 }),
  ]
  assert.deepEqual(
    sortActiveCards(sameLevel, new Map()).map((entry) => entry.id),
    ['newer', 'older'],
  )
  const sameActivity = [
    card({ id: 'b', number: 2, updatedAt: 100 }),
    card({ id: 'a', number: 1, updatedAt: 100 }),
  ]
  assert.deepEqual(
    sortActiveCards(sameActivity, new Map()).map((entry) => entry.id),
    ['a', 'b'],
  )
})

test('done 卡按完成时间倒序', () => {
  const cards = [
    card({ id: 'old', number: 1, status: 'done', doneAt: 100 }),
    card({ id: 'new', number: 2, status: 'done', doneAt: 300 }),
    card({ id: 'mid', number: 3, status: 'done', doneAt: 200 }),
  ]
  assert.deepEqual(
    sortDoneCards(cards).map((entry) => entry.id),
    ['new', 'mid', 'old'],
  )
})

test('停滞判定要求有绑定会话且超过阈值，非 active 不计时', () => {
  const now = 100 * 60 * 60 * 1000
  const bound = { status: 'active', slots: { a: { sessionId: 's1' } } }
  const idle = { status: 'active', slots: { a: {} } }
  const states = new Map([['s1', sessionState()]])
  assert.equal(isCardStalled({ ...bound, updatedAt: now - STALLED_THRESHOLD_MS - 1 }, states, now), true)
  assert.equal(isCardStalled({ ...bound, updatedAt: now - STALLED_THRESHOLD_MS }, states, now), false)
  assert.equal(isCardStalled({ ...idle, updatedAt: 0 }, states, now), false)
  assert.equal(isCardStalled({ ...bound, status: 'done', updatedAt: 0 }, states, now), false)
  assert.equal(isCardStalled({ ...bound, updatedAt: now }, states, now), false)
})

test('停滞判定：会话状态不可知时不断言卡住', () => {
  const now = 100 * 60 * 60 * 1000
  const target = { status: 'active', slots: { a: { sessionId: 's1' } }, updatedAt: 0 }
  const unknown = new Map([['s1', sessionState({ known: false })]])
  assert.equal(isCardStalled(target, unknown, now), false)
  assert.equal(isCardStalled(target, new Map(), now), false)
})

test('停滞判定：名下会话正在跑不算停滞', () => {
  const now = 100 * 60 * 60 * 1000
  const card = { status: 'active', slots: { a: { sessionId: 's1' } }, updatedAt: 0 }
  const running = new Map([['s1', sessionState({ running: true })]])
  assert.equal(isCardStalled(card, running, now), false)
  const idle = new Map([['s1', sessionState()]])
  assert.equal(isCardStalled(card, idle, now), true)
})

test('时长文案按小时或天展示，负差值钳制为 0h', () => {
  const now = 100 * 60 * 60 * 1000
  assert.equal(formatDuration(now - 3 * 60 * 60 * 1000, now), '3h')
  assert.equal(formatDuration(now - 26 * 60 * 60 * 1000, now), '1d')
  assert.equal(formatDuration(now + 60 * 60 * 1000, now), '0h')
  assert.equal(formatDuration(now, now), '0h')
})

test('链接 chip 排布：宽度未量出时全量展示，放不下时为 +N 预留', () => {
  assert.equal(fitLinkChips({
    availableWidth: 0,
    chipWidths: [50, 60],
    overflowWidth: 30,
    gap: 6,
  }), 2)
  assert.equal(fitLinkChips({
    availableWidth: 200,
    chipWidths: [50, 50, 50],
    overflowWidth: 30,
    gap: 6,
  }), 3)
  assert.equal(fitLinkChips({
    availableWidth: 120,
    chipWidths: [50, 50, 50],
    overflowWidth: 30,
    gap: 6,
  }), 1)
  assert.equal(fitLinkChips({
    availableWidth: 40,
    chipWidths: [50],
    overflowWidth: 30,
    gap: 6,
  }), 0)
  assert.equal(fitLinkChips({
    availableWidth: 200,
    chipWidths: [],
    overflowWidth: 30,
    gap: 6,
  }), 0)
})

test('链接 chip 排布：间距非法时全量展示，不藏链接', () => {
  assert.equal(fitLinkChips({
    availableWidth: 100,
    chipWidths: [50, 50],
    overflowWidth: 20,
    gap: Number.NaN,
  }), 2)
  assert.equal(fitLinkChips({
    availableWidth: 100,
    chipWidths: [50, 50],
    overflowWidth: 20,
    gap: -1,
  }), 2)
})

test('事件增量：append 只处理新增条目，不重放整扇窗口', () => {
  const first = cardEvent('card', [{ id: 'a', number: 1, revision: 1 }])
  const second = cardEvent('card', [{ id: 'b', number: 2, revision: 1 }])
  const initial = applyEventChange(new Map(), { kind: 'append', entries: [first] }, [first])
  assert.deepEqual([...initial.cards.keys()], ['a'])
  const next = applyEventChange(initial.cards, { kind: 'append', entries: [second] }, [first, second])
  assert.deepEqual([...next.cards.keys()], ['a', 'b'])
  assert.equal(next.changed, true)
})

test('事件增量：卡片表为空时全量重建', () => {
  const entries = [cardEvent('card', [{ id: 'a', number: 1, revision: 1 }])]
  const result = applyEventChange(new Map(), { kind: 'append', entries: [] }, entries)
  assert.deepEqual([...result.cards.keys()], ['a'])
})

test('事件增量：prepend 与 replace 全量重建，窗口靠后的版本作数', () => {
  const older = cardEvent('card', [{ id: 'a', number: 1, revision: 1 }])
  const newer = cardEvent('card', [{ id: 'a', number: 1, revision: 2 }])
  const base = applyEventChange(new Map(), { kind: 'replace', entries: [newer] }, [newer])
  const prepended = applyEventChange(base.cards, { kind: 'prepend', entries: [older] }, [older, newer])
  assert.equal(prepended.cards.get('a').revision, 2)
  const replaced = applyEventChange(base.cards, { kind: 'replace', entries: [older] }, [older])
  assert.equal(replaced.cards.get('a').revision, 1)
})

test('事件增量：settle-assistant 不改卡片表', () => {
  const entries = [cardEvent('card', [{ id: 'a', number: 1, revision: 1 }])]
  const base = applyEventChange(new Map(), { kind: 'replace', entries }, entries)
  const settled = applyEventChange(base.cards, { kind: 'settle-assistant', attemptId: 'a1' }, entries)
  assert.equal(settled.changed, false)
  assert.equal(settled.cards, base.cards)
})

test('事件增量：全量投影清空此前的视图', () => {
  const one = cardEvent('card', [{ id: 'a', number: 1, revision: 1 }])
  const all = cardEvent('all', [{ id: 'b', number: 2, revision: 1 }])
  const base = applyEventChange(new Map(), { kind: 'replace', entries: [one] }, [one])
  const result = applyEventChange(base.cards, { kind: 'append', entries: [all] }, [one, all])
  assert.deepEqual([...result.cards.keys()], ['b'])
})

test('事件增量：同一 revision 的卡片不重复写入，transient 条目被跳过', () => {
  const one = cardEvent('card', [{ id: 'a', number: 1, revision: 1 }])
  const base = applyEventChange(new Map(), { kind: 'replace', entries: [one] }, [one])
  const again = applyEventChange(base.cards, { kind: 'append', entries: [one] }, [one, one])
  assert.equal(again.changed, false)
  const transient = { type: 'transient', event: { type: 'assistant/live-chunk' } }
  const skipped = applyEventChange(new Map(), { kind: 'append', entries: [transient] }, [transient])
  assert.equal(skipped.cards.size, 0)
})
