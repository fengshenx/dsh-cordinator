import assert from 'node:assert/strict'
import { test } from 'node:test'
import { notifyProjectsChanged, onProjectsChanged } from '../src/client/project-changes.js'

test('项目变更广播：退订后不再收到，别的订阅者不受影响', () => {
  let first = 0
  let second = 0
  const stopFirst = onProjectsChanged(() => { first += 1 })
  const stopSecond = onProjectsChanged(() => { second += 1 })

  notifyProjectsChanged()
  assert.equal(first, 1)
  assert.equal(second, 1)

  stopFirst()
  notifyProjectsChanged()
  assert.equal(first, 1)
  assert.equal(second, 2)

  stopSecond()
  notifyProjectsChanged()
  assert.equal(second, 2)
})

test('项目变更广播：单个订阅者抛错不打断其余订阅者', () => {
  let reached = 0
  const stopThrower = onProjectsChanged(() => { throw new Error('订阅者炸了') })
  const stopCounter = onProjectsChanged(() => { reached += 1 })
  // 广播把异常大声打出来（不静默吞），这里只确认它没被吞成「其余订阅者失联」
  const originalError = console.error
  console.error = () => {}
  try {
    notifyProjectsChanged()
  } finally {
    console.error = originalError
    stopThrower()
    stopCounter()
  }
  assert.equal(reached, 1)
})
