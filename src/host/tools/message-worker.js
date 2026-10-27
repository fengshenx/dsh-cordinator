/**
 * `message_worker` 工具：给已派出的 worker 发后续消息。
 *
 * 续聊走宿主的 subagent 服务层 API（`sendMessage`）：worker 还在运行时消息并入
 * 当前执行；已结束的 worker 由宿主从持久化日志冷恢复，带着完整上下文继续跑。
 * 结束后的完成通知与第一轮同源同格式（`src/host/dispatch.js`）。
 *
 * 不复用宿主全局的 `send_message` 工具：那是 dsh 内部子会话协议，语义与派工
 * 协议不同，且名字已被占用。
 *
 * @module dsh-coordinator/host/tools/message-worker
 */

/**
 * 创建 `message_worker` 工具定义。
 * @param {object} options - 工具选项
 * @param {{ message: (input: object) => Promise<string> }} options.dispatcher - 派工器
 * @returns {object} dsh 工具定义
 */
export function createMessageWorkerTool({ dispatcher }) {
  return {
    name: 'message_worker',
    description:
      '给一个已派出的 worker 发后续消息：追问结果、补充要求或返工指示。worker 带着完整上下文继续执行，结束后会自动唤醒你并附上完成通知与产物摘要。childId 用 spawn_worker 返回的子会话 id。',
    parameters: {
      type: 'object',
      properties: {
        childId: {
          type: 'string',
          description: 'worker 的子会话 id，来自 spawn_worker 的返回值或完成通知。',
        },
        message: {
          type: 'string',
          description: '发给 worker 的消息正文，自包含、说清要它接着做什么。',
        },
      },
      required: ['childId', 'message'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          childId: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['childId', 'status'],
      },
      render(args, value) {
        const result = /** @type {{ childId: string, label?: string, status: string }} */ (value)
        if (result.status === 'merged') {
          return [
            {
              type: 'text',
              text: `worker「${result.label ?? result.childId}」仍在运行，消息已并入当前任务，随本轮执行一并回报。`,
            },
          ]
        }
        return [
          {
            type: 'text',
            text: `已把消息发给 worker「${result.label ?? result.childId}」（子会话 ${result.childId}），它恢复执行后会自动回报。`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const input = /** @type {{ childId?: unknown, message?: unknown }} */ (args)
      if (typeof input.childId !== 'string' || input.childId.trim() === '') {
        throw new Error('message_worker: childId 不能为空')
      }
      if (typeof input.message !== 'string' || input.message.trim() === '') {
        throw new Error('message_worker: message 不能为空')
      }
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('message_worker: 需要调用方 agent 才能给 worker 发消息')
      }
      const status = await dispatcher.message({
        parent,
        childId: input.childId.trim(),
        message: input.message,
        signal: exec.signal,
      })
      const label = status.label
      const code = status.code
      return { childId: input.childId.trim(), label, status: code }
    },
  }
}
