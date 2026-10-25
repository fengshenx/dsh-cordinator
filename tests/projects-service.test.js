import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectStore } from '../src/host/projects/store.js'
import { createProjectService } from '../src/host/projects/service.js'

/**
 * 造一套临时 home 与项目目录。
 * @returns {Promise<{ home: string, workspace: string }>} 路径
 */
async function makeWorkspace() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-projects-'))
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-coordinator-work-'))
  return { home, workspace }
}

/**
 * 造一个假的 Cordis 上下文。
 * @returns {object} 上下文
 */
function createContext() {
  return {
    get: () => undefined,
  }
}

/**
 * 造一个记录调用次数的协调者会话工厂。
 * @param {object} [options] - 选项
 * @param {boolean} [options.fail] - 建会话是否失败
 * @returns {{ factory: (directory: string) => Promise<string>, calls: string[], disposed: string[] }} 工厂与记录
 */
function createSessionFactory({ fail = false } = {}) {
  const calls = []
  const disposed = []
  let counter = 0
  const factory = async (directory) => {
    calls.push(directory)
    if (fail) throw new Error('建会话失败')
    counter += 1
    return `session-${counter}`
  }
  factory.calls = calls
  factory.disposed = disposed
  return factory
}

test('建项目会建协调者会话并绑定', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const factory = createSessionFactory()
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: factory,
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  assert.equal(project.name, 'alpha')
  assert.equal(project.directory, workspace)
  assert.equal(project.coordinatorSessionId, 'session-1')
  assert.deepEqual(factory.calls, [workspace])
})

test('项目名缺省取目录末段', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  const project = await service.create({ directory: workspace })
  assert.equal(project.name, join(workspace).split(/[\\/]/).pop())
})

test('建会话失败时不落盘', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory({ fail: true }),
    sessionExists: async () => true,
  })

  await assert.rejects(() => service.create({ directory: workspace }), /建会话失败/)
  assert.deepEqual(await store.list(), [])
})

test('目录不存在时拒绝建项目', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  await assert.rejects(
    () => service.create({ directory: join(workspace, 'missing') }),
    /项目目录不存在或不可访问/,
  )
})

test('目录不是绝对路径时拒绝建项目', async () => {
  const { home } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  await assert.rejects(() => service.create({ directory: 'relative/path' }), /必须是绝对路径/)
})

test('目录指向文件时拒绝建项目', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  const file = join(workspace, 'file.txt')
  await mkdir(workspace, { recursive: true })
  await (await import('node:fs/promises')).writeFile(file, 'x', 'utf8')

  await assert.rejects(() => service.create({ directory: file }), /不是目录/)
})

test('项目名不能为空或过长', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  await assert.rejects(() => service.create({ directory: workspace, name: '  ' }), /项目名不能为空/)
  await assert.rejects(
    () => service.create({ directory: workspace, name: 'x'.repeat(201) }),
    /项目名过长/,
  )
})

test('列表标注协调者会话是否还在', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async (sessionId) => sessionId === 'session-1',
  })

  await service.create({ directory: workspace, name: 'alpha' })
  await service.create({ directory: workspace, name: 'beta' })
  const projects = await service.list()
  assert.equal(projects.length, 2)
  assert.equal(projects[0].coordinatorAlive, true)
  assert.equal(projects[1].coordinatorAlive, false)
})

test('协调者索引在增删改后保持同步', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  assert.equal(service.directoryOfCoordinator('session-1'), workspace)

  await service.replaceCoordinator(project.id)
  assert.equal(service.directoryOfCoordinator('session-1'), undefined)
  assert.equal(service.directoryOfCoordinator('session-2'), workspace)

  await service.remove(project.id)
  assert.equal(service.directoryOfCoordinator('session-2'), undefined)
})

test('重启后从注册表重建协调者索引', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const first = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  await first.create({ directory: workspace, name: 'alpha' })

  const second = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  await second.loadIndex()
  assert.equal(second.directoryOfCoordinator('session-1'), workspace)
})

test('换新协调者会改绑，旧会话不再指向项目', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  const updated = await service.replaceCoordinator(project.id)
  assert.equal(updated.coordinatorSessionId, 'session-2')
  assert.equal(await service.getByCoordinator('session-1'), undefined)
  assert.equal((await service.getByCoordinator('session-2')).id, project.id)
})

test('注销项目保留协调者会话', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  const removed = await service.remove(project.id)
  assert.equal(removed.coordinatorSessionId, 'session-1')
  assert.deepEqual(await service.list(), [])
})
