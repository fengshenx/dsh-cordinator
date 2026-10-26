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

import { createElement, useEffect, useState } from 'react'
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
  color: var(--dsw-alias-label-tertiary);
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
  position: absolute;
  z-index: 40;
  min-width: 160px;
  padding: 4px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-menu-bg, var(--dsw-specific-sidebar-fill));
  border: 1px solid var(--dsw-alias-border-l4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.dsh-coordinator-project-menu-item {
  display: block;
  width: 100%;
  padding: 4px 8px;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-coordinator-project-menu-item:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.dsh-coordinator-project-menu-item[data-danger='true'] {
  color: var(--dsw-alias-label-danger, #d29922);
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
.dsh-coordinator-session-title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
}
.dsh-coordinator-session-tag {
  flex: none;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  color: var(--dsw-alias-label-tertiary);
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
        productIcon(listExpanded ? 'chevron-down-outline' : 'chevron-right-outline', { size: 14 }),
        productIcon('folder-open-outline', { size: 14 }),
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
          { type: 'button', disabled: busy, onClick: onConfirmAdd, className: 'dsh-coordinator-project-menu-item' },
          '注册',
        ),
        createElement(
          'button',
          { type: 'button', onClick: onCancelAdd, className: 'dsh-coordinator-project-menu-item' },
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
          onToggleExpand(project.id)
        },
      },
      createElement(
        'span',
        { className: 'dsh-coordinator-project-lead' },
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
            className: 'dsh-coordinator-project-icon-button',
            title: '更多',
            disabled: busy,
            onClick: (event) => { event.stopPropagation(); setMenuOpen((value) => !value) },
          },
          productIcon('ellipsis-outline'),
        ),
        menuOpen
          ? createElement(
              'div',
              { className: 'dsh-coordinator-project-menu', onClick: (event) => event.stopPropagation() },
              openable
                ? createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-coordinator-project-menu-item',
                      onClick: () => { setMenuOpen(false); onOpen(project) },
                    },
                    '打开协调者会话',
                  )
                : null,
              createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-coordinator-project-menu-item',
                  onClick: () => { setMenuOpen(false); setRenaming(true) },
                },
                '重命名',
              ),
              createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-coordinator-project-menu-item',
                  onClick: () => { setMenuOpen(false); onReplace(project) },
                },
                '换新协调者',
              ),
              createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-coordinator-project-menu-item',
                  'data-danger': 'true',
                  onClick: () => { setMenuOpen(false); onRemove(project) },
                },
                '注销项目',
              ),
            )
          : null,
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
  )
}

/**
 * 项目下的一个会话行。
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
    row.running
      ? createElement('span', { className: 'dsh-coordinator-session-spinner' })
      : productIcon('new-chat-outline', { size: 14 }),
    createElement(
      'span',
      { className: 'dsh-coordinator-session-title' },
      row.title ?? row.displayTitle ?? row.id,
    ),
    row.origin === 'subagent'
      ? createElement(
          'span',
          { className: 'dsh-coordinator-session-tag', title: '执行者会话' },
          productIcon('users-outline', { size: 12 }),
        )
      : null,
  )
}
