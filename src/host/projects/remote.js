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
 * @param {object} options.ctx - 宿主 Cordis 上下文
 * @returns {object} 已注册的远程服务实例
 */
export function createProjectRemote({ service, ctx }) {
  class ProjectRemote {
    /**
     * @param {object} service - 项目服务
     */
    constructor(service) {
      this.projects = service
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
     * 确保协调者会话跑过至少一轮。
     *
     * 官方界面把空会话渲染成欢迎页（输入框居中），跑过一轮才是输入框停靠底部的
     * 对话形态。幂等：已经跑过一轮的协调者不会重复发起。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<{engaged: boolean, reason?: string}>} 结果
     */
    async engageCoordinator(id) {
      return this.projects.engageCoordinator(id)
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
  }

  Object.defineProperty(ProjectRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: buildMethodDescriptor(),
  })

  const remote = new ProjectRemote(service)
  ctx.provide(PROJECT_REMOTE_SERVICE_KEY, remote)
  return remote
}
