import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  basenameOf,
  isProjectOpenable,
  openCoordinatorSession,
  selectProjectSessionRows,
  validateProjectName,
} from '../src/client/project-panel-logic.js'

test('目录末段在两种分隔符下都能取到', () => {
  assert.equal(basenameOf('/work/alpha'), 'alpha')
  assert.equal(basenameOf('C:\\work\\alpha'), 'alpha')
  assert.equal(basenameOf('/work/alpha/'), 'alpha')
  assert.equal(basenameOf('/work/alpha///'), 'alpha')
})

test('项目名不能为空也不能过长', () => {
  assert.equal(validateProjectName('alpha').ok, true)
  assert.equal(validateProjectName('  ').ok, false)
  assert.equal(validateProjectName('x'.repeat(201)).ok, false)
  assert.equal(validateProjectName('x'.repeat(200)).ok, true)
})

test('协调者会话没了的项目不能直接打开', () => {
  assert.equal(isProjectOpenable({ coordinatorSessionId: 'session-1', coordinatorAlive: true }), true)
  assert.equal(isProjectOpenable({ coordinatorSessionId: 'session-1', coordinatorAlive: false }), false)
  assert.equal(isProjectOpenable({ coordinatorSessionId: '', coordinatorAlive: true }), false)
  assert.equal(isProjectOpenable({ coordinatorAlive: true }), false)
})

test('会话存在性未知时按可打开处理', () => {
  assert.equal(isProjectOpenable({ coordinatorSessionId: 'session-1' }), true)
})

test('项目下的会话列表不含协调者', () => {
  const rows = selectProjectSessionRows({
    sessionIds: ['s-coordinator', 's-worker'],
    sessionRows: {
      's-coordinator': { id: 's-coordinator' },
      's-worker': { id: 's-worker' },
    },
    coordinatorSessionId: 's-coordinator',
  })
  assert.deepEqual(rows.map((row) => row.id), ['s-worker'])
})

test('会话列表还没同步到时先略过该会话', () => {
  const rows = selectProjectSessionRows({
    sessionIds: ['s-known', 's-unknown'],
    sessionRows: { 's-known': { id: 's-known' } },
    coordinatorSessionId: undefined,
  })
  assert.deepEqual(rows.map((row) => row.id), ['s-known'])
})

test('没有会话时列表为空', () => {
  assert.deepEqual(selectProjectSessionRows({ sessionIds: [], sessionRows: {} }), [])
})

test('打开协调者会先让宿主把会话挂到工作区', async () => {
  const calls = []
  const opened = []
  const result = await openCoordinatorSession({
    project: { id: 'p-1', coordinatorSessionId: 'session-1' },
    callRemote: async (method, args) => {
      calls.push([method, args])
      return { attached: true, workspaceId: 'ws-1' }
    },
    openSession: (sessionId) => opened.push(sessionId),
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [['attachCoordinator', ['p-1']]])
  assert.deepEqual(opened, ['session-1'])
})

test('挂不上工作区时不打开会话并报出原因', async () => {
  const opened = []
  const result = await openCoordinatorSession({
    project: { id: 'p-1', coordinatorSessionId: 'session-1' },
    callRemote: async () => ({ attached: false, reason: '当前宿主没有工作区服务' }),
    openSession: (sessionId) => opened.push(sessionId),
  })
  assert.equal(result.ok, false)
  assert.equal(result.message, '当前宿主没有工作区服务')
  assert.deepEqual(opened, [])
})

test('远程调用抛错时不打开会话并报出原因', async () => {
  const opened = []
  const result = await openCoordinatorSession({
    project: { id: 'p-1', coordinatorSessionId: 'session-1' },
    callRemote: async () => {
      throw new Error('通道断开')
    },
    openSession: (sessionId) => opened.push(sessionId),
  })
  assert.equal(result.ok, false)
  assert.match(result.message, /通道断开/)
  assert.deepEqual(opened, [])
})
