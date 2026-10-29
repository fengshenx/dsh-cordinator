/**
 * 为 GitHub App 生成 installation access token（默认 1 小时有效），用于以 bot 身份
 * 发 PR 评论。用法、身份边界与防错理由见 AGENTS.md「用 bot 身份发评论」。
 *
 * 本机工具：读 `~/.telov/github-app.env`（`GITHUB_APP_ID` /
 * `GITHUB_APP_INSTALLATION_ID`）与 `~/.telov/github-app.pem`，凭据不入库。
 *
 *   TOKEN=$(node scripts/github-app-token.mjs) && GH_TOKEN="$TOKEN" gh pr comment <n> --body-file /tmp/review.md
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJwt } from './github-app-jwt.mjs'

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
 * 取 installation token。
 *
 * 非 2xx 先按文本截断报出：代理或网关回 HTML 502 时，`json()` 抛的是
 * `Unexpected token '<'`，真实状态码被那句解析错误埋掉。
 *
 * `fetchImpl` 只为用例注入假的响应，生产调用不传。
 *
 * @param {string} jwt - App JWT
 * @param {string} installationId - installation id
 * @param {typeof fetch} [fetchImpl] - fetch 实现
 * @returns {Promise<string>} installation token
 */
export async function exchangeToken(jwt, installationId, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    // 网络挂住时不能让调用方一直等；10 秒对一次 token 交换足够宽
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'telov-review-bot',
    },
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`换取 installation token 失败（HTTP ${response.status}）：${text.slice(0, 400)}`)
  }
  const body = await response.json()
  if (typeof body.token !== 'string') {
    throw new Error(`换取 installation token 的响应里没有 token：${JSON.stringify(body).slice(0, 400)}`)
  }
  return body.token
}

async function main() {
  if (!existsSync(KEY_FILE)) {
    throw new Error(`缺少私钥 ${KEY_FILE}，请在 GitHub App 设置页「Generate a private key」下载后移入`)
  }
  const { appId, installationId } = readConfig()
  const jwt = createJwt({ appId, privateKey: readFileSync(KEY_FILE, 'utf8') })
  process.stdout.write(`${await exchangeToken(jwt, installationId)}\n`)
  return 0
}

/**
 * 判断本模块是被直接执行还是被 import。
 *
 * 用 argv 比对而不是 `import.meta.main`：后者在 Node 24.2 之前不存在，属性读成
 * undefined 会让脚本静默什么都不做。
 *
 * @returns {boolean} 直接执行时 true
 */
function invokedDirectly() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (invokedDirectly()) {
  try {
    await main()
  } catch (error) {
    process.stderr.write(`github-app-token: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
