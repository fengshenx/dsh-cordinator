/**
 * `npm run dev` —— 起一个挂本工作树插件版本的 dsh 开发实例。
 *
 * 为什么不是 `dsh plugin --profile web add <本目录> && dsh web`：那会改写用户在
 * `~/.dsh` 里的日常 profile，几个工作树并行开发时互相覆盖（后装的赢），并且开发
 * 实例与日常实例共用会话、项目与卡片数据——协调者插件在这些数据上写，混用会互相
 * 干扰。
 *
 * 这里的做法：
 * - 数据根（`DSH_HOME`）默认落在工作树内的 `.dev/home`，删掉即重置，工作树删掉
 *   时一起消失；
 * - profile 从源 HOME 的 `profiles/web` 派生：`package.json` 照抄依赖与 bundle
 *   列表（复现日常组合），只把 `dsh-coordinator` 换成工作树链接；
 * - `node_modules` 不复制，逐条符号链接到源 profile 的同名条目——依赖仍由源里那
 *   一份承担，源里升级 dsh 或增删插件时开发实例自动跟随；
 * - 端口默认交给系统分配（`--port 0`），设 `DEV_PORT` 可固定。
 *
 * 环境变量：
 * - `DSH_HOME`        自定义开发实例的数据根（默认 `<工作树>/.dev/home`）
 * - `DSH_HOME_SOURCE` 源 HOME，默认 `~/.dsh`
 * - `DEV_PORT`        监听端口，默认 `0`（系统分配）
 * - `DEV_NO_OPEN=1`   不自动打开浏览器
 * - `DEV_DSH`         dsh 可执行文件名，默认 `dsh`
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  COPIED_PROFILE_FILES, deriveProfilePackage, planNodeModules, resolveDevPaths,
} from './dev-plan.mjs'

const worktree = join(dirname(fileURLToPath(import.meta.url)), '..')
const paths = resolveDevPaths({ worktree, homeDir: homedir(), env: process.env })

/**
 * 跑一条命令，失败即终止。
 *
 * @param {string} command - 可执行文件
 * @param {string[]} args - 参数
 * @param {object} options - 传给 `spawnSync` 的选项
 * @returns {void} 无返回
 */
function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) {
    throw new Error(`执行失败: ${command} ${args.join(' ')} —— ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`退出码 ${result.status}: ${command} ${args.join(' ')}`)
  }
}

const sourcePackagePath = join(paths.sourceProfileDir, 'package.json')
if (!existsSync(sourcePackagePath)) {
  console.error(`找不到源 profile: ${sourcePackagePath}`)
  console.error('先在源 HOME 里装一次本插件，让日常 profile 具备完整依赖：')
  console.error('  dsh plugin --profile web add <本仓库路径>')
  console.error('或用 DSH_HOME_SOURCE 指向另一个已备好的 HOME。')
  process.exit(1)
}

mkdirSync(paths.profileDir, { recursive: true })

// 源 profile 的 cordis 配置照抄一次：之后开发实例里的改动不再被覆盖（那里是调试
// 界面开关、主题这类会随时改的东西）。
for (const name of COPIED_PROFILE_FILES) {
  const target = join(paths.profileDir, name)
  if (!existsSync(target)) copyFileSync(join(paths.sourceProfileDir, name), target)
}

const sourcePackage = JSON.parse(readFileSync(sourcePackagePath, 'utf8'))
writeFileSync(
  join(paths.profileDir, 'package.json'),
  `${JSON.stringify(deriveProfilePackage(sourcePackage, worktree), null, 2)}\n`,
)

const nodeModulesDir = join(paths.profileDir, 'node_modules')
const sourceNodeModules = paths.sourceNodeModules
if (!existsSync(sourceNodeModules)) {
  console.error(`源 profile 没有 node_modules: ${sourceNodeModules}（先在源 HOME 里跑一次 dsh）`)
  process.exit(1)
}
mkdirSync(nodeModulesDir, { recursive: true })

const plan = planNodeModules({
  sourceEntries: readdirSync(sourceNodeModules),
  existingEntries: readdirSync(nodeModulesDir),
  sourceNodeModules,
  worktree,
})
for (const name of plan.removals) rmSync(join(nodeModulesDir, name), { recursive: true, force: true })
for (const { name, target } of plan.links) {
  const linkPath = join(nodeModulesDir, name)
  const current = lstatSync(linkPath, { throwIfNoEntry: false })
  if (current?.isSymbolicLink() && readlinkSync(linkPath) === target) continue
  rmSync(linkPath, { recursive: true, force: true })
  symlinkSync(target, linkPath, 'junction')
}

console.log('')
console.log('== dsh-coordinator 开发实例 ==')
console.log(`  工作树    ${worktree}`)
console.log(`  数据根    ${paths.home}  （会话、项目、卡片都在这里；删掉即重置）`)
console.log(`  插件链接  ${join(nodeModulesDir, 'dsh-coordinator')} -> ${worktree}`)
console.log('')

run('npm', ['run', 'build:client'], { cwd: worktree })

const port = process.env.DEV_PORT ?? '0'
const args = ['web', '--port', port]
if (process.env.DEV_NO_OPEN === '1') args.push('--no-open')
run(process.env.DEV_DSH ?? 'dsh', args, { cwd: worktree, env: { ...process.env, DSH_HOME: paths.home } })
