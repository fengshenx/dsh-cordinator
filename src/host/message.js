/**
 * 本地构造 dsh 的用户消息。
 *
 * dsh 的 `createUserMessage` 在 `@deepseek-ai/dsh-llm` 里，属于 dsh 内部包。本 bundle
 * 刻意不 peer 依赖任何 dsh 内部包（宿主版本漂移会让带 peer 的 bundle 周期性失效），
 * 因此按 dsh 的消息契约就地构造等价对象：`id` 是随机 UUID，`source` 取
 * `{ kind: 'user' }`。
 *
 * @module dsh-coordinator/host/message
 */

import { randomUUID } from 'node:crypto'

/**
 * 构造一条 dsh 用户消息。
 * @param {Array<{ type: string, [key: string]: unknown }>} content - 模型可见内容块
 * @returns {{ id: string, role: 'user', content: unknown[], source: { kind: 'user' } }} 消息
 */
export function createUserMessage(content) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content,
    source: { kind: 'user' },
  })
}

/**
 * 把内容块数组折成纯文本，供通知正文与落盘记录共用。
 * @param {Array<{ type?: string, text?: string }>} blocks - 内容块数组
 * @returns {string} 拼接后的文本
 */
export function blocksToText(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
