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

/**
 * 挑出项目下要列出的会话行。
 *
 * 协调者不在其中——项目名就是它的入口，重复列出会让「点项目名打开协调者」这条
 * 路径变得含糊。宿主侧暂时取不到的会话行（会话刚建、列表还没同步）直接略过。
 *
 * @param {object} options - 选项
 * @param {string[]} options.sessionIds - 该项目的会话 id 列表
 * @param {Record<string, object>} options.sessionRows - 会话 id 到会话行
 * @param {string | undefined} options.coordinatorSessionId - 协调者会话 id
 * @returns {object[]} 要渲染的会话行
 */
export function selectProjectSessionRows({ sessionIds, sessionRows, coordinatorSessionId }) {
  const rows = []
  for (const sessionId of sessionIds ?? []) {
    if (sessionId === coordinatorSessionId) continue
    const row = sessionRows?.[sessionId]
    if (row === undefined) continue
    rows.push(row)
  }
  return rows
}
