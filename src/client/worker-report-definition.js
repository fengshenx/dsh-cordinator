/**
 * worker 回报的会话节点定义。
 *
 * 官方 `input-message` 定义会匹配所有 `user/message` 事件，把它们渲染成右对齐的
 * 用户气泡。worker 回报也是 `user/message`（它要唤醒父会话），但它说话人是另一个
 * agent，不是用户。
 *
 * 这里注册一个独立的节点 kind，用 exclusive claim 接管这一类消息：认领成功后官方
 * 定义不再处理它，消息改由本插件的渲染器呈现成左侧、带头像与身份的气泡。影响面
 * 只有 worker 回报这一类消息，普通用户输入的渲染完全不动。
 *
 * 认领失败时（宿主版本漂移导致本定义没注册上）消息仍由官方渲染，最多退化成一条
 * 右对齐的用户气泡，不会丢内容。
 *
 * @module dsh-coordinator/client/worker-report-definition
 */

import { readWorkerReportSource, workerReportText } from '../shared/worker-report.js'

/** worker 回报消息的节点 kind（渲染器的 dispatch key）。 */
export const WORKER_REPORT_NODE_KIND = 'dsh-coordinator-worker-report'

/**
 * 会话节点定义。
 *
 * 字段与宿主契约一一对应（`ConversationNodeDefinition`）：`match` 认事件、
 * `start` 建状态、`update` 消化后续事件、`buildViewNode` 产出最终节点。
 */
export const workerReportDefinition = {
  kind: WORKER_REPORT_NODE_KIND,
  target: 'chat',
  match: (event) => {
    if (event.type !== 'user/message') return null
    if (readWorkerReportSource(event.data?.source) === null) return null
    return { id: String(event.data.id), role: 'start', exclusive: true }
  },
  start: (_context, match) => {
    const event = match.event
    if (event.type !== 'user/message') throw new Error('worker 回报 start 需要 user/message 事件')
    const source = readWorkerReportSource(event.data.source)
    if (source === null) throw new Error('worker 回报 start 需要带 worker 标记的 source')
    return {
      seq: event.seq,
      time: event.time,
      messageId: String(event.data.id),
      text: workerReportText(event.data.content),
      label: source.label,
      childSessionId: source.childSessionId,
    }
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: WORKER_REPORT_NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      visibility: 'visible',
      // `input` 是这条回报的分组位置：它是被注入到会话里的一次输入（role=user、
      // 唤醒父会话），与官方用户输入同类。没有这个位置，节点会落进回合的「过程
      // 折叠区」，被默认隐藏——worker 就在说话，却看不见它说话。
      groupTree: 'input',
      data: context.state,
    }
  },
}
