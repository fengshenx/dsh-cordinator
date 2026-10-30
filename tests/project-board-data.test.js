import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  boardViewState,
  fetchBoardCards,
  fetchProjectWorkers,
  isBoardEntryVisible,
  isBoardViewable,
  isCoordinatorProject,
  isProjectWorker,
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

test('看板视图状态：归属、身份与存活收敛成五种出口', () => {
  const base = { id: 'p1', name: '项目一', coordinatorSessionId: 'coordinator-1' }
  assert.equal(boardViewState(undefined, 'coordinator-1'), 'no-project')
  // 协调者失效优先于身份：项目会话与旧协调者本人都该看到「去换新协调者」
  assert.equal(boardViewState({ ...base, coordinatorAlive: false }, 'coordinator-1'), 'coordinator-dead')
  assert.equal(boardViewState({ ...base, coordinatorAlive: false }, 'worker-1'), 'coordinator-dead')
  // 项目 worker 可看；同目录的普通会话不可看
  assert.equal(boardViewState({ ...base, coordinatorAlive: true }, 'worker-1', true), 'worker')
  assert.equal(boardViewState({ ...base, coordinatorAlive: true }, 'worker-1'), 'not-viewable')
  assert.equal(boardViewState({ ...base, coordinatorAlive: true }, 'plain-1'), 'not-viewable')
  assert.equal(boardViewState({ ...base, coordinatorAlive: true }, 'coordinator-1'), 'coordinator')
  // 协调者本人不会被 worker 参数改判
  assert.equal(boardViewState(base, 'coordinator-1', true), 'coordinator')
  // 存活状态未知按「还在」处理
  assert.equal(boardViewState(base, 'coordinator-1'), 'coordinator')
})

test('看板可看性：协调者与项目 worker 可看，普通会话不可看', () => {
  const base = { id: 'p1', name: '项目一', coordinatorSessionId: 'coordinator-1' }
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: true }, 'coordinator-1'), true)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: true }, 'worker-1', true), true)
  // 存活状态未知时按「还在」处理，不误报失效
  assert.equal(isBoardViewable(base, 'coordinator-1'), true)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: false }, 'coordinator-1'), false)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: false }, 'worker-1', true), false)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: true }, 'worker-1'), false)
  assert.equal(isBoardViewable({ ...base, coordinatorAlive: true }, 'plain-1'), false)
  assert.equal(isBoardViewable(undefined, 'coordinator-1'), false)
})

test('入口可见性：只有项目会话有入口，协调者失效时仍保留出口', () => {
  const base = { id: 'p1', name: '项目一', coordinatorSessionId: 'coordinator-1' }
  assert.equal(isBoardEntryVisible(base, 'coordinator-1'), true)
  assert.equal(isBoardEntryVisible(base, 'worker-1', true), true)
  // 同目录里的普通会话没有看板入口
  assert.equal(isBoardEntryVisible(base, 'plain-1'), false)
  assert.equal(isBoardEntryVisible(base, 'worker-1'), false)
  assert.equal(isBoardEntryVisible(undefined, 'coordinator-1'), false)
  // 协调者已失效：入口留着，点开是「去左栏换新协调者」的引导
  assert.equal(isBoardEntryVisible({ ...base, coordinatorAlive: false }, 'coordinator-1'), true)
  assert.equal(isBoardEntryVisible({ ...base, coordinatorAlive: false }, 'worker-1', true), true)
})

test('项目 worker 表：按项目归组，非数组当空表', async () => {
  const table = await fetchProjectWorkers(async () => [
    { projectId: 'p1', sessionIds: ['w1', 'w2'] },
    { projectId: 'p2', sessionIds: ['w3'] },
    { projectId: '', sessionIds: ['bad'] },
    { projectId: 'p3', sessionIds: 'not-an-array' },
  ])
  assert.equal(isProjectWorker('p1', 'w1', table), true)
  assert.equal(isProjectWorker('p2', 'w1', table), false)
  assert.equal(isProjectWorker('p1', 'plain-1', table), false)
  assert.equal(isProjectWorker('missing', 'w1', table), false)
  assert.equal(isProjectWorker('p1', '', table), false)
  assert.deepEqual(await fetchProjectWorkers(async () => 'not-an-array'), new Map())
  assert.deepEqual(await fetchProjectWorkers(async () => undefined), new Map())
})

test('项目摘要比较：名字、协调者或存活状态变了才算变化', () => {
  const base = { id: 'p1', coordinatorSessionId: 'c1', coordinatorAlive: true }
  assert.equal(sameProjectSummary(base, { ...base }), true)
  assert.equal(sameProjectSummary(base, { ...base, coordinatorAlive: false }), false)
  assert.equal(sameProjectSummary(base, { ...base, coordinatorSessionId: 'c2' }), false)
  // 重命名也要算变化：否则看板上的项目名会一直停在旧值
  assert.equal(sameProjectSummary(base, { ...base, name: '改名' }), false)
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
