import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { cleanupTempDirs, makeTempDir } from './helpers/temp-dir.js'
import { createDispatcher, buildNotificationText, buildWorkerReport } from '../src/host/dispatch.js'
import { createNotificationStore } from '../src/host/notification-store.js'
import { createSpawnWorkerTool } from '../src/host/tools/spawn-worker.js'

// 临时目录统一登记、测试结束后统一删：用例自己 rm 容易漏，也会在在途写盘
// 与删除之间撞出 ENOENT / ENOTEMPTY。
after(cleanupTempDirs)

/**
 * 等待条件成立。落盘与唤醒是异步链，固定轮次的等待会在慢机器上偶发失败。
 * @param {() => boolean | Promise<boolean>} predicate - 条件
 * @param {number} [timeoutMs] - 超时毫秒
 * @returns {Promise<boolean>} 条件是否成立
 */
async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return await predicate()
}

/**
 * 构造一个假的 dsh 上下文与激活记录。
 * @returns {object} 测试夹具
 */
function createFixture() {
  const activations = []
  const agents = new Map()
  const delivered = []
  let sequence = 0
  const subagents = {
    async startActivation(spec) {
      sequence += 1
      const childId = `child-${sequence}`
      let settle
      const result = new Promise((resolve) => {
        settle = resolve
      })
      activations.push({ spec, childId, settle })
      return { childId, result }
    },
  }
  const ctx = {
    get(key) {
      if (key === 'subagents') return subagents
      if (key === 'agents') return { get: (id) => agents.get(id) }
      return undefined
    },
  }
  return { ctx, activations, agents, delivered }
}

/**
 * 建一个父 agent 假身。
 *
 * 记录走 `followup`：完成通知排进父会话的下一个 turn（inbox 的 next-turn 边界）。
 *
 * @param {string} id - 会话 id
 * @param {object[]} delivered - 收到的消息数组
 * @returns {object} agent 假身
 */
function createParent(id, delivered, status = 'idle') {
  return {
    id,
    status,
    followup(message) {
      delivered.push(message)
    },
  }
}

test('通知正文包含任务标签、状态与产物摘要', () => {
  const text = buildNotificationText(
    { label: '实现派工', childId: 'child-1' },
    { ok: true, result: { stopReason: 'completed', output: [{ type: 'text', text: '改完了' }] } },
  )
  assert.match(text, /实现派工/)
  assert.match(text, /child-1/)
  assert.match(text, /completed/)
  assert.match(text, /改完了/)
})

test('失败终态的通知正文写明失败原因', () => {
  const text = buildNotificationText(
    { label: '实现派工', childId: 'child-1' },
    { ok: false, error: new Error('模型不可用') },
  )
  assert.match(text, /failed/)
  assert.match(text, /模型不可用/)
})

test('派工立即返回，不等待 worker 完成', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
    const parent = createParent('parent-1', fixture.delivered)

    const record = await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })

    assert.equal(record.childId, 'child-1')
    assert.equal(dispatcher.inflightCount(), 1)
    assert.equal(fixture.delivered.length, 0)
  } finally {
  }
})

test('worker 完成后通知父会话并从队列移除', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
    const parent = createParent('parent-1', fixture.delivered)
    fixture.agents.set('parent-1', parent)

    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({
      stopReason: 'completed',
      output: [{ type: 'text', text: '产物在此' }],
    })
    await waitFor(() => fixture.delivered.length === 1)
    await waitFor(async () => (await store.listPending()).length === 0)

    assert.equal(fixture.delivered.length, 1)
    assert.equal(fixture.delivered[0].role, 'user')
    assert.match(fixture.delivered[0].content[0].text, /产物在此/)
    assert.equal((await store.listPending()).length, 0)
  } finally {
  }
})

test('父会话正忙时通知先留队，空闲后自动投递', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store: createNotificationStore({ home }) })
  try {
    const store = createNotificationStore({ home })
    const parent = createParent('parent-1', fixture.delivered, 'running')
    fixture.agents.set('parent-1', parent)

    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({
      stopReason: 'completed',
      output: [{ type: 'text', text: '产物在此' }],
    })
    // 协调者正忙：不投，通知留在落盘队列里
    await waitFor(async () => (await store.listPending()).length === 1)
    assert.equal(fixture.delivered.length, 0)

    // 转空闲后自动投递。投递与落盘的「已投递」标记之间有一步异步：
    // 消息先到父会话，队列文件随后才清——等两件事都成立再断言。
    parent.status = 'idle'
    await waitFor(async () => (
      fixture.delivered.length === 1 && (await store.listPending()).length === 0
    ), 5000)
    assert.equal(fixture.delivered.length, 1)
    assert.equal((await store.listPending()).length, 0)
  } finally {
    dispatcher.dispose()
  }
})

test('轮询重入不会重复投递同一条通知', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  const real = createNotificationStore({ home })
  // 造出「两次轮询拿到同一份待投快照」：第一份读到的结果被缓存下来，
  // 之后每次轮询都返回它——两个轮询都认为这条通知还等着投。
  let calls = 0
  let snapshot = null
  const store = {
    listPending: async () => {
      calls += 1
      if (snapshot === null) snapshot = await real.listPending()
      await new Promise((resolve) => setTimeout(resolve, calls % 2 === 1 ? 800 : 300))
      return snapshot
    },
    markDelivered: (id) => real.markDelivered(id),
    markUndelivered: (id, reason) => real.markUndelivered(id, reason),
    enqueue: (notification) => real.enqueue(notification),
  }
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
  try {
    const parent = createParent('parent-1', fixture.delivered, 'running')
    fixture.agents.set('parent-1', parent)
    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({
      stopReason: 'completed',
      output: [{ type: 'text', text: '产物在此' }],
    })
    await waitFor(async () => (await real.listPending()).length === 1)
    parent.status = 'idle'
    // 两轮轮询（500ms 一次）都跑过
    await new Promise((resolve) => setTimeout(resolve, 2000))
    assert.equal(fixture.delivered.length, 1)
  } finally {
    dispatcher.dispose()
  }
})

test('空闲检测读盘失败不会变成未处理拒绝', async () => {
  const fixture = createFixture()
  const rejections = []
  const onRejection = (reason) => rejections.push(reason)
  process.on('unhandledRejection', onRejection)
  const store = {
    listPending: async () => { throw new Error('EIO: i/o error, read') },
    markDelivered: async () => {},
    markUndelivered: async () => {},
    enqueue: async () => {},
  }
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
  try {
    const parent = createParent('parent-1', fixture.delivered, 'running')
    fixture.agents.set('parent-1', parent)
    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({
      stopReason: 'completed',
      output: [{ type: 'text', text: '产物在此' }],
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    assert.deepEqual(rejections, [])
    assert.equal(fixture.delivered.length, 0)
  } finally {
    process.off('unhandledRejection', onRejection)
    dispatcher.dispose()
  }
})

test('改造前落盘的旧通知补投不会失败', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  const store = createNotificationStore({ home })
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
  try {
    // PR #6 形状的记录：没有 summary / report / outcome 字段。
    await store.enqueue({
      id: 'note-old-1',
      childId: 'child-old',
      parentSessionId: 'parent-1',
      label: '实现派工',
      text: '任务「实现派工」已结束。\n子会话：child-old',
      createdAt: 1,
      attempts: 0,
    })
    const parent = createParent('parent-1', fixture.delivered)
    fixture.agents.set('parent-1', parent)
    const delivered = await dispatcher.redeliverPending(parent)
    assert.equal(delivered, 1)
    assert.equal(fixture.delivered.length, 1)
    const source = fixture.delivered[0].source
    assert.equal(source.summary, '任务「实现派工」已结束。')
    assert.equal(source.worker.report, '')
    assert.equal(source.worker.outcome, 'completed')
  } finally {
    dispatcher.dispose()
  }
})

test('插件卸载后不再起定时器', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  const store = createNotificationStore({ home })
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
  try {
    dispatcher.dispose()
    // 卸载后即便父会话转空闲，也不该再有定时器把它投出去
    const parent = createParent('parent-1', fixture.delivered, 'idle')
    fixture.agents.set('parent-1', parent)
    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({
      stopReason: 'completed',
      output: [{ type: 'text', text: '产物在此' }],
    })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    // 卸载后不再投递，也不该有轮询把它送出去
    assert.equal(fixture.delivered.length, 0)
    assert.equal((await store.listPending()).length, 1)
  } finally {
    dispatcher.dispose()
  }
})

test('worker 最后一次回报的内容只取产物摘要或失败原因', () => {
  assert.equal(
    buildWorkerReport({ ok: true, result: { output: [{ type: 'text', text: '改完了' }] } }),
    '改完了',
  )
  assert.equal(buildWorkerReport({ ok: true, result: { output: [] } }), '（worker 未产出文本）')
  assert.equal(buildWorkerReport({ ok: false, error: new Error('模型不可用') }), '失败：模型不可用')
})

test('父会话已销毁时通知留在队列等待补投', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
    const parent = createParent('parent-1', fixture.delivered)
    dispatcher.markDisposed('parent-1')

    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({ stopReason: 'completed', output: [] })
    await waitFor(async () => (await store.listPending()).length === 1)

    assert.equal(fixture.delivered.length, 0)
    assert.equal((await store.listPending()).length, 1)
  } finally {
  }
})

test('父会话注册后补投队列中的通知', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
    const parent = createParent('parent-1', fixture.delivered)
    dispatcher.markDisposed('parent-1')

    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '实现派工',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({ stopReason: 'completed', output: [] })
    await waitFor(async () => (await store.listPending()).length === 1)
    assert.equal(fixture.delivered.length, 0)

    dispatcher.markAlive('parent-1')
    const delivered = await dispatcher.redeliverPending(parent)

    assert.equal(delivered, 1)
    assert.equal(fixture.delivered.length, 1)
    assert.equal((await store.listPending()).length, 0)
  } finally {
  }
})

test('连续自动续行达到上限后不再唤醒', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  const store = createNotificationStore({ home })
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store, autoResumeLimit: 2 })
  try {
    const parent = createParent('parent-1', fixture.delivered)
    fixture.agents.set('parent-1', parent)

    for (let index = 0; index < 3; index += 1) {
      await dispatcher.dispatch({
        parent,
        task: '做一件事',
        label: `工 ${index}`,
        signal: new AbortController().signal,
      })
      fixture.activations[index].settle({ stopReason: 'completed', output: [] })
      await waitFor(() => fixture.delivered.length === Math.min(index + 1, 2))
    }
    await waitFor(async () => (await store.listPending()).length === 1)

    assert.equal(fixture.delivered.length, 2)
    assert.equal((await store.listPending()).length, 1)
  } finally {
    dispatcher.dispose()
  }
})

test('撞续行上限后不再每轮重试', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  const store = createNotificationStore({ home })
  const dispatcher = createDispatcher({ ctx: fixture.ctx, store, autoResumeLimit: 1 })
  try {
    const parent = createParent('parent-1', fixture.delivered, 'running')
    fixture.agents.set('parent-1', parent)

    // 两条通知都在父会话忙时进等待表
    for (let index = 0; index < 2; index += 1) {
      await dispatcher.dispatch({
        parent,
        task: '做一件事',
        label: `工 ${index}`,
        signal: new AbortController().signal,
      })
      fixture.activations[index].settle({ stopReason: 'completed', output: [] })
    }
    await waitFor(async () => (await store.listPending()).length === 2)

    // 转空闲：第一条投出，第二条撞上限
    parent.status = 'idle'
    await waitFor(() => fixture.delivered.length === 1, 5000)
    await waitFor(async () => {
      const pending = await store.listPending()
      return pending.some((item) => typeof item.lastError === 'string' && item.lastError.includes('上限'))
    }, 5000)

    // 撞上限后不再每 500ms 重试：尝试次数不再增长
    const before = (await store.listPending()).map((item) => item.attempts ?? 0)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const after = (await store.listPending()).map((item) => item.attempts ?? 0)
    assert.deepEqual(after, before)
    assert.equal(fixture.delivered.length, 1)
  } finally {
    dispatcher.dispose()
  }
})

test('外部输入重置自动续行计数', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store, autoResumeLimit: 1 })
    const parent = createParent('parent-1', fixture.delivered)
    fixture.agents.set('parent-1', parent)

    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '工 0',
      signal: new AbortController().signal,
    })
    fixture.activations[0].settle({ stopReason: 'completed', output: [] })
    await waitFor(() => fixture.delivered.length === 1)
    assert.equal(fixture.delivered.length, 1)

    dispatcher.resetResumeCount('parent-1')

    await dispatcher.dispatch({
      parent,
      task: '做一件事',
      label: '工 1',
      signal: new AbortController().signal,
    })
    fixture.activations[1].settle({ stopReason: 'completed', output: [] })
    await waitFor(() => fixture.delivered.length === 2)
    assert.equal(fixture.delivered.length, 2)
  } finally {
  }
})

test('spawn_worker 缺少调用方 agent 时报错', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
    const tool = createSpawnWorkerTool({ dispatcher })

    await assert.rejects(
      () => tool.execute({ task: '做一件事' }, { signal: new AbortController().signal }),
      /调用方 agent/,
    )
    await assert.rejects(
      () => tool.execute({ task: '  ' }, { signal: new AbortController().signal, agent: createParent('p', []) }),
      /task 不能为空/,
    )
  } finally {
  }
})

test('spawn_worker 返回子会话 id 且不等待结果', async () => {
  const fixture = createFixture()
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store })
    const tool = createSpawnWorkerTool({ dispatcher })

    const result = await tool.execute(
      { task: '做一件事', label: '实现派工' },
      { signal: new AbortController().signal, agent: createParent('parent-1', fixture.delivered) },
    )

    assert.equal(result.childId, 'child-1')
    assert.equal(result.status, 'dispatched')
    assert.equal(result.label, '实现派工')
  } finally {
  }
})

test('未启用 subagents 服务时派工明确报错', async () => {
  const home = await makeTempDir('dsh-coordinator-dispatch-')
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: { get: () => undefined }, store })
    await assert.rejects(
      () => dispatcher.dispatch({
        parent: createParent('parent-1', []),
        task: '做一件事',
        label: '工',
        signal: new AbortController().signal,
      }),
      /subagents/,
    )
  } finally {
  }
})

test('派工工具拒绝非字符串的 label，不静默换成任务前缀', async () => {
  const dispatcher = { dispatch: async () => ({ childId: 'child-1', label: 'x' }) }
  const tool = createSpawnWorkerTool({ dispatcher })
  await assert.rejects(
    () => tool.execute({ task: '做一件事', label: 7 }, { signal: new AbortController().signal, agent: createParent('p', []) }),
    /label 必须是字符串/,
  )
})
