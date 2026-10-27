/**
 * 浮层外壳：portal、遮罩、Escape、焦点陷阱与关闭回焦。
 *
 * 结构与数值照抄宿主 `packages/client/ui-primitives/src/Modal.tsx` 与
 * `Modal.module.css`（版本 `0.2.1-rc.2`）——第三方 bundle 不能 import 宿主 UI
 * 包（见 docs/subsystems/web-client.zh.md:93），只能复制源码后改写：类名换成
 * 本仓前缀，避免与宿主的 CSS module 撞名；`clsx` 换成字符串拼接；焦点工具
 * `focusWithoutRing` 依赖宿主的 `[data-dsh-automatic-focus]` 主题规则，保留原样
 * 以便行为与官方一致。
 *
 * 宿主把「外壳」与「内容」分成两件事：外壳管遮罩、Escape、焦点循环与回焦，内容
 * 管标题、描述、正文、页脚。这里照抄这个划分——`headless` 模式下外壳只渲染卡片，
 * 内容自带头部（卡片详情浮层用这种：标题是卡片标题本身，不是「卡片详情」这种
 * 无信息标题）。
 *
 * 官方的 `useModalLayer` 还管 IME 组合输入（`keyboard-composition.ts`）：确认
 * 框里没有可输入的控件，组合态下按 Escape 的风险不存在，这里只在按键判断里留
 * 一个 `isComposing` 检查。
 *
 * @module dsh-coordinator/client/modal-shell
 */

import { createElement, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { productIcon } from './icons.js'

/** 样式表 id，同一页面只注入一次。 */
const STYLE_ID = 'dsh-coordinator-modal'

/**
 * 样式表内容。类名、数值与断点照抄宿主 `Modal.module.css`，`--dsw-*` 变量由宿主
 * 主题提供。
 */
const STYLE_TEXT = `
.dsh-coordinator-modal-root {
  pointer-events: auto;
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, var(--dsh-frame-overlay-top, 24px)) 24px;
}

.dsh-coordinator-modal-mask {
  position: absolute;
  inset: var(--dsh-frame-chrome-top, 0px) 0 0;
  backdrop-filter: var(--dsw-mask-blur);
}

.dsh-coordinator-modal-mask::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--dsw-alias-bg-mask-1);
  animation: dsh-coordinator-modal-enter var(--ds-transition-duration) var(--ds-ease-in-out);
}

.dsh-coordinator-modal-dialog {
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: min(380px, 100%);
  padding: 0 0 24px;
  overflow: hidden;
  border: 0;
  border-radius: var(--dsw-radius-panel);
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-elevation-prominent);
  animation: dsh-coordinator-modal-enter var(--ds-transition-duration) var(--ds-ease-in-out);
}

.dsh-coordinator-modal-dialog-wide {
  width: min(560px, 100%);
  max-height: 80vh;
}

@keyframes dsh-coordinator-modal-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .dsh-coordinator-modal-mask::after,
  .dsh-coordinator-modal-dialog { animation: none; }
}

.dsh-coordinator-modal-dialog:focus {
  outline: none;
}

.dsh-coordinator-modal-content {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
}

.dsh-coordinator-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 22px 14px 12px 24px;
}

.dsh-coordinator-modal-title {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dsh-coordinator-modal-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}

@media (hover: hover) {
  .dsh-coordinator-modal-close:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.dsh-coordinator-modal-description {
  margin: 0;
  padding: 0 24px;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
}

.dsh-coordinator-modal-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin-top: 20px;
  padding: 0 24px;
}

.dsh-coordinator-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px;
}

.dsh-coordinator-modal-button {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 36px;
  border: none;
  border-radius: var(--dsw-radius-md);
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  padding: 0 14px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
}

.dsh-coordinator-modal-button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.dsh-coordinator-modal-button-outline {
  border: 0.5px solid transparent;
  background: transparent;
  box-shadow: inset 0 0 0 var(--ds-hairline-width, 0.5px) var(--dsh-button-outline-color, var(--dsw-alias-border-l3));
}

@media (hover: hover) {
  .dsh-coordinator-modal-button-outline:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}

.dsh-coordinator-modal-button-danger:not(:disabled) {
  color: var(--dsw-alias-state-error-primary);
}

.dsh-coordinator-modal-error {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary);
}
`

/** 可聚焦元素的选取规则，照抄宿主 `useModalLayer`。 */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'

/**
 * 注入样式表。同一页面只注入一次。
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

/** 宿主主题用这个属性抑制自动聚焦时的焦点环。 */
const AUTOMATIC_FOCUS_ATTRIBUTE = 'data-dsh-automatic-focus'

/** 键盘导航键：按下即把焦点环放回来（照抄宿主 `focus.ts`）。 */
const NAVIGATION_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** 已挂释放器的元素，重复聚焦时先撤掉旧的。 */
const focusReleases = new WeakMap()

/**
 * 聚焦元素但不显示焦点环。
 *
 * 照抄宿主 `packages/client/ui-primitives/src/focus.ts` 的 `focusWithoutRing`：
 * 宿主主题用 `[data-dsh-automatic-focus]:focus` 抑制自动聚焦时的焦点环，失焦或
 * 键盘导航后再把环放回来。只设属性不撤释放器会让焦点环再也回不来。
 *
 * @param {HTMLElement} element - 目标元素
 * @returns {void}
 */
function focusWithoutRing(element) {
  focusReleases.get(element)?.()
  const release = () => {
    element.removeAttribute(AUTOMATIC_FOCUS_ATTRIBUTE)
    element.removeEventListener('blur', release)
    element.removeEventListener('keydown', navigate, true)
    focusReleases.delete(element)
  }
  const navigate = (event) => {
    if (
      !event.isComposing
      && !event.ctrlKey && !event.altKey && !event.metaKey
      && NAVIGATION_KEYS.has(event.key)
    ) {
      release()
    }
  }
  focusReleases.set(element, release)
  element.setAttribute(AUTOMATIC_FOCUS_ATTRIBUTE, '')
  element.addEventListener('blur', release)
  element.addEventListener('keydown', navigate, true)
  element.focus({ preventScroll: true })
  if (!element.matches(':focus')) release()
}

/**
 * 浮层外壳。
 *
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 是否显示
 * @param {() => void} props.onClose - 关闭（Escape、遮罩点击、关闭按钮）
 * @param {string} props.title - 标题；同时是 dialog 的无障碍名
 * @param {string} props.closeLabel - 关闭按钮的无障碍名
 * @param {string} [props.description] - 说明文字
 * @param {object} [props.children] - 正文
 * @param {object} [props.footer] - 页脚
 * @param {boolean} [props.headless] - 内容自带头部时置真，外壳只渲染卡片
 * @param {boolean} [props.wide] - 宽卡片（详情浮层）
 * @param {HTMLElement | null} [props.restoreFocus] - 关闭后焦点落点；缺省回落到打开前的活动元素
 * @returns {object | null} React 元素；未打开时 null
 */
export function ModalShell({
  open,
  onClose,
  title,
  closeLabel,
  description = '',
  children = null,
  footer = null,
  headless = false,
  wide = false,
  restoreFocus = null,
}) {
  const dialog = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  const restore = useRef(restoreFocus)
  restore.current = restoreFocus

  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) return undefined
    const previous = document.activeElement
    const initial = element.querySelector('[data-modal-autofocus]')
      ?? element.querySelector(FOCUSABLE)
      ?? element
    if (!element.contains(document.activeElement)) focusWithoutRing(initial)

    const keydown = (event) => {
      if (event.defaultPrevented || event.isComposing
        || event.ctrlKey || event.altKey || event.metaKey) return
      if (event.key === 'Escape' && !event.shiftKey) {
        event.preventDefault()
        if (!event.repeat) close.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = [...element.querySelectorAll(FOCUSABLE)]
        .filter((item) => !item.closest('[inert], [hidden]'))
      const first = items[0] ?? element
      const last = items.at(-1) ?? element
      const atEdge = event.shiftKey
        ? document.activeElement === first
        : document.activeElement === last
      if (document.activeElement === element || !element.contains(document.activeElement) || atEdge) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      const target = restore.current ?? previous
      if (target instanceof HTMLElement && target.isConnected) {
        focusWithoutRing(target)
      }
    }
  }, [dialog, open])

  // 布局期注入：浮层是点击后才出现的，等 effect 注入会闪一帧无样式
  useLayoutEffect(() => {
    if (!open) return
    ensureStyles()
  }, [open])

  if (!open) return null

  return createPortal(
    createElement('div', {
      className: 'dsh-coordinator-modal-root',
      role: 'presentation',
    },
    createElement('div', {
      className: 'dsh-coordinator-modal-mask',
      'aria-hidden': 'true',
      onClick: () => close.current(),
    }),
    createElement('div', {
      ref: dialog,
      tabIndex: -1,
      className: `dsh-coordinator-modal-dialog${wide ? ' dsh-coordinator-modal-dialog-wide' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    headless
      ? children
      : createElement('div', { className: 'dsh-coordinator-modal-content' },
        createElement('div', { className: 'dsh-coordinator-modal-header' },
          createElement('h2', { className: 'dsh-coordinator-modal-title' }, title),
          createElement('button', {
            type: 'button',
            className: 'dsh-coordinator-modal-close',
            'aria-label': closeLabel,
            onClick: () => close.current(),
          }, productIcon('close-outline', { size: 14 })),
        ),
        description !== ''
          ? createElement('p', { className: 'dsh-coordinator-modal-description' }, description)
          : null,
        children !== null
          ? createElement('div', { className: 'dsh-coordinator-modal-body' }, children)
          : null,
      ),
    footer !== null
      ? createElement('div', { className: 'dsh-coordinator-modal-footer' }, footer)
      : null,
    ),
    ),
    document.body,
  )
}
