import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markWorkspaceRow } from '../src/client/workspace-hiding.js'

/**
 * 造一个假的工作区行：需要 `getAttribute`、`setAttribute`、`removeAttribute`
 * 与 `classList.toggle`。
 * @param {string} rowKey - 行的 data-row-key
 * @returns {object} 假行
 */
function fakeRow(rowKey) {
  const classes = new Set()
  const attributes = new Map()
  return {
    classes,
    attributes,
    getAttribute: (name) => (name === 'data-row-key' ? rowKey : attributes.get(name) ?? null),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    classList: {
      toggle: (name, force) => {
        if (force === true) classes.add(name)
        else classes.delete(name)
      },
    },
  }
}

test('命中隐藏集的工作区行被标记为隐藏', () => {
  const row = fakeRow('workspace:ws-1')
  const hidden = markWorkspaceRow(row, new Set(['ws-1']))
  assert.equal(hidden, true)
  assert.equal(row.classes.has('dsh-coordinator-hidden-workspace'), true)
  assert.equal(row.getAttribute('data-dsh-coordinator-workspace'), 'true')
})

test('不在隐藏集里的工作区行保持可见', () => {
  const row = fakeRow('workspace:ws-2')
  const hidden = markWorkspaceRow(row, new Set(['ws-1']))
  assert.equal(hidden, false)
  assert.equal(row.classes.has('dsh-coordinator-hidden-workspace'), false)
  assert.equal(row.getAttribute('data-dsh-coordinator-workspace'), null)
})

test('不是工作区行的标识不参与隐藏', () => {
  const row = fakeRow('session:s1')
  const hidden = markWorkspaceRow(row, new Set(['s1']))
  assert.equal(hidden, false)
  assert.equal(row.classes.size, 0)
})

test('未分组桶的标识不参与隐藏', () => {
  const row = fakeRow('workspace:')
  const hidden = markWorkspaceRow(row, new Set(['']))
  assert.equal(hidden, false)
  assert.equal(row.classes.size, 0)
})

test('隐藏集变化后重新标记能改回可见', () => {
  const row = fakeRow('workspace:ws-1')
  markWorkspaceRow(row, new Set(['ws-1']))
  assert.equal(row.classes.has('dsh-coordinator-hidden-workspace'), true)
  markWorkspaceRow(row, new Set())
  assert.equal(row.classes.has('dsh-coordinator-hidden-workspace'), false)
  assert.equal(row.getAttribute('data-dsh-coordinator-workspace'), null)
})
