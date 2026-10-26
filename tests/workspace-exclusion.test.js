import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markSessionRow } from '../src/client/workspace-exclusion.js'

/**
 * 造一个假的会话行：只需要 `getAttribute` 与 `classList.toggle`。
 * @param {string} rowKey - 行的 data-row-key
 * @returns {object} 假行
 */
function fakeRow(rowKey) {
  const classes = new Set()
  return {
    classes,
    getAttribute: (name) => (name === 'data-row-key' ? rowKey : null),
    classList: {
      toggle: (name, force) => {
        if (force === true) classes.add(name)
        else classes.delete(name)
      },
    },
  }
}

test('命中排除集的会话行被标记为隐藏', () => {
  const row = fakeRow('session:s1')
  const hidden = markSessionRow(row, new Set(['s1']))
  assert.equal(hidden, true)
  assert.equal(row.classes.has('dsh-coordinator-excluded-session'), true)
})

test('不在排除集里的会话行保持可见', () => {
  const row = fakeRow('session:s2')
  const hidden = markSessionRow(row, new Set(['s1']))
  assert.equal(hidden, false)
  assert.equal(row.classes.has('dsh-coordinator-excluded-session'), false)
})

test('不是会话行的标识不参与排除', () => {
  const row = fakeRow('workspace:group-1')
  const hidden = markSessionRow(row, new Set(['group-1']))
  assert.equal(hidden, false)
  assert.equal(row.classes.size, 0)
})

test('排除集变化后重新标记能改回可见', () => {
  const row = fakeRow('session:s1')
  markSessionRow(row, new Set(['s1']))
  assert.equal(row.classes.has('dsh-coordinator-excluded-session'), true)
  markSessionRow(row, new Set())
  assert.equal(row.classes.has('dsh-coordinator-excluded-session'), false)
})
