import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectRemote } from '../src/host/projects/remote.js'
import {
  PROJECT_REMOTE_METHODS,
  PROJECT_REMOTE_NAMESPACE,
  PROJECT_REMOTE_SERVICE_KEY,
} from '../src/shared/projects.js'

const DESCRIPTOR_PROPERTY = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * 造一个只记录 provide 的假 Cordis 上下文。
 * @returns {{ctx: object, provided: Map<string, object>}} 上下文与登记表
 */
function fakeCtx() {
  const provided = new Map()
  return {
    provided,
    ctx: {
      provide(key, value) {
        provided.set(key, value)
        return () => provided.delete(key)
      },
    },
  }
}

/**
 * 造一个记录调用的假项目服务。
 * @returns {object} 项目服务
 */
function fakeService() {
  const calls = []
  return {
    calls,
    async list() {
      calls.push(['list'])
      return [{ id: 'p1', name: 'demo', directory: '/tmp/demo', coordinatorSessionId: 's1' }]
    },
    async create({ directory, name }) {
      calls.push(['create', directory, name])
      return { id: 'p2', name, directory, coordinatorSessionId: 's2' }
    },
    async remove(id) {
      calls.push(['remove', id])
      return { id, name: 'gone', directory: '/tmp/gone', coordinatorSessionId: 's3' }
    },
    async rename(id, name) {
      calls.push(['rename', id, name])
      return { id, name, directory: '/tmp/demo', coordinatorSessionId: 's1' }
    },
    async replaceCoordinator(id) {
      calls.push(['replaceCoordinator', id])
      return { id, name: 'demo', directory: '/tmp/demo', coordinatorSessionId: 's4' }
    },
  }
}

test('远程服务注册进 Cordis，服务键与命名空间对齐契约', () => {
  const { ctx, provided } = fakeCtx()
  const remote = createProjectRemote({ service: fakeService(), ctx })

  assert.equal(provided.get(PROJECT_REMOTE_SERVICE_KEY), remote)
  assert.equal(remote.typertRemote.serviceKey, PROJECT_REMOTE_SERVICE_KEY)
  assert.equal(remote.typertRemote.namespace, PROJECT_REMOTE_NAMESPACE)
  // 绑定里的 service 必须指向服务实例本身：宿主拿它与调用时取到的实例比对。
  assert.equal(remote.typertRemote.service, remote)
})

test('原型上的方法标记覆盖契约里的每个方法', () => {
  const { ctx } = fakeCtx()
  const remote = createProjectRemote({ service: fakeService(), ctx })
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(remote),
    DESCRIPTOR_PROPERTY,
  ).value

  assert.equal(descriptor.version, 1)
  assert.deepEqual(
    descriptor.methods.map((marker) => marker.method),
    Object.keys(PROJECT_REMOTE_METHODS),
  )
  for (const marker of descriptor.methods) {
    assert.deepEqual(marker.invocation, { kind: 'direct' })
  }
})

test('方法的形参名与契约一致——宿主按源码里的形参名建 wire 字段', () => {
  const { ctx } = fakeCtx()
  const remote = createProjectRemote({ service: fakeService(), ctx })

  for (const [method, expected] of Object.entries(PROJECT_REMOTE_METHODS)) {
    const source = Function.prototype.toString.call(remote[method])
    const open = source.indexOf('(')
    const close = source.indexOf(')', open + 1)
    const names = source.slice(open + 1, close).split(',').map((part) => part.trim()).filter(Boolean)
    assert.deepEqual(names, [...expected], `${method} 的形参名与契约不一致`)
  }
})

test('方法把调用转给项目服务', async () => {
  const { ctx } = fakeCtx()
  const service = fakeService()
  const remote = createProjectRemote({ service, ctx })

  assert.deepEqual(await remote.list(), [
    { id: 'p1', name: 'demo', directory: '/tmp/demo', coordinatorSessionId: 's1' },
  ])
  assert.deepEqual(await remote.create('/tmp/x', 'x'), {
    id: 'p2', name: 'x', directory: '/tmp/x', coordinatorSessionId: 's2',
  })
  assert.deepEqual(await remote.rename('p1', '新名'), {
    id: 'p1', name: '新名', directory: '/tmp/demo', coordinatorSessionId: 's1',
  })
  assert.deepEqual(await remote.replaceCoordinator('p1'), {
    id: 'p1', name: 'demo', directory: '/tmp/demo', coordinatorSessionId: 's4',
  })
})

test('注销项目返回布尔结果，不返回可能缺失的项目对象', async () => {
  const { ctx } = fakeCtx()
  const service = fakeService()
  const remote = createProjectRemote({ service, ctx })

  assert.deepEqual(await remote.unregister('p1'), { removed: true })
  service.remove = async () => undefined
  assert.deepEqual(await remote.unregister('p1'), { removed: false })
})
