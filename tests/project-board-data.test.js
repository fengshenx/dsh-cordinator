import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fetchBoardCards,
  isBoardViewable,
  isCoordinatorProject,
  newCardIds,
  resolveProject,
  sameProjectSummary,
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

test('看板只认项目协调者：worker 与同目录普通会话都不算', () => {
  const project = { id: 'p1', name: '项目一', coordinatorSessionId: 'coordinator-1' }
  assert.equal(isCoordinatorProject(project, 'coordinator-1'), true)
  assert.equal(isCoordinatorProject(project, 'worker-1'), false)
  assert.equal(isCoordinatorProject(project, 'plain-1'), false)
  assert.equal(isCoordinatorProject({ id: 'p1' }, 'coordinator-1'), false)
  assert.equal(isCoordinatorProject({ id: 'p1', coordinatorSessionId: '' }, ''), false)
  assert.equal(isCoordinatorProject(undefined, 'coordinator-1'), false)
})

test('看板可看性：协调者会话还得没失效', () => {
  const base = { id: 'p1', name: '项目一', coordinatorSessionId: 'coordinator-1' }
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: true }, 'coordinator-1'), true)
  // 存活状态未知时按「还在」处理，不误报失效
  assert.equal(isBoardViewable(base, 'coordinator-1'), true)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: false }, 'coordinator-1'), false)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: true }, 'worker-1'), false)
  assert.equal(isBoardViewable(undefined, 'coordinator-1'), false)
})

test('项目摘要比较：协调者或存活状态变了才算变化', () => {
  const base = { id: 'p1', coordinatorSessionId: 'c1', coordinatorAlive: true }
  assert.equal(sameProjectSummary(base, { ...base }), true)
  assert.equal(sameProjectSummary(base, { ...base, coordinatorAlive: false }), false)
  assert.equal(sameProjectSummary(base, { ...base, coordinatorSessionId: 'c2' }), false)
  assert.equal(sameProjectSummary(undefined, undefined), true)
  assert.equal(sameProjectSummary(undefined, base), false)
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
