import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { mergeConventions } from '../src/host/tools/init-project.js'
import { createInitProjectTool } from '../src/host/tools/init-project.js'

const CONVENTIONS = '# 约定\n正文\n'

test('空文件时写入完整受管区块', () => {
  const merged = mergeConventions('', CONVENTIONS)
  assert.match(merged, /<!-- dsh-coordinator:conventions:start -->/)
  assert.match(merged, /<!-- dsh-coordinator:conventions:end -->/)
  assert.match(merged, /# 约定/)
})

test('已有内容时保留用户内容', () => {
  const merged = mergeConventions('# 用户自己的约定\n', CONVENTIONS)
  assert.match(merged, /# 用户自己的约定/)
  assert.match(merged, /# 约定/)
})

test('重复合并是幂等的', () => {
  const once = mergeConventions('# 原有\n', CONVENTIONS)
  const twice = mergeConventions(once, CONVENTIONS)
  assert.equal(twice, once)
})

test('约定更新时只替换受管区块', () => {
  const once = mergeConventions('# 原有\n', CONVENTIONS)
  const updated = mergeConventions(once, '# 新约定\n')
  assert.match(updated, /# 原有/)
  assert.match(updated, /# 新约定/)
  assert.doesNotMatch(updated, /正文/)
})

test('init_project 工具写入目标目录的 AGENTS.md', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-coordinator-'))
  try {
    const tool = createInitProjectTool({ conventionsPath: '/nonexistent/conventions.md' })
    // 约定文件缺失时应报错，而不是静默写入空内容
    await assert.rejects(() => tool.execute({ path: directory }, {}), /ENOENT|no such file/i)

    const conventionsPath = join(directory, 'conventions.md')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(conventionsPath, CONVENTIONS, 'utf8')
    const real = createInitProjectTool({ conventionsPath })
    const result = await real.execute({ path: directory }, {})
    assert.equal(result.updated, true)
    assert.equal(result.path, join(directory, 'AGENTS.md'))
    const written = await readFile(result.path, 'utf8')
    assert.match(written, /<!-- dsh-coordinator:conventions:start -->/)

    const second = await real.execute({ path: directory }, {})
    assert.equal(second.updated, true)
    const rewritten = await readFile(result.path, 'utf8')
    assert.equal(rewritten, written)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('init_project 拒绝不存在的目录', async () => {
  const tool = createInitProjectTool({ conventionsPath: '/nonexistent/conventions.md' })
  await assert.rejects(() => tool.execute({ path: '/nonexistent/dir' }, {}), /目标目录不存在/)
})

test('dryRun 类型不符时报错，不静默当成要写入', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-coordinator-init-'))
  try {
    const conventionsPath = join(directory, 'conventions.md')
    await writeFile(conventionsPath, CONVENTIONS, 'utf8')
    const tool = createInitProjectTool({ conventionsPath })
    await assert.rejects(
      () => tool.execute({ path: directory, dryRun: 'true' }, {}),
      /dryRun 必须是布尔值/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
