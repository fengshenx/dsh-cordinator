import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCardStore } from '../src/host/cards/store.js'
import {
  createCreateCardTool,
  createUpdateCardTool,
  createListCardsTool,
} from '../src/host/tools/cards.js'

/**
 * 建一组卡片工具与它们共用的存储。
 * @returns {Promise<{ home: string, tools: Record<string, object> }>} 工具集与 home 目录
 */
async function createTools() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-coordinator-cardtools-'))
  const store = createCardStore({ home })
  return {
    home,
    tools: {
      create_card: createCreateCardTool({ store }),
      update_card: createUpdateCardTool({ store }),
      list_cards: createListCardsTool({ store }),
    },
  }
}

/** 假的执行上下文：只需 agent 与 signal。 */
const exec = { agent: { id: 'session-1' }, signal: undefined }

test('建卡工具返回完整卡片，模型视图是简短确认', async () => {
  const { home, tools } = await createTools()
  try {
    const result = await tools.create_card.execute(
      { title: '实现派工', spec: '验收：能派工并回报' },
      exec,
    )
    assert.equal(result.card.title, '实现派工')
    assert.equal(result.card.number, 1)
    assert.equal(result.card.revision, 0)
    assert.equal(result.card.status, 'active')
    const rendered = tools.create_card.output.render({}, result)
    assert.match(rendered[0].text, /已建卡 #1「实现派工」/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('建卡工具拒绝空标题', async () => {
  const { home, tools } = await createTools()
  try {
    await assert.rejects(() => tools.create_card.execute({ title: '  ' }, exec), /title 不能为空/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('建卡工具补齐链接条目 id', async () => {
  const { home, tools } = await createTools()
  try {
    const result = await tools.create_card.execute(
      { title: '任务', links: [{ label: 'MR', url: 'https://example.test/mr/1' }] },
      exec,
    )
    assert.equal(result.card.links.length, 1)
    assert.equal(typeof result.card.links[0].id, 'string')
    assert.equal(result.card.links[0].label, 'MR')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('改卡工具透传版本校验，冲突时报错', async () => {
  const { home, tools } = await createTools()
  try {
    const created = await tools.create_card.execute({ title: '任务' }, exec)
    const updated = await tools.update_card.execute(
      { id: created.card.id, status: 'done', expectedRevision: 0 },
      exec,
    )
    assert.equal(updated.card.status, 'done')
    assert.equal(updated.card.revision, 1)
    await assert.rejects(
      () => tools.update_card.execute(
        { id: created.card.id, title: 'x', expectedRevision: 0 },
        exec,
      ),
      /版本冲突/,
    )
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('改卡工具拒绝空 id', async () => {
  const { home, tools } = await createTools()
  try {
    await assert.rejects(() => tools.update_card.execute({ id: '' }, exec), /id 不能为空/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('查卡工具默认不含归档卡，显式要求时返回', async () => {
  const { home, tools } = await createTools()
  try {
    const created = await tools.create_card.execute({ title: '任务' }, exec)
    await tools.update_card.execute({ id: created.card.id, status: 'archived' }, exec)
    const listed = await tools.list_cards.execute({}, exec)
    assert.equal(listed.cards.length, 0)
    assert.match(tools.list_cards.output.render({}, listed)[0].text, /当前没有任务卡片/)
    const withArchived = await tools.list_cards.execute({ includeArchived: true }, exec)
    assert.equal(withArchived.cards.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('查卡工具按状态过滤，模型视图列出编号与标题', async () => {
  const { home, tools } = await createTools()
  try {
    await tools.create_card.execute({ title: '一' }, exec)
    await tools.create_card.execute({ title: '二' }, exec)
    const listed = await tools.list_cards.execute({}, exec)
    assert.equal(listed.cards.length, 2)
    const rendered = tools.list_cards.output.render({}, listed)[0].text
    assert.match(rendered, /#1 一（active）/)
    assert.match(rendered, /#2 二（active）/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('卡片数据投影到 presentationMeta，客户端据此重建看板', async () => {
  const { home, tools } = await createTools()
  try {
    const created = await tools.create_card.execute({ title: '任务' }, exec)
    const single = tools.create_card.output.presentationMeta({}, created)
    assert.equal(single.kind, 'dsh-coordinator-cards')
    assert.equal(single.scope, 'card')
    assert.equal(single.cards[0].title, '任务')
    const listed = await tools.list_cards.execute({}, exec)
    const all = tools.list_cards.output.presentationMeta({}, listed)
    assert.equal(all.scope, 'all')
    assert.equal(all.cards.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
