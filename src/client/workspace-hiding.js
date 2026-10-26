/**
 * 把插件注册的工作区从官方工作区树里隐藏。
 *
 * 官方 UI 只能打开归属工作区的会话（宿主 `session.create` 传 `cwd` 建出的会话
 * 不归属任何工作区），所以项目目录必须在宿主里有一个工作区。副作用是这些工作区
 * 会出现在官方左栏的工作区树里——它们属于「项目」语境，不是「代码语境」，摆在
 * 官方树里既重复又占位。
 *
 * 宿主的工作区记录是封闭 schema（`path` / `title` / `sessionIds` / 时间戳），
 * 没有「隐藏」位，官方也没有按外部集合隐藏分组的扩展点。因此这里走**渲染层**：
 * 官方工作区分组行带 `data-row-key="workspace:<id>"`，命中集合的行打上标记属性
 * 并由样式表隐藏，官方数据层不动。
 *
 * 与 `workspace-exclusion.js` 的差别只在于对象：那边排会话行，这边排工作区行。
 *
 * @module dsh-coordinator/client/workspace-hiding
 */

/** 命中隐藏集的工作区行所用的类名。 */
const HIDDEN_CLASS = 'dsh-coordinator-hidden-workspace'

/** 命中隐藏集的工作区行上的标记属性。 */
const MARK_ATTRIBUTE = 'data-dsh-coordinator-workspace'

/** 隐藏规则的样式表 id。 */
const STYLE_ID = 'dsh-coordinator-workspace-hiding'

const STYLE_TEXT = `
.${HIDDEN_CLASS} {
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
 * 从 `data-row-key` 里取工作区 id。
 * @param {string} rowKey - 行标识
 * @returns {string | undefined} 工作区 id；不是工作区行时 undefined
 */
function workspaceIdOf(rowKey) {
  if (typeof rowKey !== 'string' || !rowKey.startsWith('workspace:')) return undefined
  const id = rowKey.slice('workspace:'.length)
  return id === '' ? undefined : id
}

/**
 * 按隐藏集标记一行。
 *
 * 抽成独立函数是为了能脱离 DOM 单测：行只需提供 `getAttribute`、`setAttribute`
 * 与 `classList`。
 *
 * @param {object} row - 工作区行元素
 * @param {Set<string>} hidden - 要隐藏的工作区 id
 * @returns {boolean} 该行是否被标记为隐藏
 */
export function markWorkspaceRow(row, hidden) {
  const id = workspaceIdOf(row.getAttribute('data-row-key'))
  const isHidden = id !== undefined && hidden.has(id)
  row.classList.toggle(HIDDEN_CLASS, isHidden)
  if (isHidden) row.setAttribute(MARK_ATTRIBUTE, 'true')
  else row.removeAttribute(MARK_ATTRIBUTE)
  return isHidden
}

/**
 * 创建隐藏器。
 *
 * 观察整棵文档：官方树重绘、虚拟滚动新增行、以及 React 重写 className，都会触发
 * 重新标记。全量扫描的范围是「所有工作区行」，左栏里数量有限，开销可忽略。
 *
 * @returns {{ update: (workspaceIds: Iterable<string>) => void, dispose: () => void }} 隐藏器
 */
export function createWorkspaceHiding() {
  /** @type {Set<string>} 要从官方树里隐藏的工作区 id */
  let hidden = new Set()
  /** @type {MutationObserver | undefined} 观察器 */
  let observer

  /**
   * 按当前隐藏集重新标记所有工作区行。
   * @returns {void}
   */
  const markAll = () => {
    if (typeof document === 'undefined') return
    const rows = document.querySelectorAll('[data-row-key^="workspace:"]')
    for (const row of rows) {
      markWorkspaceRow(row, hidden)
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
     * 更新隐藏集。
     * @param {Iterable<string>} workspaceIds - 要隐藏的工作区 id
     * @returns {void}
     */
    update(workspaceIds) {
      hidden = new Set(workspaceIds)
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
        row.removeAttribute(MARK_ATTRIBUTE)
      }
    },
  }
}
