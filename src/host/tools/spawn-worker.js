/**
 * `spawn_worker` 工具：把任务派给一个后台 worker。
 *
 * 派工立即返回，worker 在子会话里继续跑；worker 结束时由派工与唤醒器
 * （`src/host/dispatch.js`）构造完成通知并唤醒协调者会话。因此本工具不等待结果，
 * 协调者可以在同一轮里连派多个工。
 *
 * @module dsh-coordinator/host/tools/spawn-worker
 */

/**
 * 创建 `spawn_worker` 工具定义。
 * @param {object} options - 工具选项
 * @param {{ dispatch: (input: object) => Promise<object> }} options.dispatcher - 派工器
 * @returns {object} dsh 工具定义
 */
export function createSpawnWorkerTool({ dispatcher }) {
  return {
    name: 'spawn_worker',
    description:
      '把一个独立任务派给后台 worker。工具立即返回 worker 的子会话 id，不等待结果；worker 结束后会自动唤醒你并附上完成通知与产物摘要。适合并行派多个工。',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '交给 worker 的完整任务正文：要做什么、改哪些文件、验收标准是什么。',
        },
        label: {
          type: 'string',
          description: '任务短标签，用于在完成通知里标识这项工。',
        },
      },
      required: ['task'],
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
        return [
          {
            type: 'text',
            text: `已派工「${result.label ?? result.childId}」，子会话 ${result.childId}。worker 结束后会自动回报，无需轮询。`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const input = /** @type {{ task: string, label?: string }} */ (args)
      if (typeof input.task !== 'string' || input.task.trim() === '') {
        throw new Error('spawn_worker: task 不能为空')
      }
      // 入参 schema 在运行时不生效：label 传非字符串会被静默换成 task 前缀，
      // 任务标识与调用方以为的不一致。
      if (input.label !== undefined && typeof input.label !== 'string') {
        throw new Error('spawn_worker: label 必须是字符串')
      }
      const parent = exec.agent
      if (parent === undefined) {
        throw new Error('spawn_worker: 需要调用方 agent 才能派工')
      }
      const label = typeof input.label === 'string' && input.label.trim() !== ''
        ? input.label.trim()
        : input.task.slice(0, 40)
      const record = await dispatcher.dispatch({
        parent,
        task: input.task,
        label,
        signal: exec.signal,
      })
      return { childId: record.childId, label: record.label, status: 'dispatched' }
    },
  }
}
