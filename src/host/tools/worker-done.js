/**
 * `worker_done` 工具：worker 收尾时向协调者交作业。
 *
 * 换成根会话后，宿主不再有 `activation.result` 那种终态 promise，也没有给第三方
 * 留「读最后一轮产出」的稳定 API（`Session.snapshotEvents` 已标废弃）。所以产出由
 * worker 自己在收尾时报——这与宿主的完成回调等价，且谁调的、报了什么都在会话里。
 *
 * 只有 worker 会话能看到这个工具：协调者与普通会话调它没有意义，只会制造一条
 * 指向不存在的派工记录的空回报。
 *
 * @module dsh-coordinator/host/tools/worker-done
 */

/**
 * 创建 `worker_done` 工具定义。
 * @param {object} options - 工具选项
 * @param {{ reportDone: (input: object) => Promise<boolean> }} options.dispatcher - 派工器
 * @returns {object} dsh 工具定义
 */
export function createWorkerDoneTool({ dispatcher }) {
  return {
    name: 'worker_done',
    description:
      '收尾时调用：把这一轮的产物摘要（或失败原因）交给协调者，它会被自动唤醒。派工与续聊的每一轮都要调一次，否则协调者收不到回报、只能干等。人直接找你聊的那一轮不用调。',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: '产物摘要：做了什么、改了哪些文件、验证结果、遗留问题。协调者据此验收。',
        },
        outcome: {
          type: 'string',
          enum: ['completed', 'failed'],
          description: '终态：做成了 completed（默认），没做成 failed。',
        },
      },
      required: ['summary'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          acknowledged: { type: 'boolean' },
        },
        required: ['acknowledged'],
      },
      render(args, value) {
        const result = /** @type {{ acknowledged: boolean }} */ (value)
        return [
          {
            type: 'text',
            text: result.acknowledged
              ? '已回报协调者，它会自动被唤醒。'
              : '当前没有在飞的派工记录可结算（协调者已经收到过这一轮的回报，或这一轮不是它派的）。',
          },
        ]
      },
    },
    async execute(args, exec) {
      const input = /** @type {{ summary?: unknown, outcome?: unknown }} */ (args)
      if (typeof input.summary !== 'string' || input.summary.trim() === '') {
        throw new Error('worker_done: summary 不能为空')
      }
      if (input.outcome !== undefined && input.outcome !== 'completed' && input.outcome !== 'failed') {
        throw new Error('worker_done: outcome 只能是 completed 或 failed')
      }
      const sessionId = exec.agent?.id
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('worker_done: 需要调用方会话才能交付回报')
      }
      const acknowledged = await dispatcher.reportDone({
        sessionId,
        summary: input.summary,
        outcome: input.outcome ?? 'completed',
      })
      return { acknowledged }
    },
  }
}
