/**
 * `npm run dev` 的路径与派生计算。
 *
 * 开发实例要满足三件事：插件指向**当前工作树**（而不是主 checkout 或上一次
 * `dsh plugin add` 留下的路径）、数据（会话、项目、卡片）落在工作树内、以及
 * 不触碰用户在 `~/.dsh` 里的日常 profile。
 *
 * 做法是不复制依赖：目标 profile 的 `node_modules` 逐条符号链接到源 profile 的
 * 同名条目，只有 `dsh-coordinator` 指向工作树。dsh 启动时读的是包解析结果，
 * 不校验 `package.json` 的 `link:` 路径与磁盘链接是否一致，所以这样一个
 * profile 能被正常加载（`npm run dev` 的隔离实例就是这么跑起来的）。
 *
 * 这里的函数只算「该建什么」，文件系统操作在 `dev.mjs`。
 *
 * @module dsh-coordinator/scripts/dev-plan
 */

import { join } from 'node:path'

/** 插件包名：profile 里换成工作树链接的那个。 */
export const COORDINATOR_PACKAGE = 'dsh-coordinator'

/** 开发实例用的 profile 名。插件的客户端 manifest 声明 `platform: web`。 */
export const PROFILE_NAME = 'web'

/** 从源 profile 复制过来的配置：用户在源里改过就跟着走。 */
export const COPIED_PROFILE_FILES = ['cordis.yml', 'cordis.patch.yml']

/**
 * 算出开发实例的各个目录。
 *
 * @param {object} options - 选项
 * @param {string} options.worktree - 当前工作树的绝对路径
 * @param {string} options.homeDir - 用户主目录，源 `~/.dsh` 的父目录
 * @param {object} [options.env] - 环境变量，支持 `DSH_HOME` 与 `DSH_HOME_SOURCE`
 * @returns {object} 目录与文件路径
 */
export function resolveDevPaths({ worktree, homeDir, env = {} }) {
  const sourceHome = env.DSH_HOME_SOURCE ?? join(homeDir, '.dsh')
  const home = env.DSH_HOME ?? join(worktree, '.dev', 'home')
  const sourceProfileDir = join(sourceHome, 'profiles', PROFILE_NAME)
  return {
    sourceHome,
    sourceProfileDir,
    sourceNodeModules: join(sourceProfileDir, 'node_modules'),
    home,
    profileDir: join(home, 'profiles', PROFILE_NAME),
  }
}

/**
 * 从源 profile 的 `package.json` 派生开发实例的版本。
 *
 * 依赖与 bundle 列表都照源抄——开发实例要复现日常环境的组合，否则「本地跑得
 * 起来、装进 profile 就坏」这类问题测不出来。只有两处不同：`dsh-coordinator`
 * 的依赖换成工作树链接，bundle 列表保证含它（源里没装过本插件时也能起）。
 *
 * @param {object} sourcePackage - 源 profile 的 `package.json` 解析结果
 * @param {string} worktree - 当前工作树的绝对路径
 * @returns {object} 派生后的 `package.json` 对象
 */
export function deriveProfilePackage(sourcePackage, worktree) {
  const bundles = [...(sourcePackage?.dsh?.profile?.bundles ?? [])]
  if (!bundles.includes(COORDINATOR_PACKAGE)) bundles.push(COORDINATOR_PACKAGE)
  return {
    ...sourcePackage,
    dependencies: {
      ...(sourcePackage?.dependencies ?? {}),
      [COORDINATOR_PACKAGE]: `link:${worktree}`,
    },
    dsh: {
      ...(sourcePackage?.dsh ?? {}),
      profile: {
        ...(sourcePackage?.dsh?.profile ?? {}),
        bundles,
      },
    },
  }
}

/**
 * 算出 `node_modules` 该怎么摆。
 *
 * 源 profile 的每个条目都链过去（依赖由它在源里那一份承担，升级时开发实例自动
 * 跟随），只有插件本体指工作树。目标里多出来的条目要删掉——源里已经移除的插件
 * 留在开发实例里会让「卸掉它之后还能不能起」测不出来。
 *
 * @param {object} options - 选项
 * @param {string[]} options.sourceEntries - 源 `node_modules` 的条目名
 * @param {string[]} options.existingEntries - 目标 `node_modules` 已有的条目名
 * @param {string} options.sourceNodeModules - 源 `node_modules` 的绝对路径
 * @param {string} options.worktree - 当前工作树的绝对路径
 * @returns {{ links: { name: string, target: string }[], removals: string[] }} 链接与清理计划
 */
export function planNodeModules({ sourceEntries, existingEntries, sourceNodeModules, worktree }) {
  const links = sourceEntries
    .filter((name) => name !== COORDINATOR_PACKAGE)
    .map((name) => ({ name, target: join(sourceNodeModules, name) }))
  links.push({ name: COORDINATOR_PACKAGE, target: worktree })
  const removals = existingEntries
    .filter((name) => !sourceEntries.includes(name) && name !== COORDINATOR_PACKAGE)
  return { links, removals }
}
