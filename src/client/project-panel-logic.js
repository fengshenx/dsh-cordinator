/**
 * 左栏项目区块的纯逻辑。
 *
 * 浏览器侧没有 `node:path`，路径末段要自己取；两种分隔符都得认——宿主可能在
 * Windows 上把目录写成反斜杠形式。
 *
 * @module dsh-coordinator/client/project-panel-logic
 */

/** 项目名的长度上限，与宿主侧一致。 */
export const MAX_PROJECT_NAME_LENGTH = 200

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
