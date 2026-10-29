import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exchangeToken } from '../scripts/github-app-token.mjs'

/**
 * 造一个假的 fetch 实现。
 *
 * @param {object} response - 假响应
 * @param {boolean} response.ok - 是否成功
 * @param {number} response.status - 状态码
 * @param {() => Promise<unknown>} response.body - 响应体读取器
 * @returns {typeof fetch} 假 fetch
 */
function fakeFetch(response) {
  return async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => String(await response.body()),
    json: async () => response.body(),
  })
}

test('非 2xx 时报出状态码与响应正文，而不是抛 JSON 解析错误', async () => {
  const fetchImpl = fakeFetch({ ok: false, status: 502, body: async () => '<html>bad gateway</html>' })
  await assert.rejects(
    () => exchangeToken('jwt', '1', fetchImpl),
    /HTTP 502.*bad gateway/s,
  )
})

test('2xx 但响应里没有 token 时如实说出来', async () => {
  const fetchImpl = fakeFetch({ ok: true, status: 201, body: async () => ({ message: 'weird' }) })
  await assert.rejects(() => exchangeToken('jwt', '1', fetchImpl), /响应里没有 token/)
})

test('成功时只输出 token', async () => {
  const fetchImpl = fakeFetch({ ok: true, status: 201, body: async () => ({ token: 'ghs_example' }) })
  assert.equal(await exchangeToken('jwt', '1', fetchImpl), 'ghs_example')
})
