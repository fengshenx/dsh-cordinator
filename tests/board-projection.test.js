import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectCards, loadHistory } from '../src/client/board-projection.js'

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

test('loadOlder 失败不打断加载流程，也不无限循环', async () => {
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
