/**
 * 项目数据的通道契约。
 *
 * 宿主侧与浏览器侧共用：通道路径、端点名、载荷形状。放在 `shared/` 是因为两端
 * 各跑各的进程，浏览器半边不能 import 宿主模块里的实现。
 *
 * @module dsh-coordinator/shared/projects
 */

/** 项目数据的自有 HTTP 通道路径前缀。 */
export const PROJECT_RPC_PATH = '/coordinator'

/** 通道上的端点名。 */
export const PROJECT_ENDPOINTS = Object.freeze({
  list: 'projects/list',
  create: 'projects/create',
  remove: 'projects/remove',
  rename: 'projects/rename',
  replaceCoordinator: 'projects/replace-coordinator',
})
