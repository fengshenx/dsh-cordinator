/**
 * 左栏「项目」区块的内容。
 *
 * 结构是**项目树**：项目行下面挂着该项目目录里的会话。点项目行展开或收起子会话
 * 列表；协调者会话的入口在行的「更多」菜单里（项目名不再承担两个动作）。
 *
 * 排版对齐宿主的工作区浏览：小节标题用同一套行高与三级标签色，项目行用工作区
 * 行的高度、内边距、圆角与 hover 反馈；行首槽位与官方工作区行同款——平时是目录
 * 图标，悬停整行时换成展开箭头，展开时箭头旋转朝下。图标是自带的内联路径
 * （宿主 web 端运行时没有 sprite，见 `icons.js`）。
 *
 * @module dsh-coordinator/client/project-section
 */

import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { productIcon } from './icons.js'
import { isProjectOpenable, selectProjectSessionRows } from './project-panel-logic.js'

const STYLE_ID = 'dsh-coordinator-project-section'

/** 区块的样式表。随主题变量走，宿主换肤时自动跟随。 */
const STYLE_TEXT = `
.dsh-coordinator-project-section {
  display: flex;
  flex-direction: column;
  padding-right: var(--dsh-session-list-edge-inset, 0px);
}
.dsh-coordinator-project-header {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 36px;
  padding-left: 4px;
  margin-bottom: 4px;
  box-sizing: border-box;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-coordinator-project-header-label {
  flex: none;
  line-height: 20px;
  font-size: 14px;
}
.dsh-coordinator-project-header-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dsh-coordinator-project-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.dsh-coordinator-project-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-coordinator-project-icon-button:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-coordinator-project-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 8px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
@media (hover: hover) {
  .dsh-coordinator-project-row:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-coordinator-project-row[data-dead='true'] {
  color: var(--dsw-alias-label-secondary);
}
.dsh-coordinator-project-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
}
/* 行首槽位：默认目录图标，悬停整行时换成展开箭头（与官方工作区行同款）。 */
.dsh-coordinator-project-lead {
  flex: none;
  width: 16px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dsh-coordinator-project-lead-arrow {
  display: none;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));
  transition: transform 150ms var(--ds-ease-in-out, ease);
}
.dsh-coordinator-project-lead-arrow[data-open='true'] {
  transform: rotate(90deg);
}
@media (hover: hover) {
  .dsh-coordinator-project-row:hover .dsh-coordinator-project-lead-arrow {
    display: inline-flex;
  }
  .dsh-coordinator-project-row:hover .dsh-coordinator-project-lead-folder {
    display: none;
  }
  .dsh-coordinator-project-header:hover .dsh-coordinator-project-lead-arrow {
    display: inline-flex;
  }
  .dsh-coordinator-project-header:hover .dsh-coordinator-project-lead-folder {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-coordinator-project-lead-arrow {
    transition: none;
  }
}
.dsh-coordinator-project-meta {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-coordinator-project-actions {
  flex: none;
  display: none;
  align-items: center;
  gap: 2px;
}
@media (hover: hover) {
  .dsh-coordinator-project-row:hover .dsh-coordinator-project-actions {
    display: inline-flex;
  }
}
.dsh-coordinator-project-row[data-menu-open='true'] .dsh-coordinator-project-actions {
  display: inline-flex;
}
.dsh-coordinator-project-rename {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14px;
  line-height: 20px;
  padding: 0 2px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-button-elevated-fill);
  color: inherit;
  outline: none;
}
.dsh-coordinator-project-menu {
  position: fixed;
  z-index: 1100;
  box-sizing: border-box;
  min-width: 144px;
  max-width: 360px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  box-shadow: var(--dsw-elevation-prominent);
}
.dsh-coordinator-project-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: none;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-coordinator-project-menu-item:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-coordinator-project-menu-item:focus-visible:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  outline: none;
}
.dsh-coordinator-project-menu-item[data-danger='true'] {
  color: var(--dsw-alias-state-error-primary);
}
@media (hover: hover) {
  .dsh-coordinator-project-menu-item[data-danger='true']:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover-danger);
  }
}
.dsh-coordinator-project-menu-icon {
  display: inline-flex;
  flex: none;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  color: inherit;
}
.dsh-coordinator-project-draft-action {
  padding: 4px 10px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-button-elevated-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dsh-coordinator-project-notice {
  padding: 4px 8px;
  font-size: 12px;
  line-height: 17px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-coordinator-project-sessions {
  display: flex;
  flex-direction: column;
  padding: 2px 0 4px 20px;
}
.dsh-coordinator-session-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px 0 4px;
  box-sizing: border-box;
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  -webkit-user-select: none;
  user-select: none;
}
@media (hover: hover) {
  .dsh-coordinator-session-row:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-coordinator-session-status {
  flex: none;
  width: 10px;
  height: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dsh-coordinator-session-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
}
.dsh-coordinator-session-spinner {
  flex: none;
  width: 10px;
  height: 10px;
  box-sizing: border-box;
  border: 1.5px solid var(--dsw-alias-label-tertiary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: dsh-coordinator-spin 0.8s linear infinite;
}
@keyframes dsh-coordinator-spin {
  to { transform: rotate(360deg); }
}
`

/**
 * 注入区块样式表。同一页面只注入一次。
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
 * 项目区块内容。
 *
 * @param {object} props - 组件属性
 * @returns {object} React 元素
 */
export function ProjectSection(props) {
  const {
    projects, busy, notice, draft,
    onAdd, onConfirmAdd, onCancelAdd, onDraftName,
    onOpen, onRename, onReplace, onRemove,
    sessionsByProject, sessionRows, expandedProjects,
    onToggleExpand, onOpenSession,
    listExpanded, onToggleList,
  } = props

  useEffect(() => { ensureStyles() }, [])

  return createElement(
    'div',
    { className: 'dsh-coordinator-project-section' },
    createElement(
      'div',
      { className: 'dsh-coordinator-project-header' },
      createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-coordinator-project-header-toggle',
          'aria-expanded': listExpanded,
          title: listExpanded ? '收起项目列表' : '展开项目列表',
          onClick: onToggleList,
        },
        createElement(
          'span',
          { className: 'dsh-coordinator-project-lead' },
          createElement(
            'span',
            { className: 'dsh-coordinator-project-lead-folder' },
            productIcon('folder-open-outline', { size: 16 }),
          ),
          createElement(
            'span',
            {
              className: 'dsh-coordinator-project-lead-arrow',
              'data-open': listExpanded ? 'true' : 'false',
            },
            productIcon('triangle-right-fill', { size: 14 }),
          ),
        ),
        createElement('span', { className: 'dsh-coordinator-project-header-label' }, '项目'),
      ),
      createElement(
        'div',
        { className: 'dsh-coordinator-project-header-actions' },
        createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-coordinator-project-icon-button',
            title: '加项目：选一个目录',
            disabled: busy,
            onClick: onAdd,
          },
          productIcon('project-add-outline'),
        ),
      ),
    ),
    draft === null ? null : createElement(
      'div',
      { style: { padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '4px' } },
      createElement(
        'div',
        { className: 'dsh-coordinator-project-meta' },
        draft.directory,
      ),
      createElement('input', {
        type: 'text',
        className: 'dsh-coordinator-project-rename',
        value: draft.name,
        autoFocus: true,
        onChange: (event) => onDraftName(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter') onConfirmAdd()
          if (event.key === 'Escape') onCancelAdd()
        },
      }),
      createElement(
        'div',
        { style: { display: 'flex', gap: '4px' } },
        createElement(
          'button',
          { type: 'button', disabled: busy, onClick: onConfirmAdd, className: 'dsh-coordinator-project-draft-action' },
          '注册',
        ),
        createElement(
          'button',
          { type: 'button', onClick: onCancelAdd, className: 'dsh-coordinator-project-draft-action' },
          '取消',
        ),
      ),
    ),
    listExpanded
      ? (projects.length === 0
          ? createElement(
              'div',
              { className: 'dsh-coordinator-project-notice' },
              '还没有项目。加一个即在它的目录里建好协调者会话。',
            )
          : createElement(
              'div',
              null,
              projects.map((project) => createElement(ProjectRow, {
                key: project.id,
                project,
                busy,
                onOpen,
                onRename,
                onReplace,
                onRemove,
                sessions: sessionsByProject.get(project.id) ?? [],
                sessionRows,
                expanded: expandedProjects.has(project.id),
                onToggleExpand,
                onOpenSession,
              })),
            ))
      : null,
    notice === '' ? null : createElement(
      'div',
      { className: 'dsh-coordinator-project-notice' },
      notice,
    ),
  )
}

/**
 * 一个项目行：行首目录图标、项目名，悬停整行时行首换成展开箭头、右端露出操作按钮。
 *
 * 点行（或点行首图标）折叠/展开该项目下的会话列表。协调者不在列表里——它的入口
 * 在行的「更多」菜单里，重复列出会让入口含糊。
 *
 * @param {object} props - 组件属性
 * @returns {object} React 元素
 */
function ProjectRow(props) {
  const {
    project, busy, onOpen, onRename, onReplace, onRemove,
    sessions, sessionRows, expanded, onToggleExpand, onOpenSession,
  } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const moreRef = useRef(null)
  const leadRef = useRef(null)
  const openable = isProjectOpenable(project)

  useEffect(() => {
    if (!menuOpen) return undefined
    const onDismiss = () => setMenuOpen(false)
    window.addEventListener('click', onDismiss)
    return () => window.removeEventListener('click', onDismiss)
  }, [menuOpen])

  const commitRename = () => {
    setRenaming(false)
    if (name !== project.name) onRename(project, name)
  }

  const childSessions = selectProjectSessionRows({
    sessionIds: sessions,
    sessionRows,
    coordinatorSessionId: project.coordinatorSessionId,
  })

  const menuItems = [
    openable
      ? { id: 'open', label: '打开协调者会话', icon: 'new-chat-outline', onSelect: () => onOpen(project) }
      : null,
    { id: 'rename', label: '重命名', icon: 'edit-outline', onSelect: () => setRenaming(true) },
    { id: 'replace', label: '换新协调者', icon: 'refresh-outline', onSelect: () => onReplace(project) },
    { id: 'remove', label: '注销项目', icon: 'trash-outline', danger: true, onSelect: () => onRemove(project) },
  ].filter((item) => item !== null)

  return createElement(
    'div',
    null,
    createElement(
      'div',
      {
        className: 'dsh-coordinator-project-row',
        'data-dead': openable ? undefined : 'true',
        'data-menu-open': menuOpen ? 'true' : undefined,
        role: 'treeitem',
        'aria-expanded': expanded,
        title: `${project.name} · ${project.directory}`,
        onClick: (event) => {
          if (event.target.closest('.dsh-coordinator-project-actions') !== null) return
          onOpen(project)
        },
      },
      createElement(
        'button',
        {
          type: 'button',
          ref: leadRef,
          className: 'dsh-coordinator-project-lead',
          'aria-label': expanded ? '收起会话' : '展开会话',
          onClick: (event) => { event.stopPropagation(); onToggleExpand(project.id) },
        },
        createElement(
          'span',
          { className: 'dsh-coordinator-project-lead-folder' },
          productIcon(expanded ? 'folder-open' : 'folder-close', { size: 16 }),
        ),
        createElement(
          'span',
          {
            className: 'dsh-coordinator-project-lead-arrow',
            'data-open': expanded ? 'true' : 'false',
          },
          productIcon('triangle-right-fill', { size: 14 }),
        ),
      ),
      renaming
        ? createElement('input', {
            type: 'text',
            className: 'dsh-coordinator-project-rename',
            value: name,
            autoFocus: true,
            onClick: (event) => event.stopPropagation(),
            onChange: (event) => setName(event.target.value),
            onBlur: commitRename,
            onKeyDown: (event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') { setName(project.name); setRenaming(false) }
            },
          })
        : createElement(
            'span',
            { className: 'dsh-coordinator-project-title' },
            project.name,
          ),
      createElement(
        'div',
        { className: 'dsh-coordinator-project-actions' },
        openable
          ? null
          : createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-coordinator-project-icon-button',
                title: '换新协调者',
                disabled: busy,
                onClick: (event) => { event.stopPropagation(); onReplace(project) },
              },
              productIcon('refresh-outline'),
            ),
        createElement(
          'button',
          {
            type: 'button',
            ref: moreRef,
            className: 'dsh-coordinator-project-icon-button',
            title: '更多',
            disabled: busy,
            onClick: (event) => {
              event.stopPropagation()
              // 「更多」按钮平时不显示（悬停整行才出现），脚本触发的点击会拿到
              // 空矩形——这时退回行首槽位，菜单才不会贴到视口左上角。
              const rect = moreRef.current?.getBoundingClientRect()
              const anchorRect = rect !== undefined && rect.width > 0
                ? rect
                : leadRef.current?.getBoundingClientRect()
              setMenuAnchor(anchorRect === undefined ? null : {
                left: anchorRect.left,
                top: anchorRect.top,
                bottom: anchorRect.bottom,
              })
              setMenuOpen((value) => !value)
            },
          },
          productIcon('ellipsis-outline'),
        ),
      ),
    ),
    expanded
      ? createElement(
          'div',
          { className: 'dsh-coordinator-project-sessions' },
          childSessions.length === 0
            ? createElement(
                'div',
                { className: 'dsh-coordinator-project-notice' },
                '该项目下还没有会话。',
              )
            : childSessions.map((row) => createElement(SessionRow, {
                key: row.id,
                row,
                onOpenSession,
              })),
        )
      : null,
    menuOpen && menuAnchor !== null
      ? createPortal(
          createElement(ProjectMenu, {
            anchor: menuAnchor,
            items: menuItems,
            onClose: () => setMenuOpen(false),
          }),
          document.body,
        )
      : null,
  )
}

/**
 * 项目的操作菜单。
 *
 * 第三方插件不能 import 宿主 UI 包（dsh 的包面规则禁止功能包为绕过规则添加
 * `dsh.client.external`），所以菜单是自己渲染的，但外观照官方 `Menu`：同样的
 * 圆角、材质、阴影与行高，取的是同一批 `--dsw-*` 变量。菜单挂在 `document.body`
 * 上（portal），避免被左栏滚动区裁掉。
 *
 * @param {object} props - 组件属性
 * @param {object} props.anchor - 锚点按钮的视口矩形
 * @param {object[]} props.items - 菜单项
 * @param {Function} props.onClose - 关闭菜单
 * @returns {object} React 元素
 */
function ProjectMenu(props) {
  const { anchor, items, onClose } = props
  const ref = useRef(null)
  const [placement, setPlacement] = useState({ left: anchor.left, top: anchor.bottom + 4 })

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0
    const fitsBelow = anchor.bottom + 4 + height <= window.innerHeight - 12
    setPlacement(fitsBelow
      ? { left: anchor.left, top: anchor.bottom + 4 }
      : { left: anchor.left, top: Math.max(12, anchor.top - height - 4) })
  }, [anchor])

  return createElement(
    'div',
    {
      ref,
      role: 'menu',
      className: 'dsh-coordinator-project-menu',
      'data-menu-material': 'translucent',
      style: { left: `${placement.left}px`, top: `${placement.top}px` },
      onClick: (event) => event.stopPropagation(),
    },
    items.map((item) => createElement(
      'button',
      {
        key: item.id,
        type: 'button',
        role: 'menuitem',
        className: 'dsh-coordinator-project-menu-item',
        'data-danger': item.danger === true ? 'true' : undefined,
        onClick: () => { onClose(); item.onSelect() },
      },
      item.icon === undefined
        ? null
        : createElement(
            'span',
            { className: 'dsh-coordinator-project-menu-icon' },
            productIcon(item.icon, { size: 14 }),
          ),
      createElement('span', null, item.label),
    )),
  )
}

/**
 * 项目下的一个会话行。
 *
 * 纯文字行：左边的会话图标与右边的执行者标记都不画——会话名在项目树里已经能
 * 看清，再加图标只会挤占标题的宽度。运行中的会话仍在行首留一个状态位。
 *
 * @param {object} props - 组件属性
 * @returns {object} React 元素
 */
function SessionRow(props) {
  const { row, onOpenSession } = props
  return createElement(
    'div',
    {
      className: 'dsh-coordinator-session-row',
      onClick: () => onOpenSession(row.id),
      title: row.displayTitle ?? row.title ?? row.id,
    },
    createElement(
      'span',
      { className: 'dsh-coordinator-session-status' },
      row.running ? createElement('span', { className: 'dsh-coordinator-session-spinner' }) : null,
    ),
    createElement(
      'span',
      { className: 'dsh-coordinator-session-title' },
      row.title ?? row.displayTitle ?? row.id,
    ),
  )
}
