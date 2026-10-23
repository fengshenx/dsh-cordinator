/**
 * 项目作用域工具：`list_projects`、`switch_project`。
 *
 * dsh 没有「项目」这个实体，本 bundle 把**目录**当作项目：项目列表是「有会话的
 * 目录集合」，项目切换是「切到另一个目录的会话」。会话的目录在创建时定死
 * （`SessionHeader.cwd` 只读），所以切换只能落到另一个会话上——这与 Telov
 * 「切项目 = 切协调者会话」是同一件事，不是降级。
 *
 * 项目列表取自 `ctx.sessionQuery.listSessions()`：它合并持久化记录与 live
 * session（live 优先），项目列表因此不随进程重启漂移。宿主侧不能用
 * `ctx.sessions.list()`——那只返回进程内 live session，重启后昨天的项目就没了。
 *
 * @module dsh-coordinator/host/tools/projects
 */

import { basename } from 'node:path'

/**
 * 列出全部会话记录。
 *
 * `ctx.sessionQuery` 由 sqlite 引擎提供，base bundle 已挂载，但引擎可能被部署
 * 替换或缺席——与 `sessionController` 同属不能声明为必需 inject 的一类，缺失时
 * 降级为只列 live session。
 *
 * @param {object} ctx - Cordis 上下文
 * @returns {Promise<{ records: object[], complete: boolean }>} 会话记录与列表是否完整
 */
async function listSessionRecords(ctx) {
  const query = ctx.get?.('sessionQuery')
  if (query === undefined || query === null || typeof query.listSessions !== 'function') {
    const live = ctx.sessions.list().map((session) => ({ header: session.header, live: true }))
    return { records: live, complete: false }
  }
  const records = await query.listSessions()
  return { records, complete: true }
}

/**
 * 把会话记录按目录聚成项目。
 *
 * 子会话（`header.origin === 'subagent'`）不构成独立项目——它们的工作目录就是
 * 父会话的目录，单独列出会让项目列表多出重复项。
 *
 * @param {object[]} records - 会话记录
 * @returns {object[]} 项目列表
 */
function groupProjects(records) {
  /** @type {Map<string, { path: string, name: string, sessions: object[] }>} */
  const projects = new Map()
  for (const record of records) {
    const header = record?.header
    const directory = header?.cwd
    if (typeof directory !== 'string' || directory === '') continue
    if (header.origin === 'subagent') continue
    let project = projects.get(directory)
    if (project === undefined) {
      project = { path: directory, name: basename(directory), sessions: [] }
      projects.set(directory, project)
    }
    project.sessions.push({
      id: header.id,
      createdAt: header.createdAt,
      live: record.live === true,
    })
  }
  return [...projects.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * 找出目录下最可能的协调者会话。
 *
 * 目录不区分会话身份：同一个目录下可能同时有历史协调者会话、fork 与子会话。
 * 这里取**最近创建**的顶层会话作为候选——它是软约定「一个目录同一时刻至多一个
 * 活跃协调者会话」在工具层的落地。持久化记录只有 `createdAt` 可用（会话标题与
 * 更新时间属于客户端投影，不在持久化头部里），故排序依据是创建时间，运行中的
 * 会话优先。
 *
 * @param {object[]} sessions - 该目录下的顶层会话
 * @returns {object | undefined} 候选协调者会话
 */
function pickCoordinator(sessions) {
  if (sessions.length === 0) return undefined
  return [...sessions].sort((a, b) => {
    if (a.live !== b.live) return a.live === true ? -1 : 1
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })[0]
}

/**
 * 创建 `list_projects` 工具定义。
 * @param {object} options - 工具选项
 * @param {object} options.ctx - Cordis 上下文
 * @returns {object} dsh 工具定义
 */
export function createListProjectsTool({ ctx }) {
  return {
    name: 'list_projects',
    description:
      '列出可用项目。项目即目录，每个项目列出该目录下的顶层会话（子会话不单列）。项目列表来自持久化会话语料，重启后不会丢失。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          projects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                name: { type: 'string' },
                sessions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      createdAt: { type: 'number' },
                      live: { type: 'boolean' },
                    },
                    required: ['id'],
                  },
                },
              },
              required: ['path', 'name', 'sessions'],
            },
          },
          complete: {
            type: 'boolean',
            description: '列表是否完整。为 false 表示持久化会话语料不可用，只列出了运行中的会话。',
          },
        },
        required: ['projects', 'complete'],
      },
      render(args, value) {
        const projects = /** @type {{ projects: { path: string, name: string, sessions: object[] }[], complete: boolean }} */ (value).projects
        if (projects.length === 0) {
          return [{ type: 'text', text: '当前没有可用项目（没有任何会话的工作目录）。' }]
        }
        const lines = projects.map((project) => {
          const sessions = project.sessions
            .map((session) => `${session.id}${session.live ? '（运行中）' : ''}`)
            .join('、')
          return `${project.name}：${project.path}｜会话 ${sessions}`
        })
        const note = projects.complete ? '' : '\n注意：持久化会话语料不可用，本列表只含运行中的会话，可能不完整。'
        return [{ type: 'text', text: `共 ${projects.length} 个项目：\n${lines.join('\n')}${note}` }]
      },
    },
    async execute() {
      const { records, complete } = await listSessionRecords(ctx)
      return { projects: groupProjects(records), complete }
    },
  }
}

/**
 * 创建 `switch_project` 工具定义。
 * @param {object} options - 工具选项
 * @param {object} options.ctx - Cordis 上下文
 * @returns {object} dsh 工具定义
 */
export function createSwitchProjectTool({ ctx }) {
  return {
    name: 'switch_project',
    description:
      '解析目标项目并给出它的协调者会话。会话的工作目录在创建时定死，因此切换项目实际是切到另一个目录的会话。本工具不移动当前会话，只返回目标会话供导航；若该目录还没有协调者会话，会说明需要在目标目录新建。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目标项目目录的绝对路径，取自 list_projects 返回的 path。',
        },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          name: { type: 'string' },
          found: { type: 'boolean', description: '该目录是否已有协调者会话。' },
          sessionId: { type: 'string', description: '协调者会话 id；found 为 false 时为空串。' },
          complete: { type: 'boolean' },
        },
        required: ['path', 'name', 'found', 'sessionId', 'complete'],
      },
      render(args, value) {
        const result = /** @type {{ path: string, name: string, found: boolean, sessionId: string, complete: boolean }} */ (value)
        if (!result.found) {
          return [
            {
              type: 'text',
              text: `项目「${result.name}」(${result.path}) 还没有协调者会话。需要在该目录新建一个会话再切过去。`,
            },
          ]
        }
        return [
          {
            type: 'text',
            text: `项目「${result.name}」(${result.path}) 的协调者会话是 ${result.sessionId}。切到该会话即完成项目切换。`,
          },
        ]
      },
    },
    async execute(args) {
      const input = /** @type {{ path?: string }} */ (args)
      if (typeof input.path !== 'string' || input.path.trim() === '') {
        throw new Error('switch_project: path 不能为空')
      }
      const path = input.path.trim()
      const { records, complete } = await listSessionRecords(ctx)
      const projects = groupProjects(records)
      const project = projects.find((item) => item.path === path)
      if (project === undefined) {
        return { path, name: basename(path), found: false, sessionId: '', complete }
      }
      const coordinator = pickCoordinator(project.sessions)
      return {
        path: project.path,
        name: project.name,
        found: coordinator !== undefined,
        sessionId: coordinator?.id ?? '',
        complete,
      }
    },
  }
}
