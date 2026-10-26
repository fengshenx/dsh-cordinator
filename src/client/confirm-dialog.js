/**
 * 确认弹窗。
 *
 * 结构与数值照抄宿主 `packages/client/ui-primitives/src/Modal.tsx` 与
 * `Modal.module.css`（版本 `0.2.1-rc.2`）——第三方 bundle 不能 import 宿主 UI
 * 包（见 docs/subsystems/web-client.zh.md:93），只能复制源码后改写：类名换成
 * 本仓前缀，避免与宿主的 CSS module 撞名；`clsx` 换成字符串拼接；焦点工具
 * `focusWithoutRing` 依赖宿主的 `[data-dsh-automatic-focus]` 主题规则，保留原样
 * 以便行为与官方一致。
 *
 * 官方的 `useModalLayer` 还管 IME 组合输入（`keyboard-composition.ts`）：确认
 * 框里没有可输入的控件，组合态下按 Escape 的风险不存在，这里只在按键判断里留
 * 一个 `isComposing` 检查。
 *
 * @module dsh-coordinator/client/confirm-dialog
 */

import { createElement, useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { productIcon } from './icons.js'

/** 样式表 id，同一页面只注入一次。 */
const STYLE_ID = 'dsh-coordinator-confirm-dialog'

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

/**
 * 聚焦元素但不显示焦点环。
 *
 * 照抄宿主 `packages/client/ui-primitives/src/focus.ts` 的 `focusWithoutRing`：
 * 宿主主题用 `[data-dsh-automatic-focus]:focus` 抑制自动聚焦时的焦点环，键盘
 * 导航再把环放回来。
 *
 * @param {HTMLElement} element - 目标元素
 * @returns {void}
 */
function focusWithoutRing(element) {
  element.setAttribute('data-dsh-automatic-focus', '')
  element.focus({ preventScroll: true })
}

/**
 * 确认弹窗。
 *
 * @param {object} props - 组件属性
 * @param {boolean} props.open - 是否显示
 * @param {string} props.title - 标题
 * @param {string} props.description - 说明文字
 * @param {string} props.confirmLabel - 确认按钮文案
 * @param {string} props.cancelLabel - 取消按钮文案
 * @param {boolean} props.danger - 确认按钮是否用危险色
 * @param {boolean} props.busy - 正在执行，禁用按钮
 * @param {string} props.error - 错误文案
 * @param {() => void} props.onConfirm - 确认
 * @param {() => void} props.onCancel - 取消
 * @returns {object | null} React 元素；未打开时 null
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  error = '',
  onConfirm,
  onCancel,
}) {
  const dialog = useRef(null)
  const close = useRef(onCancel)
  close.current = onCancel

  useLayoutEffect(() => {
    const element = dialog.current
    if (!open || element === null) return
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
      if (previous instanceof HTMLElement && previous.isConnected) {
        focusWithoutRing(previous)
      }
    }
  }, [dialog, open])

  useEffect(() => {
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
      className: 'dsh-coordinator-modal-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    createElement('div', { className: 'dsh-coordinator-modal-content' },
      createElement('div', { className: 'dsh-coordinator-modal-header' },
        createElement('h2', { className: 'dsh-coordinator-modal-title' }, title),
        createElement('button', {
          type: 'button',
          className: 'dsh-coordinator-modal-close',
          'aria-label': cancelLabel,
          onClick: () => close.current(),
        }, productIcon('close-outline', { size: 14 })),
      ),
      createElement('p', { className: 'dsh-coordinator-modal-description' }, description),
      error !== '' && createElement('div', { className: 'dsh-coordinator-modal-body' },
        createElement('div', { className: 'dsh-coordinator-modal-error', role: 'alert' }, error),
      ),
    ),
    createElement('div', { className: 'dsh-coordinator-modal-footer' },
      createElement('button', {
        type: 'button',
        className: 'dsh-coordinator-modal-button dsh-coordinator-modal-button-outline',
        disabled: busy,
        onClick: () => close.current(),
      }, cancelLabel),
      createElement('button', {
        type: 'button',
        'data-modal-autofocus': '',
        className: `dsh-coordinator-modal-button dsh-coordinator-modal-button-outline${danger ? ' dsh-coordinator-modal-button-danger' : ''}`,
        disabled: busy,
        onClick: onConfirm,
      }, confirmLabel),
    ),
    ),
    ),
    document.body,
  )
}
