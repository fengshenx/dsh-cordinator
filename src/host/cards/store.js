/**
 * 任务看板卡片的落盘存储。
 *
 * 卡片是任务管理单元（会话是执行单元）：标题、规格、状态、链接、槽位绑定与检查点
 * 都落盘；信号灯（等你/需注意/推进/停滞）不落盘，由看板按名下会话状态纯投影。
 *
 * 三条领域规则来自 Telov 的任务看板，迁移时必须保持：
 *
 * - **编号不复用**：卡片编号全局递增，归档或删除都不回收，用户可用 `@#n` 引用。
 * - **乐观并发**：更新必须带 `expectedRevision`，版本不符即冲突，不落盘。
 * - **archived 是终态**：归档后不可再改；`active ⇄ done` 可逆。
 *
 * 落盘位置在 dsh home 下的自有目录，不占用 session 事件流——仓外插件不得新增
 * session event 类型。
 *
 * @module dsh-coordinator/host/cards/store
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const STORE_VERSION = 1

/**
 * 卡片状态的合法取值。
 * @type {readonly ['active', 'done', 'archived']}
 */
export const CARD_STATUSES = Object.freeze(['active', 'done', 'archived'])

/**
 * 读取卡片库；文件缺失返回空库。
 * @param {string} file - 卡片库文件路径
 * @param {() => Promise<void>} [onCorrupt] - 库损坏且已备份后的补救动作
 * @returns {Promise<{ version: number, counter: number, cards: object[] }>} 卡片库快照
 */
async function readStore(file, onCorrupt) {
  const raw = await readFile(file, 'utf8').catch(() => undefined)
  if (raw === undefined) return { version: STORE_VERSION, counter: 0, cards: [] }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) {
      throw new Error('卡片库结构非法：缺少 cards 数组')
    }
    const counter = Number.isInteger(parsed.counter) && parsed.counter >= 0 ? parsed.counter : 0
    return { version: STORE_VERSION, counter, cards: parsed.cards }
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`
    await rename(file, backup).catch(() => undefined)
    // 备份后必须写回空库：否则存储文件就此消失，下次启动连"库是空的"都读不出来。
    await onCorrupt?.()
    return { version: STORE_VERSION, counter: 0, cards: [] }
  }
}

/**
 * 创建卡片存储。
 *
 * @param {object} options - 选项
 * @param {string} options.home - dsh home 目录
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @returns {object} 卡片存储接口
 */
export function createCardStore({ home, logger = () => {} } = {}) {
  const directory = join(home, 'dsh-coordinator')
  const file = join(directory, 'cards.json')
  const temporary = join(directory, 'cards.json.tmp')

  /** 所有写操作的串行链，保证读-改-写不交错。 */
  let tail = Promise.resolve()

  /**
   * 原子写回卡片库。
   * @param {{ version: number, counter: number, cards: object[] }} store - 卡片库快照
   * @returns {Promise<void>} 写盘完成
   */
  async function writeStore(store) {
    await mkdir(directory, { recursive: true })
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }

  /**
   * 库损坏后的补救：写回空库，避免存储文件就此消失。
   * @returns {Promise<void>} 写盘完成
   */
  async function recoverFromCorruption() {
    await writeStore({ version: STORE_VERSION, counter: 0, cards: [] })
  }

  /**
   * 串行执行写操作。
   * @template T
   * @param {() => Promise<T>} operation - 写操作
   * @returns {Promise<T>} 操作结果
   */
  function serialize(operation) {
    const run = tail.then(operation, operation)
    tail = run.then(() => undefined, () => undefined)
    return run
  }

  return {
    directory,
    file,

    /**
     * 建卡。编号在此分配，之后永不复用。
     * @param {object} input - 建卡输入
     * @param {string} input.title - 任务标题
     * @param {string} [input.spec] - 任务规格
     * @param {object[]} [input.links] - 链接条目
     * @param {object} [input.slots] - 槽位绑定
     * @param {object} [input.checkpoint] - 检查点（维护者与时间由宿主补写）
     * @param {string} [input.updatedBy] - 维护者会话 id
     * @returns {Promise<object>} 新建的卡片
     */
    async create({ title, spec, links, slots, checkpoint, updatedBy }) {
      return serialize(async () => {
        const store = await readStore(file, recoverFromCorruption)
        const now = Date.now()
        const card = {
          id: randomUUID(),
          number: store.counter + 1,
          revision: 0,
          title,
          ...spec === undefined ? {} : { spec },
          status: 'active',
          ...links === undefined ? {} : { links },
          ...slots === undefined ? {} : { slots },
          ...checkpoint === undefined
            ? {}
            : { checkpoint: withCheckpointMeta(checkpoint, updatedBy, now) },
          createdAt: now,
          updatedAt: now,
        }
        store.counter = card.number
        store.cards.push(card)
        await writeStore(store)
        return card
      })
    },

    /**
     * 改卡。带 `expectedRevision` 时做乐观并发校验。
     * @param {object} input - 改卡输入
     * @param {string} input.id - 卡片 id
     * @param {number} [input.expectedRevision] - 期望的内容版本
     * @param {string} [input.title] - 新标题
     * @param {string} [input.spec] - 新规格
     * @param {string} [input.status] - 新状态
     * @param {object[]} [input.links] - 新链接条目
     * @param {object} [input.slots] - 新槽位绑定
     * @param {object} [input.checkpoint] - 新检查点
     * @param {number} [input.sortOrder] - 手动排序序号
     * @param {string} [input.updatedBy] - 维护者会话 id
     * @returns {Promise<object>} 更新后的卡片
     */
    async update({
      id,
      expectedRevision,
      title,
      spec,
      status,
      links,
      slots,
      checkpoint,
      sortOrder,
      updatedBy,
    }) {
      return serialize(async () => {
        const store = await readStore(file, recoverFromCorruption)
        const card = store.cards.find((item) => item.id === id)
        if (card === undefined) throw new Error(`卡片不存在：${id}`)
        const current = card.revision ?? 0
        if (expectedRevision !== undefined && expectedRevision !== current) {
          throw new Error(
            `卡片版本冲突：期望 ${expectedRevision}，当前 ${current}；请重新读取卡片后判断`,
          )
        }
        if (card.status === 'archived') {
          throw new Error(`卡片 ${id} 已归档，归档是终态，不可再改`)
        }
        if (status !== undefined && !CARD_STATUSES.includes(status)) {
          throw new Error(`卡片状态非法：${String(status)}`)
        }
        const now = Date.now()
        const next = { ...card }
        if (title !== undefined) next.title = title
        if (spec !== undefined) next.spec = spec
        if (links !== undefined) next.links = links
        if (slots !== undefined) next.slots = slots
        if (sortOrder !== undefined) next.sortOrder = sortOrder
        if (checkpoint !== undefined) {
          next.checkpoint = withCheckpointMeta(checkpoint, updatedBy, now)
        }
        if (status !== undefined && status !== card.status) {
          next.status = status
          if (status === 'done') next.doneAt = now
          if (status === 'active') delete next.doneAt
        }
        next.revision = current + 1
        next.updatedAt = now
        store.cards[store.cards.indexOf(card)] = next
        await writeStore(store)
        return next
      })
    },

    /**
     * 读单张卡片。
     * @param {string} id - 卡片 id
     * @returns {Promise<object | undefined>} 卡片，不存在时 undefined
     */
    async get(id) {
      const store = await readStore(file, recoverFromCorruption)
      return store.cards.find((item) => item.id === id)
    },

    /**
     * 列出卡片，按编号升序。
     * @param {object} [filter] - 过滤条件
     * @param {string} [filter.status] - 只返回该状态的卡片
     * @returns {Promise<object[]>} 卡片列表
     */
    async list({ status } = {}) {
      const store = await readStore(file, recoverFromCorruption)
      const cards = [...store.cards].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
      return status === undefined ? cards : cards.filter((card) => card.status === status)
    },
  }
}

/**
 * 补齐检查点的维护者与确认时间。调用方只能提供事实部分。
 * @param {object} checkpoint - 检查点事实
 * @param {string | undefined} updatedBy - 维护者会话 id
 * @param {number} updatedAt - 确认时间
 * @returns {object} 完整检查点
 */
function withCheckpointMeta(checkpoint, updatedBy, updatedAt) {
  return {
    summary: checkpoint.summary ?? '',
    nextAction: checkpoint.nextAction ?? '',
    ...checkpoint.blocker === undefined ? {} : { blocker: checkpoint.blocker },
    ...checkpoint.outputVersion === undefined ? {} : { outputVersion: checkpoint.outputVersion },
    updatedBy: updatedBy ?? '',
    updatedAt,
  }
}
