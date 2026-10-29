/**
 * worktree 命名与目录约定。
 *
 * 与 `npm run dev` 无关的部分不放在这里：这些函数只回答「任务名合法吗、目录在
 * 哪、分支叫什么」，供 `worktree-spawn.mjs` 与测试共用。
 *
 * @module dsh-coordinator/scripts/worktree-common
 */

import { join } from 'node:path'

/** 任务名允许的字符：字母数字开头，之后可带点、下划线、连字符。 */
const TASK_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * 校验任务名。
 *
 * 任务名会拼进目录路径与 git 分支名，所以拦掉路径穿越（`..`）、分隔符与空白——
 * 这类名字建出来不是落在 `.worktrees/` 里，就是让 `git worktree add` 报一个
 * 看不懂的错。
 *
 * @param {string} name - 任务名
 * @returns {void} 合法时无返回
 */
export function assertTaskName(name) {
  if (typeof name !== 'string' || name === '') {
    throw new Error('任务名不能为空')
  }
  if (!TASK_NAME.test(name)) {
    throw new Error(`任务名不合法: ${name}（只允许字母数字开头的字母数字、点、下划线、连字符）`)
  }
}

/**
 * 任务对应的分支名。
 *
 * @param {string} name - 任务名
 * @returns {string} 分支名
 */
export function branchFor(name) {
  return `feature/${name}`
}

/**
 * 任务对应的 worktree 目录。
 *
 * @param {string} root - 主 checkout 的绝对路径
 * @param {string} name - 任务名
 * @returns {string} worktree 的绝对路径
 */
export function worktreeDirFor(root, name) {
  return join(root, '.worktrees', name)
}
