/**
 * worker 回报气泡的渲染组件。
 *
 * 形态：身份头（头像 + 名字）在气泡上方单独一行，气泡本身
 * 左对齐、带 1px 边框、淡底——读起来像另一个 agent 在回话，而不是用户在说话。
 *
 * 气泡里只渲染 worker **最后一次回报的内容**（产物摘要或失败原因）。协议字段
 * （子会话 id、状态、下一步）留在消息正文里给模型读，不占用户的界面。
 *
 * 气泡下方一行是时间与复制按钮，与官方消息的底部 chrome 同形。
 *
 * @module dsh-coordinator/client/worker-report-view
 */

import { createElement, useEffect, useState } from 'react'
import { agentAvatarDataUri } from './worker-report-avatar.js'
import { workerReportBody } from '../shared/worker-report.js'
import { ensureWorkerReportStyles } from './worker-report-styles.js'
import { productIcon } from './icons.js'

/**
 * 把时间戳格式成消息时钟。
 *
 * 与宿主的 `formatMessageClock` 同口径（zh-CN 模板）：今天只显示时分；同年往日
 * 显示「M月D日 时分」；跨年再加年份。宿主按 i18n 模板渲染（英文环境下是
 * `M/D`），本仓不做多语言，固定用中文形态。
 *
 * @param {number} time - 毫秒时间戳
 * @returns {string} 时钟文本
 */
export function formatReportClock(time) {
  const date = new Date(time)
  const now = new Date()
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()) {
    return clock
  }
  const day = `${date.getMonth() + 1}月${date.getDate()}日`
  const md = date.getFullYear() === now.getFullYear() ? day : `${date.getFullYear()}年${day}`
  return `${md} ${clock}`
}

/**
 * 渲染一条 worker 回报。
 *
 * @param {object} props - 槽位注入的属性
 * @param {object} props.node - 会话节点，`node.data` 是这条回报的事实
 * @param {(sessionId: string) => void} [props.openSession] - 打开 worker 子会话
 * @returns {object} React 元素
 */
export function WorkerReportView({ node, openSession }) {
  // 样式在副作用里注入，不在渲染期：渲染期做 DOM 查询是副作用，会在并发渲染下
  // 与 React 的渲染阶段交错（与看板面板的处理一致）。
  useEffect(() => {
    ensureWorkerReportStyles()
  }, [])
  const [copied, setCopied] = useState(false)
  const data = node?.data
  if (data === undefined) return null
  const body = workerReportBody(data)

  /**
   * 把回报正文复制到剪贴板。
   * @returns {Promise<void>} 复制完成
   */
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body)
    } catch {
      // 剪贴板不可用（非安全上下文或权限被拒）：静默跳过，不打断阅读。
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return createElement(
    'div',
    { className: 'dsh-coordinator-worker-report' },
    createElement(
      'div',
      { className: 'dsh-coordinator-worker-report__identity' },
      createElement('img', {
        className: 'dsh-coordinator-worker-report__avatar',
        src: agentAvatarDataUri(data.label),
        alt: '',
      }),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-coordinator-worker-report__name',
          title: `打开 ${data.label} 的子会话`,
          onClick: () => openSession?.(data.childSessionId),
        },
        data.label,
      ),
    ),
    createElement('div', { className: 'dsh-coordinator-worker-report__bubble' }, body),
    createElement(
      'div',
      { className: 'dsh-coordinator-worker-report__meta' },
      createElement('span', { className: 'dsh-coordinator-worker-report__time' }, formatReportClock(data.time)),
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-coordinator-worker-report__copy',
          'aria-label': copied ? '已复制' : '复制',
          title: copied ? '已复制' : '复制',
          onClick: () => { void copy() },
        },
        productIcon(copied ? 'check-outline' : 'copy-outline', { size: 14 }),
      ),
    ),
  )
}
