import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createCanonicalizer, groupSessionsByProject } from '../src/host/projects/session-index.js'
import { createProjectStore } from '../src/host/projects/store.js'
import { createProjectService } from '../src/host/projects/service.js'
import { cleanupTempDirs, makeTempDir } from './helpers/temp-dir.js'

after(cleanupTempDirs)

/**
 * 造一套临时 home 与项目目录。
 * @returns {Promise<{ home: string, workspace: string }>} 路径
 */
async function makeWorkspace() {
  const home = await makeTempDir('dsh-coordinator-index-')
  const workspace = await makeTempDir('dsh-coordinator-dir-')
  return { home, workspace }
}

/**
 * 造一个按映射返回归一路径的假归一器。
 * @param {Record<string, string>} mapping - 原始路径到归一路径
 * @returns {(path: string) => Promise<string>} 归一器
 */
function createFakeCanonicalizer(mapping) {
  return async (path) => mapping[path] ?? path
}

test('worker 会话 cwd 等于项目目录时归属该项目', async () => {
  const grouped = await groupSessionsByProject({
    projects: [{ id: 'p1', directory: '/repo' }],
    sessions: [{ id: 's1', cwd: '/repo', origin: 'subagent' }],
    canonicalize: createFakeCanonicalizer({}),
  })
  assert.deepEqual(grouped.get('p1'), ['s1'])
})

test('非 worker 会话不归属项目', async () => {
  // 协调者会话的入口在项目行上，用户在项目目录里手动开的会话也不属于项目编排。
  const grouped = await groupSessionsByProject({
    projects: [{ id: 'p1', directory: '/repo' }],
    sessions: [
      { id: 'coordinator', cwd: '/repo' },
      { id: 'manual', cwd: '/repo' },
    ],
    canonicalize: createFakeCanonicalizer({}),
  })
  assert.equal(grouped.has('p1'), false)
})

test('同一物理目录的两种写法归到同一个项目', async () => {
  // macOS 的 /tmp 是 /private/tmp 的符号链接，两种写法指向同一目录
  const grouped = await groupSessionsByProject({
    projects: [{ id: 'p1', directory: '/tmp/demo' }],
    sessions: [
      { id: 'worker-a', cwd: '/tmp/demo', origin: 'subagent' },
      { id: 'worker-b', cwd: '/private/tmp/demo', origin: 'subagent' },
    ],
    canonicalize: createFakeCanonicalizer({
      '/tmp/demo': '/private/tmp/demo',
      '/private/tmp/demo': '/private/tmp/demo',
    }),
  })
  assert.deepEqual(grouped.get('p1'), ['worker-a', 'worker-b'])
})

test('子目录里的会话不归属项目', async () => {
  const grouped = await groupSessionsByProject({
    projects: [{ id: 'p1', directory: '/repo' }],
    sessions: [{ id: 's1', cwd: '/repo/sub', origin: 'subagent' }],
    canonicalize: createFakeCanonicalizer({}),
  })
  assert.equal(grouped.has('p1'), false)
})

test('没有 cwd 的会话不归属任何项目', async () => {
  const grouped = await groupSessionsByProject({
    projects: [{ id: 'p1', directory: '/repo' }],
    sessions: [{ id: 's1', origin: 'subagent' }],
    canonicalize: createFakeCanonicalizer({}),
  })
  assert.equal(grouped.has('p1'), false)
})

test('两个项目指向同一目录时先注册的那个持有会话', async () => {
  const grouped = await groupSessionsByProject({
    projects: [
      { id: 'p1', directory: '/repo' },
      { id: 'p2', directory: '/repo' },
    ],
    sessions: [{ id: 's1', cwd: '/repo', origin: 'subagent' }],
    canonicalize: createFakeCanonicalizer({}),
  })
  assert.deepEqual(grouped.get('p1'), ['s1'])
  assert.equal(grouped.has('p2'), false)
})

test('归一器对同一路径只解析一次', async () => {
  let calls = 0
  const canonicalize = createCanonicalizer(async (path) => {
    calls += 1
    return path
  })
  await canonicalize('/repo')
  await canonicalize('/repo')
  assert.equal(calls, 1)
})

test('归一器在路径解析失败时回落原路径', async () => {
  const canonicalize = createCanonicalizer(async () => {
    throw new Error('路径不存在')
  })
  assert.equal(await canonicalize('/gone'), '/gone')
})

test('服务按项目聚合会话', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const query = {
    listSessions: async () => [
      { header: { id: 'session-coordinator', cwd: workspace } },
      { header: { id: 'session-worker', cwd: workspace, origin: 'subagent' } },
      { header: { id: 'session-elsewhere', cwd: join(workspace, '..'), origin: 'subagent' } },
    ],
  }
  const service = createProjectService({
    store,
    ctx: { get: (key) => (key === 'sessionQuery' ? query : undefined) },
    createCoordinatorSession: async () => 'session-coordinator',
    sessionExists: async () => true,
  })
  const project = await service.create({ directory: workspace, name: 'alpha' })

  const grouped = await service.sessionsByProject()
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].projectId, project.id)
  assert.deepEqual(grouped[0].sessionIds, ['session-worker'])
})

test('服务在没有 sessionQuery 时返回空映射', async () => {
  const { home, workspace } = await makeWorkspace()
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: { get: () => undefined },
    createCoordinatorSession: async () => 'session-coordinator',
    sessionExists: async () => true,
  })
  await service.create({ directory: workspace, name: 'alpha' })
  assert.deepEqual(await service.sessionsByProject(), [])
})

test('真实符号链接目录按 realpath 归一后归属同一项目', async () => {
  const { home, workspace } = await makeWorkspace()
  const link = join(home, 'link-to-workspace')
  await symlink(workspace, link)
  const canonical = await realpath(workspace)

  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: {
      get: (key) => (key === 'sessionQuery'
        ? {
            listSessions: async () => [
              { header: { id: 'via-real', cwd: canonical, origin: 'subagent' } },
              { header: { id: 'via-link', cwd: link, origin: 'subagent' } },
            ],
          }
        : undefined),
    },
    createCoordinatorSession: async () => 'session-coordinator',
    sessionExists: async () => true,
  })
  const project = await service.create({ directory: link, name: 'alpha' })

  const grouped = await service.sessionsByProject()
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].projectId, project.id)
  assert.deepEqual(grouped[0].sessionIds.sort(), ['via-link', 'via-real'])
})

test('项目目录下新建的子目录不改变归属', async () => {
  const { home, workspace } = await makeWorkspace()
  await mkdir(join(workspace, 'nested'), { recursive: true })
  const store = createProjectStore({ home })
  const service = createProjectService({
    store,
    ctx: {
      get: (key) => (key === 'sessionQuery'
        ? { listSessions: async () => [{ header: { id: 's1', cwd: join(workspace, 'nested'), origin: 'subagent' } }] }
        : undefined),
    },
    createCoordinatorSession: async () => 'session-coordinator',
    sessionExists: async () => true,
  })
  await service.create({ directory: workspace, name: 'alpha' })

  assert.deepEqual(await service.sessionsByProject(), [])
})
