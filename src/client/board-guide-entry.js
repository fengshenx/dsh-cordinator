/**
 * 右栏 guide 页的「看板」入口。
 *
 * 宿主的 guide 页是**全局静态**的：入口来自 tab 类型的静态注册，注册表没有按
 * 会话过滤的扩展点（见 docs/capability-gaps.md 第 15 条与 2026-10-30 的 note）。
 * 于是从不属于项目的普通会话里也能看到「看板」胶囊，点开才看到一句「这不是
 * 项目会话」——入口本身是一句谎。
 *
 * 这里接管这个胶囊的渲染：`sidebar.right.tab.guide.entry` 按 provider id 分发，
 * 本插件渲染自己的那一个，按当前会话决定画还是不画。项目会话（协调者与
 * worker）画，其余返回 `null`。代价是胶囊的样式要自己复刻宿主的
 * `EntryBox`（第三方 bundle 不能 import 宿主的 CSS module），数值取自
 * `ui-sidebar-right` 的 `GuideBody.module.css`。
 *
 * @module dsh-coordinator/client/board-guide-entry
 */

import { createElement, useEffect, useState } from 'react'
import { ensureBoardStyles } from './board-styles.js'
import { productIcon } from './icons.js'
import { BOARD_TAB_KIND } from './project-board-monitor.js'
import {
  fetchProjectWorkers,
  isBoardEntryVisible,
  isCoordinatorProject,
  isProjectWorker,
  resolveProject,
} from './project-board-data.js'

/**
 * 看板入口胶囊。
 *
 * @param {object} props - 槽位注入的运行时属性
 * @param {string} props.sessionId - 当前会话
 * @param {string} props.title - 入口标题（来自 tab 类型的 guide 定义）
 * @param {string} [props.description] - 入口说明；guide 条目多时宿主不传
 * @param {() => { tab: { actions: object } }} props.useTabInfo - 宿主绑定的 tab 信息 hook
 * @param {(method: string, args: unknown[]) => Promise<unknown>} props.callRemote - 项目通道调用
 * @returns {object | null} React 元素；非项目会话时不渲染
 */
export function BoardGuideEntry({ sessionId, title, description, useTabInfo, callRemote }) {
  const { tab } = useTabInfo()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    ensureBoardStyles()
  }, [])

  // 入口可见性跟着会话走：解析项目 → 非协调者时再确认是不是项目 worker。
  // 窗口重新聚焦时复核一次：项目可能在另一个窗口里被建出来或换过协调者。
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const project = await resolveProject(callRemote, sessionId)
        if (cancelled) return
        let worker = false
        if (project !== undefined && !isCoordinatorProject(project, sessionId)) {
          const workers = await fetchProjectWorkers(callRemote)
          if (cancelled) return
          worker = isProjectWorker(project.id, sessionId, workers)
        }
        setVisible(isBoardEntryVisible(project, sessionId, worker))
      } catch {
        // 项目通道未就绪或一次 RPC 失败：按不可见处理，聚焦时再试。这里吞掉是
        // 有意的——guide 页不能因为一次远程失败就把入口闪出来再消失。
        if (!cancelled) setVisible(false)
      }
    }
    void check()
    const onFocus = () => { void check() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [sessionId, callRemote])

  if (!visible) return null

  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-coordinator-guide-entry',
      onClick: () => {
        tab.actions.openTab(BOARD_TAB_KIND, { replaceTab: true })
        tab.actions.close()
      },
    },
    createElement(
      'span',
      { className: 'dsh-coordinator-guide-entry-icon' },
      productIcon('checklist-outline', { size: description === undefined ? 22 : 26 }),
    ),
    createElement(
      'span',
      { className: 'dsh-coordinator-guide-entry-text' },
      createElement('span', { className: 'dsh-coordinator-guide-entry-title' }, title),
      description === undefined
        ? null
        : createElement('span', { className: 'dsh-coordinator-guide-entry-description' }, description),
    ),
  )
}
