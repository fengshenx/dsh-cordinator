import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectStore } from '../src/host/projects/store.js'

/**
 * 造一个临时 home 目录。
 * @returns {Promise<string>} 目录路径
 */
async function makeHome() {
  return mkdtemp(join(tmpdir(), 'dsh-coordinator-projects-'))
}

test('项目记录落盘后可读回，字段齐全', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  const draft = store.draft({ name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1' })
  await store.insert(draft)

  const stored = await store.get(draft.id)
  assert.equal(stored.name, 'alpha')
  assert.equal(stored.directory, '/work/alpha')
  assert.equal(stored.coordinatorSessionId, 'session-1')
  assert.equal(typeof stored.createdAt, 'number')
  assert.equal(typeof stored.updatedAt, 'number')
})

test('只接受 name 与 coordinatorSessionId 两个可变字段', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  const draft = store.draft({ name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1' })
  await store.insert(draft)

  const updated = await store.update(draft.id, {
    name: 'beta',
    coordinatorSessionId: 'session-2',
    directory: '/work/other',
    id: 'forged',
  })

  assert.equal(updated.name, 'beta')
  assert.equal(updated.coordinatorSessionId, 'session-2')
  assert.equal(updated.directory, '/work/alpha')
  assert.equal(updated.id, draft.id)
})

test('改不存在的项目会报错', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  await assert.rejects(() => store.update('missing', { name: 'x' }), /项目不存在/)
})

test('注册表损坏时备份原文件并写回空表', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  await store.insert(store.draft({ name: 'alpha', directory: '/work/alpha' }))
  await writeFile(store.file, '{ 这不是 JSON', 'utf8')

  const projects = await store.list()
  assert.deepEqual(projects, [])

  const raw = await readFile(store.file, 'utf8')
  assert.equal(JSON.parse(raw).projects.length, 0)
})

test('注册表结构非法时按损坏处理', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  await store.insert(store.draft({ name: 'alpha', directory: '/work/alpha' }))
  await writeFile(store.file, JSON.stringify({ version: 1 }), 'utf8')
  assert.deepEqual(await store.list(), [])
})

test('按协调者会话反查项目', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  const draft = store.draft({ name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1' })
  await store.insert(draft)

  const found = await store.getByCoordinator('session-1')
  assert.equal(found.id, draft.id)
  assert.equal(await store.getByCoordinator('session-other'), undefined)
})

test('删项目后反查不到', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  const draft = store.draft({ name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1' })
  await store.insert(draft)

  const removed = await store.remove(draft.id)
  assert.equal(removed.id, draft.id)
  assert.equal(await store.getByCoordinator('session-1'), undefined)
  assert.equal(await store.remove(draft.id), undefined)
})

test('并发写不丢项目', async () => {
  const home = await makeHome()
  const store = createProjectStore({ home })
  await Promise.all(
    Array.from({ length: 8 }, (_value, index) =>
      store.insert(store.draft({ name: `p${index}`, directory: `/work/p${index}` }))),
  )
  assert.equal((await store.list()).length, 8)
})
