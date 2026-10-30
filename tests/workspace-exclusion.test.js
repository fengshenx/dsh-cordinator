import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFrameScheduler, markSessionRow, markWorkspaceRow } from '../src/client/workspace-exclusion.js'

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

test('命中压灰集的工作区行被标记为不激活', () => {
  const row = fakeRow('workspace:w1')
  const quiet = markWorkspaceRow(row, new Set(['w1']))
  assert.equal(quiet, true)
  assert.equal(row.classes.has('dsh-coordinator-quiet-workspace'), true)
})

test('不在压灰集里的工作区行保持激活态', () => {
  const row = fakeRow('workspace:w2')
  const quiet = markWorkspaceRow(row, new Set(['w1']))
  assert.equal(quiet, false)
  assert.equal(row.classes.has('dsh-coordinator-quiet-workspace'), false)
})

test('压灰集变化后重新标记能恢复激活态', () => {
  const row = fakeRow('workspace:w1')
  markWorkspaceRow(row, new Set(['w1']))
  assert.equal(row.classes.has('dsh-coordinator-quiet-workspace'), true)
  markWorkspaceRow(row, new Set())
  assert.equal(row.classes.has('dsh-coordinator-quiet-workspace'), false)
})

test('会话行与工作区行各认各的前缀', () => {
  const sessionRow = fakeRow('session:s1')
  const workspaceRow = fakeRow('workspace:session:junk')
  assert.equal(markSessionRow(workspaceRow, new Set(['session:junk'])), false)
  assert.equal(markWorkspaceRow(sessionRow, new Set(['s1'])), false)
})

test('排除集变化后重新标记能改回可见', () => {
  const row = fakeRow('session:s1')
  markSessionRow(row, new Set(['s1']))
  assert.equal(row.classes.has('dsh-coordinator-excluded-session'), true)
  markSessionRow(row, new Set())
  assert.equal(row.classes.has('dsh-coordinator-excluded-session'), false)
})

/**
 * 造一个假的帧调度器：记录排了几次，并交出待执行的回调。
 * @returns {{ scheduler: object, scheduled: () => number, run: () => void, cancel: () => void }} 调度器与操作
 */
function fakeFrameScheduler() {
  let count = 0
  let callback
  let cancelled = 0
  const scheduler = createFrameScheduler({
    schedule: (task) => {
      count += 1
      callback = task
      return count
    },
    cancel: () => { cancelled += 1 },
  })
  return {
    scheduler,
    scheduled: () => count,
    cancelled: () => cancelled,
    run: () => callback?.(),
  }
}

test('同一帧内重复排任务只排一次', () => {
  const frame = fakeFrameScheduler()
  frame.scheduler.run(() => {})
  frame.scheduler.run(() => {})
  frame.scheduler.run(() => {})
  assert.equal(frame.scheduled(), 1)
})

test('任务执行后可以再排下一次', () => {
  const frame = fakeFrameScheduler()
  let count = 0
  frame.scheduler.run(() => { count += 1 })
  frame.run()
  assert.equal(count, 1)
  frame.scheduler.run(() => { count += 1 })
  frame.run()
  assert.equal(count, 2)
  assert.equal(frame.scheduled(), 2)
})

test('取消后回调即使被调用也不执行任务', () => {
  const frame = fakeFrameScheduler()
  let count = 0
  frame.scheduler.run(() => { count += 1 })
  frame.scheduler.cancel()
  assert.equal(frame.cancelled(), 1)
  frame.run()
  assert.equal(count, 0)
})
