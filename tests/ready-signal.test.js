import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReadySignal } from '../src/client/ready-signal.js'

test('就绪前订阅，标记后回调一次', () => {
  const signal = createReadySignal()
  let calls = 0
  signal.subscribe(() => { calls += 1 })
  assert.equal(calls, 0)

  signal.mark()
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

test('退订后不再收到通知，已排队的那次也不执行', async () => {
  const signal = createReadySignal()
  let calls = 0
  const off = signal.subscribe(() => { calls += 1 })
  off()
  signal.mark()
  assert.equal(calls, 0)

  // 已就绪时订阅会排一次微任务：退订要能把它一并作废，否则调用方得自己再挡一次。
  const offLate = signal.subscribe(() => { calls += 1 })
  offLate()
  await Promise.resolve()
  assert.equal(calls, 0)
})

test('一个订阅者抛错不带走其余订阅者', () => {
  const signal = createReadySignal()
  let survivorCalls = 0
  const reported = []
  const originalError = console.error
  console.error = (...args) => { reported.push(args) }
  try {
    signal.subscribe(() => { throw new Error('订阅者崩了') })
    signal.subscribe(() => { survivorCalls += 1 })
    signal.mark()
  } finally {
    console.error = originalError
  }

  // 中断循环就等于让别人永久失联（ready 已置位，不会再有下一轮）。
  assert.equal(survivorCalls, 1)
  assert.equal(reported.length, 1)
})

test('通知期间新增的订阅者本轮不被调用，微任务里收到一次', async () => {
  const signal = createReadySignal()
  const order = []
  let lateCalls = 0
  signal.subscribe(() => {
    order.push('first')
    signal.subscribe(() => { lateCalls += 1 })
  })

  signal.mark()
  assert.deepEqual(order, ['first'])
  // 快照之外的新订阅者只能靠自己的微任务收到通知，本轮不该顺带叫一次。
  assert.equal(lateCalls, 0)
  await Promise.resolve()
  assert.equal(lateCalls, 1)
})
