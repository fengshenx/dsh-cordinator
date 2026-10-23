/**
 * 任务看板卡片工具：`create_card`、`update_card`、`list_cards`。
 *
 * 卡片是协调者维护的任务事实：标题、规格、状态、链接、槽位绑定与检查点。看板 UI
 * 从工具的结构化输出重建卡片列表，因此工具返回完整卡片对象；模型看到的是
 * `render` 给出的简短确认，不需要读全量卡片。
 *
 * 检查点的维护者与确认时间由宿主写入，调用方只能提供事实部分。
 *
 * @module dsh-coordinator/host/tools/cards
 */

import { randomUUID } from 'node:crypto'

/**
 * 链接条目的 JSON Schema。
 * @returns {object} schema
 */
function linkSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      url: { type: 'string' },
      purpose: { type: 'string' },
    },
    required: ['label'],
  }
}

/**
 * 检查点事实的 JSON Schema。
 * @returns {object} schema
 */
function checkpointSchema() {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      nextAction: { type: 'string' },
      blocker: { type: 'string' },
      outputVersion: { type: 'string' },
    },
    required: ['summary'],
  }
}

/**
 * 槽位绑定的 JSON Schema。
 * @returns {object} schema
 */
function slotsSchema() {
  return {
    type: 'object',
    properties: {
      dev: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
      review: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId'],
      },
    },
  }
}

/**
 * 完整卡片的 JSON Schema——客户端按它重建看板。
 * @returns {object} schema
 */
function cardSchema() {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      number: { type: 'number' },
      revision: { type: 'number' },
      title: { type: 'string' },
      spec: { type: 'string' },
      status: { type: 'string', enum: ['active', 'done', 'archived'] },
      links: { type: 'array', items: linkSchema() },
      slots: slotsSchema(),
      checkpoint: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          nextAction: { type: 'string' },
          blocker: { type: 'string' },
          outputVersion: { type: 'string' },
          updatedBy: { type: 'string' },
          updatedAt: { type: 'number' },
        },
      },
      sortOrder: { type: 'number' },
      doneAt: { type: 'number' },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
    },
    required: ['id', 'number', 'revision', 'title', 'status', 'createdAt', 'updatedAt'],
  }
}

/**
 * 规范化链接条目，补齐条目 id。
 * @param {object[]} links - 原始链接条目
 * @returns {object[]} 规范化后的链接条目
 */
function normalizeLinks(links) {
  return links.map((link) => ({
    id: typeof link.id === 'string' && link.id !== '' ? link.id : randomUUID(),
    label: link.label,
    ...link.url === undefined ? {} : { url: link.url },
    ...link.purpose === undefined ? {} : { purpose: link.purpose },
  }))
}

/**
 * 创建 `create_card` 工具定义。
 * @param {object} options - 工具选项
 * @param {{ create: (input: object) => Promise<object> }} options.store - 卡片存储
 * @returns {object} dsh 工具定义
 */
export function createCreateCardTool({ store }) {
  return {
    name: 'create_card',
    description:
      '建立一张任务看板卡片。卡片是协调者维护的任务事实，编号自动分配且永不复用，可用返回的 number 引用。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题，一句话说清要做什么。' },
        spec: {
          type: 'string',
          description: '任务规格：任务简报与验收标准。协调者验收判断与 worker 防漂移的锚点。',
        },
        links: {
          type: 'array',
          items: linkSchema(),
          description: '外部引用条目（MR、Issue、设计文档等）。',
        },
        slots: {
          ...slotsSchema(),
          description: '槽位绑定：把执行或评审会话挂到卡片上。',
        },
        checkpoint: {
          ...checkpointSchema(),
          description: '当前任务事实：已确认的结论与下一步动作。',
        },
      },
      required: ['title'],
    },
    output: {
      schema: { type: 'object', properties: { card: cardSchema() }, required: ['card'] },
      render(args, value) {
        const card = /** @type {{ card: { number: number, title: string } }} */ (value).card
        return [
          {
            type: 'text',
            text: `已建卡 #${card.number}「${card.title}」。`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const input = /** @type {{ title: string, spec?: string, links?: object[], slots?: object, checkpoint?: object }} */ (args)
      if (typeof input.title !== 'string' || input.title.trim() === '') {
        throw new Error('create_card: title 不能为空')
      }
      const card = await store.create({
        title: input.title.trim(),
        ...input.spec === undefined ? {} : { spec: input.spec },
        ...input.links === undefined ? {} : { links: normalizeLinks(input.links) },
        ...input.slots === undefined ? {} : { slots: input.slots },
        ...input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint },
        updatedBy: exec.agent?.id,
      })
      return { card }
    },
  }
}

/**
 * 创建 `update_card` 工具定义。
 * @param {object} options - 工具选项
 * @param {{ update: (input: object) => Promise<object> }} options.store - 卡片存储
 * @returns {object} dsh 工具定义
 */
export function createUpdateCardTool({ store }) {
  return {
    name: 'update_card',
    description:
      '更新一张任务看板卡片。带 expectedRevision 时做乐观并发校验，版本不符即报错，需重新读卡再改。归档是终态，不能再改。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '卡片 id（建卡时返回）。' },
        expectedRevision: {
          type: 'number',
          description: '期望的内容版本，来自上一次读到的 revision。',
        },
        title: { type: 'string', description: '新标题。' },
        spec: { type: 'string', description: '新规格。' },
        status: {
          type: 'string',
          enum: ['active', 'done', 'archived'],
          description: '新状态。active 与 done 可逆，archived 是终态。',
        },
        links: { type: 'array', items: linkSchema(), description: '新的链接条目（整体替换）。' },
        slots: { ...slotsSchema(), description: '新的槽位绑定（整体替换）。' },
        checkpoint: {
          ...checkpointSchema(),
          description: '新的任务事实。维护者与确认时间由宿主写入。',
        },
        sortOrder: { type: 'number', description: '手动排序序号（小的在前）。' },
      },
      required: ['id'],
    },
    output: {
      schema: { type: 'object', properties: { card: cardSchema() }, required: ['card'] },
      render(args, value) {
        const card = /** @type {{ card: { number: number, title: string, status: string } }} */ (value).card
        return [
          {
            type: 'text',
            text: `已更新卡片 #${card.number}「${card.title}」，状态 ${card.status}。`,
          },
        ]
      },
    },
    async execute(args, exec) {
      const input = /** @type {{ id: string, expectedRevision?: number, title?: string, spec?: string, status?: string, links?: object[], slots?: object, checkpoint?: object, sortOrder?: number }} */ (args)
      if (typeof input.id !== 'string' || input.id.trim() === '') {
        throw new Error('update_card: id 不能为空')
      }
      const card = await store.update({
        id: input.id.trim(),
        ...input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision },
        ...input.title === undefined ? {} : { title: input.title.trim() },
        ...input.spec === undefined ? {} : { spec: input.spec },
        ...input.status === undefined ? {} : { status: input.status },
        ...input.links === undefined ? {} : { links: normalizeLinks(input.links) },
        ...input.slots === undefined ? {} : { slots: input.slots },
        ...input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint },
        ...input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder },
        updatedBy: exec.agent?.id,
      })
      return { card }
    },
  }
}

/**
 * 创建 `list_cards` 工具定义。
 * @param {object} options - 工具选项
 * @param {{ list: (filter: object) => Promise<object[]> }} options.store - 卡片存储
 * @returns {object} dsh 工具定义
 */
export function createListCardsTool({ store }) {
  return {
    name: 'list_cards',
    description:
      '列出任务看板卡片，按编号升序。默认只返回未归档的卡片；需要看归档卡时传 includeArchived。',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'done', 'archived'],
          description: '只返回该状态的卡片。不传则返回全部未归档卡片。',
        },
        includeArchived: {
          type: 'boolean',
          description: '连同归档卡一起返回。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: { cards: { type: 'array', items: cardSchema() } },
        required: ['cards'],
      },
      render(args, value) {
        const cards = /** @type {{ cards: { number: number, title: string, status: string }[] }} */ (value).cards
        if (cards.length === 0) return [{ type: 'text', text: '当前没有任务卡片。' }]
        const lines = cards.map(
          (card) => `#${card.number} ${card.title}（${card.status}）`,
        )
        return [{ type: 'text', text: `共 ${cards.length} 张卡片：\n${lines.join('\n')}` }]
      },
    },
    async execute(args) {
      const input = /** @type {{ status?: string, includeArchived?: boolean }} */ (args)
      const all = await store.list(
        input.status === undefined ? {} : { status: input.status },
      )
      const cards = input.includeArchived === true
        ? all
        : all.filter((card) => card.status !== 'archived')
      return { cards }
    },
  }
}
