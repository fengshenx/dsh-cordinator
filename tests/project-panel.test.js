import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  basenameOf,
  isProjectOpenable,
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
