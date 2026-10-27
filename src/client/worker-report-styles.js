/**
 * worker 回报气泡的样式。
 *
 * 颜色与圆角全部走宿主 `--dsw-*` 令牌，不写死色值——第三方 bundle 不能 import
 * 宿主 UI 包，只能引用它们已经落在页面上的 CSS 变量。
 *
 * @module dsh-coordinator/client/worker-report-styles
 */

const STYLE_ID = 'dsh-coordinator-worker-report'

const STYLE_TEXT = `
.dsh-coordinator-worker-report {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
}

.dsh-coordinator-worker-report__identity {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dsh-coordinator-worker-report__avatar {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  flex-shrink: 0;
}

.dsh-coordinator-worker-report__name {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
}

.dsh-coordinator-worker-report__name:hover {
  color: var(--dsw-alias-label-primary);
  text-decoration: underline;
}

.dsh-coordinator-worker-report__bubble {
  max-width: min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%);
  /* 淡底：按前景色混出极淡的一层，浅色主题是几乎看不出的灰，深色主题是微亮。 */
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xl);
  padding: 10px 16px;
  font-size: var(--dsh-content-font-size, 14px);
  line-height: calc(22px + var(--dsh-content-font-delta, 0px));
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.dsh-coordinator-worker-report__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 2px;
}

.dsh-coordinator-worker-report__time {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-coordinator-worker-report__copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-coordinator-worker-report__copy:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
  color: var(--dsw-alias-label-secondary);
}
`

/**
 * 注入 worker 回报的样式（同一页面只注入一次）。
 * @returns {void}
 */
export function ensureWorkerReportStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_TEXT
  document.head.append(style)
}
