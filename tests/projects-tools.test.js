import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createListProjectsTool, createSwitchProjectTool } from '../src/host/tools/projects.js'

/**
 * 造一个假的 Cordis 上下文。
 *
 * @param {object} options - 选项
 * @param {object[] | undefined} options.records - 持久化会话语料
 * @param {object[] | undefined} options.live - 进程内 live session
 * @returns {object} 上下文
 */
function createContext({ records, live = [] } = {}) {
  return {
    get(name) {
      if (name === 'sessionQuery' && records !== undefined) {
        return { listSessions: async () => records }
      }
      return undefined
    },
    sessions: {
      list: () => live,
    },
  }
}

/**
 * 造一条会话记录。
 *
 * @param {string} id - 会话 id
 * @param {string} cwd - 工作目录
 * @param {object} [extra] - 额外字段
 * @returns {object} 会话记录
 */
function record(id, cwd, extra = {}) {
  return {
    header: { id, cwd, createdAt: 1000, origin: undefined },
    live: false,
    ...extra,
  }
}

test('list_projects 按工作目录去重成项目', async () => {
  const tool = createListProjectsTool({
    ctx: createContext({
      records: [
        record('s1', '/work/alpha'),
        record('s2', '/work/alpha'),
        record('s3', '/work/beta'),
      ],
    }),
  })
  const result = await tool.execute({})
  assert.equal(result.complete, true)
  assert.equal(result.projects.length, 2)
  assert.equal(result.projects[0].path, '/work/alpha')
  assert.equal(result.projects[0].name, 'alpha')
  assert.equal(result.projects[0].sessions.length, 2)
})

test('list_projects 不把子会话单列为项目', async () => {
  const tool = createListProjectsTool({
    ctx: createContext({
      records: [
        record('s1', '/work/alpha'),
        record('child', '/work/alpha', { header: { id: 'child', cwd: '/work/alpha', createdAt: 1001, origin: 'subagent' } }),
      ],
    }),
  })
  const result = await tool.execute({})
  assert.equal(result.projects.length, 1)
  assert.equal(result.projects[0].sessions.length, 1)
})

test('list_projects 在持久化语料缺失时降级为只列 live session 并标记不完整', async () => {
  const tool = createListProjectsTool({
    ctx: createContext({
      live: [{ header: { id: 'live-1', cwd: '/work/live', createdAt: 1 } }],
    }),
  })
  const result = await tool.execute({})
  assert.equal(result.complete, false)
  assert.equal(result.projects.length, 1)
  assert.equal(result.projects[0].path, '/work/live')
  assert.equal(result.projects[0].sessions[0].live, true)
})

test('switch_project 找到目标项目的协调者会话', async () => {
  const tool = createSwitchProjectTool({
    ctx: createContext({
      records: [
        record('old', '/work/alpha', { header: { id: 'old', cwd: '/work/alpha', createdAt: 1000 } }),
        record('new', '/work/alpha', { header: { id: 'new', cwd: '/work/alpha', createdAt: 2000 } }),
      ],
    }),
  })
  const result = await tool.execute({ path: '/work/alpha' })
  assert.equal(result.found, true)
  assert.equal(result.sessionId, 'new')
})

test('switch_project 在目标目录没有协调者会话时如实说明', async () => {
  const tool = createSwitchProjectTool({
    ctx: createContext({ records: [] }),
  })
  const result = await tool.execute({ path: '/work/nowhere' })
  assert.equal(result.found, false)
  assert.equal(result.sessionId, '')
  assert.equal(result.name, 'nowhere')
})

test('switch_project 拒绝空路径', async () => {
  const tool = createSwitchProjectTool({ ctx: createContext({ records: [] }) })
  await assert.rejects(() => tool.execute({ path: '  ' }), /path 不能为空/)
})
