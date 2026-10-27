import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fetchBoardCards,
  newCardIds,
  resolveProject,
} from '../src/client/project-board-data.js'

test('解析项目：通道返回项目就返回，返回空就说没有项目', async () => {
  const project = await resolveProject(async () => ({ id: 'p1', name: '项目一' }), 'session-1')
  assert.equal(project.id, 'p1')
  assert.equal(await resolveProject(async () => undefined, 'session-1'), undefined)
  assert.equal(await resolveProject(async () => null, 'session-1'), undefined)
})

test('解析项目：会话 id 为空时不发远程调用', async () => {
  let called = 0
  const resolve = async () => { called += 1; return undefined }
  assert.equal(await resolveProject(resolve, ''), undefined)
  assert.equal(called, 0)
})

test('取项目卡片：通道返回数组才认，非数组当空列表', async () => {
  const cards = await fetchBoardCards(async () => [{ id: 'c1' }], 'p1')
  assert.equal(cards.length, 1)
  assert.deepEqual(await fetchBoardCards(async () => 'not-an-array', 'p1'), [])
  assert.deepEqual(await fetchBoardCards(async () => [{ id: 'c1' }], ''), [])
})

test('新增卡片 id：只看多出来的卡，改卡不算新增', () => {
  const before = [{ id: 'a', revision: 1 }, { id: 'b', revision: 1 }]
  // 内容变化：id 没变，不是新增
  assert.deepEqual(newCardIds(before, [{ id: 'a', revision: 2 }, { id: 'b', revision: 1 }]), [])
  // 多了一张卡
  assert.deepEqual(
    newCardIds(before, [{ id: 'a', revision: 1 }, { id: 'b', revision: 1 }, { id: 'c', revision: 0 }]),
    ['c'],
  )
  // 少了一张卡不是新增（卡片被归档不算「刚建的」）
  assert.deepEqual(newCardIds(before, [{ id: 'a', revision: 1 }]), [])
})

test('新增卡片 id：缺 id 的条目不算新增', () => {
  assert.deepEqual(newCardIds([], [{ title: '没有 id' }]), [])
})
