import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COORDINATOR_ONLY_TOOLS,
  COORDINATOR_UNUSABLE_TOOLS,
  applyToolGate,
  deniedToolsFor,
} from '../src/host/tools/gate.js'

/**
 * 造一个 agent 假件，并记录作用域上的 restrict 调用。
 *
 * 方法面照 `engines.dsh` 的下限（0.2.1-rc.2）构造：只有 `restrict` / `get` /
 * `schemas`。夹具多给一个宿主方法就会掩盖版本缺口——`definitions()` 是
 * 0.2.2-alpha.2 才加的，在 0.2.1-rc.2 上调用是 TypeError，而那个调用落在
 * `agent/created` 上，会让每个会话创建都失败。
 *
 * @param {string} id - 会话 id
 * @param {string[]} [registered] - 该作用域里已注册的全局工具名，默认包含三件宿主工具
 * @returns {object} agent
 */
function makeAgent(id, registered = ['list_agents', 'send_message', 'interrupt_agent', 'read']) {
  const restrictions = []
  const names = new Set(registered)
  return {
    id,
    ctx: {
      tools: {
        restrict: (filter) => { restrictions.push(filter); return () => {} },
        get: (name) => (names.has(name) ? { name } : undefined),
        schemas: () => registered.map((name) => ({ name })),
      },
    },
    restrictions,
  }
}

test('协调者拿不到收作业的工具，也拿不到对 worker 无效的三件宿主工具', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('coordinator-1'),
    isCoordinatorSession: (id) => id === 'coordinator-1',
    isWorkerSession: () => false,
  })
  // 三件宿主 subagent 工具对根会话 worker 全部无效，其中一个还返回假成功回执，
  // 从工具面直接摘掉比只在文档里叮嘱可靠。
  assert.deepEqual(denied, [...COORDINATOR_UNUSABLE_TOOLS])
})

test('worker 看不到派工与全库查询', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('worker-1'),
    isCoordinatorSession: () => false,
    isWorkerSession: (id) => id === 'worker-1',
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS])
})

test('普通会话禁掉派工与全库查询', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('plain-1'),
    isCoordinatorSession: () => false,
    isWorkerSession: () => false,
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS])
})

test('缺 worker 判定时按普通会话处理，不误判成 worker', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('whatever'),
    isCoordinatorSession: () => false,
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS])
})

test('applyToolGate 只对受限角色调 restrict，并在作用域上留下限制', () => {
  const coordinator = makeAgent('c')
  applyToolGate({
    agent: coordinator,
    isCoordinatorSession: (id) => id === 'c',
    isWorkerSession: () => false,
  })
  assert.deepEqual(coordinator.restrictions, [{ deny: [...COORDINATOR_UNUSABLE_TOOLS] }])

  const worker = makeAgent('w')
  const workerDenied = applyToolGate({
    agent: worker,
    isCoordinatorSession: () => false,
    isWorkerSession: () => true,
  })
  assert.deepEqual(worker.restrictions, [{ deny: [...COORDINATOR_ONLY_TOOLS] }])
  assert.deepEqual(workerDenied, [...COORDINATOR_ONLY_TOOLS])
})

test('宿主没装 subagent 控制工具时跳过那三件，不拿未注册的工具名去 restrict', () => {
  // `restrict()` 对没注册过的全局工具名直接报错，而这三件来自可被禁用的宿主组合。
  const coordinator = makeAgent('c', ['read', 'write'])
  const denied = applyToolGate({
    agent: coordinator,
    isCoordinatorSession: (id) => id === 'c',
    isWorkerSession: () => false,
  })
  assert.deepEqual(denied, [])
  assert.deepEqual(coordinator.restrictions, [])
})

test('只依赖 engines 下限的 tools 方法面', () => {
  // 0.2.1-rc.2 的 ToolsService 没有 definitions()。这个调用落在 agent/created 上，
  // 一旦用上就是每个会话创建都 TypeError——而且夹具给了假方法就测不出来。
  const coordinator = makeAgent('c')
  assert.equal(typeof coordinator.ctx.tools.definitions, 'undefined')
  assert.doesNotThrow(() => applyToolGate({
    agent: coordinator,
    isCoordinatorSession: (id) => id === 'c',
    isWorkerSession: () => false,
  }))
})

test('两组名单不重叠，改名时不会悄悄互相覆盖', () => {
  const overlap = COORDINATOR_ONLY_TOOLS.filter((name) => COORDINATOR_UNUSABLE_TOOLS.includes(name))
  assert.deepEqual(overlap, [])
})
