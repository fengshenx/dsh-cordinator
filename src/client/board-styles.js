/**
 * 看板样式表。
 *
 * 数值照抄 Telov 的看板实现（`apps/electron/src/renderer/components/board/`）：
 * 8px 圆角、6px 卡间距、13px 标题、11px 弱化文字、22px 链接行缩进。颜色一律走
 * 宿主 `--dsw-*` 令牌，不写死色值——第三方 bundle 不能 import 宿主 UI 包
 * （见 docs/subsystems/web-client.zh.md:93），既没有 Tailwind 也没有宿主 CSS
 * module 可用，只能自注入样式表（沿用 `modal-shell.js` 的做法）。
 *
 * @module dsh-coordinator/client/board-styles
 */

/** 样式表 id，同一页面只注入一次。 */
const STYLE_ID = 'dsh-coordinator-board'

/**
 * 样式表内容。类名统一 `dsh-coordinator-board-*` 前缀，避免与宿主样式撞名。
 */
const STYLE_TEXT = `
.dsh-coordinator-board {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.dsh-coordinator-board-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 24px;
}

.dsh-coordinator-board-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 卡面：无边框无阴影，静态零装饰，hover 只出背景 */
.dsh-coordinator-board-card {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out);
}

.dsh-coordinator-board-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-coordinator-board-card:focus-visible {
  outline: 1px solid var(--dsw-alias-link);
  outline-offset: -1px;
}

.dsh-coordinator-board-card-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

/* 信号灯槽：固定 14px，让各卡的标题左缘对齐 */
.dsh-coordinator-board-signal-slot {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 20px;
}

.dsh-coordinator-board-signal {
  display: inline-block;
  box-sizing: border-box;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.4;
}

/* 等你输入与未读同色不同动效：都在等你动作，但「有人在等」与「有结果没看」不同 */
.dsh-coordinator-board-signal-waiting {
  background: var(--dsw-static-blue-500);
  opacity: 1;
  animation: dsh-coordinator-board-pulse 1.6s ease-in-out infinite;
}

.dsh-coordinator-board-signal-unread {
  background: var(--dsw-static-blue-500);
  opacity: 1;
}

.dsh-coordinator-board-signal-running {
  background: var(--dsw-alias-state-warn-primary);
  opacity: 1;
  animation: dsh-coordinator-board-pulse 1.6s ease-in-out infinite;
}

.dsh-coordinator-board-signal-attention {
  background: var(--dsw-alias-state-error-primary);
  opacity: 1;
}

.dsh-coordinator-board-signal-idle {
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.55;
}

/* 未派工与状态未知共用虚线圈：两者都不谎称空闲，形状上与实心档区分 */
.dsh-coordinator-board-signal-unknown,
.dsh-coordinator-board-signal-none {
  background: transparent;
  border: 1px dashed var(--dsw-alias-label-tertiary);
  opacity: 0.55;
}

@keyframes dsh-coordinator-board-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-coordinator-board-signal-running,
  .dsh-coordinator-board-signal-waiting { animation: none; }
}

.dsh-coordinator-board-card-number {
  flex: none;
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.7;
}

.dsh-coordinator-board-card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.dsh-coordinator-board-card-stalled {
  flex: none;
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-state-warn-primary);
}

/* 链接行与元信息行缩进 22px，对齐标题文字起点 */
.dsh-coordinator-board-card-links {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  padding-left: 22px;
  overflow: hidden;
  white-space: nowrap;
}

/* 测量层：全量 chip 与「+N」的不可见副本（visibility: hidden 仍参与布局），
   只用来量真实宽度，不承载交互。标签必须与真实 chip 同构（a / button）——
   UA 默认样式只要有一条没被覆盖，量出的宽度就和渲染不一致 */
.dsh-coordinator-board-links-measure {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  visibility: hidden;
  pointer-events: none;
}

.dsh-coordinator-board-link-chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  max-width: 110px;
  padding: 1px 6px;
  border: 1px solid var(--dsw-alias-border-l3);
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-link);
  opacity: 0.8;
  background: transparent;
  cursor: pointer;
  text-decoration: none;
  overflow: hidden;
}

.dsh-coordinator-board-link-chip:hover {
  opacity: 1;
}

.dsh-coordinator-board-link-chip-body {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.dsh-coordinator-board-link-chip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-coordinator-board-link-overflow {
  font-family: var(--ds-font-family-code);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
  opacity: 1;
}

.dsh-coordinator-board-card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
  padding-left: 22px;
}

.dsh-coordinator-board-slot-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

.dsh-coordinator-board-slot-chip:hover {
  color: var(--dsw-alias-label-primary);
}

.dsh-coordinator-board-slot-dot {
  display: inline-block;
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.4;
}

.dsh-coordinator-board-slot-dot-waiting {
  background: var(--dsw-static-blue-500);
  opacity: 1;
  animation: dsh-coordinator-board-pulse 1.6s ease-in-out infinite;
}

.dsh-coordinator-board-slot-dot-unread {
  background: var(--dsw-static-blue-500);
  opacity: 1;
}

.dsh-coordinator-board-slot-dot-running {
  background: var(--dsw-alias-state-warn-primary);
  opacity: 1;
  animation: dsh-coordinator-board-pulse 1.6s ease-in-out infinite;
}

.dsh-coordinator-board-slot-dot-attention {
  background: var(--dsw-alias-state-error-primary);
  opacity: 1;
}

.dsh-coordinator-board-slot-dot-idle {
  background: var(--dsw-alias-label-tertiary);
  opacity: 0.55;
}

.dsh-coordinator-board-slot-dot-unknown,
.dsh-coordinator-board-slot-dot-empty {
  background: transparent;
  border: 1px dashed var(--dsw-alias-label-tertiary);
  opacity: 0.55;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-coordinator-board-slot-dot-running,
  .dsh-coordinator-board-slot-dot-waiting { animation: none; }
}

/* done 卡：单行轻量变体 */
.dsh-coordinator-board-card-done {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  border-radius: 8px;
  padding: 6px 10px;
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out);
}

.dsh-coordinator-board-card-done:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-coordinator-board-card-done:focus-visible {
  outline: 1px solid var(--dsw-alias-link);
  outline-offset: -1px;
}

.dsh-coordinator-board-done-check {
  flex: none;
  display: inline-flex;
  color: var(--dsw-alias-state-success-primary);
}

.dsh-coordinator-board-done-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-coordinator-board-done-time {
  flex: none;
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.7;
}

/* done 折叠区 */
.dsh-coordinator-board-done-section {
  margin-top: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--dsw-alias-border-l3);
}

.dsh-coordinator-board-done-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  border-radius: 6px;
  padding: 6px 4px;
  background: transparent;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  opacity: 0.7;
  cursor: pointer;
  text-align: left;
}

.dsh-coordinator-board-done-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  opacity: 1;
}

.dsh-coordinator-board-done-chevron {
  flex: none;
  display: inline-flex;
  transition: transform 200ms var(--ds-ease-in-out);
}

.dsh-coordinator-board-done-chevron-open {
  transform: rotate(90deg);
}

.dsh-coordinator-board-done-count {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

/* 骨架与空态 */
.dsh-coordinator-board-skeleton {
  height: 56px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-skeleton);
  animation: dsh-coordinator-board-fade 1.4s ease-in-out infinite;
}

@keyframes dsh-coordinator-board-fade {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-coordinator-board-skeleton { animation: none; }
}

.dsh-coordinator-board-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  text-align: center;
}

.dsh-coordinator-board-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
}

.dsh-coordinator-board-empty-icon-success {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.dsh-coordinator-board-empty-title {
  margin-top: 12px;
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  opacity: 0.7;
}

.dsh-coordinator-board-empty-hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}

/* 卡片详情浮层内容 */
.dsh-coordinator-card-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: 80vh;
}

.dsh-coordinator-card-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 24px 24px 8px;
}

.dsh-coordinator-card-detail-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}

.dsh-coordinator-card-detail-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: -6px -6px 0 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-coordinator-card-detail-close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.dsh-coordinator-card-detail-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 24px 12px;
}

.dsh-coordinator-card-detail-number {
  font-family: var(--ds-font-family-code);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
  opacity: 0.7;
}

.dsh-coordinator-card-detail-status {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-coordinator-card-detail-status-done {
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent);
  color: var(--dsw-alias-state-success-primary);
}

.dsh-coordinator-card-detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 24px 24px;
}

.dsh-coordinator-card-detail-section {
  margin-top: 16px;
}

.dsh-coordinator-card-detail-section:first-child {
  margin-top: 0;
}

.dsh-coordinator-card-detail-section-title {
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-coordinator-card-detail-text {
  margin-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.dsh-coordinator-card-detail-muted {
  margin-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}

.dsh-coordinator-card-detail-links {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
}

.dsh-coordinator-card-detail-link {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-link);
  text-decoration: none;
  border-bottom: 1px solid var(--dsw-alias-border-l3);
}

.dsh-coordinator-card-detail-link:last-child {
  border-bottom: 0;
}

.dsh-coordinator-card-detail-link-purpose {
  min-width: 0;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

/**
 * 注入样式表。同一页面只注入一次。
 * @returns {void}
 */
export function ensureBoardStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE_TEXT
  document.head.append(style)
}
