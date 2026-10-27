/**
 * worker 登记表：协调者派过的工在这里留档。
 *
 * **为什么需要落盘**：给 worker 发消息（`message_worker`）必须知道子会话 id 与
 * 它的父会话。子会话跑完一轮就被宿主销毁（`manager.ts` 的 `finishDisposal`），
 * 进程内的映射随之失效；进程重启更是全丢。登记表落盘，续聊与查工才跨得过去。
 *
 * **登记表不是派工真源**：派工真源是宿主的 subagent 服务（子会话与它的持久化
 * 日志）。这里存的是「这个子会话是本 bundle 派出去的工」这一层归属，以及续聊
 * 需要的父会话 id——宿主那边不存这层，插件这边也不重复存子会话内容。
 *
 * 落盘位置在 dsh home 下的自有目录，与通知队列同构（原子写 + 串行化读改写）。
 *
 * @module dsh-coordinator/host/worker-registry
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REGISTRY_VERSION = 1

/**
 * 创建 worker 登记表。
 *
 * @param {object} options - 选项
 * @param {string} [options.home] - dsh home 目录
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @returns {object} 登记表接口
 */
export function createWorkerRegistry({ home, logger = () => {} } = {}) {
  const directory = join(home, 'dsh-coordinator')
  const file = join(directory, 'workers.json')
  const temporary = join(directory, 'workers.json.tmp')

  /** 读改写串行链：多个 worker 同时登记或更新时不能互相覆盖。 */
  let tail = Promise.resolve()

  /**
   * 读取登记表；文件缺失或损坏返回空表。
   * @returns {Promise<{ version: number, workers: object[] }>} 登记表快照
   */
  async function read() {
    const raw = await readFile(file, 'utf8').catch(() => undefined)
    if (raw === undefined) return { version: REGISTRY_VERSION, workers: [] }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.workers)) {
        throw new Error('worker 登记表结构非法：缺少 workers 数组')
      }
      return { version: REGISTRY_VERSION, workers: parsed.workers }
    } catch (error) {
      const backup = `${file}.corrupt-${Date.now()}`
      await rename(file, backup).catch(() => undefined)
      logger(`worker 登记表损坏，已备份到 ${backup}：${error instanceof Error ? error.message : String(error)}`)
      return { version: REGISTRY_VERSION, workers: [] }
    }
  }

  /**
   * 原子写回登记表。
   * @param {{ version: number, workers: object[] }} registry - 登记表快照
   * @returns {Promise<void>} 写盘完成
   */
  async function write(registry) {
    await mkdir(directory, { recursive: true })
    await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }

  /**
   * 串行执行一次读改写。
   * @template T
   * @param {(registry: { version: number, workers: object[] }) => Promise<T> | T} mutate - 变更函数
   * @returns {Promise<T>} 变更结果
   */
  function serialize(mutate) {
    const result = tail.then(async () => {
      const registry = await read()
      const value = await mutate(registry)
      await write(registry)
      return value
    })
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    /**
     * 登记一个派出去的 worker。
     *
     * @param {object} worker - worker 记录
     * @param {string} worker.childId - 子会话 id
     * @param {string} worker.parentSessionId - 父会话 id
     * @param {string} worker.label - 任务标签
     * @param {string} [worker.task] - 任务正文
     * @param {string} [worker.projectId] - 所属项目 id
     * @returns {Promise<object>} 登记后的记录
     */
    async register(worker) {
      return serialize((registry) => {
        const existing = registry.workers.find((item) => item.childId === worker.childId)
        // 同一子会话重复登记时更新而非追加：续聊会再次登记，不更新就会出现两条
        // 同 id 的记录，查工时不知道该用哪条。
        if (existing !== undefined) {
          Object.assign(existing, worker)
          return existing
        }
        const record = { ...worker, registeredAt: Date.now() }
        registry.workers.push(record)
        return record
      })
    },

    /**
     * 更新一个 worker 的状态字段。
     *
     * @param {string} childId - 子会话 id
     * @param {object} patch - 要更新的字段
     * @returns {Promise<object | undefined>} 更新后的记录；没有这条记录时 undefined
     */
    async update(childId, patch) {
      return serialize((registry) => {
        const record = registry.workers.find((item) => item.childId === childId)
        if (record === undefined) return undefined
        Object.assign(record, patch, { updatedAt: Date.now() })
        return record
      })
    },

    /**
     * 取一个 worker 记录。
     *
     * @param {string} childId - 子会话 id
     * @returns {Promise<object | undefined>} 记录；没有时 undefined
     */
    async get(childId) {
      const registry = await read()
      return registry.workers.find((item) => item.childId === childId)
    },

    /**
     * 列某个父会话的 worker，按登记时间倒序。
     *
     * @param {string} parentSessionId - 父会话 id
     * @returns {Promise<object[]>} worker 记录
     */
    async listByParent(parentSessionId) {
      const registry = await read()
      return registry.workers
        .filter((item) => item.parentSessionId === parentSessionId)
        .sort((left, right) => (right.registeredAt ?? 0) - (left.registeredAt ?? 0))
    },

    /**
     * 列某个项目的 worker。
     *
     * @param {string} projectId - 项目 id
     * @returns {Promise<object[]>} worker 记录
     */
    async listByProject(projectId) {
      const registry = await read()
      return registry.workers
        .filter((item) => item.projectId === projectId)
        .sort((left, right) => (right.registeredAt ?? 0) - (left.registeredAt ?? 0))
    },
  }
}
