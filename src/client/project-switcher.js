/**
 * 项目切换器的纯逻辑。
 *
 * 项目即目录。客户端的会话列表带着每个会话的工作目录（`SessionSummary.cwd`），
 * 把它们按目录聚合就得到项目列表。子会话（`origin === 'subagent'`）的工作目录
 * 就是父会话的目录，单独列出会让项目列表出现重复项。
 *
 * 纯函数部分不碰 React，便于单测。
 *
 * @module dsh-coordinator/client/project-switcher
 */

/**
 * 取路径的末段名称。
 *
 * 客户端跑在浏览器里，没有 `node:path` 可用；路径分隔符两种都得认——宿主可能在
 * Windows 上把工作目录写成反斜杠形式。
 *
 * @param {string} path - 目录路径
 * @returns {string} 末段名称
 */
export function basenameOf(path) {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/**
 * 把会话列表按工作目录聚成项目。
 *
 * @param {readonly object[]} rows - 会话行
 * @returns {object[]} 项目列表，按目录路径升序
 */
export function groupSessionsByProject(rows) {
  /** @type {Map<string, { path: string, name: string, sessions: object[] }>} */
  const projects = new Map()
  for (const row of rows) {
    const directory = row?.cwd
    if (typeof directory !== 'string' || directory === '') continue
    if (row.origin === 'subagent') continue
    let project = projects.get(directory)
    if (project === undefined) {
      project = { path: directory, name: basenameOf(directory), sessions: [] }
      projects.set(directory, project)
    }
    project.sessions.push({
      id: row.id,
      displayTitle: typeof row.displayTitle === 'string' ? row.displayTitle : '',
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
    })
  }
  for (const project of projects.values()) {
    project.sessions.sort((left, right) => right.updatedAt - left.updatedAt)
  }
  return [...projects.values()].sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * 选出目录下的目标会话。
 *
 * 目录不区分会话身份，同一目录下可能有历史协调者会话与 fork。取**最近更新**的
 * 那个作为切换目标——它是「一个目录同一时刻至多一个活跃协调者会话」这一约定在
 * 客户端的落地。
 *
 * @param {object[]} sessions - 该目录下的会话
 * @returns {object | undefined} 目标会话
 */
export function pickProjectSession(sessions) {
  if (sessions.length === 0) return undefined
  return sessions[0]
}

/**
 * 取某个会话所属项目的目录。
 *
 * @param {readonly object[]} rows - 会话行
 * @param {string} sessionId - 会话 id
 * @returns {string | undefined} 目录绝对路径
 */
export function projectPathOf(rows, sessionId) {
  const row = rows.find((item) => item.id === sessionId)
  return typeof row?.cwd === 'string' && row.cwd !== '' ? row.cwd : undefined
}
