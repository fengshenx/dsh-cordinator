/**
 * 把项目下的会话从官方工作区树里排除。
 *
 * 官方工作区树由宿主渲染，落在左栏的 `sidebar.workspaces` 槽里，那个槽是 single
 * 且已被官方占用，第三方既不能换掉它，也没有「按项目排除会话」的扩展点。
 *
 * 官方确实提供归档接口（`workspaceRegistry.archiveSession` 会把会话从**所有**
 * 分组面里摘掉），但归档是用户可见的持久状态：会话会出现在官方的归档视图里，
 * 项目注销时还得逐个反归档，用户自己归档过的会话更不能被我们反归档。借用它做
 * 「排除」会把两件事搅在一起。
 *
 * 因此这里走**渲染层**：官方会话行带 `data-row-key="session:<id>"`，认得出会话
 * id，命中排除集的行加一个类由样式表隐藏。官方的数据层不动，用户在别处的操作
 * （打开会话、搜索）不受影响；代价是官方分组行上的会话计数仍包含被隐藏的会话。
 *
 * @module dsh-coordinator/client/workspace-exclusion
 */

/** 命中排除集的会话行所用的类名。 */
const HIDDEN_CLASS = 'dsh-coordinator-excluded-session'

/** 隐藏规则的样式表 id。 */
const STYLE_ID = 'dsh-coordinator-workspace-exclusion'

const STYLE_TEXT = `
.dsh-coordinator-excluded-session {
  display: none !important;
}
`

/**
 * 注入隐藏规则。同一页面只注入一次。
 * @returns {void}
 */
function ensureStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_TEXT
  document.head.append(style)
}

/**
 * 从 `data-row-key` 里取会话 id。
 * @param {string} rowKey - 行标识
 * @returns {string | undefined} 会话 id；不是会话行时 undefined
 */
function sessionIdOf(rowKey) {
  if (typeof rowKey !== 'string' || !rowKey.startsWith('session:')) return undefined
  return rowKey.slice('session:'.length)
}

/**
 * 按排除集标记一行。
 *
 * 抽成独立函数是为了能脱离 DOM 单测：行只需提供 `getAttribute` 与 `classList`。
 *
 * @param {object} row - 会话行元素
 * @param {Set<string>} excluded - 要排除的会话 id
 * @returns {boolean} 该行是否被标记为隐藏
 */
export function markSessionRow(row, excluded) {
  const id = sessionIdOf(row.getAttribute('data-row-key'))
  const hidden = id !== undefined && excluded.has(id)
  row.classList.toggle(HIDDEN_CLASS, hidden)
  return hidden
}

/**
 * 创建排除器。
 *
 * 观察整棵文档：官方树重绘、虚拟滚动新增行、以及 React 重写 className，都会触发
 * 重新标记。全量扫描的范围是「所有会话行」，左栏里数量有限，开销可忽略。
 *
 * @returns {{ update: (sessionIds: Iterable<string>) => void, dispose: () => void }} 排除器
 */
export function createWorkspaceExclusion() {
  /** @type {Set<string>} 要从官方树里排除的会话 id */
  let excluded = new Set()
  /** @type {MutationObserver | undefined} 观察器 */
  let observer

  /**
   * 按当前排除集重新标记所有会话行。
   * @returns {void}
   */
  const markAll = () => {
    if (typeof document === 'undefined') return
    const rows = document.querySelectorAll('[data-row-key^="session:"]')
    for (const row of rows) {
      markSessionRow(row, excluded)
    }
  }

  if (typeof document !== 'undefined') {
    ensureStyles()
    observer = new MutationObserver(() => markAll())
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
  }

  return {
    /**
     * 更新排除集。
     * @param {Iterable<string>} sessionIds - 要排除的会话 id
     * @returns {void}
     */
    update(sessionIds) {
      excluded = new Set(sessionIds)
      markAll()
    },

    /**
     * 停止观察并清理隐藏状态。
     * @returns {void}
     */
    dispose() {
      observer?.disconnect()
      observer = undefined
      if (typeof document === 'undefined') return
      for (const row of document.querySelectorAll(`.${HIDDEN_CLASS}`)) {
        row.classList.remove(HIDDEN_CLASS)
      }
    },
  }
}
