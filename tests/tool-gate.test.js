import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COORDINATOR_ONLY_TOOLS,
  WORKER_HIDDEN_TOOLS,
  applyToolGate,
  deniedToolsFor,
  isWorkerAgent,
} from '../src/host/tools/gate.js'

/**
 * 造一个 agent 假件，并记录作用域上的 restrict 调用。
 * @param {object} options - 选项
 * @param {string} options.id - 会话 id
 * @param {string} [options.origin] - 会话头 origin
 * @returns {object} agent
 */
function makeAgent({ id, origin }) {
  const restrictions = []
  return {
    id,
    session: { header: origin === undefined ? {} : { origin } },
    ctx: { tools: { restrict: (filter) => { restrictions.push(filter); return () => {} } } },
    restrictions,
  }
}

test('isWorkerAgent 只认 origin 为 subagent 的会话', () => {
  assert.equal(isWorkerAgent(makeAgent({ id: 's', origin: 'subagent' })), true)
  assert.equal(isWorkerAgent(makeAgent({ id: 's' })), false)
  assert.equal(isWorkerAgent(makeAgent({ id: 's', origin: 'user' })), false)
  assert.equal(isWorkerAgent({ id: 's' }), false)
  assert.equal(isWorkerAgent(undefined), false)
})

test('isWorkerAgent 在会话头缺失时不算 worker', () => {
  assert.equal(isWorkerAgent({ id: 's', session: {} }), false)
  assert.equal(isWorkerAgent({ id: 's', session: { header: undefined } }), false)
})

test('协调者一个工具都不禁', () => {
  const denied = deniedToolsFor({
    agent: makeAgent({ id: 'coordinator-1' }),
    isCoordinatorSession: (id) => id === 'coordinator-1',
  })
  assert.deepEqual(denied, [])
})

test('普通会话禁掉 worker 编排与全库查询', () => {
  const denied = deniedToolsFor({
    agent: makeAgent({ id: 'plain-1' }),
    isCoordinatorSession: () => false,
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS])
})

test('worker 再少掉项目注册表的读写', () => {
  const denied = deniedToolsFor({
    agent: makeAgent({ id: 'worker-1', origin: 'subagent' }),
    // worker 会话的 cwd 在项目目录里，但它是子会话——身份优先于归属
    isCoordinatorSession: () => true,
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS, ...WORKER_HIDDEN_TOOLS])
})

test('applyToolGate 只对受限角色调 restrict，并在作用域上留下限制', () => {
  const coordinator = makeAgent({ id: 'c' })
  applyToolGate({ agent: coordinator, isCoordinatorSession: (id) => id === 'c' })
  assert.deepEqual(coordinator.restrictions, [])

  const plain = makeAgent({ id: 'p' })
  const plainDenied = applyToolGate({ agent: plain, isCoordinatorSession: () => false })
  assert.deepEqual(plain.restrictions, [{ deny: [...COORDINATOR_ONLY_TOOLS] }])
  assert.deepEqual(plainDenied, [...COORDINATOR_ONLY_TOOLS])

  const worker = makeAgent({ id: 'w', origin: 'subagent' })
  applyToolGate({ agent: worker, isCoordinatorSession: () => false })
  assert.deepEqual(worker.restrictions, [{ deny: [...COORDINATOR_ONLY_TOOLS, ...WORKER_HIDDEN_TOOLS] }])
})

test('两组名单不重叠，改名时不会悄悄互相覆盖', () => {
  const overlap = COORDINATOR_ONLY_TOOLS.filter((name) => WORKER_HIDDEN_TOOLS.includes(name))
  assert.deepEqual(overlap, [])
})
