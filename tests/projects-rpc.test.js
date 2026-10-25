import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProjectHttpHandler, createProjectRpcHandler } from '../src/host/projects/rpc.js'
import { PROJECT_ENDPOINTS, PROJECT_RPC_PATH } from '../src/shared/projects.js'

/**
 * 造一个假的项目服务。
 * @returns {object} 服务
 */
function createService() {
  return {
    async list() {
      return [{ id: 'p1', name: 'alpha', directory: '/work/alpha', coordinatorSessionId: 'session-1' }]
    },
    async create({ directory, name }) {
      return { id: 'p1', name: name ?? 'alpha', directory, coordinatorSessionId: 'session-1' }
    },
    async remove(id) {
      return id === 'p1' ? { id } : undefined
    },
    async rename(id, name) {
      return { id, name }
    },
    async replaceCoordinator(id) {
      return { id, coordinatorSessionId: 'session-2' }
    },
  }
}

/**
 * 造一个假的 HTTP 请求。
 * @param {object} options - 选项
 * @returns {object} 请求
 */
function createReq({ method = 'POST', url = '/coordinator/projects/list', headers = {}, body = '' } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== '') yield Buffer.from(body)
    },
  }
}

/**
 * 造一个假的 HTTP 响应。
 * @returns {object} 响应
 */
function createRes() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    end(text) {
      this.body = text
    },
  }
}

test('通道路径与端点名是共享契约', () => {
  assert.equal(PROJECT_RPC_PATH, '/coordinator')
  assert.equal(PROJECT_ENDPOINTS.list, 'projects/list')
})

test('projects/list 返回项目列表', async () => {
  const handle = createProjectRpcHandler(createService())
  const result = await handle(PROJECT_ENDPOINTS.list, {})
  assert.equal(result.ok, true)
  assert.equal(result.value.projects.length, 1)
})

test('projects/create 缺少 directory 时报错', async () => {
  const handle = createProjectRpcHandler(createService())
  const result = await handle(PROJECT_ENDPOINTS.create, {})
  assert.equal(result.ok, false)
  assert.match(result.error.message, /directory 不能为空/)
})

test('projects/create 转发到服务', async () => {
  const handle = createProjectRpcHandler(createService())
  const result = await handle(PROJECT_ENDPOINTS.create, { directory: '/work/alpha', name: 'alpha' })
  assert.equal(result.ok, true)
  assert.equal(result.value.project.directory, '/work/alpha')
})

test('projects/remove 报告是否真的删掉了', async () => {
  const handle = createProjectRpcHandler(createService())
  assert.equal((await handle(PROJECT_ENDPOINTS.remove, { id: 'p1' })).value.removed, true)
  assert.equal((await handle(PROJECT_ENDPOINTS.remove, { id: 'p9' })).value.removed, false)
})

test('projects/rename 与 replace-coordinator 转发到服务', async () => {
  const handle = createProjectRpcHandler(createService())
  assert.equal((await handle(PROJECT_ENDPOINTS.rename, { id: 'p1', name: 'beta' })).value.project.name, 'beta')
  assert.equal(
    (await handle(PROJECT_ENDPOINTS.replaceCoordinator, { id: 'p1' })).value.project.coordinatorSessionId,
    'session-2',
  )
})

test('未知端点被挡下', async () => {
  const handle = createProjectRpcHandler(createService())
  const result = await handle('projects/unknown', {})
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'coordinator/unknown-endpoint')
})

test('业务异常变成失败结果而不是抛出', async () => {
  const handle = createProjectRpcHandler({
    async list() {
      throw new Error('库坏了')
    },
  })
  const result = await handle(PROJECT_ENDPOINTS.list, {})
  assert.equal(result.ok, false)
  assert.equal(result.error.message, '库坏了')
})

test('HTTP 通道把路径解析成端点并返回 JSON', async () => {
  const handler = createProjectHttpHandler({
    origin: 'http://127.0.0.1:3080',
    handle: createProjectRpcHandler(createService()),
  })
  const req = createReq({
    url: '/coordinator/projects/list',
    headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' },
    body: '{}',
  })
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 200)
  const parsed = JSON.parse(res.body)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.value.projects.length, 1)
})

test('HTTP 通道拒绝非同源请求', async () => {
  const handler = createProjectHttpHandler({
    origin: 'http://127.0.0.1:3080',
    handle: createProjectRpcHandler(createService()),
  })
  const req = createReq({
    headers: { origin: 'http://evil.example', host: '127.0.0.1:3080' },
    body: '{}',
  })
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 403)
  assert.equal(JSON.parse(res.body).error.code, 'coordinator/forbidden')
})

test('HTTP 通道拒绝没有 Origin 的请求', async () => {
  const handler = createProjectHttpHandler({
    origin: 'http://127.0.0.1:3080',
    handle: createProjectRpcHandler(createService()),
  })
  const req = createReq({ headers: { host: '127.0.0.1:3080' }, body: '{}' })
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 403)
})

test('HTTP 通道只接受 POST', async () => {
  const handler = createProjectHttpHandler({
    origin: 'http://127.0.0.1:3080',
    handle: createProjectRpcHandler(createService()),
  })
  const req = createReq({
    method: 'GET',
    headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' },
  })
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 405)
})

test('HTTP 通道把坏 JSON 报成 400', async () => {
  const handler = createProjectHttpHandler({
    origin: 'http://127.0.0.1:3080',
    handle: createProjectRpcHandler(createService()),
  })
  const req = createReq({
    headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080' },
    body: 'not json',
  })
  const res = createRes()
  await handler(req, res)
  assert.equal(res.statusCode, 400)
})
