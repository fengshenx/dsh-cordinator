import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertTaskName, branchFor, worktreeDirFor } from '../scripts/worktree-common.mjs'

test('合法任务名通过校验', () => {
  for (const name of ['dev-script', 'p14-fix', 'a', 'task_1', 'v1.2']) {
    assert.doesNotThrow(() => assertTaskName(name))
  }
})

test('路径穿越与分隔符一律拒绝', () => {
  for (const name of ['../escape', 'a/b', 'a\\b', '/abs', '.hidden', 'a b', '']) {
    assert.throws(() => assertTaskName(name))
  }
})

test('分支名与目录按约定派生', () => {
  assert.equal(branchFor('dev-script'), 'feature/dev-script')
  assert.equal(worktreeDirFor('/repo', 'dev-script'), '/repo/.worktrees/dev-script')
})
