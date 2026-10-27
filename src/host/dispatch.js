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
 * 完成通知走 **next-turn** 边界（`followup`）：它是「下一个 turn 的一次输入」，
 * 语义上就该排进下一轮，而不是插进协调者当前这一步里。
 *
 * 投递时机是「父会话空闲时」：宿主输入框上方的「消息队列」面板显示的是 inbox 的
 * next-turn 未消费项（`ui-conversation` 的 QueueDock 读 `inbox['next-turn']`）。
 * 协调者正忙时把通知投进去，它就会以「一条待发消息」的形态挂在那里——那是用户的
 * 输入队列，不是后台通知该待的地方。改为忙时先不投（通知留在落盘队列），检测到
 * 空闲再投：投递即被消费，队列面板不会看到它，唤醒时机与排进 next-turn 也几乎
 * 一样（两者都要等当前 turn 结束）。
 *
 * 本模块不新增 session event 类型（仓外插件的硬约束），完成通知走自有落盘队列。
 *
 * @module dsh-coordinator/host/dispatch
 */

import { createUserMessage, blocksToText } from './message.js'
import { workerReportSource } from '../shared/worker-report.js'

const DEFAULT_AUTO_RESUME_LIMIT = 8
const NOTIFICATION_LIMIT = 4000
/** 空闲检测的轮询间隔（毫秒）。 */
const IDLE_POLL_MS = 500

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
 * 构造 worker 最后一次回报的内容（界面渲染用）。
 *
 * 消息正文是给模型读的事实，含子会话 id、状态、下一步这些协议字段；界面只渲染
 * worker 真正产出的内容——成功是产物摘要，失败是失败原因。
 *
 * @param {{ ok: boolean, result?: object, error?: unknown }} outcome - 终态
 * @returns {string} 最后一次回报的内容
 */
export function buildWorkerReport(outcome) {
  if (!outcome.ok) {
    const reason = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
    return `失败：${reason}`.slice(0, NOTIFICATION_LIMIT)
  }
  const summary = blocksToText(outcome.result?.output ?? [])
  return (summary === '' ? '（worker 未产出文本）' : summary).slice(0, NOTIFICATION_LIMIT)
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
  /** @type {Set<string>} 已销毁的会话 id。失活的 agent 会静默接受投递，投递前必须排除。 */
  const disposed = new Set()
  /** @type {Map<string, object[]>} 等待父会话空闲的通知，按父会话分组 */
  const waiting = new Map()
  /** @type {ReturnType<typeof setInterval> | undefined} 空闲检测定时器 */
  let idleTimer = undefined
  /** @type {Set<string>} 正在投递的通知 id：同一条通知只投一次。 */
  const delivering = new Set()
  /** @type {boolean} 空闲检测是否正在跑：轮询重入会重复投递，用它当闸门。 */
  let flushing = false
  /** @type {boolean} 插件是否已卸载：卸载后不再起定时器、不再投递。 */
  let closed = false

  /**
   * 解析父会话的 agent。
   *
   * 优先走 `sessionController.resolveAgent()`：它给出活 agent 并确保会话的 inbox
   * 投影处于激活状态。缺失该服务时回退到派工时持有的父 agent 活对象——实测只要
   * 父 agent 尚未被销毁，对空闲 agent 调 `steer()` 就能唤醒它开新 turn。
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
   * 把一条通知投进父会话的下一个 turn。
   *
   * 走 `followup`：通知是「下一个 turn 的一次输入」，语义上就该排进下一轮。
   *
   * @param {object} notification - 通知记录
   * @param {object} agent - 父会话的 agent 活对象
   * @returns {Promise<boolean>} 是否已投递
   */
  async function deliverNow(notification, agent) {
    // 幂等闸：轮询重入、补投与轮询并发时，同一条通知只投一次。
    if (delivering.has(notification.id)) return false
    delivering.add(notification.id)
    try {
      return await deliverOnce(notification, agent)
    } finally {
      delivering.delete(notification.id)
    }
  }

  /**
   * 真正投递一条通知（幂等闸之外的部分）。
   *
   * @param {object} notification - 通知记录
   * @param {object} agent - 父会话的 agent 活对象
   * @returns {Promise<boolean>} 是否已投递
   */
  async function deliverOnce(notification, agent) {
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
      workerReportSource(
        notification.label,
        notification.childId,
        // 改造前落盘的记录没有 summary / report / outcome：摘要退回正文首行
        // （与当时的算法一致），回报正文与终态按缺省处理。
        notification.summary ?? notification.text.split('\n')[0] ?? '',
        notification.report ?? '',
        notification.outcome ?? 'completed',
      ),
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
   * 向父会话投递完成通知。
   *
   * 父会话正忙时不投：通知排在 inbox 的 next-turn 队列里，会以「一条待发消息」的
   * 形态出现在宿主输入框上方的消息队列面板——那是用户的输入队列，不是后台通知
   * 该待的地方。改为留在落盘队列里等空闲，检测到空闲再投：投递即被消费。
   *
   * @param {object} notification - 通知记录
   * @param {object} [parentAgent] - 派工时持有的父 agent 活对象
   * @returns {Promise<boolean>} 是否已投递
   */
  async function deliver(notification, parentAgent) {
    if (closed) {
      await store.markUndelivered(notification.id, '插件已卸载，等待下次启动后补投')
      return false
    }
    if (disposed.has(notification.parentSessionId)) {
      await store.markUndelivered(notification.id, '父会话已销毁，等待重新打开后补投')
      return false
    }
    const agent = await resolveParentAgent(notification.parentSessionId, parentAgent)
    if (agent === undefined) {
      await store.markUndelivered(notification.id, '父会话当前不可达')
      return false
    }
    if (agent.status !== 'idle') {
      const list = waiting.get(notification.parentSessionId) ?? []
      // 记下当时的 agent 活对象：空闲检测里没有第二个入口能拿到它
      if (!list.some((item) => item.notification.id === notification.id)) {
        list.push({ notification, agent })
      }
      waiting.set(notification.parentSessionId, list)
      await store.markUndelivered(notification.id, '父会话正忙，等待空闲后投递')
      ensureIdleTimer()
      return false
    }
    return deliverNow(notification, agent)
  }

  /**
   * 启动空闲检测定时器。
   * @returns {void}
   */
  function ensureIdleTimer() {
    if (closed) return
    if (idleTimer !== undefined) return
    idleTimer = setInterval(() => {
      if (flushing) return
      flushing = true
      void flushWaiting()
        .catch((error) => {
          // 读盘失败等异常必须在这里兜住：宿主对未处理拒绝是致命退出（proc.exit(1)），
          // 一次磁盘抖动不该带走整个 dsh 进程。
          logger(`dsh-coordinator: 空闲检测失败：${error instanceof Error ? error.message : String(error)}`)
        })
        .finally(() => {
          flushing = false
        })
    }, IDLE_POLL_MS)
    // 空闲检测不该拖住进程退出：dsh 退出时通知仍在落盘队列里，重启后补投。
    idleTimer.unref?.()
  }

  /**
   * 把等待中的通知投给已经空闲的父会话。
   *
   * 投递前先看通知还在不在落盘队列里：父会话重新打开时补投通道（`redeliverPending`）
   * 可能已经投过同一条，重复投会让协调者收到两遍。
   *
   * @returns {Promise<void>} 处理完成
   */
  async function flushWaiting() {
    const pending = await store.listPending()
    for (const [parentSessionId, list] of [...waiting]) {
      // 先摘后投：投递期间等待表里没有这些条目，轮询重入也拿不到同一条。
      waiting.delete(parentSessionId)
      const remaining = []
      for (const item of list) {
        const { notification } = item
        if (!pending.some((entry) => entry.id === notification.id)) continue
        const agent = await resolveParentAgent(parentSessionId, item.agent)
        if (agent === undefined || agent.status !== 'idle') {
          remaining.push(item)
          continue
        }
        if (!await deliverNow(notification, agent)) remaining.push(item)
      }
      if (remaining.length > 0) {
        // 合并而不是覆盖：投递期间新到的通知也在这个等待表里。
        waiting.set(parentSessionId, [...(waiting.get(parentSessionId) ?? []), ...remaining])
      }
    }
    if (waiting.size === 0 && idleTimer !== undefined) {
      clearInterval(idleTimer)
      idleTimer = undefined
    }
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
    const text = buildNotificationText(record, outcome)
    const notification = {
      id: `note-${childId}-${record.startedAt}`,
      childId,
      parentSessionId: record.parentSessionId,
      label: record.label,
      text,
      summary: text.split('\n')[0] ?? '',
      report: buildWorkerReport(outcome),
      outcome: outcome.ok ? 'completed' : 'failed',
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
      // 补投通道已经处理过这个父会话的待投通知，等待表里的同一批不要再留
      if (delivered > 0) waiting.delete(agent.id)
      return delivered
    },

    /**
     * 释放定时器。
     * @returns {void}
     */
    dispose() {
      closed = true
      if (idleTimer !== undefined) {
        clearInterval(idleTimer)
        idleTimer = undefined
      }
      waiting.clear()
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
