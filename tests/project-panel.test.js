import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  basenameOf,
  isProjectOpenable,
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
