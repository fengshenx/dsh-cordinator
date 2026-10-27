/**
 * 看板卡片行。
 *
 * 视觉与交互照抄 Telov 的 `BoardCardItem`：卡面零操作铬——只做信息与导航，
 * 不放操作按钮；active 卡三层（标题行 / 链接行 / 元信息行），done 卡单行轻量
 * 变体；点卡面开详情，点链接 chip 直跳，点槽位 chip 开会话。
 *
 * 卡面根是 `role="button"` 且内嵌可聚焦控件，严格说这违反 ARIA 的「button 不含
 * 可聚焦后代」。这是 Telov 同款取舍：整卡热区与嵌套控件并存，子控件保留独立
 * 按钮语义优先，键盘可达性由子控件自己保证。
 *
 * @module dsh-coordinator/client/board-card
 */

import { createElement, useLayoutEffect, useRef, useState } from 'react'
import {
  cardSignal,
  fitLinkChips,
  formatDuration,
  isCardStalled,
  slotViewsForCard,
} from './board-projection.js'
import { productIcon } from './icons.js'

/** 链接行左侧缩进，对齐标题文字起点（信号灯槽 14px + 间距 8px）。 */
const LINKS_ROW_INDENT = 22

/** 链接 chip 之间的间距。 */
const LINKS_ROW_GAP = 4

/**
 * 键盘触发详情。
 *
 * 只在事件来自卡面根本身时触发：chip 是嵌套控件，它们的 Enter/Space 归自己。
 *
 * @param {object} event - 键盘事件
 * @param {object} card - 卡片
 * @param {(card: object, anchor: HTMLElement) => void} onOpenDetail - 开详情
 * @returns {void}
 */
function openDetailOnKey(event, card, onOpenDetail) {
  if (event.target !== event.currentTarget) return
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onOpenDetail(card, event.currentTarget)
  }
}

/**
 * 链接 chip 的内容：链接图标 + 标签。
 *
 * @param {object} link - 链接
 * @returns {object} React 元素
 */
function linkChipContent(link) {
  return createElement(
    'span',
    { className: 'dsh-coordinator-board-link-chip-body' },
    productIcon('link-outline', { size: 10 }),
    createElement('span', { className: 'dsh-coordinator-board-link-chip-label' }, link.label ?? ''),
  )
}

/**
 * 链接行：可见 chip 按实测宽度算，放不下的收进「+N」。
 *
 * 测量层是全量 chip 的不可见副本（`visibility: hidden` 仍参与布局），宽度变化
 * 后重排——收缩后仍能量到被收起的 chip。
 *
 * @param {object} props - 组件属性
 * @param {object[]} props.links - 链接列表
 * @param {(card: object, anchor: HTMLElement) => void} props.onOpenDetail - 开详情
 * @returns {object} React 元素
 */
function BoardLinks({ links, onOpenDetail }) {
  const row = useRef(null)
  const measure = useRef(null)
  const [visibleCount, setVisibleCount] = useState(links.length)

  useLayoutEffect(() => {
    const rowElement = row.current
    const measureElement = measure.current
    if (rowElement === null || measureElement === null) return undefined
    const fit = () => {
      const widths = Array.from(measureElement.children)
        .map((element) => element.getBoundingClientRect().width)
      // 测量层最后一个固定是「+N」；结构被改坏时 fitLinkChips 把非有限值当未测量，全量展示
      const overflowWidth = widths.pop() ?? 0
      setVisibleCount(fitLinkChips({
        availableWidth: rowElement.getBoundingClientRect().width - LINKS_ROW_INDENT,
        chipWidths: widths,
        overflowWidth,
        gap: LINKS_ROW_GAP,
      }))
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(fit)
    observer.observe(rowElement)
    return () => observer.disconnect()
  }, [links])

  const overflow = links.length - visibleCount

  return createElement(
    'div',
    { ref: row, className: 'dsh-coordinator-board-card-links' },
    createElement(
      'div',
      { ref: measure, 'aria-hidden': 'true', className: 'dsh-coordinator-board-links-measure' },
      links.map((link) => (typeof link.url === 'string' && link.url !== ''
        ? createElement('a', {
            key: link.id ?? link.label,
            href: link.url,
            tabIndex: -1,
            className: 'dsh-coordinator-board-link-chip',
          }, linkChipContent(link))
        : createElement('button', {
            key: link.id ?? link.label,
            type: 'button',
            tabIndex: -1,
            className: 'dsh-coordinator-board-link-chip',
          }, linkChipContent(link)))),
      createElement(
        'button',
        { type: 'button', tabIndex: -1, className: 'dsh-coordinator-board-link-chip dsh-coordinator-board-link-overflow' },
        `+${links.length}`,
      ),
    ),
    links.slice(0, visibleCount).map((link) => (typeof link.url === 'string' && link.url !== ''
      ? createElement('a', {
          key: link.id ?? link.label,
          href: link.url,
          target: '_blank',
          rel: 'noreferrer',
          title: link.purpose || link.url,
          className: 'dsh-coordinator-board-link-chip',
          onClick: (event) => { event.stopPropagation() },
        }, linkChipContent(link))
      : createElement('button', {
          key: link.id ?? link.label,
          type: 'button',
          title: link.purpose || link.label,
          className: 'dsh-coordinator-board-link-chip',
          onClick: (event) => {
            event.stopPropagation()
            onOpenDetail(event.currentTarget)
          },
        }, linkChipContent(link)))),
    overflow > 0
      ? createElement('button', {
          type: 'button',
          title: links.map((link) => link.label).join(' · '),
          className: 'dsh-coordinator-board-link-chip dsh-coordinator-board-link-overflow',
          onClick: (event) => {
            event.stopPropagation()
            onOpenDetail(event.currentTarget)
          },
        }, `+${overflow}`)
      : null,
  )
}

/**
 * 槽位 chip：状态点 + 槽位名，点击打开该槽位绑定的会话。
 *
 * 未派工的槽位（没有绑定会话）不是按钮——没有会话可打开。
 *
 * @param {object} props - 组件属性
 * @param {object} props.slot - 槽位视图
 * @param {(sessionId: string) => void} props.onOpenSession - 打开会话
 * @returns {object} React 元素
 */
function BoardSlot({ slot, onOpenSession }) {
  const dot = createElement('span', {
    className: `dsh-coordinator-board-slot-dot dsh-coordinator-board-slot-dot-${slot.state}`,
  })
  if (slot.sessionId === '') {
    return createElement(
      'span',
      { className: 'dsh-coordinator-board-slot-chip', title: `${slot.name}：未派工` },
      dot,
      slot.name,
    )
  }
  return createElement(
    'button',
    {
      type: 'button',
      className: 'dsh-coordinator-board-slot-chip',
      title: `${slot.name}：${slot.state === 'unknown' ? '状态未知' : slot.state}`,
      onClick: (event) => {
        event.stopPropagation()
        onOpenSession(slot.sessionId)
      },
    },
    dot,
    slot.name,
  )
}

/**
 * 看板卡片行。
 *
 * @param {object} props - 组件属性
 * @param {object} props.card - 卡片
 * @param {Map<string, object>} props.states - 会话 id 到状态
 * @param {number} props.now - 当前时间戳
 * @param {(card: object, anchor: HTMLElement) => void} props.onOpenDetail - 开详情
 * @param {(sessionId: string) => void} props.onOpenSession - 打开会话
 * @returns {object} React 元素
 */
export function BoardCard({ card, states, now, onOpenDetail, onOpenSession }) {
  const links = Array.isArray(card.links) ? card.links : []
  const done = card.status === 'done'

  if (done) {
    return createElement(
      'div',
      {
        className: 'dsh-coordinator-board-card-done',
        role: 'button',
        tabIndex: 0,
        onClick: (event) => onOpenDetail(card, event.currentTarget),
        onKeyDown: (event) => openDetailOnKey(event, card, onOpenDetail),
      },
      createElement(
        'span',
        { className: 'dsh-coordinator-board-done-check' },
        productIcon('check-circle-outline', { size: 14 }),
      ),
      createElement('span', { className: 'dsh-coordinator-board-card-number' }, `#${card.number ?? '?'}`),
      createElement('span', { className: 'dsh-coordinator-board-done-title', title: card.title }, card.title ?? ''),
      typeof card.doneAt === 'number'
        ? createElement('span', { className: 'dsh-coordinator-board-done-time' }, formatDuration(card.doneAt, now))
        : null,
    )
  }

  const signal = cardSignal(card, states)
  const slots = slotViewsForCard(card, states)
  const stalled = isCardStalled(card, states, now)

  return createElement(
    'div',
    {
      className: 'dsh-coordinator-board-card',
      role: 'button',
      tabIndex: 0,
      onClick: (event) => onOpenDetail(card, event.currentTarget),
      onKeyDown: (event) => openDetailOnKey(event, card, onOpenDetail),
    },
    createElement(
      'div',
      { className: 'dsh-coordinator-board-card-title-row' },
      createElement(
        'span',
        { className: 'dsh-coordinator-board-signal-slot' },
        createElement('span', { className: `dsh-coordinator-board-signal dsh-coordinator-board-signal-${signal}` }),
      ),
      createElement('span', { className: 'dsh-coordinator-board-card-number' }, `#${card.number ?? '?'}`),
      createElement('span', { className: 'dsh-coordinator-board-card-title', title: card.title }, card.title ?? ''),
      stalled
        ? createElement(
            'span',
            { className: 'dsh-coordinator-board-card-stalled' },
            `停滞 ${formatDuration(card.updatedAt ?? 0, now)}`,
          )
        : null,
    ),
    links.length > 0
      ? createElement(BoardLinks, { links, onOpenDetail: (anchor) => onOpenDetail(card, anchor) })
      : null,
    slots.length > 0
      ? createElement(
          'div',
          { className: 'dsh-coordinator-board-card-meta' },
          slots.map((slot) => createElement(BoardSlot, { key: slot.name, slot, onOpenSession })),
        )
      : null,
  )
}
