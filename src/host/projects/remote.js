/**
 * 项目数据的 Typert 远程服务（宿主侧）。
 *
 * 与工作区控制器同构：服务注册进 Cordis，方法通过 dsh 官方的 `/api` 通道被
 * 浏览器侧调用，鉴权、传输与错误语义都走官方链路。
 *
 * 这里手写协议形状而不安装 `@deepseek-ai/dsh-typert-protocol`：协议包是 dsh
 * 内部包，仓外 bundle 装它会被宿主的版本校验卡住，而它的标记契约是稳定字符串
 * + 版本化描述符，宿主读标记时不校验来源包的版本。手写的部分只有两处——
 * 原型上的方法标记与实例上的服务绑定，宿主的 SRC 通道据此还原调用描述符。
 *
 * @module dsh-coordinator/host/projects/remote
 */

import {
  PROJECT_REMOTE_METHODS,
  PROJECT_REMOTE_NAMESPACE,
  PROJECT_REMOTE_SERVICE_KEY,
} from '../../shared/projects.js'

/**
 * 协议包把 Remote 方法标记写在原型的这个属性上。属性名是稳定字符串，宿主读标记
 * 时不校验来源包的版本。
 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

/**
 * 构造原型上的方法标记表。
 *
 * 标记里的方法名必须与实例上的方法名逐字一致：宿主按标记找实现方法，再按实现
 * 方法的形参名还原 wire 字段。
 *
 * @returns {{version: number, methods: ReadonlyArray<object>}} 版本化描述符
 */
function buildMethodDescriptor() {
  const methods = Object.keys(PROJECT_REMOTE_METHODS).map((method) => Object.freeze({
    method,
    invocation: Object.freeze({ kind: 'direct' }),
  }))
  return Object.freeze({ version: 1, methods: Object.freeze(methods) })
}

/**
 * 建项目数据的远程服务并注册进 Cordis。
 *
 * @param {object} options - 装配选项
 * @param {object} options.service - 项目服务（`src/host/projects/service.js`）
 * @param {object} options.cards - 卡片存储（`src/host/cards/store.js`）
 * @param {object} options.workers - worker 登记表（`src/host/worker-registry.js`）
 * @param {object} options.ctx - 宿主 Cordis 上下文
 * @returns {object} 已注册的远程服务实例
 */
export function createProjectRemote({ service, cards, workers, ctx }) {
  class ProjectRemote {
    /**
     * @param {object} service - 项目服务
     * @param {object} cards - 卡片存储
     * @param {object} workers - worker 登记表
     */
    constructor(service, cards, workers) {
      this.projects = service
      this.cards = cards
      this.workers = workers
      // 服务绑定：宿主据此认出「这个服务导出哪个命名空间」。绑定里的 service 必须
      // 指向服务实例本身，宿主会拿它与调用时取到的实例比对。
      this.typertRemote = {
        service: this,
        serviceKey: PROJECT_REMOTE_SERVICE_KEY,
        namespace: PROJECT_REMOTE_NAMESPACE,
      }
    }

    /**
     * 列项目。
     * @returns {Promise<object[]>} 项目列表
     */
    async list() {
      return this.projects.list()
    }

    /**
     * 建项目：建实体 + 建协调者会话 + 绑定。
     * @param {string} directory - 项目目录绝对路径
     * @param {string} name - 项目名
     * @returns {Promise<object>} 建成的项目
     */
    async create(directory, name) {
      return this.projects.create({ directory, name })
    }

    /**
     * 注销项目。协调者会话保留，不在项目里的会话历史不因注销而消失。
     * @param {string} id - 项目 id
     * @returns {Promise<{removed: boolean}>} 是否确实注销了
     */
    async unregister(id) {
      const removed = await this.projects.remove(id)
      return { removed: removed !== undefined }
    }

    /**
     * 改项目名。
     * @param {string} id - 项目 id
     * @param {string} name - 新项目名
     * @returns {Promise<object>} 更新后的项目
     */
    async rename(id, name) {
      return this.projects.rename(id, name)
    }

    /**
     * 换新协调者会话并改绑。
     * @param {string} id - 项目 id
     * @returns {Promise<object>} 更新后的项目
     */
    async replaceCoordinator(id) {
      return this.projects.replaceCoordinator(id)
    }

    /**
     * 确保协调者会话挂在项目目录对应的工作区上。
     *
     * 只有归属工作区的会话能被官方 UI 打开成主区域；目录还不是工作区时顺带
     * 注册一个（幂等）。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<{attached: boolean, workspaceId?: string, reason?: string}>} 挂载结果
     */
    async attachCoordinator(id) {
      return this.projects.attachCoordinator(id)
    }

    /**
     * 从宿主里移除项目的工作区。
     *
     * 只删工作区注册，目录与全部会话日志都留着；协调者会话仍在，只是不再归属
     * 工作区，下次打开项目会重新注册并挂上。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<{removed: boolean, reason?: string}>} 移除结果
     */
    async removeWorkspace(id) {
      return this.projects.removeWorkspace(id)
    }

    /**
     * 列项目下的会话。
     * @returns {Promise<{projectId: string, sessionIds: string[]}[]>} 每个项目的会话 id 列表
     */
    async sessionsByProject() {
      return this.projects.sessionsByProject()
    }

    /**
     * 解析某个会话所属的项目。
     *
     * 判据与卡片归属同一套：协调者会话走项目注册表的指针，其它会话按 cwd 与项目
     * 目录的 canonical 路径相等。
     *
     * @param {string} sessionId - 会话 id
     * @returns {Promise<object | undefined>} 项目摘要；不归属任何项目时 undefined
     */
    async resolveProject(sessionId) {
      return this.projects.resolveProjectOfSession(sessionId)
    }

    /**
     * 摘掉一个会话在卡片槽位与派工登记表上的痕迹。
     *
     * 由浏览器侧在会话归档成功后调用：归档本身走宿主的 `workspaces` 服务（会话
     * 还在跑时会被拒绝，那时不该动卡片），这里只做归档之后的收尾。
     *
     * @param {string} sessionId - 会话 id
     * @returns {Promise<{cards: string[], slots: number, worker: boolean}>} 摘除结果
     */
    async detachSession(sessionId) {
      const detached = await this.cards.detachSession(sessionId)
      const worker = await this.workers.remove(sessionId)
      return { ...detached, worker }
    }

    /**
     * 列某个项目的看板卡片。
     *
     * 看板按项目取卡：一个项目一个看板，跨会话聚合（协调者建的卡与 worker 建的
     * 卡在一处）。卡片真源在宿主的卡片库里，不从会话事件流重建。
     *
     * @param {string} projectId - 项目 id
     * @returns {Promise<object[]>} 该项目的全部卡片
     */
    async boardCards(projectId) {
      return this.cards.list({ projectId })
    }
  }

  Object.defineProperty(ProjectRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: buildMethodDescriptor(),
  })

  const remote = new ProjectRemote(service, cards, workers)
  ctx.provide(PROJECT_REMOTE_SERVICE_KEY, remote)
  return remote
}
