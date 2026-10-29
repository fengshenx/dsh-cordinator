/**
 * 从最新 `origin/main` 起一个可独立开发的 worktree。
 *
 * 约定与仓库既有做法一致：目录 `.worktrees/<任务名>`（已 gitignore）、分支
 * `feature/<任务名>`、base 取最新 `origin/main`。建好后在目录里 `npm run dev`
 * 就能起一个挂该工作树插件版本的 dsh 实例（见 `scripts/dev.mjs`）。
 *
 * 依赖不重新安装：`node_modules` 符号链接到主 checkout 那一份。本仓库的运行期
 * 依赖只有 esbuild（构建）与 minidenticons（打进客户端产物），共享一份足够；
 * 代价是改 `package.json` 后在 worktree 里 `npm install` 会写到主 checkout，
 * 依赖变更请在主 checkout 做。
 *
 * 用法：
 *   node scripts/worktree-spawn.mjs <任务名>
 *   node scripts/worktree-spawn.mjs <任务名> --remote upstream
 */

import { existsSync, lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { assertTaskName, branchFor, worktreeDirFor } from './worktree-common.mjs'

/**
 * 跑一条 git 命令，返回结果而不抛错。
 *
 * @param {string[]} args - git 参数
 * @param {string} cwd - 工作目录
 * @returns {{ status: number | null, stdout: string, stderr: string }} 结果
 */
function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 跑一条 git 命令，失败即抛错。
 *
 * @param {string[]} args - git 参数
 * @param {string} cwd - 工作目录
 * @returns {void} 无返回
 */
function gitOrThrow(args, cwd) {
  const result = git(args, cwd)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} 失败: ${result.stderr.trim()}`)
}

const argv = process.argv.slice(2)
if (argv.length < 1) {
  console.error('用法: node scripts/worktree-spawn.mjs <任务名> [--remote <远端名>]')
  console.error('  <任务名>  目录 .worktrees/<任务名>，分支 feature/<任务名>')
  console.error('  --remote  远端名，默认 origin')
  process.exit(1)
}
const task = argv[0]
let remote = 'origin'
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i] === '--remote' && argv[i + 1] !== undefined) {
    remote = argv[i + 1]
    i += 1
  } else {
    console.error(`未知参数: ${argv[i]}`)
    process.exit(1)
  }
}

try {
  assertTaskName(task)
} catch (error) {
  console.error(`错误: ${error.message}`)
  process.exit(1)
}

// 主 checkout 根：在 worktree 里调用时经 git-common-dir 回到主 checkout，之后的
// git 命令都在那里执行。
const commonDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], process.cwd())
if (commonDir.status !== 0) {
  console.error('错误: 当前目录不在 git 仓库里')
  process.exit(1)
}
const root = dirname(commonDir.stdout.trim())
const branch = branchFor(task)
const target = worktreeDirFor(root, task)

if (existsSync(target)) {
  console.error(`错误: 目标目录已存在: ${target}`)
  process.exit(1)
}
if (git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], root).status === 0) {
  console.error(`错误: 本地分支已存在: ${branch}`)
  process.exit(1)
}

let base = `refs/remotes/${remote}/main`
if (git(['rev-parse', '--verify', '--quiet', base], root).status !== 0) {
  if (git(['rev-parse', '--verify', '--quiet', 'refs/heads/main'], root).status !== 0) {
    console.error(`错误: 找不到 base（${remote}/main 与本地 main 均不存在）`)
    process.exit(1)
  }
  base = 'refs/heads/main'
  console.log(`[warn] 无 ${remote}/main 引用，base 使用本地 main`)
} else if (git(['fetch', '--quiet', remote, 'main'], root).status !== 0) {
  console.log(`[warn] fetch ${remote} main 失败，使用本地引用`)
}

const mainNodeModules = join(root, 'node_modules')
if (!existsSync(mainNodeModules)) {
  console.error(`错误: 主 checkout 没有 node_modules（${mainNodeModules}），先在主 checkout 跑 npm install`)
  process.exit(1)
}

mkdirSync(join(root, '.worktrees'), { recursive: true })

let created = false
try {
  gitOrThrow(['worktree', 'add', target, '-b', branch, base], root)
  created = true
  // 依赖共享：本仓依赖少，链接比重新安装便宜，也不会因缺 esbuild 无法构建客户端
  const link = join(target, 'node_modules')
  if (!lstatSync(link, { throwIfNoEntry: false })) symlinkSync(mainNodeModules, link, 'junction')
} catch (error) {
  console.error(`[rollback] ${error.message}`)
  if (created) {
    git(['worktree', 'remove', target, '--force'], root)
    git(['branch', '-D', branch], root)
  }
  process.exit(1)
}

console.log('')
console.log('== 新 worktree 就绪 ==')
console.log(`  目录:  ${target}`)
console.log(`  分支:  ${branch}（base: ${base}）`)
console.log('  依赖:  node_modules 已链接主 checkout（改 package.json 请回主 checkout 安装）')
console.log('')
console.log('下一步:')
console.log(`  cd ${target}`)
console.log('  npm run dev     # 起一个挂本工作树插件版本的 dsh 开发实例')
