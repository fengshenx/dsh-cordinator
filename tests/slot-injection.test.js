import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ROLE_CONTEXT_NAME,
  ROLE_CONTEXT_ORDER,
  applyRoleContext,
} from '../src/host/slots/index.js'
import { SLOT_TEMPLATE_FILE } from '../src/host/slots/slot-templates.js'

/**
 * 建一个假的服务上下文，捕获注册进来的运行时上下文。
 *
 * @returns {{ ctx: object, holder: { registered: object | undefined } }} 上下文与注册项持有者
 */
function createFakeCtx() {
  const holder = { registered: undefined }
  const ctx = {
    systemPrompt: {
      context(definition) {
        holder.registered = definition
        return () => {}
      },
    },
    effect(fn) {
      fn()
      return () => {}
    },
  }
  return { ctx, holder }
}

/**
 * 以给定组装上下文求值注册项的正文。
 *
 * @param {object} registered - 注册项
 * @param {object} assembleContext - 组装上下文
 * @returns {string} 正文
 */
function render(registered, assembleContext) {
  return registered.text(assembleContext)
}

test('注册为运行时上下文，标记为必需且按字面量处理', () => {
  const { ctx, holder } = createFakeCtx()
  applyRoleContext({ ctx, slotIndex: new Map(), resolveCwd: () => undefined })
  assert.equal(holder.registered.name, ROLE_CONTEXT_NAME)
  assert.equal(holder.registered.order, ROLE_CONTEXT_ORDER)
  assert.equal(holder.registered.required, true)
  assert.equal(holder.registered.interpolate, false)
})

test('组装上下文没有会话时正文为空串', () => {
  const { ctx, holder } = createFakeCtx()
  applyRoleContext({ ctx, slotIndex: new Map(), resolveCwd: () => undefined })
  assert.equal(render(holder.registered, {}), '')
})

test('绑定了槽位的会话渲染出角色正文', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-coordinator-inject-'))
  try {
    await writeFile(join(directory, SLOT_TEMPLATE_FILE), '## dev\n你是实现者。\n', 'utf8')
    const { ctx, holder } = createFakeCtx()
    applyRoleContext({
      ctx,
      slotIndex: new Map([['session-a', 'dev']]),
      resolveCwd: () => directory,
    })
    const text = render(holder.registered, { agent: { id: 'session-a' } })
    assert.match(text, /你是实现者。/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('会话头里的目录优先于外部取目录的回调', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-coordinator-inject-'))
  try {
    await writeFile(join(directory, SLOT_TEMPLATE_FILE), '## dev\n来自会话头。\n', 'utf8')
    const { ctx, holder } = createFakeCtx()
    applyRoleContext({
      ctx,
      slotIndex: new Map([['session-a', 'dev']]),
      resolveCwd: () => undefined,
    })
    const text = render(holder.registered, {
      agent: { id: 'session-a', session: { header: { cwd: directory } } },
    })
    assert.match(text, /来自会话头。/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('渲染出错时返回空串，不把错误抛给组装流程', () => {
  const { ctx, holder } = createFakeCtx()
  applyRoleContext({
    ctx,
    slotIndex: new Map([['session-a', 'dev']]),
    resolveCwd: () => {
      throw new Error('目录不可用')
    },
  })
  assert.equal(render(holder.registered, { agent: { id: 'session-a' } }), '')
})
