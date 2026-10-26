import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createListProjectsTool,
  createAddProjectTool,
  createSwitchProjectTool,
  createRemoveProjectTool,
} from '../src/host/tools/projects.js'

/**
 * 造一个假的项目服务。
 * @param {object[]} [projects] - 项目列表
 * @returns {object} 服务
 */
function createService(projects = []) {
  return {
    async list() {
      return projects
    },
    async create({ directory, name }) {
      return { id: 'p1', name: name ?? 'alpha', directory, coordinatorSessionId: 'session-1' }
    },
    async remove(id) {
      return projects.find((project) => project.id === id)
    },
  }
}

test('list_projects 返回注册表里的项目', async () => {
  const tool = createListProjectsTool({
    service: createService([
      { id: 'p1', name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1', coordinatorAlive: true },
    ]),
  })
  const result = await tool.execute({})
  assert.equal(result.projects.length, 1)
  assert.equal(result.projects[0].name, 'alpha')
})

test('add_project 把目录与名字交给服务', async () => {
  const tool = createAddProjectTool({ service: createService() })
  const result = await tool.execute({ directory: '/work/alpha', name: 'alpha' })
  assert.equal(result.directory, '/work/alpha')
  assert.equal(result.coordinatorSessionId, 'session-1')
})

test('switch_project 按 id 找到协调者会话', async () => {
  const tool = createSwitchProjectTool({
    service: createService([
      { id: 'p1', name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1', coordinatorAlive: true },
    ]),
  })
  const result = await tool.execute({ projectId: 'p1' })
  assert.equal(result.found, true)
  assert.equal(result.sessionId, 'session-1')
  assert.equal(result.directory, '/work/alpha')
})

test('switch_project 按名字也能找到', async () => {
  const tool = createSwitchProjectTool({
    service: createService([
      { id: 'p1', name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1', coordinatorAlive: true },
    ]),
  })
  const result = await tool.execute({ name: 'alpha' })
  assert.equal(result.found, true)
  assert.equal(result.id, 'p1')
})

test('switch_project 找不到时如实说明', async () => {
  const tool = createSwitchProjectTool({ service: createService([]) })
  const result = await tool.execute({ projectId: 'p9' })
  assert.equal(result.found, false)
  assert.equal(result.sessionId, '')
})

test('switch_project 标出协调者会话已失效', async () => {
  const tool = createSwitchProjectTool({
    service: createService([
      { id: 'p1', name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1', coordinatorAlive: false },
    ]),
  })
  const result = await tool.execute({ projectId: 'p1' })
  assert.equal(result.coordinatorAlive, false)
})

test('remove_project 拒绝空 id', async () => {
  const tool = createRemoveProjectTool({ service: createService() })
  await assert.rejects(() => tool.execute({ projectId: '  ' }), /projectId 不能为空/)
})

test('remove_project 报告是否真的注销了', async () => {
  const tool = createRemoveProjectTool({
    service: createService([{ id: 'p1', name: 'alpha', directory: '/work/alpha' }]),
  })
  assert.deepEqual(await tool.execute({ projectId: 'p1' }), { removed: true })
  assert.deepEqual(await tool.execute({ projectId: 'p9' }), { removed: false })
})
