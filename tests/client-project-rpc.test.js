import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callProjectRpc } from '../src/client/project-rpc.js'
import { PROJECT_ENDPOINTS, PROJECT_RPC_PATH } from '../src/shared/projects.js'

test('浏览器侧调用把业务失败变成异常', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `${PROJECT_RPC_PATH}/${PROJECT_ENDPOINTS.list}`)
    assert.equal(init.method, 'POST')
    return {
      status: 200,
      async text() {
        return JSON.stringify({ ok: false, error: { code: 'x', message: '端点炸了', details: {} } })
      },
    }
  }
  try {
    await assert.rejects(() => callProjectRpc(PROJECT_ENDPOINTS.list, {}), /端点炸了/)
  } finally {
    globalThis.fetch = original
  }
})

test('浏览器侧调用把非 JSON 响应报成通道不可用', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    status: 404,
    async text() {
      return '<!doctype html><html></html>'
    },
  })
  try {
    await assert.rejects(() => callProjectRpc(PROJECT_ENDPOINTS.list, {}), /项目通道不可用/)
  } finally {
    globalThis.fetch = original
  }
})

test('浏览器侧调用把成功结果原样返回', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({
    status: 200,
    async text() {
      return JSON.stringify({ ok: true, value: { projects: [] } })
    },
  })
  try {
    assert.deepEqual(await callProjectRpc(PROJECT_ENDPOINTS.list, {}), { projects: [] })
  } finally {
    globalThis.fetch = original
  }
})
