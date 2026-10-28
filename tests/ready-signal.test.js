import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReadySignal } from '../src/client/ready-signal.js'

test('就绪前订阅，标记后回调一次', () => {
  const signal = createReadySignal()
  let calls = 0
  signal.subscribe(() => { calls += 1 })
  assert.equal(signal.isReady(), false)
  assert.equal(calls, 0)

  signal.mark()
  assert.equal(signal.isReady(), true)
  assert.equal(calls, 1)

  // 重复标记不该把订阅者再叫一遍：订阅里通常跟着一次真实的订阅动作。
  signal.mark()
  assert.equal(calls, 1)
})

test('已就绪后订阅，用微任务补一次通知', async () => {
  const signal = createReadySignal()
  signal.mark()
  let calls = 0
  signal.subscribe(() => { calls += 1 })
  // 同步补发会在调用方「判空 → 订阅」之间重入，所以必须让出一次微任务。
  assert.equal(calls, 0)
  await Promise.resolve()
  assert.equal(calls, 1)
})

test('退订后不再收到通知', () => {
  const signal = createReadySignal()
  let calls = 0
  const off = signal.subscribe(() => { calls += 1 })
  off()
  signal.mark()
  assert.equal(calls, 0)
})
