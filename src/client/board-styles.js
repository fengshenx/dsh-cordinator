/**
 * 看板样式表。
 *
 * 材质与几何全部取宿主的共享令牌，不写死数值：卡面是宿主「行内卡片」的
 * 组合——`--dsw-alias-bg-layer-2` 底、`--dsw-elevation-stroke` 发丝描边、
 * `--dsw-radius-*` 圆角，hover 换描边档并升到 `--dsw-elevation-panel`；
 * 焦点环走 `--dsw-focus-ring-*`。同构的实现是宿主
 * `client-ui-agent-team` 的成员卡。
 *
 * 数值约定：8px 卡间距、13px 标题、11px 弱化文字、22px 链接行缩进。颜色一律走
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
  padding: 10px 12px 24px;
  /* 滚动条档位不在这里重绑：看板所在的宿主 paneBody/floatBody 已按浮起面绑成
     l2，本层再绑一次只是同值重复；写 body 的基础档反而会在浮起面上读成脏印 */
}

.dsh-coordinator-board-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 卡面：宿主行内卡片材质——bg-layer-2 底 + elevation-stroke 发丝描边，
   hover 换描边档并升到 panel 投影。与 client-ui-agent-team 的成员卡同构：
   重绑 stroke 色而不叠 border——中性 border 配 elevation 阴影被宿主
   ui-theme 的 elevation spec 拒绝。静态取 l3 而不是成员卡的 l2：看板卡在
   浅色 sidebar 上独自立着，没有弹出面板的暗底衬着，l2 在 1x 屏读不出边界。 */
.dsh-coordinator-board-card {
  display: block;
  box-sizing: border-box;
  width: 100%;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-stroke);
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    box-shadow var(--ds-transition-duration) var(--ds-ease-in-out),
    background-color var(--ds-transition-duration) var(--ds-ease-in-out);
}

@media (hover: hover) {
  .dsh-coordinator-board-card:hover {
    --dsw-elevation-stroke-color: var(--dsw-alias-border-l4);
    box-shadow: var(--dsw-elevation-panel);
  }
}

/* 卡面在贴边滚动容器里，外扩焦点环会被裁掉，用内嵌环 */
.dsh-coordinator-board-card:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
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
  corner-shape: round;
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
  color: var(--dsw-alias-label-caption);
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
  /* warn 的 label 档比 primary 档在浅色下更可读 */
  color: var(--dsw-alias-state-warn-label);
}

/* 链接行与元信息行缩进 22px，对齐标题文字起点 */
.dsh-coordinator-board-card-links {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
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

/* 链接 chip：宿主「可点击产物链接」的示能——link 色 + 500 字重、默认无
   下划线、hover 与键盘焦点同为点状下划线，外面套一层发丝线圆角壳把它和
   卡面分开。17px 高属「低于 H20 的微型控件」，圆角取 R4 */
.dsh-coordinator-board-link-chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  box-sizing: border-box;
  max-width: 110px;
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xs);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  color: var(--dsw-alias-link);
  background: transparent;
  cursor: pointer;
  text-decoration: none;
  overflow: hidden;
}

/* 链路行是 overflow: hidden 的横向裁切带，外扩焦点环只剩左右两段弧，
   所以焦点环改内嵌；下划线示能与 hover 一致。
   下划线偏移取 1px 而不是宿主的 3px：chip 的内容盒只有 16px（line-height
   16 + 上下各 0.5px 发丝线），3px 落到底边框之外，被 chip 与 chip-body 的
   overflow 裁掉，真机上整条不可见；1px 是能整条画在盒内的偏移 */
.dsh-coordinator-board-link-chip:focus-visible {
  text-decoration: underline dotted;
  text-underline-offset: 1px;
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

@media (hover: hover) {
  .dsh-coordinator-board-link-chip:hover {
    border-color: var(--dsw-alias-border-l4);
    background: var(--dsw-alias-interactive-bg-hover);
    text-decoration: underline dotted;
    text-underline-offset: 1px;
  }
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
}

.dsh-coordinator-board-card-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
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

@media (hover: hover) {
  .dsh-coordinator-board-slot-chip:hover {
    color: var(--dsw-alias-label-primary);
  }
}

.dsh-coordinator-board-slot-dot {
  display: inline-block;
  box-sizing: border-box;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  corner-shape: round;
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

/* done 卡：单行轻量变体。成品不需要抢注意力，就没有卡面材质——
   透明的行，靠 hover 与 active 卡的卡面区分 */
.dsh-coordinator-board-card-done {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  gap: 8px;
  width: 100%;
  border: 0;
  border-radius: var(--dsw-radius-md);
  padding: 6px 10px;
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration) var(--ds-ease-in-out);
}

@media (hover: hover) {
  .dsh-coordinator-board-card-done:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.dsh-coordinator-board-card-done:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid
    var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
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
  color: var(--dsw-alias-label-caption);
}

/* done 折叠区 */
.dsh-coordinator-board-done-section {
  margin-top: 16px;
  padding-top: 6px;
  border-top: 0.5px solid var(--dsw-alias-border-l3);
}

.dsh-coordinator-board-done-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  border-radius: var(--dsw-radius-md);
  padding: 6px 4px;
  background: transparent;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  text-align: left;
}

@media (hover: hover) {
  .dsh-coordinator-board-done-toggle:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
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
  corner-shape: round;
  background: var(--dsw-alias-interactive-bg-hover);
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

/* 骨架与空态 */
.dsh-coordinator-board-skeleton {
  height: 64px;
  border-radius: var(--dsw-radius-lg);
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
  border-radius: var(--dsw-radius-lg);
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
  color: var(--dsw-alias-label-secondary);
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

@media (hover: hover) {
  .dsh-coordinator-card-detail-close:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
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
  color: var(--dsw-alias-label-caption);
}

.dsh-coordinator-card-detail-status {
  padding: 2px 8px;
  border-radius: 999px;
  corner-shape: round;
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
  font-weight: 500;
  color: var(--dsw-alias-link);
  text-decoration: none;
  border-bottom: 0.5px solid var(--dsw-alias-border-l3);
}

@media (hover: hover) {
  .dsh-coordinator-card-detail-link:hover {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
}

/* 键盘焦点与 hover 同一示能；不可跳转的链接渲染成 div，不在此列 */
.dsh-coordinator-card-detail-link:focus-visible {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
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

/* 右栏 guide 页的入口胶囊：复刻宿主 EntryBox 的数值（380px 宽、56px 最小高、
   14/20 内边距、14px 图标间距），宿主改样式时这里要跟着改。 */
.dsh-coordinator-guide-entry {
  display: flex;
  gap: 14px;
  align-items: center;
  box-sizing: border-box;
  width: 380px;
  max-width: 100%;
  min-height: 56px;
  padding: 14px 20px;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  background: var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: var(--dsw-radius-xl);
  cursor: pointer;
}

@media (hover: hover) {
  .dsh-coordinator-guide-entry:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.dsh-coordinator-guide-entry-icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: var(--dsw-alias-label-secondary);
}

.dsh-coordinator-guide-entry-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.dsh-coordinator-guide-entry-title {
  overflow: hidden;
  font-size: 14px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.dsh-coordinator-guide-entry-description {
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 1.4;
  white-space: nowrap;
  text-overflow: ellipsis;
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
