import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMessageWorkerTool } from '../src/host/tools/message-worker.js'

/** 造一个记录调用的派工器假身。 */
function createFakeDispatcher() {
  const calls = []
  return {
    calls,
    async message(input) {
      calls.push(input)
      if (input.childId === 'child-在飞') return { code: 'merged', label: '在飞的工' }
      return { code: 'sent', label: '已结算的工' }
    },
  }
}

/** 跑一次工具 execute 的快捷方式。 */
function run(tool, args, agent = { id: 'parent-1' }) {
  return tool.execute(args, { agent, signal: new AbortController().signal })
}

test('childId 缺失或非字符串时报错', async () => {
  const tool = createMessageWorkerTool({ dispatcher: createFakeDispatcher() })
  await assert.rejects(() => run(tool, { message: 'hi' }), /childId/)
  await assert.rejects(() => run(tool, { childId: '  ', message: 'hi' }), /childId/)
  await assert.rejects(() => run(tool, { childId: 42, message: 'hi' }), /childId/)
})

test('message 缺失或空白时报错', async () => {
  const tool = createMessageWorkerTool({ dispatcher: createFakeDispatcher() })
  await assert.rejects(() => run(tool, { childId: 'child-1' }), /message/)
  await assert.rejects(() => run(tool, { childId: 'child-1', message: '' }), /message/)
})

test('没有调用方 agent 时报错', async () => {
  const tool = createMessageWorkerTool({ dispatcher: createFakeDispatcher() })
  await assert.rejects(() => tool.execute({ childId: 'child-1', message: 'hi' }, { signal: new AbortController().signal }), /agent/)
})

test('透传给派工器并返回 merged 状态', async () => {
  const dispatcher = createFakeDispatcher()
  const tool = createMessageWorkerTool({ dispatcher })
  const result = await run(tool, { childId: 'child-在飞', message: '补个用例' })
  assert.equal(result.status, 'merged')
  assert.equal(result.label, '在飞的工')
  assert.equal(dispatcher.calls.length, 1)
  assert.equal(dispatcher.calls[0].childId, 'child-在飞')
  assert.equal(dispatcher.calls[0].message, '补个用例')
})

test('返回 sent 状态', async () => {
  const tool = createMessageWorkerTool({ dispatcher: createFakeDispatcher() })
  const result = await run(tool, { childId: 'child-1', message: '再核对' })
  assert.equal(result.status, 'sent')
  assert.equal(result.childId, 'child-1')
})

test('渲染文案区分两种状态', () => {
  const tool = createMessageWorkerTool({ dispatcher: createFakeDispatcher() })
  const merged = tool.output.render({}, { childId: 'c1', label: '工A', status: 'merged' })
  assert.ok(merged[0].text.includes('仍在运行'))
  const sent = tool.output.render({}, { childId: 'c1', label: '工B', status: 'sent' })
  assert.ok(sent[0].text.includes('自动回报'))
})
