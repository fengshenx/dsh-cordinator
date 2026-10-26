/**
 * 项目服务：项目实体的领域操作。
 *
 * 服务层承接 Telov 项目容器的核心语义：
 *
 * - **建项目 = 建实体 + 建协调者会话 + 绑定**，三步一体。协调者会话在项目目录里
 *   运行（`SessionHeader.cwd` 创建时定死），项目与会话之间是显式指针，不是「目录里
 *   最新的那个会话」这类软约定。
 * - **失败整体回滚**：协调者会话建不出来时项目不落盘；项目落盘失败时尽力撤销刚建
 *   的会话，不留半条记录。
 * - **目录不可改**：项目目录是身份的一部分，改目录等于换项目。
 *
 * @module dsh-coordinator/host/projects/service
 */

import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { createEngager } from './engagement.js'
import { createCanonicalizer, groupSessionsByProject } from './session-index.js'

/** 目录归一器在进程内共享：会话头里的 cwd 高度重复，重复 realpath 纯属浪费。 */
const canonicalize = createCanonicalizer(realpath)

/** 项目名的长度上限，与 Telov 一致。 */
const MAX_NAME_LENGTH = 200

/**
 * 校验项目目录。
 * @param {string} directory - 候选目录
 * @returns {Promise<string>} 归一化后的绝对路径
 */
export async function assertUsableDirectory(directory) {
  if (typeof directory !== 'string' || directory.trim() === '') {
    throw new Error('项目目录不能为空')
  }
  const raw = directory.trim()
  if (!isAbsolute(raw)) {
    throw new Error(`项目目录必须是绝对路径：${raw}`)
  }
  const normalized = resolve(raw)
  let info
  try {
    info = await stat(normalized)
  } catch {
    throw new Error(`项目目录不存在或不可访问：${normalized}`)
  }
  if (!info.isDirectory()) {
    throw new Error(`项目目录不是目录：${normalized}`)
  }
  if (normalized === resolve(normalized, '..')) {
    throw new Error('项目目录不能是文件系统根目录')
  }
  return normalized
}

/**
 * 校验项目名。
 * @param {string} name - 候选名
 * @returns {string} 去掉首尾空白的项目名
 */
export function assertUsableName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('项目名不能为空')
  }
  const trimmed = name.trim()
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new Error(`项目名过长（上限 ${MAX_NAME_LENGTH} 字）`)
  }
  return trimmed
}

/**
 * 创建项目服务。
 *
 * @param {object} options - 选项
 * @param {object} options.store - 项目注册表存储
 * @param {object} options.ctx - Cordis 上下文
 * @param {(directory: string) => Promise<string>} [options.createCoordinatorSession] - 建协调者会话
 * @param {(sessionId: string) => Promise<boolean | undefined>} [options.sessionExists] - 判断会话是否仍存在
 * @param {(message: string) => void} [options.logger] - 日志输出
 * @returns {object} 项目服务接口
 */
export function createProjectService({
  store,
  ctx,
  createCoordinatorSession,
  sessionExists,
  logger = () => {},
}) {
  const openCoordinatorSession = createCoordinatorSession
    ?? ((directory) => createCoordinatorSessionWithCtx(ctx, directory))
  const coordinatorExists = sessionExists
    ?? ((sessionId) => sessionExistsWithCtx(ctx, sessionId))
  const engager = createEngager({ ctx, logger })

  /**
   * 协调者会话 id → 项目目录的内存镜像。
   *
   * 项目注册表是异步落盘的，而提示词组装与派工都需要**同步**拿到「这个会话属于
   * 哪个项目」。卡片库用的是同一手法：落盘是真源，内存镜像是读路径。
   */
  const coordinatorIndex = new Map()

  // 目录归一器在进程内共享：会话头里的 cwd 高度重复，重复 realpath 纯属浪费。

  /**
   * 撤销一个刚建成的协调者会话。
   *
   * dsh 没有「删除会话」的公开能力（`sessionController` 只提供创建与导航），因此
   * 这里只能尽力把 agent 停掉；残留的会话记录会落在左栏的「未分组」桶里，不影响
   * 项目数据。撤销失败必须记日志，不能静默吞掉。
   *
   * @param {string} sessionId - 会话 id
   * @returns {Promise<void>} 撤销完成
   */
  async function abandonCoordinatorSession(sessionId) {
    try {
      const agent = ctx.get('agents')?.get?.(sessionId)
      await agent?.dispose?.()
    } catch (error) {
      logger(
        `dsh-coordinator: 撤销协调者会话 ${sessionId} 失败：`
        + `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    /**
     * 重建协调者索引。进程启动时调用：内存镜像是进程内的，崩溃后不会留下。
     * @returns {Promise<Map<string, string>>} 重建后的索引
     */
    async loadIndex() {
      const projects = await store.list()
      coordinatorIndex.clear()
      for (const project of projects) {
        if (typeof project.coordinatorSessionId === 'string' && project.coordinatorSessionId !== '') {
          coordinatorIndex.set(project.coordinatorSessionId, project.directory)
        }
      }
      return coordinatorIndex
    },

    /**
     * 同步取某个协调者会话所属的项目目录。
     * @param {string} sessionId - 会话 id
     * @returns {string | undefined} 项目目录；该会话不是协调者时 undefined
     */
    directoryOfCoordinator(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return undefined
      return coordinatorIndex.get(sessionId)
    },

    /**
     * 建项目：建实体 + 建协调者会话 + 绑定。
     *
     * @param {object} input - 建项输入
     * @param {string} input.directory - 项目目录绝对路径
     * @param {string} [input.name] - 项目名，缺省用目录末段
     * @returns {Promise<object>} 建成的项目
     */
    async create({ directory, name }) {
      const normalizedDirectory = await assertUsableDirectory(directory)
      const fallbackName = normalizedDirectory.split(/[\\/]/).pop() ?? normalizedDirectory
      const displayName = assertUsableName(name ?? fallbackName)

      // 只有插件自己注册的工作区才算项目的：复用来的可能是用户自己加的。
      // 必须在建会话之前问——建会话本身也会注册工作区，那时再问就只剩「已存在」。
      const ensured = await ensureWorkspace(ctx, normalizedDirectory, canonicalize)
      // 先建会话再建记录：会话建不出来时项目不落盘，失败路径没有半条记录。
      const coordinatorSessionId = await openCoordinatorSession(normalizedDirectory)
      const draft = store.draft({
        name: displayName,
        directory: normalizedDirectory,
        coordinatorSessionId,
        ...ensured?.created === true ? { workspaceId: ensured.workspace.id } : {},
      })
      let inserted
      try {
        inserted = await store.insert(draft)
        coordinatorIndex.set(coordinatorSessionId, normalizedDirectory)
      } catch (error) {
        await abandonCoordinatorSession(coordinatorSessionId)
        throw error
      }
      // 建完项目就让协调者跑一轮：空会话在官方界面里渲染成欢迎页（输入框居中），
      // 跑过一轮才是输入框停靠底部的对话形态（见 `engagement.js`）。首轮失败不
      // 影响项目落盘——下次打开项目时还会再试一次。
      await engager.engage({
        sessionId: coordinatorSessionId,
        name: displayName,
        directory: normalizedDirectory,
      })
      return inserted
    },

    /**
     * 列项目，并标注协调者会话是否仍在、是否已挂到工作区。
     *
     * `coordinatorAttached` 决定浏览器侧能不能把协调者会话打开成主区域：只有
     * 归属工作区的会话才能被官方 UI 打开（见 `ensureWorkspace`）。
     *
     * @returns {Promise<object[]>} 项目列表
     */
    async list() {
      const projects = await store.list()
      return Promise.all(projects.map(async (project) => ({
        ...project,
        coordinatorAlive: await coordinatorExists(project.coordinatorSessionId),
        coordinatorAttached: isSessionAttachedToWorkspace(ctx, project.coordinatorSessionId),
        workspaceId: recordedWorkspaceId(ctx, project),
      })))
    },

    /**
     * 确保协调者会话挂在项目目录对应的工作区上。
     *
     * 官方 UI 只能打开归属工作区的会话（宿主 `session.create` 传 `cwd` 建出的
     * 会话不归属任何工作区，见 `ensureWorkspace`）。目录还不是
     * 工作区时这里顺带注册一个——注册是幂等的，宿主侧已有同名工作区就直接复用。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<{attached: boolean, workspaceId?: string, reason?: string}>} 挂载结果
     */
    async attachCoordinator(id) {
      const project = await store.get(id)
      if (project === undefined) throw new Error('项目不存在')
      if (ctx.get('workspaceRegistry') === undefined) {
        return { attached: false, reason: '当前宿主没有工作区服务，无法把协调者会话挂到工作区。' }
      }
      const ensured = await ensureWorkspace(ctx, project.directory, canonicalize)
      if (ensured === undefined) {
        return { attached: false, reason: '当前宿主的工作区服务不支持注册目录。' }
      }
      const workspace = ensured.workspace
      if (ensured.created) {
        // 只有插件自己注册的工作区才记进项目记录：复用的可能是用户自己加的
        // 工作区，那不是我们的，不该被隐藏。
        await store.update(project.id, { workspaceId: workspace.id })
      }
      // 归属可能刚写进记录（工作区是这次新建的），重读一遍再报给调用方。
      const recorded = await store.get(project.id)
      if ((workspace.sessionIds ?? []).includes(project.coordinatorSessionId)) {
        return { attached: true, workspaceId: recordedWorkspaceId(ctx, recorded ?? project) }
      }
      try {
        await workspace.attachSession(project.coordinatorSessionId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { attached: false, reason: `协调者会话挂到工作区失败：${message}` }
      }
      return { attached: true, workspaceId: recordedWorkspaceId(ctx, recorded ?? project) }
    },

    /**
     * 从宿主里移除项目的工作区。
     *
     * 插件注册的工作区在官方左栏里是隐藏的，用户在官方界面里没法直接删它——
     * 这里给出项目侧的入口。宿主的 `delete` 只删注册，目录与全部会话日志都留着
     * （`packages/workspace/workspace/src/index.ts:302-312`），协调者会话仍然在，
     * 只是不再归属工作区；下次打开项目会重新注册并挂上。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<{removed: boolean, reason?: string}>} 移除结果
     */
    async removeWorkspace(id) {
      const project = await store.get(id)
      if (project === undefined) throw new Error('项目不存在')
      const registry = ctx.get('workspaceRegistry')
      if (registry === undefined || typeof registry.list !== 'function') {
        return { removed: false, reason: '当前宿主没有工作区服务。' }
      }
      const workspaceId = project.workspaceId
      if (typeof workspaceId !== 'string' || workspaceId === '') {
        return { removed: false, reason: '该项目没有由插件注册的工作区。' }
      }
      if (!registry.list().some((workspace) => workspace.id === workspaceId)) {
        await store.update(project.id, { workspaceId: undefined })
        return { removed: false, reason: '工作区已经不在宿主里了。' }
      }
      if (typeof registry.delete !== 'function') {
        return { removed: false, reason: '当前宿主的工作区服务不支持删除。' }
      }
      await registry.delete(workspaceId)
      await store.update(project.id, { workspaceId: undefined })
      return { removed: true }
    },

    /**
     * 列项目下的会话。
     *
     * 判据是会话跑的目录：worker 会话与协调者会话都跑在项目目录里，用户在该目录
     * 手动开的会话也算。子目录里开的会话不算——那属于另一个目录。
     *
     * `sessionQuery` 缺失时返回空映射：会话索引是增强能力，缺了不该让项目列表
     * 整体不可用。
     *
     * @returns {Promise<{projectId: string, sessionIds: string[]}[]>} 每个项目的会话 id 列表
     */
    async sessionsByProject() {
      const query = ctx.get('sessionQuery')
      if (query === undefined || typeof query.listSessions !== 'function') return []
      const projects = await store.list()
      const records = await query.listSessions()
      const sessions = records
        .map((record) => ({
          id: record?.header?.id,
          cwd: record?.header?.cwd,
        }))
        .filter((session) => typeof session.id === 'string' && session.id !== '')
      const grouped = await groupSessionsByProject({ projects, sessions, canonicalize })
      return [...grouped.entries()].map(([projectId, sessionIds]) => ({ projectId, sessionIds }))
    },

    /**
     * 读单个项目。
     * @param {string} id - 项目 id
     * @returns {Promise<object | undefined>} 项目，不存在时 undefined
     */
    async get(id) {
      const project = await store.get(id)
      if (project === undefined) return undefined
      return {
        ...project,
        coordinatorAlive: await coordinatorExists(project.coordinatorSessionId),
        coordinatorAttached: isSessionAttachedToWorkspace(ctx, project.coordinatorSessionId),
        workspaceId: recordedWorkspaceId(ctx, project),
      }
    },

    /**
     * 按协调者会话 id 反查项目。
     *
     * 会话归属的判定真源就是这条指针——dsh 的会话头没有自由元数据槽，第三方插件
     * 无法给会话塞 `projectId`。
     *
     * @param {string} sessionId - 会话 id
     * @returns {Promise<object | undefined>} 项目，不存在时 undefined
     */
    async getByCoordinator(sessionId) {
      const project = await store.getByCoordinator(sessionId)
      if (project === undefined) return undefined
      return {
        ...project,
        coordinatorAlive: await coordinatorExists(project.coordinatorSessionId),
        coordinatorAttached: isSessionAttachedToWorkspace(ctx, project.coordinatorSessionId),
        workspaceId: recordedWorkspaceId(ctx, project),
      }
    },

    /**
     * 改项目名。
     * @param {string} id - 项目 id
     * @param {string} name - 新项目名
     * @returns {Promise<object>} 更新后的项目
     */
    async rename(id, name) {
      return store.update(id, { name: assertUsableName(name) })
    },

    /**
     * 换新协调者：建一个新会话并改绑，旧会话降级为项目里的普通会话。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<object>} 更新后的项目
     */
    async replaceCoordinator(id) {
      const project = await store.get(id)
      if (project === undefined) throw new Error(`项目不存在：${id}`)
      // 建会话本身会注册工作区（会话要归属工作区才能被官方 UI 打开），这一步
      // 顺带把归属记进项目记录——工作区被删过再换协调者时，归属会重新落回。
      const ensured = await ensureWorkspace(ctx, project.directory, canonicalize)
      if (ensured?.created === true) {
        await store.update(id, { workspaceId: ensured.workspace.id })
      }
      const coordinatorSessionId = await openCoordinatorSession(project.directory)
      let updated
      try {
        updated = await store.update(id, { coordinatorSessionId })
        if (typeof project.coordinatorSessionId === 'string') {
          coordinatorIndex.delete(project.coordinatorSessionId)
        }
        coordinatorIndex.set(coordinatorSessionId, project.directory)
      } catch (error) {
        await abandonCoordinatorSession(coordinatorSessionId)
        throw error
      }
      await engager.engage({
        sessionId: coordinatorSessionId,
        name: project.name,
        directory: project.directory,
      })
      return updated
    },

    /**
     * 确保协调者会话跑过至少一轮。
     *
     * 官方界面把空会话渲染成欢迎页（输入框居中），跑过一轮才是输入框停靠底部的
     * 对话形态。这个方法是幂等的：会话已经跑过一轮就什么都不做。建项目时已经跑过
     * 一轮的协调者不会重复发起。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<{engaged: boolean, reason?: string}>} 结果
     */
    async engageCoordinator(id) {
      const project = await store.get(id)
      if (project === undefined) throw new Error(`项目不存在：${id}`)
      const sessionId = project.coordinatorSessionId
      if (typeof sessionId !== 'string' || sessionId === '') {
        return { engaged: false, reason: '该项目还没有协调者会话。' }
      }
      return engager.engage({
        sessionId,
        name: project.name,
        directory: project.directory,
      })
    },

    /**
     * 删项目。
     *
     * 协调者会话**保留**：它是用户的会话历史，删掉等于丢上下文。删项目后该会话
     * 仍在左栏可见，只是不再是任何项目的协调者。
     *
     * @param {string} id - 项目 id
     * @returns {Promise<object | undefined>} 被删的项目，不存在时 undefined
     */
    async remove(id) {
      const removed = await store.remove(id)
      if (removed !== undefined && typeof removed.coordinatorSessionId === 'string') {
        coordinatorIndex.delete(removed.coordinatorSessionId)
      }
      return removed
    },
  }
}

/**
 * 拿到项目目录对应的工作区，没有就注册一个。
 *
 * dsh 的会话只有挂到工作区上，UI 才能把它显示到主区域——宿主 `session.create`
 * 传 `cwd` 建出来的会话不属于任何工作区（`packages/api/session-controller/src/commands.ts`
 * 的 create 只在传 `workspaceId` 时 attach），于是官方 UI 没有任何路径能打开它。
 * 因此建协调者会话前先确保目录已注册为工作区；注册是幂等的，目录已是工作区时
 * 直接复用。
 *
 * 「有没有是我们建的」由 `created` 区分：复用的工作区可能是用户自己加的，
 * 那不是插件的东西，不该被隐藏、不该被记进项目记录。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {string} directory - 项目目录绝对路径
 * @param {(directory: string) => Promise<string>} canonicalize - 路径归一器
 * @returns {Promise<{workspace: object, canonical: string, created: boolean} | undefined>} 工作区
 */
async function ensureWorkspace(ctx, directory, canonicalize) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return undefined
  const canonical = await canonicalize(directory)
  const existing = registry.list().find((workspace) => workspace.path === canonical)
  if (existing !== undefined) return { workspace: existing, canonical, created: false }
  if (typeof registry.create !== 'function') return undefined
  const created = await registry.create(canonical, canonical.split(/[\\/]/).pop() ?? canonical)
  if (created === undefined) return undefined
  return { workspace: created, canonical, created: true }
}

/**
 * 读项目记录里的工作区 id，只认仍然活着的。
 *
 * 返回的是「项目自己的」工作区，不是当前目录对应的那个：复用的用户工作区不在
 * 记录里，返回 undefined，客户端据此不给「从 dsh 移除工作区」的入口。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {object} project - 项目记录
 * @returns {string | undefined} 工作区 id；没有或已不在宿主里时 undefined
 */
export function recordedWorkspaceId(ctx, project) {
  return isWorkspaceAlive(ctx, project.workspaceId) ? project.workspaceId : undefined
}

/**
 * 判断工作区是否还在宿主里。
 *
 * 项目记录里的工作区 id 可能悬空——用户在工作区管理面板里删掉了它。悬空的 id
 * 不该再被当成「项目工作区」，否则客户端会拿着一张不存在的行去隐藏。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {string} workspaceId - 记录里的工作区 id
 * @returns {boolean} 工作区仍在时 true
 */
export function isWorkspaceAlive(ctx, workspaceId) {
  if (typeof workspaceId !== 'string' || workspaceId === '') return false
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return false
  return registry.list().some((workspace) => workspace.id === workspaceId)
}

/**
 * 判断会话是否已挂到某个工作区。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {string} sessionId - 会话 id
 * @returns {boolean} 已挂到工作区时 true
 */
export function isSessionAttachedToWorkspace(ctx, sessionId) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return false
  return registry.list().some((workspace) => (workspace.sessionIds ?? []).includes(sessionId))
}

/**
 * 用宿主服务建一个协调者会话。
 *
 * 优先走 `sessionController`（官方完整路径：建 agent、带上默认模型），它只挂在
 * web-app bundle 上；缺失时退回 `agents` 注册表直接建 agent——`agents` 由 base
 * bundle 提供，所有 profile 都有。两个服务都走惰性获取：它们不在本插件的
 * `inject` 列表里，声明成必需依赖会让不含该服务的 profile 整个插件挂起。
 *
 * 走 `sessionController` 时优先按工作区建（见 `ensureWorkspace`）：
 * 只有归属工作区的会话才能被 UI 打开成主区域。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {string} directory - 项目目录绝对路径
 * @returns {Promise<string>} 会话 id
 */
export async function createCoordinatorSessionWithCtx(ctx, directory) {
  const controller = ctx.get('sessionController')
  if (controller !== undefined && typeof controller.create === 'function') {
    const ensured = await ensureWorkspace(ctx, directory, canonicalize)
    const workspaceId = ensured?.workspace.id
    const created = await controller.create(workspaceId === undefined
      ? { cwd: directory }
      : { workspaceId })
    return created.sessionId
  }
  const agents = ctx.get('agents')
  if (agents === undefined || typeof agents.create !== 'function') {
    throw new Error('当前组合既没有 sessionController 也没有 agents 服务，无法建立协调者会话')
  }
  const sessionId = `session-${randomUUID()}`
  const defaults = ctx.get('agentDefaultModel')
  const handle = await agents.create({
    sessionId,
    ...defaults === undefined
      ? {}
      : {
          agentOptions: {
            get provider() { return defaults.currentSelection().provider },
            get model() { return defaults.currentSelection().model },
            get reasoningEffort() { return defaults.currentSelection().reasoningEffort },
          },
        },
    meta: { cwd: directory },
  })
  return handle?.agent?.id ?? sessionId
}

/**
 * 判断会话是否仍存在。
 *
 * `sessionQuery` 由 sqlite 引擎提供，引擎可能被部署替换，因此走惰性获取；缺失时
 * 返回 undefined，语义是「不知道」而不是「不存在」。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {string} sessionId - 会话 id
 * @returns {Promise<boolean | undefined>} 会话是否存在
 */
export async function sessionExistsWithCtx(ctx, sessionId) {
  const query = ctx.get('sessionQuery')
  if (query === undefined || typeof query.listSessions !== 'function') return undefined
  const records = await query.listSessions()
  return records.some((record) => record?.header?.id === sessionId)
}
