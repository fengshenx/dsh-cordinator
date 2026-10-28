import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COORDINATOR_ONLY_TOOLS,
  WORKER_HIDDEN_TOOLS,
  WORKER_ONLY_TOOLS,
  applyToolGate,
  deniedToolsFor,
} from '../src/host/tools/gate.js'

/**
 * 造一个 agent 假件，并记录作用域上的 restrict 调用。
 * @param {string} id - 会话 id
 * @returns {object} agent
 */
function makeAgent(id) {
  const restrictions = []
  return {
    id,
    ctx: { tools: { restrict: (filter) => { restrictions.push(filter); return () => {} } } },
    restrictions,
  }
}

test('协调者拿不到收作业的工具', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('coordinator-1'),
    isCoordinatorSession: (id) => id === 'coordinator-1',
    isWorkerSession: () => false,
  })
  // worker_done 报的是「本次派工的回报」，协调者调它只会指向不存在的在飞记录。
  assert.deepEqual(denied, [...WORKER_ONLY_TOOLS])
})

test('worker 看不到派工与项目注册表，但能交作业', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('worker-1'),
    isCoordinatorSession: () => false,
    isWorkerSession: (id) => id === 'worker-1',
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS, ...WORKER_HIDDEN_TOOLS])
  assert.equal(denied.includes('worker_done'), false)
})

test('普通会话禁掉派工与交作业', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('plain-1'),
    isCoordinatorSession: () => false,
    isWorkerSession: () => false,
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS, ...WORKER_ONLY_TOOLS])
})

test('缺 worker 判定时按普通会话处理，不误判成 worker', () => {
  const denied = deniedToolsFor({
    agent: makeAgent('whatever'),
    isCoordinatorSession: () => false,
  })
  assert.deepEqual(denied, [...COORDINATOR_ONLY_TOOLS, ...WORKER_ONLY_TOOLS])
})

test('applyToolGate 只对受限角色调 restrict，并在作用域上留下限制', () => {
  const coordinator = makeAgent('c')
  applyToolGate({
    agent: coordinator,
    isCoordinatorSession: (id) => id === 'c',
    isWorkerSession: () => false,
  })
  assert.deepEqual(coordinator.restrictions, [{ deny: [...WORKER_ONLY_TOOLS] }])

  const worker = makeAgent('w')
  const workerDenied = applyToolGate({
    agent: worker,
    isCoordinatorSession: () => false,
    isWorkerSession: () => true,
  })
  assert.deepEqual(worker.restrictions, [{ deny: [...COORDINATOR_ONLY_TOOLS, ...WORKER_HIDDEN_TOOLS] }])
  assert.deepEqual(workerDenied, [...COORDINATOR_ONLY_TOOLS, ...WORKER_HIDDEN_TOOLS])
})

test('三组名单两两不重叠，改名时不会悄悄互相覆盖', () => {
  const groups = [COORDINATOR_ONLY_TOOLS, WORKER_HIDDEN_TOOLS, WORKER_ONLY_TOOLS]
  for (let index = 0; index < groups.length; index += 1) {
    for (let other = index + 1; other < groups.length; other += 1) {
      const overlap = groups[index].filter((name) => groups[other].includes(name))
      assert.deepEqual(overlap, [])
    }
  }
})
