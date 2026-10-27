import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { cleanupTempDirs, makeTempDir } from './helpers/temp-dir.js'
import { createWorkerRegistry } from '../src/host/worker-registry.js'

after(cleanupTempDirs)

test('登记后能按子会话 id 取回', async () => {
  const home = await makeTempDir('dsh-coordinator-registry-')
  const registry = createWorkerRegistry({ home })
  await registry.register({ childId: 'child-1', parentSessionId: 'parent-1', label: '工', task: '做事' })
  const record = await registry.get('child-1')
  assert.equal(record.parentSessionId, 'parent-1')
  assert.equal(record.label, '工')
  assert.equal(typeof record.registeredAt, 'number')
})

test('同 id 重复登记是更新不是追加', async () => {
  const home = await makeTempDir('dsh-coordinator-registry-')
  const registry = createWorkerRegistry({ home })
  await registry.register({ childId: 'child-1', parentSessionId: 'parent-1', label: '旧' })
  await registry.register({ childId: 'child-1', parentSessionId: 'parent-1', label: '新' })
  const record = await registry.get('child-1')
  assert.equal(record.label, '新')
  const byParent = await registry.listByParent('parent-1')
  assert.equal(byParent.length, 1)
})

test('按父会话与按项目筛选互不串扰', async () => {
  const home = await makeTempDir('dsh-coordinator-registry-')
  const registry = createWorkerRegistry({ home })
  await registry.register({ childId: 'child-1', parentSessionId: 'parent-1', label: 'A', projectId: 'p1' })
  await registry.register({ childId: 'child-2', parentSessionId: 'parent-2', label: 'B', projectId: 'p1' })
  await registry.register({ childId: 'child-3', parentSessionId: 'parent-1', label: 'C', projectId: 'p2' })
  assert.deepEqual(
    (await registry.listByParent('parent-1')).map((item) => item.childId).sort(),
    ['child-1', 'child-3'],
  )
  assert.deepEqual(
    (await registry.listByProject('p1')).map((item) => item.childId).sort(),
    ['child-1', 'child-2'],
  )
})

test('跨实例读同一份落盘（进程重启后续聊找得到工）', async () => {
  const home = await makeTempDir('dsh-coordinator-registry-')
  await createWorkerRegistry({ home }).register({ childId: 'child-1', parentSessionId: 'parent-1', label: '工' })
  const reloaded = await createWorkerRegistry({ home }).get('child-1')
  assert.equal(reloaded.label, '工')
})

test('登记表损坏时重建空表并保留备份', async () => {
  const home = await makeTempDir('dsh-coordinator-registry-')
  const directory = `${home}/dsh-coordinator`
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/workers.json`, '{oops', 'utf8')
  const warned = []
  const registry = createWorkerRegistry({ home, logger: (message) => warned.push(message) })
  assert.equal(await registry.get('child-1'), undefined)
  assert.ok(warned.length === 1 && warned[0].includes('损坏'))
  // 坏文件被挪走留证；下一次登记写回合法文件
  const { readdir, readFile } = await import('node:fs/promises')
  const files = await readdir(directory)
  assert.ok(files.some((name) => name.startsWith('workers.json.corrupt-')))
  await registry.register({ childId: 'child-2', parentSessionId: 'parent-1', label: '重建' })
  assert.deepEqual(
    JSON.parse(await readFile(`${directory}/workers.json`, 'utf8')).workers.map((item) => item.childId),
    ['child-2'],
  )
})
