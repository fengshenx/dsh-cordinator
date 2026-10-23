/**
 * 客户端半边：右栏「看板」Tab。
 *
 * 宿主侧（`src/host/`）提供卡片存储与卡片工具；浏览器侧只负责呈现。看板数据
 * 来自会话事件流里 `tool/result` 事件的 `meta`——卡片工具用
 * `output.presentationMeta` 投影的结构化卡片，与 session log 一起持久化。
 *
 * 客户端插件在浏览器进程运行，`ctx.sidebarRightTabs` 与 `ctx.slots` 都是
 * client 服务，宿主侧插件拿不到（见 docs/capability-gaps.md 第 15 条）。
 *
 * @module dsh-coordinator/client
 */

import { BoardBody } from './board.js'

export const inject = ['slots', 'sidebarRightTabs', 'sessions']

/**
 * 注册看板 tab 类型与面板主体。
 * @param {object} ctx - 客户端 Cordis 上下文
 * @returns {void}
 */
export function apply(ctx) {
  // 注册必须放进 effect：注册表把 effect 挂到调用方 fiber 上，在别的插件的
  // apply 里直接注册会让浏览器启动静默卡住。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: 'dsh-coordinator',
    kind: 'dsh-coordinator-board',
    title: () => '看板',
    guide: [{
      id: 'board',
      order: 10,
      title: () => '看板',
      description: () => '协调者的任务交付看板',
    }],
  }), 'dsh-coordinator 看板 tab 类型')

  // 面板主体挂在 tab 类型 id 上：tab 类型 id 既是实现身份，也是它在
  // `sidebar.right.pane.tab` 座里的注册键。
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: 'dsh-coordinator',
    inject: () => ({ getSessions: () => ctx.sessions }),
  }, BoardBody)), 'dsh-coordinator 看板面板')
}
