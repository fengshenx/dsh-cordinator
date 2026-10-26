import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COORDINATOR_VIEW_TARGET,
  activateCoordinatorView,
  collectCoordinatorSessionIds,
  createCoordinatorSessionIndex,
  createCoordinatorViewDefinition,
} from '../src/client/coordinator-view-logic.js'

test('视图定义的目标 id 固定', () => {
  assert.equal(createCoordinatorViewDefinition().target, COORDINATOR_VIEW_TARGET)
})

test('视图定义激活即生效', () => {
  const definition = createCoordinatorViewDefinition()
  assert.equal(definition.isActive(definition.create().empty), true)
})

test('视图构建器的快照恒定：replace 与 apply 给出同一个值', () => {
  const builder = createCoordinatorViewDefinition().create()
  const replaced = builder.replace({ nodes: [], timeline: {} })
  const applied = builder.apply({ upserts: [], timeline: {} })
  assert.equal(replaced, builder.empty)
  assert.equal(applied, builder.empty)
})

test('会话索引：订阅即刻收到当前名单', () => {
  const index = createCoordinatorSessionIndex()
  const seen = []
  index.subscribe((ids) => seen.push([...ids]))
  index.update(['s-1'])
  assert.deepEqual(seen, [[], ['s-1']])
})

test('会话索引：名单没变时不通知', () => {
  const index = createCoordinatorSessionIndex()
  index.update(['s-1'])
  const seen = []
  index.subscribe((ids) => seen.push([...ids]))
  index.update(['s-1'])
  assert.deepEqual(seen, [['s-1']])
})

test('会话索引：退订后不再收到通知', () => {
  const index = createCoordinatorSessionIndex()
  const seen = []
  const unsubscribe = index.subscribe((ids) => seen.push([...ids]))
  unsubscribe()
  index.update(['s-1'])
  assert.deepEqual(seen, [[]])
})

test('从项目列表里取协调者会话 id', () => {
  assert.deepEqual(collectCoordinatorSessionIds([
    { id: 'p-1', coordinatorSessionId: 's-1' },
    { id: 'p-2', coordinatorSessionId: '' },
    { id: 'p-3' },
  ]), ['s-1'])
})

test('项目列表不是数组时取不到协调者会话', () => {
  assert.deepEqual(collectCoordinatorSessionIds(undefined), [])
  assert.deepEqual(collectCoordinatorSessionIds({}), [])
})

test('会话已绑定时激活协调者视图目标', () => {
  const activated = []
  const conversation = {
    binding: (sessionId) => ({ activate: (target) => activated.push([sessionId, target]) }),
  }
  assert.equal(activateCoordinatorView(conversation, 's-1'), true)
  assert.deepEqual(activated, [['s-1', COORDINATOR_VIEW_TARGET]])
})

test('会话还没绑定时不激活', () => {
  const conversation = {
    binding: () => { throw new Error('unknown session') },
  }
  assert.equal(activateCoordinatorView(conversation, 's-1'), false)
})

test('会话视图服务缺失时不激活', () => {
  assert.equal(activateCoordinatorView(undefined, 's-1'), false)
  assert.equal(activateCoordinatorView({}, 's-1'), false)
})
