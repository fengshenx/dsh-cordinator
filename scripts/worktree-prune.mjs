/**
 * 清理已合并的 worktree。
 *
 * 默认只打印结论（dry-run），`--apply` 才真的删。判据见 `classifyWorktree`：
 * 有未提交改动、当前所在的 worktree、分支没进 main 且 PR 未合并——任一命中就拒绝。
 *
 * 删除范围：`git worktree remove --force`（连带清掉 `.dev/` 数据与 node_modules
 * 链接；链接指向主 checkout，删的只是链接本身）；已合并的分支一并删本地引用。
 * 远端分支默认保留，`--delete-remote` 才删。
 *
 * 用法：
 *   node scripts/worktree-prune.mjs                     # 扫描全部，只打印
 *   node scripts/worktree-prune.mjs --apply             # 删可删的
 *   node scripts/worktree-prune.mjs my-task --apply     # 只处理 my-task
 *   node scripts/worktree-prune.mjs --apply --delete-remote
 */

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { classifyWorktree, worktreeDirFor } from './worktree-common.mjs'

/**
 * 跑一条命令，返回结果而不抛错。
 *
 * @param {string} command - 可执行文件
 * @param {string[]} args - 参数
 * @param {string} cwd - 工作目录
 * @returns {{ status: number | null, stdout: string, stderr: string }} 结果
 */
function call(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 查分支的 PR 状态。
 *
 * @param {string} branch - 分支名
 * @param {string} cwd - 在主 checkout 里执行
 * @returns {{ state: string, number: number, url: string } | null | undefined} MERGED/OPEN/CLOSED；
 *   `null` 是没有 PR，`undefined` 是查不到（gh 不可用或未登录）
 */
function pullRequestOf(branch, cwd) {
  const result = call('gh', [
    'pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state,url',
  ], cwd)
  if (result.status !== 0) return undefined
  const parsed = JSON.parse(result.stdout || '[]')
  if (parsed.length === 0) return null
  return { state: parsed[0].state, number: parsed[0].number, url: parsed[0].url }
}

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const deleteRemote = argv.includes('--delete-remote')
const only = argv.find((arg) => !arg.startsWith('--'))

// 主 checkout 根：本脚本可能从某个将被删掉的 worktree 里调用，cwd 会随目录消失失效
const commonDir = call('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], process.cwd())
if (commonDir.status !== 0) {
  console.error('错误: 当前目录不在 git 仓库里')
  process.exit(1)
}
const root = dirname(commonDir.stdout.trim())
const here = call('git', ['rev-parse', '--show-toplevel'], process.cwd()).stdout.trim()
const worktreesRoot = join(root, '.worktrees')

if (!existsSync(worktreesRoot)) {
  console.log('没有 .worktrees 目录，无需清理')
  process.exit(0)
}

const names = only !== undefined
  ? [only]
  : readdirSync(worktreesRoot).filter((name) => !name.startsWith('.')
    && lstatSync(join(worktreesRoot, name), { throwIfNoEntry: false })?.isDirectory() === true)
const rows = []
for (const name of names) {
  const dir = worktreeDirFor(root, name)
  if (!existsSync(dir)) continue
  const head = call('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], root)
  if (head.status !== 0) {
    rows.push({ name, dir, branch: '', verdict: { removable: false, reason: 'worktree 登记失效（git 读不出分支）' } })
    continue
  }
  const branch = head.stdout.trim()
  if (branch === 'main') {
    rows.push({ name, dir, branch, verdict: { removable: false, reason: 'main 分支不删' } })
    continue
  }
  const dirty = call('git', ['-C', dir, 'status', '--porcelain'], root).stdout.trim() !== ''
  const mergedIntoMain = call('git', ['merge-base', '--is-ancestor', branch, 'main'], root).status === 0
  const verdict = classifyWorktree({
    isCurrent: here === dir,
    dirty,
    mergedIntoMain,
    pullRequest: pullRequestOf(branch, root),
  })
  rows.push({ name, dir, branch, verdict })
}

console.log('')
console.log('  任务              分支                             结论')
console.log('  ' + '-'.repeat(84))
for (const row of rows) {
  const mark = row.verdict.removable ? '✓' : '✗'
  console.log(`  ${mark} ${row.name.padEnd(16)} ${(row.branch || '(未知)').padEnd(32)} ${row.verdict.reason}`)
}
console.log('')

const removable = rows.filter((row) => row.verdict.removable)
if (!apply) {
  console.log(removable.length === 0 ? '没有可清理的 worktree' : `${removable.length} 个可清理；加 --apply 执行`)
  process.exit(0)
}
if (removable.length === 0) {
  console.log('没有可清理的 worktree')
  process.exit(0)
}
// 在将要删除的 worktree 里执行时，删到自己那一步 cwd 就失效了，所以从主 checkout 跑
process.chdir(root)
for (const row of removable) {
  const removed = call('git', ['worktree', 'remove', row.dir, '--force'], root)
  if (removed.status !== 0) {
    console.error(`[失败] ${row.name}: ${removed.stderr.trim()}`)
    continue
  }
  // worktree remove 偶尔留下空壳目录（`--force` 之外的残留）
  if (existsSync(row.dir)) rmSync(row.dir, { recursive: true, force: true })
  if (row.branch !== '') {
    call('git', ['branch', '-D', row.branch], root)
    if (deleteRemote) call('git', ['push', 'origin', '--delete', row.branch], root)
  }
  console.log(`[已删] ${row.name}（${row.branch}${deleteRemote ? '，含远端' : ''}）`)
}
