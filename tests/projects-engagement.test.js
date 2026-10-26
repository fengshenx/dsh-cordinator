import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildEngagementBrief,
  createEngager,
  readSessionBlank,
  resolveSessionAgent,
} from '../src/host/projects/engagement.js'

/**
 * 造一个假的 Cordis 上下文。
 * @param {object} services - 服务键到服务的映射
 * @returns {object} 上下文
 */
function createContext(services = {}) {
  return { get: (key) => services[key] }
}

/**
 * 造一个记录投递内容的假 agent。
 * @returns {{ agent: object, delivered: object[] }} agent 与记录
 */
function createAgent() {
  const delivered = []
  return {
    agent: { followup: (message) => delivered.push(message) },
    delivered,
  }
}

test('首轮正文只讲项目本身的事', () => {
  const brief = buildEngagementBrief({ name: 'demo', directory: '/tmp/demo' })
  assert.match(brief, /项目「demo」/)
  assert.match(brief, /\/tmp\/demo/)
  assert.equal(brief.includes('turn/start'), false)
})

test('会话已经跑过一轮时不重复发起', async () => {
  const { agent, delivered } = createAgent()
  const engager = createEngager({
    ctx: createContext({
      sessionController: {
        projections: async () => ({ values: { sessionListMetadata: { blank: false } } }),
        resolveAgent: async () => ({ agent }),
      },
    }),
  })
  const result = await engager.engage({ sessionId: 's-1', name: 'demo', directory: '/tmp/demo' })
  assert.deepEqual(result, { engaged: true })
  assert.deepEqual(delivered, [])
})

test('会话还没跑过一轮时投一条首轮消息', async () => {
  const { agent, delivered } = createAgent()
  const engager = createEngager({
    ctx: createContext({
      sessionController: {
        projections: async () => ({ values: { sessionListMetadata: { blank: true } } }),
        resolveAgent: async () => ({ agent }),
      },
    }),
  })
  const result = await engager.engage({ sessionId: 's-1', name: 'demo', directory: '/tmp/demo' })
  assert.deepEqual(result, { engaged: true })
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].role, 'user')
  assert.equal(delivered[0].source.kind, 'user')
  assert.match(delivered[0].content[0].text, /项目「demo」/)
})

test('读不到投影时按「还没跑过一轮」处理', async () => {
  const { agent, delivered } = createAgent()
  const engager = createEngager({
    ctx: createContext({
      sessionController: {
        projections: async () => null,
        resolveAgent: async () => ({ agent }),
      },
    }),
  })
  await engager.engage({ sessionId: 's-1', name: 'demo', directory: '/tmp/demo' })
  assert.equal(delivered.length, 1)
})

test('会话取不到时报出原因且不吞错', async () => {
  const logs = []
  const engager = createEngager({
    ctx: createContext({
      sessionController: {
        projections: async () => ({ values: { sessionListMetadata: { blank: true } } }),
        resolveAgent: async () => ({ error: new Error('会话已被销毁') }),
      },
    }),
    logger: (message) => logs.push(message),
  })
  const result = await engager.engage({ sessionId: 's-1', name: 'demo', directory: '/tmp/demo' })
  assert.equal(result.engaged, false)
  assert.match(result.reason, /协调者会话当前不可达/)
  assert.equal(logs.length, 1)
})

test('读投影失败时记日志并报出原因', async () => {
  const logs = []
  const engager = createEngager({
    ctx: createContext({
      sessionController: {
        projections: async () => { throw new Error('投影不可用') },
        resolveAgent: async () => ({ agent: createAgent().agent }),
      },
    }),
    logger: (message) => logs.push(message),
  })
  const result = await engager.engage({ sessionId: 's-1', name: 'demo', directory: '/tmp/demo' })
  assert.equal(result.engaged, false)
  assert.match(result.reason, /读会话状态失败/)
  assert.equal(logs.length, 1)
})

test('并发发起时只投递一条首轮消息', async () => {
  const { agent, delivered } = createAgent()
  const engager = createEngager({
    ctx: createContext({
      sessionController: {
        projections: async () => ({ values: { sessionListMetadata: { blank: true } } }),
        resolveAgent: async () => ({ agent }),
      },
    }),
  })
  const input = { sessionId: 's-1', name: 'demo', directory: '/tmp/demo' }
  await Promise.all([engager.engage(input), engager.engage(input)])
  assert.equal(delivered.length, 1)
})

test('没有会话控制器时读不到 blank 状态', async () => {
  assert.equal(await readSessionBlank(createContext(), 's-1'), undefined)
})

test('agent 注册表是取活 agent 的兜底路径', async () => {
  const { agent } = createAgent()
  const resolved = await resolveSessionAgent(
    createContext({ agents: { get: () => agent } }),
    's-1',
  )
  assert.equal(resolved, agent)
})
