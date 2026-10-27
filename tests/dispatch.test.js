import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDispatcher, buildNotificationText } from '../src/host/dispatch.js'
import { createNotificationStore } from '../src/host/notification-store.js'
import { createSpawnWorkerTool } from '../src/host/tools/spawn-worker.js'

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
 * 记录走 `steer`：完成通知投到 inbox 的 next-step 边界，这样它不进宿主的
 * 「消息队列」面板（那里只显示 next-turn 队列）。
 *
 * @param {string} id - 会话 id
 * @param {object[]} delivered - 收到的消息数组
 * @returns {object} agent 假身
 */
function createParent(id, delivered) {
  return {
    id,
    steer(message) {
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
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('worker 完成后通知父会话并从队列移除', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('父会话已销毁时通知留在队列等待补投', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('父会话注册后补投队列中的通知', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('连续自动续行达到上限后不再唤醒', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
  try {
    const store = createNotificationStore({ home })
    const dispatcher = createDispatcher({ ctx: fixture.ctx, store, autoResumeLimit: 2 })
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
    await rm(home, { recursive: true, force: true })
  }
})

test('外部输入重置自动续行计数', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('spawn_worker 缺少调用方 agent 时报错', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('spawn_worker 返回子会话 id 且不等待结果', async () => {
  const fixture = createFixture()
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
  }
})

test('未启用 subagents 服务时派工明确报错', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-dispatch-'))
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
    await rm(home, { recursive: true, force: true })
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
