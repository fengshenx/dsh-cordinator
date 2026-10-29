/**
 * 建卡后自动打开右栏看板。
 *
 * 监视器跟着**屏幕上的会话**走：会话变了就重新解析它属于哪个项目，然后按项目
 * 拉卡片。发现项目里多了一张卡（新增卡片 id，不是卡片内容变化）就把右栏的
 * 「看板」tab 打开；已经开着就聚焦过去，不新开第二个。
 *
 * 为什么要轮询而不是听事件：卡片可能由 worker 会话建，那边的会话事件流不在
 * 屏幕会话的窗口里，等不到它的变化。卡片真源在宿主侧的项目通道里，按项目
 * 拉一次就能看见。
 *
 * 只在屏幕会话属于某个项目时监视：不属于项目的会话没有项目看板可开。
 *
 * @module dsh-coordinator/client/project-board-monitor
 */

import {
  BOARD_REFRESH_MS,
  fetchBoardCards,
  isCoordinatorProject,
  newCardIds,
  resolveProject,
} from './project-board-data.js'

/** 本插件的看板 tab 类型 kind。 */
export const BOARD_TAB_KIND = 'dsh-coordinator-board'

/**
 * 看板监视的状态机。
 *
 * 状态机与定时器分开：状态机是纯逻辑，能单测；定时器只是它的驱动。
 *
 * @param {object} options - 选项
 * @param {(method: string, args: unknown[]) => Promise<unknown>} options.callRemote - 项目通道调用
 * @param {(projectId: string) => void} options.onNewCard - 发现新卡时的动作
 * @returns {{ followSession: (sessionId: string | undefined) => void, poll: () => Promise<void> }} 状态机
 */
export function createBoardWatch({ callRemote, onNewCard }) {
  /** @type {string | undefined} 当前屏幕上的会话 id */
  let sessionId = undefined
  /** @type {object | undefined} 当前屏幕会话所属的项目 */
  let project = undefined
  /** @type {boolean} 已解析出项目，但屏幕会话不是它的协调者 */
  let ineligible = false
  /** @type {object[]} 上一轮看到的卡片，作为「有没有新卡」的基线 */
  let baseline = []
  /** @type {boolean} 是否已经拿到过这个项目的第一轮卡片 */
  let primed = false

  return {
    /**
     * 跟随屏幕会话：换会话就换项目，并重建基线。
     *
     * @param {string | undefined} next - 屏幕上的会话 id
     * @returns {void}
     */
    followSession(next) {
      sessionId = next
      project = undefined
      ineligible = false
      baseline = []
      primed = false
    },

    /**
     * 拉一轮卡片，判断项目里有没有新卡。
     *
     * 项目在这里惰性解析：通道可能比监视器晚就绪（挂载是异步的），第一轮解析
     * 失败不该就此放弃——下一轮会再试。
     *
     * @returns {Promise<void>} 处理完成
     */
    async poll() {
      if (typeof sessionId !== 'string' || sessionId === '') return
      // 看板只给项目协调者：worker 或项目目录里的普通会话在屏幕上时，新卡不该
      // 把看板弹到它们的右栏。
      if (ineligible) return
      if (project === undefined) {
        const resolved = await resolveProject(callRemote, sessionId)
        if (resolved === undefined) return
        if (!isCoordinatorProject(resolved, sessionId)) {
          ineligible = true
          return
        }
        project = resolved
      }
      const cards = await fetchBoardCards(callRemote, project.id)
      const added = newCardIds(baseline, cards)
      baseline = cards
      // 第一轮只是建立基线：监视器启动时项目里已有的卡不是「刚建的」，不该把
      // 看板弹出来。
      if (!primed) {
        primed = true
        return
      }
      if (added.length > 0) onNewCard()
    },
  }
}

/**
 * 挂载看板监视器。
 *
 * @param {object} options - 选项
 * @param {object} options.sidebarRight - 宿主右栏服务
 * @param {(method: string, args: unknown[]) => Promise<unknown>} options.callRemote - 项目通道调用
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @param {number} [options.intervalMs] - 轮询间隔（毫秒）
 * @returns {() => void} 停止监视的函数
 */
export function mountProjectBoardMonitor({
  sidebarRight,
  callRemote,
  logger = () => {},
  intervalMs = BOARD_REFRESH_MS,
}) {
  /** @type {string | undefined} 当前屏幕上的会话 id */
  let sessionId = sidebarRight.mounted.getSnapshot()
  /** @type {boolean} 监视器是否已停 */
  let closed = false

  /**
   * 打开或聚焦右栏的看板 tab。
   *
   * 先查已开的 tab：官方文档要求开之前先看有没有同类的，避免每次都新开一个。
   *
   * @returns {void}
   */
  function revealBoard() {
    try {
      const open = sidebarRight.openTabs.getSnapshot().find((tab) => (
        tab.kind === BOARD_TAB_KIND && tab.sessionId === sessionId
      ))
      if (open !== undefined) {
        sidebarRight.focus(open.tabId)
        return
      }
      sidebarRight.openTab(BOARD_TAB_KIND)
    } catch (error) {
      // 右栏服务在特定状态下会抛（没有屏幕会话、tab 类型没注册）。监视器不该
      // 因为一次打不开看板就把整个插件带崩。
      logger(`dsh-coordinator: 打开看板失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const watch = createBoardWatch({ callRemote, onNewCard: revealBoard })

  /**
   * 切到新的屏幕会话。
   * @param {string | undefined} next - 新的屏幕会话 id
   * @returns {void}
   */
  function followSession(next) {
    sessionId = next
    watch.followSession(next)
  }

  const unsubscribe = sidebarRight.mounted.subscribe(() => {
    followSession(sidebarRight.mounted.getSnapshot())
  })
  followSession(sessionId)

  const timer = setInterval(() => {
    if (closed) return
    void watch.poll().catch((error) => {
      logger(`dsh-coordinator: 读项目卡片失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }, intervalMs)

  return () => {
    closed = true
    clearInterval(timer)
    unsubscribe()
    // 自己打开的 tab 自己收：留着一个点开即空的「看板」，插件重载后还会再叠一个。
    // 只关本 kind 的，别碰用户别的 tab（宿主 sidebar-right 的 teardown 要求）。
    try {
      for (const tab of sidebarRight.openTabs.getSnapshot()) {
        if (tab.kind !== BOARD_TAB_KIND) continue
        sidebarRight.closeIn(tab.sessionId, tab.tabId)
      }
    } catch (error) {
      // 卸载阶段右栏可能已经先拆了，关不掉不是错误。
      logger(`dsh-coordinator: 关闭看板 tab 失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
