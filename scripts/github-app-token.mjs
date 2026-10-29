/**
 * 为 GitHub App 生成 installation access token（默认 1 小时有效）。
 *
 * 用途：审查评论以项目 bot 身份发布，与作者账号分离。
 *   TOKEN=$(node scripts/github-app-token.mjs) && GH_TOKEN="$TOKEN" gh pr comment <n> --body-file /tmp/review.md
 *
 * 取 token 与 gh 调用必须写在同一行：分两次 shell 调用时 $TOKEN 已丢失，gh 会回落到
 * 本人 keyring 凭证，评论照样发出、身份却静默变成作者账号——`&&` 短路是另一道防线，
 * 取不到 token 时干脆不执行 gh。
 *
 * 凭证在机器本地，不入库：
 *   ~/.telov/github-app.env  —— GITHUB_APP_ID / GITHUB_APP_INSTALLATION_ID
 *   ~/.telov/github-app.pem  —— App 页面「Generate a private key」下载的私钥（chmod 600）
 *
 * 该 App 的 installation 覆盖 `fengshenx` 名下全部仓库（repository_selection: all），
 * 所以同一份凭据对 Telov 与本仓都适用，不必按仓库另配。
 */

import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CREDENTIAL_DIR = join(homedir(), '.telov')
const ENV_FILE = join(CREDENTIAL_DIR, 'github-app.env')
const KEY_FILE = join(CREDENTIAL_DIR, 'github-app.pem')

/**
 * 读 App id 与 installation id。
 *
 * @returns {{ appId: string, installationId: string }} 标识
 */
function readConfig() {
  if (!existsSync(ENV_FILE)) {
    throw new Error(`缺少凭证文件 ${ENV_FILE}，内容形如：\nGITHUB_APP_ID=123456\nGITHUB_APP_INSTALLATION_ID=12345678`)
  }
  const entries = new Map()
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = /^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/.exec(line)
    if (match) entries.set(match[1], match[2])
  }
  const appId = entries.get('GITHUB_APP_ID')
  const installationId = entries.get('GITHUB_APP_INSTALLATION_ID')
  if (!appId || !installationId) {
    throw new Error(`${ENV_FILE} 需同时包含 GITHUB_APP_ID 与 GITHUB_APP_INSTALLATION_ID`)
  }
  return { appId, installationId }
}

/**
 * 把一段内容转成 JWT 用的 base64url。
 *
 * @param {string | Buffer} input - 待编码内容
 * @returns {string} base64url 字符串
 */
function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 用私钥签出 RS256 JWT——GitHub App 认证的第一段，10 分钟有效（上限）。
 *
 * @param {string} appId - App id
 * @param {string} privateKey - App 私钥 PEM
 * @returns {string} JWT
 */
function createJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey)
  return `${header}.${payload}.${base64url(signature)}`
}

async function main() {
  if (!existsSync(KEY_FILE)) {
    throw new Error(`缺少私钥 ${KEY_FILE}，请在 GitHub App 设置页「Generate a private key」下载后移入`)
  }
  const { appId, installationId } = readConfig()
  const jwt = createJwt(appId, readFileSync(KEY_FILE, 'utf8'))

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const body = await response.json()
  if (!response.ok || typeof body.token !== 'string') {
    throw new Error(`换取 installation token 失败（HTTP ${response.status}）：${JSON.stringify(body).slice(0, 400)}`)
  }
  process.stdout.write(`${body.token}\n`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`github-app-token: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
