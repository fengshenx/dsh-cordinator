/**
 * worker 回报气泡的渲染组件。
 *
 * 形态照 Telov 的 worker 回报：身份头（头像 + 名字）在气泡上方单独一行，气泡本身
 * 左对齐、带 1px 边框、中性底——读起来像另一个 agent 在回话，而不是用户在说话。
 *
 * 正文按纯文本渲染：通知正文是模型读的事实，界面里再解释一遍反而多一层歧义。
 *
 * @module dsh-coordinator/client/worker-report-view
 */

import { createElement } from 'react'
import { agentAvatarDataUri } from './worker-report-avatar.js'
import { ensureWorkerReportStyles } from './worker-report-styles.js'

/**
 * 渲染一条 worker 回报。
 *
 * @param {object} props - 槽位注入的属性
 * @param {object} props.node - 会话节点，`node.data` 是这条回报的事实
 * @returns {object} React 元素
 */
export function WorkerReportView({ node }) {
  ensureWorkerReportStyles()
  const data = node?.data
  if (data === undefined) return null
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
      createElement('span', { className: 'dsh-coordinator-worker-report__name' }, data.label),
    ),
    createElement('div', { className: 'dsh-coordinator-worker-report__bubble' }, data.text),
  )
}
