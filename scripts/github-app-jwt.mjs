/**
 * GitHub App 认证用的 RS256 JWT。
 *
 * 抽成纯函数是为了能测结构：header 的 `alg`/`typ`、payload 的 `iss`/`iat`/`exp`
 * 由签约方直接决定，写错只会在调 GitHub 时得到一句 401，比断言几个字段难查得多。
 */

import { createSign } from 'node:crypto'

/**
 * 把一段内容转成 JWT 用的 base64url。
 *
 * @param {string | Buffer} input - 待编码内容
 * @returns {string} base64url 字符串
 */
export function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 用私钥签出 RS256 JWT。
 *
 * `iat` 回退 60 秒抵消本机与 GitHub 的时钟偏差；`exp` 取 9 分钟，留在 GitHub
 * 允许的 10 分钟上限之内。
 *
 * @param {object} options - 选项
 * @param {string} options.appId - App id，写进 `iss`
 * @param {string} options.privateKey - App 私钥 PEM
 * @param {number} [options.nowSeconds] - 当前时间（秒），缺省取系统时钟
 * @returns {string} JWT
 */
export function createJwt({ appId, privateKey, nowSeconds }) {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey)
  return `${header}.${payload}.${base64url(signature)}`
}

/**
 * 解开 JWT 的三段，供调用方读取 header 与 payload。
 *
 * @param {string} jwt - JWT
 * @returns {{ header: object, payload: object, signingInput: string, signature: string }} 分段
 */
export function partsOf(jwt) {
  const [header, payload, signature] = jwt.split('.')
  const decode = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  return { header: decode(header), payload: decode(payload), signingInput: `${header}.${payload}`, signature }
}
