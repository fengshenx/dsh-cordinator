/**
 * 项目数据的 client → host 通道。
 *
 * 浏览器半边没有文件系统，项目的真源必须在宿主侧。本模块在宿主自己的 Web
 * 服务器上开一条 `/coordinator` 前缀的 HTTP 通道，浏览器侧用 `fetch` 调用。
 *
 * 为什么不用 connection 的自定义 RPC 通道（`connection.rpc.handle`）：那个 API
 * 把路由注册到调用方作用域的 webServer 上，而调用方作用域拿不到 webServer 的
 * inject 声明，注册会抛 `cannot get property "webServer" without inject`——dsh
 * 内部也没有任何 `handle` 的使用者，这条路对仓外插件不成立。
 *
 * 为什么不用 Gateway 的 `/api` 共享通道：那条路要经 Typert 远程调用，需要把
 * `@deepseek-ai/dsh-typert-protocol` 装成依赖，而它的发布版本与宿主对不上
 * （npm 上的 `latest` 是 `0.1.0-rc.6`，宿主用的是 `0.2.1-rc.2`）。仓外 bundle
 * 不装 dsh 内部包为依赖——宿主对插件的 peer/engines 校验很严，带内部 peer 的
 * bundle 会周期性失效。
 *
 * `webServer` 只挂在 web-app bundle 上（`packages/bundle/web-app/cordis.patch.yml`），
 * 与项目 UI 是同一个 profile 的特性。它不能写进插件的 `inject`：声明成必需依赖
 * 会让不含该服务的 profile 整个插件挂起。这里用子作用域等待，缺席时只是没有这条
 * 通道。
 *
 * @module dsh-coordinator/host/projects/rpc
 */

import { PROJECT_ENDPOINTS, PROJECT_RPC_PATH } from '../../shared/projects.js'

/** 自有通道路径前缀。 */
export { PROJECT_RPC_PATH }

/** 单次请求体上限。请求体只有目录与名字，超过 1 MiB 一定是异常调用。 */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * 端点分派表。每个端点只做入参校验，领域操作交给项目服务。
 * @type {Readonly<Record<string, (payload: unknown, service: object) => Promise<unknown>>>}
 */
const ENDPOINTS = {
  [PROJECT_ENDPOINTS.list]: async (_payload, service) => ({ projects: await service.list() }),

  [PROJECT_ENDPOINTS.create]: async (payload, service) => {
    const input = /** @type {{ directory?: unknown, name?: unknown }} */ (payload)
    if (typeof input?.directory !== 'string' || input.directory.trim() === '') {
      throw new Error('projects/create: directory 不能为空')
    }
    if (input.name !== undefined && typeof input.name !== 'string') {
      throw new Error('projects/create: name 必须是字符串')
    }
    const project = await service.create({
      directory: input.directory,
      ...input.name === undefined ? {} : { name: input.name },
    })
    return { project }
  },

  [PROJECT_ENDPOINTS.remove]: async (payload, service) => {
    const input = /** @type {{ id?: unknown }} */ (payload)
    if (typeof input?.id !== 'string' || input.id.trim() === '') {
      throw new Error('projects/remove: id 不能为空')
    }
    const removed = await service.remove(input.id)
    return { removed: removed !== undefined }
  },

  [PROJECT_ENDPOINTS.rename]: async (payload, service) => {
    const input = /** @type {{ id?: unknown, name?: unknown }} */ (payload)
    if (typeof input?.id !== 'string' || input.id.trim() === '') {
      throw new Error('projects/rename: id 不能为空')
    }
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      throw new Error('projects/rename: name 不能为空')
    }
    return { project: await service.rename(input.id, input.name) }
  },

  [PROJECT_ENDPOINTS.replaceCoordinator]: async (payload, service) => {
    const input = /** @type {{ id?: unknown }} */ (payload)
    if (typeof input?.id !== 'string' || input.id.trim() === '') {
      throw new Error('projects/replace-coordinator: id 不能为空')
    }
    return { project: await service.replaceCoordinator(input.id) }
  },
}

/**
 * 造项目通道的处理器。
 *
 * 处理器独立于注册逻辑：注册要等宿主服务就绪，处理器本身是纯函数式的分派，
 * 可以直接单测。
 *
 * @param {object} service - 项目服务
 * @param {(message: string) => void} [logger] - 日志输出
 * @returns {(endpoint: string, payload: unknown) => Promise<object>} 处理器
 */
export function createProjectRpcHandler(service, logger = () => {}) {
  return async (endpoint, payload) => {
    const endpointHandler = ENDPOINTS[endpoint]
    if (endpointHandler === undefined) {
      return {
        ok: false,
        error: { code: 'coordinator/unknown-endpoint', message: `未知端点：${endpoint}`, details: {} },
      }
    }
    try {
      const value = await endpointHandler(payload, service)
      return { ok: true, value }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger(`dsh-coordinator: RPC ${endpoint} 失败：${message}`)
      return {
        ok: false,
        error: { code: 'coordinator/failed', message, details: {} },
      }
    }
  }
}

/**
 * 读请求体，超过上限就中断。
 *
 * @param {import('node:http').IncomingMessage} req - 请求
 * @returns {Promise<string>} 请求体文本
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new Error('请求体超过 1 MiB')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * 校验请求来自宿主自己的页面。
 *
 * 这条通道能建会话、能往宿主文件系统写项目注册表，跨站页面打进来就是提权。
 * 只接受同源：浏览器同源 POST 必带 Origin，其 host 必须与请求的 Host 头一致。
 * 没有 Origin 的请求一律拒绝——本机进程要调也走不了这条路，这是有意的。
 *
 * @param {import('node:http').IncomingMessage} req - 请求
 * @returns {boolean} 是否同源
 */
function isSameOrigin(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return false
  let originHost
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const host = req.headers.host
  return typeof host === 'string' && host !== '' && originHost === host
}

/**
 * 造 HTTP 处理函数：解析端点与载荷，交给领域处理器，返回 JSON。
 *
 * @param {object} options - 选项
 * @param {string} options.origin - 宿主页面的 origin
 * @param {(endpoint: string, payload: unknown) => Promise<object>} options.handle - 端点处理器
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} 处理函数
 */
export function createProjectHttpHandler({ origin, handle }) {
  return async (req, res) => {
    const respond = (status, body) => {
      const text = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
      res.end(text)
    }

    if (req.method !== 'POST') {
      respond(405, { ok: false, error: { code: 'coordinator/method-not-allowed', message: '只接受 POST', details: {} } })
      return
    }
    if (!isSameOrigin(req)) {
      respond(403, { ok: false, error: { code: 'coordinator/forbidden', message: '只接受同源请求', details: {} } })
      return
    }

    const requestUrl = new URL(req.url ?? '/', origin)
    const endpoint = requestUrl.pathname.slice(PROJECT_RPC_PATH.length + 1)

    let payload
    try {
      const text = await readBody(req)
      payload = text === '' ? {} : JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      respond(400, { ok: false, error: { code: 'coordinator/bad-request', message, details: {} } })
      return
    }

    const result = await handle(endpoint, payload)
    respond(200, result)
  }
}

/**
 * 注册项目通道。
 *
 * @param {object} options - 选项
 * @param {object} options.ctx - Cordis 上下文
 * @param {object} options.service - 项目服务
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @returns {void}
 */
export function applyProjectRpc({ ctx, service, logger = () => {} }) {
  const handle = createProjectRpcHandler(service, logger)

  // `webServer` 缺席时这条通道不存在，浏览器侧调用会拿到传输失败而不是静默
  // 拿到空结果——缺席必须看得见。
  //
  // 用子作用域等待而不是写进插件的 `inject`：webServer 只挂在 web-app bundle
  // 上，声明成必需依赖会让不含该服务的 profile 整个插件挂起。缺席时这个子作用域
  // 永远挂起，插件的其余能力不受影响。
  ctx.inject(['webServer'], (webCtx) => {
    const handler = createProjectHttpHandler({ origin: webCtx.webServer.getOrigin(), handle })
    // 注册返回 disposer；插件卸载时必须注销路由，否则宿主会继续把请求打给
    // 已经退出的插件。
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'prefix',
      path: PROJECT_RPC_PATH,
      handler,
    }))
  })
}
