import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { cleanupTempDirs, makeTempDir } from './helpers/temp-dir.js'
import { createDispatcher } from '../src/host/dispatch.js'
import { createNotificationStore } from '../src/host/notification-store.js'
import { createWorkerRegistry } from '../src/host/worker-registry.js'
import { WORKER_REPORT_SOURCE_KIND } from '../src/shared/worker-report.js'

after(cleanupTempDirs)

/** 协调者索引假件：续聊用例都在协调者会话里跑，默认放行。 */
const coordinatorIndex = {
  async awaitIndex() {
    return true
  },
  isCoordinatorSession: () => true,
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return await predicate()
}

/**
 * 续聊测试夹具：subagents 假件同时记录 startActivation 与 sendMessage，父 agent
 * 带 inbox（remove 可控成败）。
 * @param {object} options - 夹具选项
 * @param {boolean} [options.removeSucceeds] - inbox.remove 是否返回 true
 * @returns {object} 夹具
 */
async function createFixture({ removeSucceeds = true } = {}) {
  const activations = []
  const sent = []
  const delivered = []
  const removed = []
  const subagents = {
    async startActivation(spec) {
      let settle
      const result = new Promise((resolve) => {
        settle = resolve
      })
      const childId = `child-${activations.length + 1}`
      activations.push({ spec, childId, settle })
      return { childId, result }
    },
    async sendMessage(sender, childId, content, options) {
      sent.push({ senderId: sender.id, childId, content, options })
    },
  }
  const ctx = {
    get(key) {
      if (key === 'subagents') return subagents
      if (key === 'sessionPersistence') return { append() {} }
      if (key === 'sessionQuery') return { observeSession() {} }
      return undefined
    },
  }
  const home = await makeTempDir('dsh-coordinator-continuation-')
  const store = createNotificationStore({ home })
  const workers = createWorkerRegistry({ home })
  const dispatcher = createDispatcher({ ctx, store, workers, coordinatorIndex })
  const parent = {
    id: 'parent-1',
    status: 'idle',
    followup(message) {
      delivered.push(message)
    },
    inbox: {
      remove(messageId) {
        removed.push(messageId)
        return removeSucceeds
      },
    },
  }
  return { dispatcher, activations, sent, delivered, removed, parent, store, workers }
}

/** 走完一次派工与首轮结算，返回子会话 id。 */
async function dispatchAndSettleFirstRound(fixture) {
  const record = await fixture.dispatcher.dispatch({
    parent: fixture.parent,
    task: '做一件事',
    label: '首轮',
    signal: new AbortController().signal,
  })
  fixture.activations[0].settle({ stopReason: 'completed', output: [{ type: 'text', text: '首轮产物' }] })
  await waitFor(() => fixture.delivered.length === 1)
  return record.childId
}

test('派工同时登记进 worker 登记表', async () => {
  const fixture = await createFixture()
  const childId = await dispatchAndSettleFirstRound(fixture)
  const record = await fixture.workers.get(childId)
  assert.notEqual(record, undefined)
  assert.equal(record.parentSessionId, 'parent-1')
  assert.equal(record.label, '首轮')
})

test('缺会话持久化后端时拒绝派工', async () => {
  const activations = []
  const ctx = {
    get(key) {
      if (key === 'subagents') return { async startActivation() {} }
      if (key === 'sessionQuery') return { observeSession() {} }
      return undefined
    },
  }
  const home = await makeTempDir('dsh-coordinator-continuation-')
  const dispatcher = createDispatcher({ ctx, store: createNotificationStore({ home }), workers: createWorkerRegistry({ home }), coordinatorIndex })
  await assert.rejects(
    () => dispatcher.dispatch({ parent: { id: 'p' }, task: 't', label: 'l', signal: new AbortController().signal }),
    /持久化/,
  )
  assert.equal(activations.length, 0)
})

test('缺会话查询后端时拒绝派工', async () => {
  const ctx = {
    get(key) {
      if (key === 'subagents') return { async startActivation() {} }
      if (key === 'sessionPersistence') return { append() {} }
      return undefined
    },
  }
  const home = await makeTempDir('dsh-coordinator-continuation-')
  const dispatcher = createDispatcher({ ctx, store: createNotificationStore({ home }), workers: createWorkerRegistry({ home }), coordinatorIndex })
  await assert.rejects(
    () => dispatcher.dispatch({ parent: { id: 'p' }, task: 't', label: 'l', signal: new AbortController().signal }),
    /查询/,
  )
})

test('worker 在飞时续聊并入当前执行', async () => {
  const fixture = await createFixture()
  const record = await fixture.dispatcher.dispatch({
    parent: fixture.parent,
    task: '做一件事',
    label: '在飞',
    signal: new AbortController().signal,
  })
  const status = await fixture.dispatcher.message({
    parent: fixture.parent,
    childId: record.childId,
    message: '顺手补个测试',
    signal: new AbortController().signal,
  })
  assert.equal(status.code, 'merged')
  assert.equal(status.label, '在飞')
  assert.equal(fixture.sent.length, 1)
  assert.equal(fixture.sent[0].childId, record.childId)
})

test('已结算 worker 续聊走登记表校验并恢复执行', async () => {
  const fixture = await createFixture()
  const childId = await dispatchAndSettleFirstRound(fixture)
  const status = await fixture.dispatcher.message({
    parent: fixture.parent,
    childId,
    message: '再核对一遍',
    signal: new AbortController().signal,
  })
  assert.equal(status.code, 'sent')
  assert.equal(fixture.sent.length, 1)
  assert.equal(fixture.sent[0].senderId, 'parent-1')
  assert.equal(fixture.sent[0].childId, childId)
  assert.equal(fixture.sent[0].content[0].text, '再核对一遍')
})

test('没有派工记录的子会话拒绝续聊', async () => {
  const fixture = await createFixture()
  await assert.rejects(
    () => fixture.dispatcher.message({
      parent: fixture.parent,
      childId: 'child-别家的',
      message: 'hi',
      signal: new AbortController().signal,
    }),
    /派工记录/,
  )
})

test('别的会话派的 worker 不能跨会话续聊', async () => {
  const fixture = await createFixture()
  const childId = await dispatchAndSettleFirstRound(fixture)
  await assert.rejects(
    () => fixture.dispatcher.message({
      parent: { ...fixture.parent, id: 'parent-别的' },
      childId,
      message: 'hi',
      signal: new AbortController().signal,
    }),
    /跨会话/,
  )
})

test('宿主 sendMessage 失败时续聊登记回滚', async () => {
  const fixture = await createFixture()
  const childId = await dispatchAndSettleFirstRound(fixture)
  const deliveredBefore = fixture.delivered.length
  // 宿主冷恢复失败：子会话日志不存在等场景
  fixture.dispatcher = undefined
  const home = await makeTempDir('dsh-coordinator-continuation-')
  const ctx = {
    get(key) {
      if (key === 'subagents') {
        return {
          async startActivation() {
            throw new Error('not used')
          },
          async sendMessage() {
            throw new Error('NOT_RESUMABLE')
          },
        }
      }
      if (key === 'sessionPersistence') return { append() {} }
      if (key === 'sessionQuery') return { observeSession() {} }
      return undefined
    },
  }
  const store = createNotificationStore({ home })
  const workers = createWorkerRegistry({ home })
  // 同一子会话登记进新 home 的登记表，让 message 走到 sendMessage
  await workers.register({ childId, parentSessionId: 'parent-1', label: '首轮' })
  const dispatcher = createDispatcher({ ctx, store, workers, coordinatorIndex })
  await assert.rejects(
    () => dispatcher.message({ parent: fixture.parent, childId, message: 'x', signal: new AbortController().signal }),
    /NOT_RESUMABLE/,
  )
  // 回滚后宿主结算事件到达不得再投通知
  dispatcher.onSubagentEnd({ id: childId, stopReason: 'completed', lastAssistantMessage: [] })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(fixture.delivered.length, deliveredBefore)
  assert.equal((await store.listPending()).length, 0)
})

test('首轮的 subagent/end 事件不触发第二轮通知', async () => {
  const fixture = await createFixture()
  await fixture.dispatcher.dispatch({
    parent: fixture.parent,
    task: '做一件事',
    label: '首轮',
    signal: new AbortController().signal,
  })
  // 首轮还没结算（result promise 未 resolve）时事件先到：在飞表里还有记录
  fixture.dispatcher.onSubagentEnd({
    id: fixture.activations[0].childId,
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'x' }],
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(fixture.delivered.length, 0)
  assert.equal((await fixture.store.listPending()).length, 0)
})

test('续聊轮结算投递同格式通知且宿主英文通知被移除', async () => {
  const fixture = await createFixture()
  const childId = await dispatchAndSettleFirstRound(fixture)
  await fixture.dispatcher.message({
    parent: fixture.parent,
    childId,
    message: '再核对一遍',
    signal: new AbortController().signal,
  })
  // 模拟宿主 notifySettlement 投入 inbox 的英文结算通知
  const handled = fixture.dispatcher.maybeSwallowSettlementNotice(fixture.parent, {
    id: 'host-notice-1',
    source: { kind: 'subagent-settled', senderSessionId: childId },
  })
  assert.equal(handled, true)
  assert.deepEqual(fixture.removed, ['host-notice-1'])
  fixture.dispatcher.onSubagentEnd({
    id: childId,
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: '续聊答复：都对' }],
  })
  await waitFor(() => fixture.delivered.length === 2)
  const notice = fixture.delivered[1]
  assert.equal(notice.source.kind, WORKER_REPORT_SOURCE_KIND)
  assert.ok(notice.content[0].text.includes('续聊答复：都对'))
  assert.ok(notice.content[0].text.includes('已结束'))
})

test('宿主通知没移除成时透传兜底、不再自发', async () => {
  const fixture = await createFixture({ removeSucceeds: false })
  const childId = await dispatchAndSettleFirstRound(fixture)
  await fixture.dispatcher.message({
    parent: fixture.parent,
    childId,
    message: '再核对一遍',
    signal: new AbortController().signal,
  })
  const handled = fixture.dispatcher.maybeSwallowSettlementNotice(fixture.parent, {
    id: 'host-notice-1',
    source: { kind: 'subagent-settled', senderSessionId: childId },
  })
  assert.equal(handled, true)
  fixture.dispatcher.onSubagentEnd({
    id: childId,
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: '续聊答复' }],
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(fixture.delivered.length, 1)
  assert.equal((await fixture.store.listPending()).length, 0)
})

test('与本插件无关的结算通知不拦', async () => {
  const fixture = await createFixture()
  const childId = await dispatchAndSettleFirstRound(fixture)
  await fixture.dispatcher.message({
    parent: fixture.parent,
    childId,
    message: '再核对',
    signal: new AbortController().signal,
  })
  // 官方 subagent 的结算通知：kind 相同但子会话不在续聊表里
  const handled = fixture.dispatcher.maybeSwallowSettlementNotice(fixture.parent, {
    id: 'host-notice-2',
    source: { kind: 'subagent-settled', senderSessionId: 'child-官方派的' },
  })
  assert.equal(handled, false)
  assert.deepEqual(fixture.removed, [])
  // 普通用户消息也不拦
  assert.equal(
    fixture.dispatcher.maybeSwallowSettlementNotice(fixture.parent, {
      id: 'user-1',
      source: { kind: 'user' },
    }),
    false,
  )
})
