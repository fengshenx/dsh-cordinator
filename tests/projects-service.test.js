import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createProjectStore } from '../src/host/projects/store.js'
import {
  createCoordinatorSessionWithCtx,
  createProjectService,
  isSessionAttachedToWorkspace,
} from '../src/host/projects/service.js'
import { cleanupTempDirs, makeTempDir } from './helpers/temp-dir.js'

after(cleanupTempDirs)

/**
 * 造一套临时 home 与项目目录。
 * @returns {Promise<{ home: string, workspace: string }>} 路径
 */
async function makeWorkspace() {
  const home = await makeTempDir('dsh-coordinator-projects-')
  const workspace = await makeTempDir('dsh-coordinator-work-')
  return { home, workspace }
}

/**
 * 建项目服务。
 *
 * 这个文件的用例都不关心「谁是 worker」，一律按「谁都不是」处理；会话树的分组
 * 判据由 `project-session-index.test.js` 专门覆盖。
 *
 * @param {object} options - 传给 `createProjectService` 的选项
 * @returns {object} 项目服务
 */
function makeService(options) {
  return createProjectService({ isWorkerSession: () => false, ...options })
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const service = makeService({
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
  const first = makeService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  await first.create({ directory: workspace, name: 'alpha' })

  const second = makeService({
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
  const service = makeService({
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
  const service = makeService({
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

/**
 * 造一个假的宿主工作区注册表。
 *
 * @param {object} [options] - 选项
 * @param {object[]} [options.workspaces] - 已有工作区
 * @param {string} [options.createFails] - 注册目录时的报错信息
 * @returns {object} 注册表与调用记录
 */
function createWorkspaceRegistry({ workspaces = [], createFails } = {}) {
  const created = []
  const attached = []
  const registry = {
    list: () => workspaces,
    delete: async (id) => {
      const index = workspaces.findIndex((item) => item.id === id)
      if (index === -1) return false
      workspaces.splice(index, 1)
      return true
    },
    create: async (path, title) => {
      if (createFails !== undefined) throw new Error(createFails)
      const workspace = {
        id: `ws-${created.length + 1}`,
        path,
        title,
        sessionIds: [],
        setTitle: async (next) => {
          workspace.title = next
        },
        attachSession: async (sessionId) => {
          attached.push({ workspaceId: workspace.id, sessionId })
          workspace.sessionIds.push(sessionId)
        },
      }
      workspaces.push(workspace)
      created.push({ path, title })
      return workspace
    },
  }
  registry.created = created
  registry.attached = attached
  return registry
}

test('attachCoordinator 把协调者会话挂到项目目录的工作区', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  const result = await service.attachCoordinator(project.id)
  assert.equal(result.attached, true)
  assert.equal(result.workspaceId, 'ws-1')
  assert.equal(registry.created.length, 1)
  assert.equal(registry.created[0].title, join(workspace).split(/[\\/]/).pop())
  assert.deepEqual(registry.attached, [{ workspaceId: 'ws-1', sessionId: 'session-1' }])
})

test('attachCoordinator 复用已存在的工作区，不重复注册，也不把它算成项目的工作区', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const existing = {
    id: 'ws-existing',
    path: await realpath(workspace),
    title: '已有',
    sessionIds: [],
    attachSession: async () => {},
  }
  const registry = createWorkspaceRegistry({ workspaces: [existing] })
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  const result = await service.attachCoordinator(project.id)
  assert.equal(result.attached, true)
  // 返回的是「项目自己的」工作区：复用来的工作区不在项目记录里。
  assert.equal(result.workspaceId, undefined)
  assert.equal(registry.created.length, 0)
})

test('attachCoordinator 对已挂载的会话是幂等的', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  await service.attachCoordinator(project.id)
  await service.attachCoordinator(project.id)
  assert.equal(registry.attached.length, 1)
})

test('attachCoordinator 在宿主没有工作区服务时不报错', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = makeService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  const result = await service.attachCoordinator(project.id)
  assert.equal(result.attached, false)
  assert.match(result.reason, /工作区/)
})

test('attachCoordinator 挂载失败时返回原因而不抛出', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  registry.create = async () => ({
    id: 'ws-1',
    path: workspace,
    title: 'alpha',
    sessionIds: [],
    attachSession: async () => {
      throw new Error('会话目录与工作区不一致')
    },
  })
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  const result = await service.attachCoordinator(project.id)
  assert.equal(result.attached, false)
  assert.match(result.reason, /会话目录与工作区不一致/)
})

test('项目列表标注协调者会话是否已挂到工作区', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  assert.equal((await service.list())[0].coordinatorAttached, false)
  await service.attachCoordinator(project.id)
  assert.equal((await service.list())[0].coordinatorAttached, true)
  assert.equal((await service.get(project.id)).coordinatorAttached, true)
})

test('isSessionAttachedToWorkspace 判定会话归属', async () => {
  const registry = createWorkspaceRegistry({
    workspaces: [{ id: 'ws-1', path: '/tmp/demo', title: 'demo', sessionIds: ['session-a'] }],
  })
  const ctx = { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) }
  assert.equal(isSessionAttachedToWorkspace(ctx, 'session-a'), true)
  assert.equal(isSessionAttachedToWorkspace(ctx, 'session-b'), false)
  assert.equal(isSessionAttachedToWorkspace(createContext(), 'session-a'), false)
})

test('建协调者会话时传 workspaceId 而不是 cwd', async () => {
  const registry = createWorkspaceRegistry()
  const calls = []
  const ctx = {
    get: (key) => {
      if (key === 'workspaceRegistry') return registry
      if (key === 'sessionController') {
        return {
          create: async (options) => {
            calls.push(options)
            return { sessionId: 'session-1' }
          },
        }
      }
      return undefined
    },
  }
  const sessionId = await createCoordinatorSessionWithCtx(ctx, '/tmp/demo')
  assert.equal(sessionId, 'session-1')
  assert.deepEqual(calls, [{ workspaceId: 'ws-1' }])
})

test('宿主没有工作区服务时建协调者会话退回 cwd', async () => {
  const calls = []
  const ctx = {
    get: (key) => {
      if (key === 'sessionController') {
        return {
          create: async (options) => {
            calls.push(options)
            return { sessionId: 'session-1' }
          },
        }
      }
      return undefined
    },
  }
  await createCoordinatorSessionWithCtx(ctx, '/tmp/demo')
  assert.deepEqual(calls, [{ cwd: '/tmp/demo' }])
})

test('插件注册的工作区记进项目记录', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  await service.attachCoordinator(project.id)
  assert.equal((await service.get(project.id)).workspaceId, 'ws-1')
})

test('复用用户自己加的工作区不记进项目记录', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const userWorkspace = {
    id: 'ws-user',
    path: await realpath(workspace),
    title: '我自己的工作区',
    sessionIds: [],
    attachSession: async () => {},
  }
  const registry = createWorkspaceRegistry({ workspaces: [userWorkspace] })
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  await service.attachCoordinator(project.id)
  assert.equal((await service.get(project.id)).workspaceId, undefined)
  assert.equal(userWorkspace.title, '我自己的工作区')
})

test('项目列表带出对应的工作区 id', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  // 建项目时注册的工作区当场就记进记录，归属不会丢。
  assert.equal((await service.list())[0].workspaceId, 'ws-1')
})

test('从宿主移除项目工作区会清掉记录', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const registry = createWorkspaceRegistry()
  const service = makeService({
    store,
    ctx: { get: (key) => (key === 'workspaceRegistry' ? registry : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  await service.attachCoordinator(project.id)
  const removed = await service.removeWorkspace(project.id)
  assert.equal(removed.removed, true)
  assert.equal(registry.list().length, 0)
  assert.equal((await service.get(project.id)).workspaceId, undefined)
  // 再移除一次：工作区已经不在了，如实说明而不是报错。
  const again = await service.removeWorkspace(project.id)
  assert.equal(again.removed, false)
  assert.match(again.reason, /没有由插件注册的工作区/)
})

test('建项目不发起任何模型调用', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = makeService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })

  const project = await service.create({ directory: workspace, name: 'alpha' })
  assert.equal(project.coordinatorSessionId, 'session-1')
  assert.equal((await store.list()).length, 1)
})

test('解析会话所属项目：协调者会话按注册表指针，worker 按 cwd 相同', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const sessions = {
    get: (id) => ({
      'session-worker': { header: { cwd: workspace } },
      'session-elsewhere': { header: { cwd: '/somewhere/else' } },
    })[id],
  }
  const service = makeService({
    store,
    ctx: { get: (name) => (name === 'sessions' ? sessions : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  const project = await service.create({ directory: workspace, name: 'alpha' })

  // 协调者会话：注册表里的指针
  const coordinator = await service.resolveProjectOfSession(project.coordinatorSessionId)
  assert.equal(coordinator.id, project.id)
  assert.equal(coordinator.name, 'alpha')
  assert.equal(coordinator.coordinatorAlive, true)
  // worker 会话：cwd 与项目目录相同
  const worker = await service.resolveProjectOfSession('session-worker')
  assert.equal(worker.id, project.id)
  // 目录不同的会话不归属任何项目
  assert.equal(await service.resolveProjectOfSession('session-elsewhere'), undefined)
  assert.equal(await service.resolveProjectOfSession('session-unknown'), undefined)
})

test('解析会话所属项目：协调者会话已失效时如实报告', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = makeService({
    store,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => false,
  })
  const project = await service.create({ directory: workspace, name: 'alpha' })
  const resolved = await service.resolveProjectOfSession(project.coordinatorSessionId)
  assert.equal(resolved.id, project.id)
  assert.equal(resolved.coordinatorAlive, false)
})

test('解析会话所属项目：符号链接写法与项目目录相同也算同一个项目', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const link = join(home, 'link-to-workspace')
  await symlink(workspace, link)
  const sessions = { get: () => ({ header: { cwd: link } }) }
  const service = makeService({
    store,
    ctx: { get: (name) => (name === 'sessions' ? sessions : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  const project = await service.create({ directory: workspace, name: 'alpha' })
  const resolved = await service.resolveProjectOfSession('session-linked')
  assert.equal(resolved.id, project.id)
})

test('删项目后原会话不再归属任何项目', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const sessions = { get: () => ({ header: { cwd: workspace } }) }
  const service = makeService({
    store,
    ctx: { get: (name) => (name === 'sessions' ? sessions : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  const project = await service.create({ directory: workspace, name: 'alpha' })
  await service.remove(project.id)
  assert.equal(await service.resolveProjectOfSession(project.coordinatorSessionId), undefined)
  assert.equal(await service.resolveProjectOfSession('session-worker'), undefined)
})

test('索引重建完成前判定归属：等重建，不静悄悄地丢归属', async () => {
  const { home, workspace } = await makeWorkspace()
  const base = createProjectStore({ home })
  // 先落一条项目记录，再建服务：模拟「进程重启，索引还没重建完」
  await base.insert({
    id: 'p-restart',
    name: '重启前建的项目',
    directory: workspace,
    coordinatorSessionId: 'session-restart',
    createdAt: 1,
    updatedAt: 1,
  })
  // 把 list 卡住：重建在飞，归属判定必须等它
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const store = {
    list: async () => { await gate; return base.list() },
    get: (id) => base.get(id),
    insert: (draft) => base.insert(draft),
    update: (id, patch) => base.update(id, patch),
    remove: (id) => base.remove(id),
    getByCoordinator: (sessionId) => base.getByCoordinator(sessionId),
  }
  const sessions = { get: () => ({ header: { cwd: workspace } }) }
  const service = makeService({
    store,
    ctx: { get: (name) => (name === 'sessions' ? sessions : undefined) },
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  // 重建在飞（不 await），同时问归属
  const rebuilding = service.loadIndex()
  const pending = service.resolveProjectOfSession('session-restart')
  release()
  await rebuilding
  const resolved = await pending
  assert.equal(resolved.id, 'p-restart')
})

test('isCoordinatorSession 同步认出建项目时定下的协调者', async () => {
  const { home, workspace } = await makeWorkspace()
  const service = makeService({
    store: createProjectStore({ home }),
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  await service.loadIndex()
  const project = await service.create({ directory: workspace, name: 'alpha' })
  assert.equal(service.isCoordinatorSession(project.coordinatorSessionId), true)
  assert.equal(service.isCoordinatorSession('session-other'), false)
  assert.equal(service.isCoordinatorSession(''), false)
  assert.equal(service.isCoordinatorSession(undefined), false)
})

test('isCoordinatorSession 在索引未重建时保守放行', async () => {
  const { home, workspace } = await makeWorkspace()
  const base = createProjectStore({ home })
  await base.insert({
    id: 'p-restart',
    name: '重启前建的项目',
    directory: workspace,
    coordinatorSessionId: 'session-restart',
    createdAt: 1,
    updatedAt: 1,
  })
  const service = makeService({
    store: base,
    ctx: createContext(),
    createCoordinatorSession: createSessionFactory(),
    sessionExists: async () => true,
  })
  // 还没 loadIndex：注册表里的协调者问不出来，不能判成「不是协调者」
  assert.equal(service.isCoordinatorSession('session-restart'), true)
  assert.equal(service.isCoordinatorSession('session-anyone'), true)
  await service.loadIndex()
  assert.equal(service.isCoordinatorSession('session-restart'), true)
  assert.equal(service.isCoordinatorSession('session-anyone'), false)
})
