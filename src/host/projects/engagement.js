/**
 * 协调者会话的首轮保障。
 *
 * dsh 对空会话一律渲染欢迎页：主区域的阶段由 `conversationPhase` 决定，它只在会话
 * 跑过至少一轮时返回 `'active'`——那才是输入框停靠在底部的对话形态
 * （宿主 `packages/client/ui-conversation/src/client/skeleton/ConversationMainPanel.tsx`）。
 * 「跑过一轮」在宿主里的唯一凭据是日志里的 `turn/start` 事件：宿主投影
 * `sessionListMetadata.blank` 只被它翻成 false
 * （宿主 `packages/api/session-controller/src/list.ts`）。
 *
 * 宿主没有「标记会话非空」的命令，客户端的 `promptAttempted` 又是刷新即失的内存态，
 * 所以让协调者会话真的跑一轮是唯一持久解法。这一轮由插件自己发起，走 dsh 自带的
 * `agent.followup()`（与派工完成后的唤醒同一条路），不新增任何 session event 类型。
 *
 * @module dsh-coordinator/host/projects/engagement
 */

import { createUserMessage } from '../message.js'

/** 读会话投影的超时。 */
const PROJECTION_TIMEOUT_MS = 5000

/**
 * 构造协调者首轮正文。
 *
 * 正文是确定性的：内容只来自项目记录，不让模型自由发挥。
 *
 * @param {object} options - 选项
 * @param {string} options.name - 项目名
 * @param {string} options.directory - 项目目录
 * @returns {string} 首轮正文
 */
export function buildEngagementBrief({ name, directory }) {
  return [
    `项目「${name}」的协调者会话已建立。`,
    `项目目录：${directory}`,
    '请简短说明这个项目里你能帮我做什么、我该怎么给你派工，然后等我的指令。',
  ].join('\n')
}

/**
 * 读会话的 blank 投影。
 *
 * `sessionListMetadata.blank` 是宿主对「这段会话有没有跑过一轮」的持久判断，与官方
 * 界面用的判据同源。读不到时返回 undefined，调用方按「尚未跑过一轮」处理。
 *
 * @param {object} ctx - 宿主 Cordis 上下文
 * @param {string} sessionId - 会话 id
 * @returns {Promise<boolean | undefined>} 是否空会话；读不到时 undefined
 */
export async function readSessionBlank(ctx, sessionId) {
  const controller = ctx.get('sessionController')
  if (controller === undefined || typeof controller.projections !== 'function') return undefined
  const projections = await controller.projections(
    { sessionId },
    AbortSignal.timeout(PROJECTION_TIMEOUT_MS),
  )
  const metadata = projections?.values?.sessionListMetadata
  if (metadata === undefined) return undefined
  return metadata.blank === true
}

/**
 * 取会话的活 agent。
 *
 * 优先走 `sessionController.resolveAgent()`：它给出活 agent 并确保会话的 inbox 投影
 * 处于激活状态。缺失该服务时回退到 agent 注册表。
 *
 * @param {object} ctx - 宿主 Cordis 上下文
 * @param {string} sessionId - 会话 id
 * @returns {Promise<object | undefined>} agent；取不到时 undefined
 */
export async function resolveSessionAgent(ctx, sessionId) {
  const controller = ctx.get('sessionController')
  if (controller !== undefined && typeof controller.resolveAgent === 'function') {
    const resolved = await controller.resolveAgent(sessionId)
    if (resolved !== undefined && !('error' in resolved)) return resolved.agent
  }
  const agents = ctx.get('agents')
  return agents?.get?.(sessionId)
}

/**
 * 创建首轮保障器。
 *
 * @param {object} options - 选项
 * @param {object} options.ctx - 宿主 Cordis 上下文
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @returns {{ engage: (input: object) => Promise<{engaged: boolean, reason?: string}> }} 保障器
 */
export function createEngager({ ctx, logger = () => {} }) {
  /** @type {Set<string>} 正在启动首轮的会话 id，避免并发调用重复发起 */
  const engaging = new Set()

  /**
   * 确保协调者会话跑过至少一轮。
   *
   * 幂等：会话已经跑过一轮就直接返回，不重复发起。
   *
   * @param {object} input - 入参
   * @param {string} input.sessionId - 协调者会话 id
   * @param {string} input.name - 项目名
   * @param {string} input.directory - 项目目录
   * @returns {Promise<{engaged: boolean, reason?: string}>} 结果
   */
  async function engage({ sessionId, name, directory }) {
    if (engaging.has(sessionId)) return { engaged: false, reason: '协调者首轮正在启动。' }
    engaging.add(sessionId)
    try {
      let blank
      try {
        blank = await readSessionBlank(ctx, sessionId)
      } catch (error) {
        const reason = `读会话状态失败：${error instanceof Error ? error.message : String(error)}`
        logger(`dsh-coordinator: ${reason}`)
        return { engaged: false, reason }
      }
      if (blank === false) return { engaged: true }

      let agent
      try {
        agent = await resolveSessionAgent(ctx, sessionId)
      } catch (error) {
        const reason = `取协调者会话失败：${error instanceof Error ? error.message : String(error)}`
        logger(`dsh-coordinator: ${reason}`)
        return { engaged: false, reason }
      }
      if (agent === undefined) {
        const reason = '协调者会话当前不可达。'
        logger(`dsh-coordinator: ${reason}`)
        return { engaged: false, reason }
      }

      const brief = buildEngagementBrief({ name, directory })
      try {
        agent.followup(createUserMessage([{ type: 'text', text: brief }]))
      } catch (error) {
        const reason = `启动协调者首轮失败：${error instanceof Error ? error.message : String(error)}`
        logger(`dsh-coordinator: ${reason}`)
        return { engaged: false, reason }
      }
      return { engaged: true }
    } finally {
      engaging.delete(sessionId)
    }
  }

  return { engage }
}
