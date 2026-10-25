/**
 * 浏览器侧调用项目通道的封装。
 *
 * @module dsh-coordinator/client/project-rpc
 */

import { PROJECT_RPC_PATH } from '../shared/projects.js'

/**
 * 调用项目通道的一个端点。
 *
 * 通道的失败有两种形态：传输失败（宿主没有这条通道，返回的不是 JSON）与业务
 * 失败（端点返回 `ok: false`）。两者都要变成异常抛给调用方——静默吞掉会让
 * 「项目建不出来」看起来像「项目建好了」。
 *
 * @param {string} endpoint - 端点名
 * @param {object} payload - 请求载荷
 * @returns {Promise<object>} 端点返回值
 */
export async function callProjectRpc(endpoint, payload) {
  const response = await fetch(`${PROJECT_RPC_PATH}/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })

  const text = await response.text()
  let result
  try {
    result = JSON.parse(text)
  } catch {
    throw new Error(`项目通道不可用（HTTP ${response.status}）`)
  }
  if (result?.ok !== true) {
    throw new Error(result?.error?.message ?? `项目通道调用失败：${endpoint}`)
  }
  return result.value
}
