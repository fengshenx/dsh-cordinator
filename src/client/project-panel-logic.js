/**
 * 左栏项目区块的纯逻辑。
 *
 * 浏览器侧没有 `node:path`，路径末段要自己取；两种分隔符都得认——宿主可能在
 * Windows 上把目录写成反斜杠形式。
 *
 * @module dsh-coordinator/client/project-panel-logic
 */

import { MAX_PROJECT_NAME_LENGTH } from '../shared/projects.js'

export { MAX_PROJECT_NAME_LENGTH }

/**
 * 取路径的末段名称。
 * @param {string} path - 目录路径
 * @returns {string} 末段名称
 */
export function basenameOf(path) {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/**
 * 校验项目名。
 * @param {string} name - 候选项目名
 * @returns {{ ok: boolean, error: string }} 校验结果
 */
export function validateProjectName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, error: '项目名不能为空' }
  }
  if (name.trim().length > MAX_PROJECT_NAME_LENGTH) {
    return { ok: false, error: `项目名过长（上限 ${MAX_PROJECT_NAME_LENGTH} 字）` }
  }
  return { ok: true, error: '' }
}

/**
 * 把目录末段当默认项目名，并判定它能不能直接用。
 *
 * 能用就直接建项目（用户挑完目录就看到建好的项目）；不能用就得让用户改名——
 * 直接提交只会换回一条没有出口的报错。
 *
 * @param {string} directory - 选中的目录
 * @returns {{ name: string, ok: boolean, error: string }} 默认名与判定
 */
export function defaultProjectName(directory) {
  const name = basenameOf(directory)
  const check = validateProjectName(name)
  return { name, ok: check.ok, error: check.error }
}

/**
 * 判定一个项目能否直接打开。
 *
 * 协调者会话被删除后项目仍在注册表里，但点开没有去处——那种项目要提示换新
 * 协调者，而不是安静地不响应。
 *
 * @param {object} project - 项目记录
 * @returns {boolean} 协调者会话是否可用
 */
export function isProjectOpenable(project) {
  if (typeof project?.coordinatorSessionId !== 'string' || project.coordinatorSessionId === '') {
    return false
  }
  return project.coordinatorAlive !== false
}

/**
 * 挑出项目下要列出的会话行。
 *
 * 协调者不在其中——项目名就是它的入口，重复列出会让「点项目名打开协调者」这条
 * 路径变得含糊。已归档的会话也不列：归档是「从列表移除」这个动作的结果，宿主
 * 的会话索引按磁盘目录扫，归档后那条记录仍在索引里，不在这里滤掉就会原地复活。
 * 宿主侧暂时取不到的会话行（会话刚建、列表还没同步）直接略过。
 *
 * @param {object} options - 选项
 * @param {string[]} options.sessionIds - 该项目的会话 id 列表
 * @param {Record<string, object>} options.sessionRows - 会话 id 到会话行
 * @param {string | undefined} options.coordinatorSessionId - 协调者会话 id
 * @param {Set<string>} [options.archivedSessionIds] - 已归档的会话 id
 * @returns {object[]} 要渲染的会话行
 */
export function selectProjectSessionRows({
  sessionIds,
  sessionRows,
  coordinatorSessionId,
  archivedSessionIds,
}) {
  const rows = []
  for (const sessionId of sessionIds ?? []) {
    if (sessionId === coordinatorSessionId) continue
    if (archivedSessionIds?.has(sessionId) === true) continue
    const row = sessionRows?.[sessionId]
    if (row === undefined) continue
    rows.push(row)
  }
  return rows
}

/**
 * 判定归档失败是不是「会话还在跑」。
 *
 * 宿主对有心跳任务的会话默认拒绝归档（`workspace/session-active`），确认后才肯
 * 停掉任务再归档。其余失败（没有该会话、没有权限、通道断了）都不该问用户「要
 * 不要停」——那种提示只会把人引到一个同样失败的确认框。
 *
 * @param {unknown} reason - 宿主抛出的错误
 * @returns {boolean} 是否为「会话仍在执行」的拒绝
 */
export function isArchiveActiveRefusal(reason) {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return false
  const code = reason.rpcError?.code
  return code === 'workspace/session-active'
}

/**
 * 打开项目的协调者会话。
 *
 * 官方 UI 只能打开归属工作区的会话（宿主建会话时传 `cwd` 的话不归属任何工作
 * 区），因此先让宿主把协调者会话挂到项目目录对应的工作区，挂不上就把原因报给
 * 用户，不静默失败。
 *
 * 挂上之后直接打开会话：协调者会话是空的，官方界面按空会话渲染，但插件会用
 * 一个会话视图目标把它顶进「输入框停靠底部」的对话形态（见 `coordinator-view.js`），
 * 不需要先跑一轮模型。
 *
 * @param {object} options - 选项
 * @param {object} options.project - 项目
 * @param {(method: string, args: unknown[]) => Promise<unknown>} options.callRemote - 调用宿主远程方法
 * @param {(sessionId: string) => void} options.openSession - 打开会话
 * @returns {Promise<{ok: boolean, message?: string, workspaceId?: string}>} 打开结果
 */
export async function openCoordinatorSession({ project, callRemote, openSession }) {
  try {
    const result = await callRemote('attachCoordinator', [project.id])
    if (result?.attached !== true) {
      return { ok: false, message: result?.reason ?? '协调者会话挂到工作区失败。' }
    }
    openSession(project.coordinatorSessionId)
    // 宿主可能刚为这个目录注册了工作区，把归属带回去给调用方更新列表。
    return { ok: true, workspaceId: result.workspaceId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `协调者会话挂到工作区失败：${message}` }
  }
}

/**
 * 构造项目行「更多」菜单的条目。
 *
 * 纯函数：菜单项的显隐规则只有一条——项目有由插件注册的工作区时，才给
 * 「从 dsh 移除工作区」这个入口；没有就没有，免得点了只得到一句「没有工作区」。
 *
 * @param {object} project - 项目
 * @param {{open: boolean, onOpen: Function, onRename: Function, onReplace: Function, onRemove: Function, onRequestRemoveWorkspace: Function}} handlers - 各项的处理函数
 * @returns {object[]} 菜单条目
 */
export function buildProjectMenuItems(project, handlers) {
  const items = []
  if (handlers.open) {
    items.push({ id: 'open', label: '打开协调者会话', icon: 'new-chat-outline', onSelect: () => handlers.onOpen(project) })
  }
  items.push({ id: 'rename', label: '重命名', icon: 'edit-outline', onSelect: () => handlers.onRename(project) })
  items.push({ id: 'replace', label: '换新协调者', icon: 'refresh-outline', onSelect: () => handlers.onReplace(project) })
  if (typeof project.workspaceId === 'string' && project.workspaceId !== '') {
    items.push({ id: 'remove-workspace', label: '从 dsh 移除工作区', icon: 'close-outline', onSelect: () => handlers.onRequestRemoveWorkspace(project) })
  }
  items.push({ id: 'remove', label: '注销项目', icon: 'trash-outline', danger: true, onSelect: () => handlers.onRemove(project) })
  return items
}

/**
 * 说清「移除工作区」会发生什么。
 *
 * 宿主的工作区删除只删注册，目录与全部会话日志都留着，协调者会话仍在——用户
 * 最担心的是「会话被删了」，这句必须把这点讲明白。
 *
 * @param {object} project - 项目
 * @returns {string} 确认弹窗的说明文字
 */
export function describeWorkspaceRemoval(project) {
  return `将把项目「${project.name}」的工作区从 dsh 里移除。文件夹与全部会话记录都会保留，协调者会话仍在；下次打开这个项目会重新挂上。`
}
