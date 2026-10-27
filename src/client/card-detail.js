/**
 * 卡片详情浮层（点卡面打开）。
 *
 * 卡面是窄栏，只放得下标题、链接与槽位；spec 全文与检查点进详情。详情**只读**：
 * dsh 的卡片由协调者经卡片工具维护，浏览器侧没有写通道——完成、置顶、重命名、
 * 删除这些操作要新增宿主远程方法，属于独立议题，不在这里越权写。
 *
 * 浮层外壳（遮罩、Escape、焦点循环、关闭回焦）由 `modal-shell.js` 提供；这里用
 * `headless` 模式自带头部——标题就是卡片标题本身，「卡片详情」这种无信息标题
 * 不放。
 *
 * @module dsh-coordinator/client/card-detail
 */

import { createElement, useEffect } from 'react'
import { ModalShell } from './modal-shell.js'
import { DETAIL_SPEC_EMPTY, detailSections, statusLabel } from './card-detail-view.js'
import { isJumpableLink, linkRowKey } from './link-row.js'
import { productIcon } from './icons.js'
import { ensureBoardStyles } from './board-styles.js'

/**
 * 详情里的一段文本（spec 或检查点条目）。
 *
 * @param {object} props - 组件属性
 * @param {string} props.title - 段标题
 * @param {string} props.text - 正文
 * @returns {object} React 元素
 */
function DetailSection({ title, text }) {
  if (typeof text !== 'string' || text === '') return null
  return createElement(
    'section',
    { className: 'dsh-coordinator-card-detail-section' },
    createElement('div', { className: 'dsh-coordinator-card-detail-section-title' }, title),
    createElement('div', { className: 'dsh-coordinator-card-detail-text' }, text),
  )
}

/**
 * 卡片详情浮层。
 *
 * @param {object} props - 组件属性
 * @param {object} props.card - 目标卡片
 * @param {() => void} props.onClose - 关闭
 * @param {HTMLElement | null} [props.restoreFocus] - 关闭后焦点落点
 * @returns {object} React 元素
 */
export function CardDetail({ card, onClose, restoreFocus = null }) {
  useEffect(() => {
    ensureBoardStyles()
  }, [])
  const sections = detailSections(card)
  const done = card?.status === 'done'

  return createElement(ModalShell, {
    open: true,
    onClose,
    title: card?.title ?? '',
    closeLabel: '关闭',
    headless: true,
    wide: true,
    restoreFocus,
    children: createElement(
      'div',
      { className: 'dsh-coordinator-card-detail' },
      createElement(
        'div',
        { className: 'dsh-coordinator-card-detail-header' },
        createElement('h2', { className: 'dsh-coordinator-card-detail-title' }, card?.title ?? ''),
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-coordinator-card-detail-close',
            'aria-label': '关闭',
            onClick: onClose,
          },
          productIcon('close-outline', { size: 16 }),
        ),
      ),
      createElement(
        'div',
        { className: 'dsh-coordinator-card-detail-meta' },
        createElement(
          'span',
          { className: 'dsh-coordinator-card-detail-number' },
          `#${card?.number ?? '?'}`,
        ),
        createElement(
          'span',
          {
            className: `dsh-coordinator-card-detail-status${done ? ' dsh-coordinator-card-detail-status-done' : ''}`,
          },
          statusLabel(card?.status),
        ),
      ),
      createElement(
        'div',
        { className: 'dsh-coordinator-card-detail-body' },
        sections.spec !== null
          ? createElement(
              'section',
              { className: 'dsh-coordinator-card-detail-section' },
              createElement('div', { className: 'dsh-coordinator-card-detail-section-title' }, '说明'),
              createElement('div', { className: 'dsh-coordinator-card-detail-text' }, sections.spec),
            )
          : createElement('div', { className: 'dsh-coordinator-card-detail-muted' }, DETAIL_SPEC_EMPTY),
        sections.checkpoint.map((section) => createElement(DetailSection, {
          key: section.title,
          title: section.title,
          text: section.text,
        })),
        sections.links.length > 0
          ? createElement(
              'section',
              { className: 'dsh-coordinator-card-detail-section' },
              createElement('div', { className: 'dsh-coordinator-card-detail-section-title' }, '链接'),
              createElement(
                'div',
                { className: 'dsh-coordinator-card-detail-links' },
                sections.links.map((link, index) => {
                  const row = createElement(
                    'span',
                    { className: 'dsh-coordinator-board-link-chip-body' },
                    productIcon('link-outline', { size: 12 }),
                    createElement(
                      'span',
                      { className: 'dsh-coordinator-board-link-chip-label' },
                      link.label ?? '',
                    ),
                    link.purpose
                      ? createElement(
                          'span',
                          { className: 'dsh-coordinator-card-detail-link-purpose' },
                          link.purpose,
                        )
                      : null,
                  )
                  return isJumpableLink(link)
                    ? createElement(
                        'a',
                        {
                          key: linkRowKey(link, index),
                          className: 'dsh-coordinator-card-detail-link',
                          href: link.url,
                          target: '_blank',
                          rel: 'noreferrer',
                        },
                        row,
                      )
                    : createElement(
                        'div',
                        { key: linkRowKey(link, index), className: 'dsh-coordinator-card-detail-link' },
                        row,
                      )
                }),
              ),
            )
          : null,
      ),
    ),
  })
}
