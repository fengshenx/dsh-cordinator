/**
 * 派工与完成唤醒。
 *
 * 派工走 dsh 自带的 subagent 服务：`ctx.subagents.startActivation()` 建立子会话并
 * 返回 activation，其中 `result` 是子会话的终态 promise。本模块**不等待**该 promise
 * ——工具立即返回，父 turn 正常结束，worker 在后台继续。
 *
 * 唤醒走 dsh 自带的 agent 入口：`agent.followup()` 会「queue a follow-up turn and
 * wake the driver」，父会话空闲时由此开新 turn。这补上了 dsh 原生缺失的一环：
 * 「worker 结束 → 协调者自动被唤醒并继续」。
 *
 * 本模块不新增 session event 类型（仓外插件的硬约束），完成通知走自有落盘队列。
 *
 * @module dsh-coordinator/host/dispatch
 */

import { createUserMessage, blocksToText } from './message.js'
import { workerReportSource } from '../shared/worker-report.js'

const DEFAULT_AUTO_RESUME_LIMIT = 8
const NOTIFICATION_LIMIT = 4000

/**
 * 构造完成通知正文。
 * @param {object} record - 派工记录
 * @param {{ ok: boolean, result?: object, error?: unknown }} outcome - 终态
 * @returns {string} 通知正文
 */
export function buildNotificationText(record, outcome) {
  const lines = []
  const status = outcome.ok ? outcome.result?.stopReason ?? 'completed' : 'failed'
  // 正文不带「谁在说话」的前缀：说话人由消息的 source 标记，客户端渲染成
  // 带头像与身份的气泡。前缀写进正文会同时污染模型读的事实与用户看到的界面。
  lines.push(`任务「${record.label}」已结束。`)
  lines.push(`子会话：${record.childId}`)
  lines.push(`状态：${status}`)
  if (!outcome.ok) {
    const reason = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    lines.push(`失败原因：${reason}`)
  } else {
    const summary = blocksToText(outcome.result?.output ?? [])
    lines.push(summary === '' ? '产物摘要：（worker 未产出文本）' : `产物摘要：\n${summary}`)
  }
  lines.push('下一步：按协调者协议判断验收、返工或派新工。')
  return lines.join('\n').slice(0, NOTIFICATION_LIMIT)
}

/**
 * 创建派工与唤醒器。
 *
 * @param {object} options - 选项
 * @param {object} options.ctx - Cordis 上下文
 * @param {object} options.store - 通知落盘队列
 * @param {string} [options.provider] - subagent provider 名，默认 `spawn`
 * @param {number} [options.autoResumeLimit] - 连续自动续行上限
 * @param {(parentSessionId: string) => string | undefined} [options.resolveWorkerCwd] - 取 worker 的工作目录
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @returns {object} 派工器接口
 */
export function createDispatcher({
  ctx,
  store,
  provider = 'spawn',
  autoResumeLimit = DEFAULT_AUTO_RESUME_LIMIT,
  resolveWorkerCwd,
  logger = () => {},
}) {
  /** @type {Map<string, object>} 派工记录，key 为子会话 id */
  const inflight = new Map()
  /** @type {Map<string, number>} 每个父会话的连续自动续行次数 */
  const resumeCounts = new Map()
  /** @type {Set<string>} 本进程注入过的通知消息 id，用于区分外部输入 */
  const injected = new Set()
  /** @type {Set<string>} 已销毁的会话 id。失活的 agent 会静默接受 followup，投递前必须排除。 */
  const disposed = new Set()

  /**
   * 解析父会话的 agent。
   *
   * 优先走 `sessionController.resolveAgent()`：它给出活 agent 并确保会话的 inbox
   * 投影处于激活状态。缺失该服务时回退到派工时持有的父 agent 活对象——实测只要
   * 父 agent 尚未被销毁，对空闲 agent 调 `followup()` 就能唤醒它开新 turn。
   *
   * 真正让唤醒落空的是父 agent 已被销毁（headless 一次性 CLI 会在 turn 结束后
   * dispose 会话）。这类通知留在队列里，等父会话重新打开时补投。
   *
   * @param {string} parentSessionId - 父会话 id
   * @param {object} [fallbackAgent] - 派工时持有的父 agent 活对象
   * @returns {Promise<object | undefined>} agent 或 undefined
   */
  async function resolveParentAgent(parentSessionId, fallbackAgent) {
    try {
      const controller = ctx.get('sessionController')
      if (controller !== undefined) {
        const resolved = await controller.resolveAgent(parentSessionId)
        if (!('error' in resolved)) return resolved.agent
      }
    } catch {
      // 服务不可用或解析失败时落到派工时持有的活对象。
    }
    return fallbackAgent
  }

  /**
   * 向父会话投递完成通知。
   * @param {object} notification - 通知记录
   * @param {object} [parentAgent] - 派工时持有的父 agent 活对象
   * @returns {Promise<boolean>} 是否已投递
   */
  async function deliver(notification, parentAgent) {
    if (disposed.has(notification.parentSessionId)) {
      await store.markUndelivered(notification.id, '父会话已销毁，等待重新打开后补投')
      return false
    }
    const agent = await resolveParentAgent(notification.parentSessionId, parentAgent)
    if (agent === undefined) {
      await store.markUndelivered(notification.id, '父会话当前不可达')
      return false
    }
    const used = resumeCounts.get(notification.parentSessionId) ?? 0
    if (used >= autoResumeLimit) {
      await store.markUndelivered(notification.id, `连续自动续行已达上限 ${autoResumeLimit}`)
      logger(
        `dsh-coordinator: 父会话 ${notification.parentSessionId} 的自动续行已达上限 ${autoResumeLimit}，`
        + `通知 ${notification.id} 留待人工处理`,
      )
      return false
    }
    const message = createUserMessage(
      [{ type: 'text', text: notification.text }],
      workerReportSource(notification.label, notification.childId, notification.text.split('\n')[0] ?? ''),
    )
    injected.add(message.id)
    resumeCounts.set(notification.parentSessionId, used + 1)
    try {
      agent.followup(message)
    } catch (error) {
      // 失活的 agent 会静默接受或直接拒绝投递，通知必须留在队列里等待补投。
      await store.markUndelivered(
        notification.id,
        `投递失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return false
    }
    await store.markDelivered(notification.id)
    return true
  }

  /**
   * 处理子会话终态：落盘通知并唤醒父会话。
   * @param {string} childId - 子会话 id
   * @param {{ ok: boolean, result?: object, error?: unknown }} outcome - 终态
   * @returns {Promise<void>} 处理完成
   */
  async function settle(childId, outcome) {
    const record = inflight.get(childId)
    if (record === undefined) return
    inflight.delete(childId)
    const notification = {
      id: `note-${childId}-${record.startedAt}`,
      childId,
      parentSessionId: record.parentSessionId,
      label: record.label,
      text: buildNotificationText(record, outcome),
      createdAt: Date.now(),
      attempts: 0,
    }
    await store.enqueue(notification)
    await deliver(notification, record.parent)
  }

  /**
   * 派一个 worker。立即返回，不等待 worker 完成。
   *
   * @param {object} options - 派工参数
   * @param {object} options.parent - 发起派工的父 agent
   * @param {string} options.task - 交给 worker 的任务正文
   * @param {string} options.label - 任务短标签
   * @param {AbortSignal} options.signal - 取消信号
   * @returns {Promise<object>} 派工记录
   */
  async function dispatch({ parent, task, label, signal }) {
    const subagents = ctx.get('subagents')
    if (subagents === undefined) {
      throw new Error('dsh-coordinator: 当前组合未启用 subagents 服务，无法派工')
    }
    // worker 的工作目录由项目决定：协调者不能指定 worker 跑在哪，也不该让
    // worker 跑到项目外面去。项目目录是绝对路径，subagent 直接采用。
    const cwd = resolveWorkerCwd?.(parent.id)
    const activation = await subagents.startActivation({
      provider,
      label,
      request: {
        parent,
        prompt: [{ type: 'text', text: task }],
        signal,
        ...cwd === undefined ? {} : { cwd },
      },
      signal,
      delivery: 'caller',
    })
    const record = {
      childId: activation.childId,
      parentSessionId: parent.id,
      parent,
      label,
      task,
      startedAt: Date.now(),
    }
    inflight.set(record.childId, record)
    void activation.result.then(
      (result) => settle(record.childId, { ok: true, result }),
      (error) => settle(record.childId, { ok: false, error }),
    )
    return record
  }

  return {
    dispatch,

    /**
     * 补投队列里属于某个父会话的通知。
     *
     * 父会话重新打开时由宿主把 agent 活对象交过来——这是补投唯一可靠的入口：
     * `agents` 注册表在根作用域不可见。
     *
     * @param {object} agent - 父会话的 agent 活对象
     * @returns {Promise<number>} 成功补投的条数
     */
    async redeliverPending(agent) {
      const pending = await store.listPending()
      let delivered = 0
      for (const notification of pending) {
        if (notification.parentSessionId !== agent.id) continue
        if (await deliver(notification, agent)) delivered += 1
      }
      return delivered
    },

    /**
     * 外部输入抵达时重置该父会话的自动续行计数——人工介入后护栏应重新开始计数。
     * @param {string} parentSessionId - 父会话 id
     * @returns {void}
     */
    resetResumeCount(parentSessionId) {
      resumeCounts.delete(parentSessionId)
    },

    /**
     * 记录本进程注入的通知 id，供外部输入识别使用。
     * @param {string} messageId - 消息 id
     * @returns {void}
     */
    markInjected(messageId) {
      injected.add(messageId)
    },

    /**
     * 判断一条注入消息是否来自本进程。
     * @param {string} messageId - 消息 id
     * @returns {boolean} 是否为本进程注入
     */
    isInjected(messageId) {
      return injected.has(messageId)
    },

    /**
     * 当前在飞的派工数。
     * @returns {number} 在飞数量
     */
    inflightCount() {
      return inflight.size
    },

    /**
     * 记录会话已销毁。
     * @param {string} sessionId - 会话 id
     * @returns {void}
     */
    markDisposed(sessionId) {
      disposed.add(sessionId)
    },

    /**
     * 记录会话已重新注册。
     * @param {string} sessionId - 会话 id
     * @returns {void}
     */
    markAlive(sessionId) {
      disposed.delete(sessionId)
    },
  }
}
