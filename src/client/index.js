/**
 * 客户端半边：左栏「项目」区块与右栏「看板」Tab。
 *
 * 宿主侧（`src/host/`）提供项目注册表、卡片存储与卡片工具；浏览器侧只负责呈现
 * 与操作。看板数据来自会话事件流里 `tool/result` 事件的 `meta`——卡片工具用
 * `output.presentationMeta` 投影的结构化卡片，与 session log 一起持久化。
 *
 * 项目数据走 dsh 官方的 Typert 远程通道（命名空间 `projects`，经 `/api` 共享
 * 通道），浏览器侧没有文件系统，项目的真源在宿主侧。
 *
 * 客户端插件在浏览器进程运行，`ctx.sidebarRightTabs` 与 `ctx.slots` 都是
 * client 服务，宿主侧插件拿不到（见 docs/capability-gaps.md 第 15 条）。
 *
 * @module dsh-coordinator/client
 */

import { BoardBody } from './board.js'
import { ProjectPanel } from './project-panel.js'
import { mountCoordinatorView, watchCoordinatorSessions } from './coordinator-view.js'
import { callProjectRemote, mountProjectRemote, reportProjectRemoteError } from './project-remote.js'

export const inject = ['slots', 'sidebarRightTabs', 'sessions']

/**
 * 注册左栏项目区块与看板 tab 类型、面板主体。
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
  //
  // `getSessions` 与 `getUiWorkspace` 都是延迟取值器：ctx 上的服务在 apply 期
  // 未必就绪，直接取会拿到 undefined。`uiWorkspace` 由 web-app bundle 提供，
  // 第三方 bundle 不能把它写进 inject（缺服务会让整个插件挂起）。
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: 'dsh-coordinator',
    inject: () => ({
      getSessions: () => ctx.sessions,
      getUiWorkspace: () => ctx.get('uiWorkspace'),
    }),
  }, BoardBody)), 'dsh-coordinator 看板面板')

  // 项目区块挂左栏底部（`sidebar.footer.action`）：左栏正文区只有
  // `sidebar.workspaces` 一个槽（已被宿主的工作区浏览占用），slot 机制没有装饰
  // 或包装能力，第三方插件无法在它旁边插入并列区块。footer 槽的 occupant 可以
  // 渲染任意内容，位置在工作区下方、设置按钮上方。
  //
  // `uiWorkspace` 只挂在 web-app bundle 上，一律惰性获取。
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'dsh-coordinator-projects',
    order: 10,
    label: '项目',
    inject: () => ({
      callRemote: (method, args) => callProjectRemote(ctx, method, args),
      getUiWorkspace: () => ctx.get('uiWorkspace'),
      getSessions: () => ctx.sessions,
    }),
  }, ProjectPanel)), 'dsh-coordinator 左栏项目区块')

  // 协调者视图目标：让协调者会话进入官方 active 形态，输入框停靠底部而会话区
  // 保持空白。`uiConversation` 由 ui-conversation bundle 提供，缺失时这个回调
  // 不执行（`ctx.inject` 单独起一个 fiber，不拖累本插件），协调者会话退化成
  // 官方欢迎页。
  ctx.inject(['uiConversation'], function mountCoordinatorViewFiber(conversationCtx) {
    mountCoordinatorView(conversationCtx)
  })

  // 项目命名空间挂在官方 gateway client 的 `ctx.remote` 上。远程通道由官方
  // bundle 提供，缺失时这个回调不执行（`ctx.inject` 单独起一个 fiber，不拖累本
  // 插件），看板与左栏注册照常工作；面板此时显示「项目通道未就绪」。
  ctx.inject(['remote'], function mountProjectChannel(remoteCtx) {
    void mountProjectRemote(remoteCtx).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      reportProjectRemoteError(message)
      remoteCtx.logger?.warn?.(`dsh-coordinator: 项目通道挂载失败：${message}`)
    })
    // 协调者会话名单走同一条通道：填充不挂在项目面板上，侧栏收起时面板会卸载。
    watchCoordinatorSessions(remoteCtx)
  })
}
