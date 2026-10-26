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
import { createCanonicalizer, groupSessionsByProject } from './session-index.js'

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

  /**
   * 协调者会话 id → 项目目录的内存镜像。
   *
   * 项目注册表是异步落盘的，而提示词组装与派工都需要**同步**拿到「这个会话属于
   * 哪个项目」。卡片库用的是同一手法：落盘是真源，内存镜像是读路径。
   */
  const coordinatorIndex = new Map()

  // 目录归一器在进程内共享：会话头里的 cwd 高度重复，重复 realpath 纯属浪费。
  const canonicalize = createCanonicalizer(realpath)

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

      // 先建会话再建记录：会话建不出来时项目不落盘，失败路径没有半条记录。
      const coordinatorSessionId = await openCoordinatorSession(normalizedDirectory)
      const draft = store.draft({
        name: displayName,
        directory: normalizedDirectory,
        coordinatorSessionId,
      })
      try {
        const inserted = await store.insert(draft)
        coordinatorIndex.set(coordinatorSessionId, normalizedDirectory)
        return inserted
      } catch (error) {
        await abandonCoordinatorSession(coordinatorSessionId)
        throw error
      }
    },

    /**
     * 列项目，并标注协调者会话是否仍在。
     *
     * @returns {Promise<object[]>} 项目列表
     */
    async list() {
      const projects = await store.list()
      return Promise.all(projects.map(async (project) => ({
        ...project,
        coordinatorAlive: await coordinatorExists(project.coordinatorSessionId),
      })))
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
      return { ...project, coordinatorAlive: await coordinatorExists(project.coordinatorSessionId) }
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
      return { ...project, coordinatorAlive: await coordinatorExists(project.coordinatorSessionId) }
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
      const coordinatorSessionId = await openCoordinatorSession(project.directory)
      try {
        const updated = await store.update(id, { coordinatorSessionId })
        if (typeof project.coordinatorSessionId === 'string') {
          coordinatorIndex.delete(project.coordinatorSessionId)
        }
        coordinatorIndex.set(coordinatorSessionId, project.directory)
        return updated
      } catch (error) {
        await abandonCoordinatorSession(coordinatorSessionId)
        throw error
      }
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
 * 用宿主服务建一个协调者会话。
 *
 * 优先走 `sessionController`（官方完整路径：建 agent、带上默认模型），它只挂在
 * web-app bundle 上；缺失时退回 `agents` 注册表直接建 agent——`agents` 由 base
 * bundle 提供，所有 profile 都有。两个服务都走惰性获取：它们不在本插件的
 * `inject` 列表里，声明成必需依赖会让不含该服务的 profile 整个插件挂起。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {string} directory - 项目目录绝对路径
 * @returns {Promise<string>} 会话 id
 */
export async function createCoordinatorSessionWithCtx(ctx, directory) {
  const controller = ctx.get('sessionController')
  if (controller !== undefined && typeof controller.create === 'function') {
    const created = await controller.create({ cwd: directory })
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
