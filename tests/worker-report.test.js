import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentAvatarDataUri, agentAvatarSeed } from '../src/client/worker-report-avatar.js'
import { WORKER_REPORT_NODE_KIND, workerReportDefinition } from '../src/client/worker-report-definition.js'
import { buildNotificationText } from '../src/host/dispatch.js'
import {
  WORKER_REPORT_SOURCE_KIND,
  readWorkerReportSource,
  workerReportSource,
  workerReportText,
} from '../src/shared/worker-report.js'

test('worker 回报的 source 记着身份名与子会话', () => {
  const source = workerReportSource('前端 worker', 'child-1', '任务「前端 worker」已结束。')
  assert.equal(source.kind, WORKER_REPORT_SOURCE_KIND)
  assert.equal(source.worker.label, '前端 worker')
  assert.equal(source.worker.childSessionId, 'child-1')
  assert.equal(source.summary, '任务「前端 worker」已结束。')
  assert.equal(source.form, 'notice')
})

test('读 worker 回报的 source 时逐层判型', () => {
  assert.deepEqual(
    readWorkerReportSource({ kind: WORKER_REPORT_SOURCE_KIND, worker: { label: 'a', childSessionId: 'b' } }),
    { label: 'a', childSessionId: 'b' },
  )
  assert.equal(readWorkerReportSource({ kind: 'user', worker: { label: 'a', childSessionId: 'b' } }), null)
  assert.equal(readWorkerReportSource({ kind: WORKER_REPORT_SOURCE_KIND }), null)
  assert.equal(readWorkerReportSource({ kind: WORKER_REPORT_SOURCE_KIND, worker: null }), null)
  assert.equal(readWorkerReportSource({ kind: WORKER_REPORT_SOURCE_KIND, worker: { label: 1, childSessionId: 'b' } }), null)
  assert.equal(readWorkerReportSource({ kind: WORKER_REPORT_SOURCE_KIND, worker: { label: 'a' } }), null)
  assert.equal(readWorkerReportSource(null), null)
  assert.equal(readWorkerReportSource([{ kind: WORKER_REPORT_SOURCE_KIND }]), null)
  assert.equal(readWorkerReportSource('worker-report'), null)
  assert.equal(readWorkerReportSource(undefined), null)
})

test('从内容块里取纯文本', () => {
  assert.equal(workerReportText([{ type: 'text', text: '一' }, { type: 'text', text: '二' }]), '一\n二')
  assert.equal(workerReportText([{ type: 'image', url: 'x' }]), '')
  assert.equal(workerReportText([{ type: 'text' }]), '')
  assert.equal(workerReportText('不是数组'), '')
})

test('通知正文不带说话人前缀', () => {
  const text = buildNotificationText(
    { label: '前端 worker', childId: 'child-1' },
    { ok: true, result: { stopReason: 'completed', output: [{ type: 'text', text: '干完了' }] } },
  )
  assert.equal(text.includes('【worker 回报】'), false)
  assert.equal(text.startsWith('任务「前端 worker」已结束。'), true)
  assert.equal(text.includes('产物摘要：\n干完了'), true)
})

test('头像按名字定种子，同名恒同图', () => {
  assert.equal(agentAvatarSeed('前端 worker'), agentAvatarSeed('前端 worker'))
  // 池子只有 63 个 seed，不同名字撞图是正常的；这里只保证分配铺得开。
  const seeds = new Set(Array.from({ length: 100 }, (_, index) => agentAvatarSeed(`worker-${index}`)))
  assert.equal(seeds.size > 10, true)
  const uri = agentAvatarDataUri('前端 worker')
  assert.equal(uri.startsWith('data:image/svg+xml,'), true)
  assert.equal(uri.includes(encodeURIComponent('<rect x="-1.5"')), true)
  assert.equal(uri, agentAvatarDataUri('前端 worker'))
})

test('节点定义只认带 worker 标记的用户消息', () => {
  const marked = {
    type: 'user/message',
    data: { id: 'm1', source: workerReportSource('worker a', 'child-1', '摘要'), content: [] },
  }
  assert.deepEqual(workerReportDefinition.match(marked), { id: 'm1', role: 'start', exclusive: true })
  assert.equal(workerReportDefinition.match({ type: 'user/message', data: { id: 'm2', source: { kind: 'user' } } }), null)
  assert.equal(workerReportDefinition.match({ type: 'assistant/message', data: {} }), null)
})

test('节点定义把回报事实装进视图节点', () => {
  const event = {
    type: 'user/message',
    seq: 12,
    time: 1700,
    data: {
      id: 'm1',
      source: workerReportSource('worker a', 'child-1', '摘要'),
      content: [{ type: 'text', text: '任务「a」已结束。' }],
    },
  }
  const state = workerReportDefinition.start({}, { event, location: { kind: 'turn' } })
  assert.equal(state.label, 'worker a')
  assert.equal(state.childSessionId, 'child-1')
  assert.equal(state.text, '任务「a」已结束。')
  assert.equal(state.seq, 12)

  const node = workerReportDefinition.buildViewNode({
    key: '7:dsh-coordinator-worker-reportm1',
    id: 'm1',
    start: { location: { kind: 'turn' } },
    state,
  })
  assert.equal(node.kind, WORKER_REPORT_NODE_KIND)
  assert.equal(node.target, 'chat')
  assert.equal(node.key, '7:dsh-coordinator-worker-reportm1')
  assert.equal(node.anchorSeq, 12)
  assert.equal(node.visibility, 'visible')
  assert.equal(node.groupTree, 'input')
  assert.equal(node.data.label, 'worker a')
})
