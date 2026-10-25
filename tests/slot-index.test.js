import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCardStore } from '../src/host/cards/store.js'

/**
 * 建一个临时 home 下的卡片存储。
 * @returns {Promise<{ store: object, home: string }>} 存储与 home 目录
 */
async function createStore() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-slot-index-'))
  return { store: createCardStore({ home }), home }
}

test('建卡即建索引，槽位名反查到会话', async () => {
  const { store, home } = await createStore()
  try {
    await store.create({ title: '任务', slots: { dev: { sessionId: 'session-dev' } } })
    assert.equal(store.slotIndex.get('session-dev'), 'dev')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('改卡改绑后索引同步更新', async () => {
  const { store, home } = await createStore()
  try {
    const card = await store.create({ title: '任务', slots: { dev: { sessionId: 'session-dev' } } })
    await store.update({ id: card.id, slots: { review: { sessionId: 'session-dev' } } })
    assert.equal(store.slotIndex.get('session-dev'), 'review')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('改卡清空槽位后索引移除该会话', async () => {
  const { store, home } = await createStore()
  try {
    const card = await store.create({ title: '任务', slots: { dev: { sessionId: 'session-dev' } } })
    await store.update({ id: card.id, slots: {} })
    assert.equal(store.slotIndex.has('session-dev'), false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('同一会话绑在多张卡上时，编号大的卡片胜出', async () => {
  const { store, home } = await createStore()
  try {
    await store.create({ title: '第一张', slots: { dev: { sessionId: 'session-a' } } })
    await store.create({ title: '第二张', slots: { review: { sessionId: 'session-a' } } })
    assert.equal(store.slotIndex.get('session-a'), 'review')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('重启后能从卡片库重建槽位索引', async () => {
  const { store, home } = await createStore()
  try {
    await store.create({ title: '任务', slots: { dev: { sessionId: 'session-dev' } } })
    // 另一个进程实例：内存索引是空的，只能从落盘的卡片库恢复。
    const reopened = createCardStore({ home })
    assert.equal(reopened.slotIndex.has('session-dev'), false)
    await reopened.loadSlotIndex()
    assert.equal(reopened.slotIndex.get('session-dev'), 'dev')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
