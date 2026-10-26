/**
 * 项目作用域工具：`list_projects`、`add_project`、`switch_project`、`remove_project`。
 *
 * **项目是显式注册的编排容器**，不是目录。项目容器里装着：一个在项目目录运行的
 * 协调者会话、该项目的任务卡片、该项目的 worker，以及项目根目录的 `SLOTS.md`
 * 角色手册。同一个目录可以挂多个项目——目录是代码语境，项目是编排语境，二者
 * 不合并。
 *
 * 项目注册表落在宿主侧（`$DSH_HOME/dsh-coordinator/projects.json`），不占用会话
 * 存储：会话头没有自由元数据槽，会话与项目的绑定靠项目记录里的
 * `coordinatorSessionId` 指针。
 *
 * @module dsh-coordinator/host/tools/projects
 */

/**
 * 创建 `list_projects` 工具定义。
 * @param {object} options - 工具选项
 * @param {object} options.service - 项目服务
 * @returns {object} dsh 工具定义
 */
export function createListProjectsTool({ service }) {
  return {
    name: 'list_projects',
    description:
      '列出已注册的项目。项目是编排容器——每个项目有一个在项目目录里运行的协调者会话，项目卡片与 worker 都归属它。项目按创建顺序列出。',
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
                id: { type: 'string' },
                name: { type: 'string' },
                directory: { type: 'string' },
                coordinatorSessionId: { type: 'string' },
                coordinatorAlive: {
                  type: 'boolean',
                  description: '协调者会话是否仍在。false 表示会话已被删除，需要换新协调者。',
                },
              },
              required: ['id', 'name', 'directory'],
            },
          },
        },
        required: ['projects'],
      },
      render(args, value) {
        const projects = /** @type {{ projects: object[] }} */ (value).projects
        if (projects.length === 0) {
          return [{ type: 'text', text: '当前没有已注册的项目。用 add_project 建一个。' }]
        }
        const lines = projects.map((project) => {
          const session = project.coordinatorSessionId ?? '（无）'
          const alive = project.coordinatorAlive === false ? '，协调者会话已失效' : ''
          return `${project.name}（${project.id}）：${project.directory}｜协调者会话 ${session}${alive}`
        })
        return [{ type: 'text', text: `共 ${projects.length} 个项目：\n${lines.join('\n')}` }]
      },
    },
    async execute() {
      return { projects: await service.list() }
    },
  }
}

/**
 * 创建 `add_project` 工具定义。
 * @param {object} options - 工具选项
 * @param {object} options.service - 项目服务
 * @returns {object} dsh 工具定义
 */
export function createAddProjectTool({ service }) {
  return {
    name: 'add_project',
    description:
      '注册一个新项目：在一个已存在的目录里建一个协调者会话，并把该会话绑为这个项目的协调者。项目目录不可更改——想换目录就换一个新项目。',
    parameters: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: '项目目录的绝对路径。目录必须已存在且是目录。',
        },
        name: {
          type: 'string',
          description: '项目名。缺省用目录末段名。',
        },
      },
      required: ['directory'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          directory: { type: 'string' },
          coordinatorSessionId: { type: 'string' },
        },
        required: ['id', 'name', 'directory', 'coordinatorSessionId'],
      },
      render(args, value) {
        const project = /** @type {{ id: string, name: string, directory: string, coordinatorSessionId: string }} */ (value)
        return [
          {
            type: 'text',
            text: `已注册项目「${project.name}」(${project.id})，目录 ${project.directory}，协调者会话 ${project.coordinatorSessionId}。`,
          },
        ]
      },
    },
    async execute(args) {
      const input = /** @type {{ directory?: string, name?: string }} */ (args)
      const project = await service.create({
        directory: input.directory ?? '',
        ...input.name === undefined ? {} : { name: input.name },
      })
      return project
    },
  }
}

/**
 * 创建 `switch_project` 工具定义。
 * @param {object} options - 工具选项
 * @param {object} options.service - 项目服务
 * @returns {object} dsh 工具定义
 */
export function createSwitchProjectTool({ service }) {
  return {
    name: 'switch_project',
    description:
      '解析目标项目并给出它的协调者会话。切换项目实际是切到那个项目的协调者会话——会话的工作目录在创建时定死。本工具不移动当前会话，只返回目标会话供导航。',
    parameters: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: '目标项目 id，取自 list_projects 返回的 id。',
        },
        name: {
          type: 'string',
          description: '目标项目名。与 projectId 二选一；同时给出时以 projectId 为准。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          found: { type: 'boolean', description: '是否找到目标项目。' },
          id: { type: 'string' },
          name: { type: 'string' },
          directory: { type: 'string' },
          sessionId: { type: 'string', description: '协调者会话 id；found 为 false 时为空串。' },
          coordinatorAlive: { type: 'boolean' },
        },
        required: ['found', 'id', 'name', 'directory', 'sessionId'],
      },
      render(args, value) {
        const result = /** @type {{ found: boolean, name: string, directory: string, sessionId: string, coordinatorAlive?: boolean }} */ (value)
        if (!result.found) {
          return [{ type: 'text', text: '没有找到目标项目。用 list_projects 看现有项目。' }]
        }
        const dead = result.coordinatorAlive === false ? '（该会话已被删除，需要换新协调者）' : ''
        return [
          {
            type: 'text',
            text: `项目「${result.name}」(${result.directory}) 的协调者会话是 ${result.sessionId}${dead}。切到该会话即完成项目切换。`,
          },
        ]
      },
    },
    async execute(args) {
      const input = /** @type {{ projectId?: string, name?: string }} */ (args)
      const projects = await service.list()
      const target = input.projectId !== undefined && input.projectId !== ''
        ? projects.find((project) => project.id === input.projectId)
        : projects.find((project) => project.name === input.name)
      if (target === undefined) {
        return { found: false, id: '', name: input.name ?? '', directory: '', sessionId: '' }
      }
      return {
        found: true,
        id: target.id,
        name: target.name,
        directory: target.directory,
        sessionId: target.coordinatorSessionId ?? '',
        coordinatorAlive: target.coordinatorAlive,
      }
    },
  }
}

/**
 * 创建 `remove_project` 工具定义。
 * @param {object} options - 工具选项
 * @param {object} options.service - 项目服务
 * @returns {object} dsh 工具定义
 */
export function createRemoveProjectTool({ service }) {
  return {
    name: 'remove_project',
    description:
      '注销一个项目。协调者会话会被保留——它是会话历史，注销项目不影响它继续留在会话列表里。卡片不随项目删除。',
    parameters: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: '要注销的项目 id，取自 list_projects 返回的 id。',
        },
      },
      required: ['projectId'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          removed: { type: 'boolean', description: '项目是否被注销。false 表示 id 不存在。' },
        },
        required: ['removed'],
      },
      render(args, value) {
        const result = /** @type {{ removed: boolean }} */ (value)
        return [
          {
            type: 'text',
            text: result.removed
              ? '项目已注销；它的协调者会话仍在会话列表里保留。'
              : '没有找到该项目。',
          },
        ]
      },
    },
    async execute(args) {
      const input = /** @type {{ projectId?: string }} */ (args)
      if (typeof input.projectId !== 'string' || input.projectId.trim() === '') {
        throw new Error('remove_project: projectId 不能为空')
      }
      const removed = await service.remove(input.projectId)
      return { removed: removed !== undefined }
    },
  }
}
