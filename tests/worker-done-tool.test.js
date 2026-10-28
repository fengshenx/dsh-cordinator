import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWorkerDoneTool } from '../src/host/tools/worker-done.js'

/**
 * 造一个记录调用的派工器假身。
 *
 * @param {{ acknowledged?: boolean }} [options] - 选项
 * @returns {object} 派工器
 */
function createFakeDispatcher({ acknowledged = true } = {}) {
  const calls = []
  return {
    calls,
    async reportDone(input) {
      calls.push(input)
      return acknowledged
    },
  }
}

/**
 * 跑一次工具 execute 的快捷方式。
 *
 * @param {object} tool - 工具定义
 * @param {object} args - 参数
 * @param {object} [agent] - 调用方 agent
 * @returns {Promise<object>} 执行结果
 */
function run(tool, args, agent = { id: 'worker-1' }) {
  return tool.execute(args, { agent, signal: new AbortController().signal })
}

test('summary 缺失或空白时报错', async () => {
  const tool = createWorkerDoneTool({ dispatcher: createFakeDispatcher() })
  await assert.rejects(() => run(tool, {}), /summary/)
  await assert.rejects(() => run(tool, { summary: '   ' }), /summary/)
  await assert.rejects(() => run(tool, { summary: 42 }), /summary/)
})

test('outcome 只接受 completed 与 failed', async () => {
  const tool = createWorkerDoneTool({ dispatcher: createFakeDispatcher() })
  await assert.rejects(() => run(tool, { summary: '做完了', outcome: 'ok' }), /outcome/)
})

test('省略 outcome 时按完成结算', async () => {
  const dispatcher = createFakeDispatcher()
  const tool = createWorkerDoneTool({ dispatcher })

  const result = await run(tool, { summary: '改完了三个文件' })

  assert.deepEqual(result, { acknowledged: true })
  assert.deepEqual(dispatcher.calls, [
    { sessionId: 'worker-1', summary: '改完了三个文件', outcome: 'completed' },
  ])
})

test('报失败时把 outcome 一起带下去', async () => {
  const dispatcher = createFakeDispatcher()
  const tool = createWorkerDoneTool({ dispatcher })

  await run(tool, { summary: '依赖装不上', outcome: 'failed' })

  assert.equal(dispatcher.calls[0].outcome, 'failed')
})

test('没有调用方会话时报错，不猜一个会话 id', async () => {
  const tool = createWorkerDoneTool({ dispatcher: createFakeDispatcher() })
  await assert.rejects(() => run(tool, { summary: 'x' }, { id: '' }), /调用方会话/)
  await assert.rejects(() => run(tool, { summary: 'x' }, null), /调用方会话/)
})

test('没有在飞记录时如实说没结算，不谎报已回报', async () => {
  const tool = createWorkerDoneTool({ dispatcher: createFakeDispatcher({ acknowledged: false }) })

  const result = await run(tool, { summary: '人直接聊的那一轮' })
  const rendered = tool.output.render({}, result)

  assert.deepEqual(result, { acknowledged: false })
  assert.match(rendered[0].text, /没有在飞的派工记录/)
})

test('结算成功时提示协调者会被唤醒', () => {
  const tool = createWorkerDoneTool({ dispatcher: createFakeDispatcher() })
  const rendered = tool.output.render({}, { acknowledged: true })
  assert.match(rendered[0].text, /协调者/)
})
