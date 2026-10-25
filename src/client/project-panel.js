/**
 * 左栏项目区块。
 *
 * 宿主侧的项目注册表是唯一真源，浏览器侧只做呈现与操作：列项目、加项目、打开
 * 项目的协调者会话、注销项目。
 *
 * **加项目**：选目录 → 起名 → 注册。注册时宿主会在该目录里建一个协调者会话并
 * 与项目绑定，所以「加完项目」就已经有一个可用的协调者会话在等用户。
 *
 * **打开项目**：点项目名就打开它的协调者会话——项目的切换就是会话的切换，会话
 * 的工作目录在创建时定死。
 *
 * 窄侧栏（56px 导轨）放不下列表，改为一个入口按钮 + 浮层；宽侧栏直接内联列表。
 *
 * @module dsh-coordinator/client/project-panel
 */

import { createElement, useCallback, useEffect, useState } from 'react'
import { PROJECT_ENDPOINTS } from '../shared/projects.js'
import { basenameOf, isProjectOpenable, validateProjectName } from './project-panel-logic.js'

/**
 * 项目区块。
 * @param {object} props - slot 注入的运行时属性
 * @param {boolean} props.wide - 侧栏是否宽（false 为 56px 导轨）
 * @param {(endpoint: string, payload: object) => Promise<object>} props.callEndpoint - 调用宿主项目通道
 * @param {() => object | undefined} props.getUiWorkspace - 取导航服务
 * @returns {object} React 元素
 */
export function ProjectPanel(props) {
  const { wide, callEndpoint, getUiWorkspace } = props
  const [projects, setProjects] = useState([])
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [floating, setFloating] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const value = await callEndpoint(PROJECT_ENDPOINTS.list, {})
      setProjects(value.projects ?? [])
    } catch (error) {
      setNotice(`读取项目失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [callEndpoint])

  useEffect(() => {
    void refresh()
    // 窗口重新获得焦点时刷新：项目也可能在另一个窗口里被增删。
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const startAdd = useCallback(async () => {
    if (busy) return
    const uiWorkspace = getUiWorkspace?.()
    if (uiWorkspace === undefined) {
      setNotice('目录选择器不可用：请在终端里用 add_project 注册项目。')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      const directory = await uiWorkspace.pickDirectory()
      if (typeof directory !== 'string' || directory === '') return
      setDraft({ directory, name: basenameOf(directory) })
    } catch (error) {
      setNotice(`选择目录失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, getUiWorkspace])

  const confirmAdd = useCallback(async () => {
    if (draft === null || busy) return
    const check = validateProjectName(draft.name)
    if (!check.ok) {
      setNotice(check.error)
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await callEndpoint(PROJECT_ENDPOINTS.create, {
        directory: draft.directory,
        name: draft.name,
      })
      setDraft(null)
      await refresh()
    } catch (error) {
      setNotice(`注册项目失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callEndpoint, draft, refresh])

  const openProject = useCallback((project) => {
    if (!isProjectOpenable(project)) {
      setNotice(`项目「${project.name}」的协调者会话已被删除，请换新协调者。`)
      return
    }
    const uiWorkspace = getUiWorkspace?.()
    if (uiWorkspace === undefined) {
      setNotice('导航服务不可用：无法打开会话。')
      return
    }
    uiWorkspace.openSession(project.coordinatorSessionId)
  }, [getUiWorkspace])

  const replaceCoordinator = useCallback(async (project) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await callEndpoint(PROJECT_ENDPOINTS.replaceCoordinator, { id: project.id })
      await refresh()
    } catch (error) {
      setNotice(`换新协调者失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callEndpoint, refresh])

  const removeProject = useCallback(async (project) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await callEndpoint(PROJECT_ENDPOINTS.remove, { id: project.id })
      await refresh()
    } catch (error) {
      setNotice(`注销项目失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callEndpoint, refresh])

  const body = createElement(
    ProjectList,
    {
      projects,
      busy,
      notice,
      draft,
      onAdd: () => { void startAdd() },
      onConfirmAdd: () => { void confirmAdd() },
      onCancelAdd: () => setDraft(null),
      onDraftName: (name) => setDraft((current) => (current === null ? current : { ...current, name })),
      onOpen: openProject,
      onReplace: (project) => { void replaceCoordinator(project) },
      onRemove: (project) => { void removeProject(project) },
    },
  )

  if (wide) {
    return createElement(
      'div',
      { style: { padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' } },
      body,
    )
  }

  // 窄导轨放不下列表：入口按钮 + 浮层。
  return createElement(
    'div',
    { style: { position: 'relative' } },
    createElement(
      'button',
      {
        type: 'button',
        title: '项目',
        onClick: () => setFloating((value) => !value),
        style: {
          width: '100%',
          padding: '4px 0',
          fontSize: '11px',
          color: floating ? '#c9d1d9' : '#8b949e',
          background: floating ? 'rgba(125, 133, 144, 0.12)' : 'transparent',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        },
      },
      '项目',
    ),
    floating
      ? createElement(
          'div',
          {
            style: {
              position: 'fixed',
              left: '60px',
              bottom: '56px',
              width: '240px',
              maxHeight: '60vh',
              overflowY: 'auto',
              padding: '8px',
              background: '#161b22',
              border: '1px solid rgba(125, 133, 144, 0.35)',
              borderRadius: '6px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
              zIndex: 40,
            },
          },
          body,
        )
      : null,
  )
}

/**
 * 项目列表。
 * @param {object} props - 组件属性
 * @returns {object} React 元素
 */
function ProjectList(props) {
  const {
    projects, busy, notice, draft,
    onAdd, onConfirmAdd, onCancelAdd, onDraftName,
    onOpen, onReplace, onRemove,
  } = props

  return createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
    createElement(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      createElement(
        'span',
        { style: { fontSize: '12px', color: '#8b949e', fontWeight: 600 } },
        `项目（${projects.length}）`,
      ),
      createElement(
        'button',
        {
          type: 'button',
          title: '加项目：选一个目录',
          disabled: busy,
          onClick: onAdd,
          style: {
            marginLeft: 'auto',
            padding: '0 6px',
            fontSize: '13px',
            lineHeight: '18px',
            color: '#8b949e',
            background: 'transparent',
            border: '1px solid rgba(125, 133, 144, 0.35)',
            borderRadius: '4px',
            cursor: busy ? 'default' : 'pointer',
          },
        },
        '+',
      ),
    ),
    draft === null
      ? null
      : createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' } },
          createElement(
            'div',
            { style: { fontSize: '11px', color: '#8b949e', wordBreak: 'break-all' } },
            draft.directory,
          ),
          createElement(
            'input',
            {
              type: 'text',
              value: draft.name,
              autoFocus: true,
              onChange: (event) => onDraftName(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') onConfirmAdd()
                if (event.key === 'Escape') onCancelAdd()
              },
              style: {
                padding: '2px 4px',
                fontSize: '12px',
                color: '#c9d1d9',
                background: '#0d1117',
                border: '1px solid rgba(125, 133, 144, 0.35)',
                borderRadius: '4px',
              },
            },
          ),
          createElement(
            'div',
            { style: { display: 'flex', gap: '4px' } },
            createElement(
              'button',
              { type: 'button', disabled: busy, onClick: onConfirmAdd, style: miniButtonStyle },
              '注册',
            ),
            createElement(
              'button',
              { type: 'button', onClick: onCancelAdd, style: miniButtonStyle },
              '取消',
            ),
          ),
        ),
    projects.length === 0
      ? createElement(
          'div',
          { style: { fontSize: '11px', color: '#8b949e', lineHeight: '1.5' } },
          '还没有项目。加一个即在它的目录里建好协调者会话。',
        )
      : createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          projects.map((project) => createElement(ProjectRow, {
            key: project.id,
            project,
            busy,
            onOpen,
            onReplace,
            onRemove,
          })),
        ),
    notice === ''
      ? null
      : createElement('div', { style: { fontSize: '11px', color: '#d29922', lineHeight: '1.5' } }, notice),
  )
}

/**
 * 小按钮的统一样式。
 * @type {object}
 */
const miniButtonStyle = {
  padding: '1px 6px',
  fontSize: '11px',
  color: '#8b949e',
  background: 'transparent',
  border: '1px solid rgba(125, 133, 144, 0.35)',
  borderRadius: '4px',
  cursor: 'pointer',
}

/**
 * 一个项目行。
 * @param {object} props - 组件属性
 * @returns {object} React 元素
 */
function ProjectRow(props) {
  const { project, busy, onOpen, onReplace, onRemove } = props
  const openable = isProjectOpenable(project)
  return createElement(
    'div',
    { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
    createElement(
      'button',
      {
        type: 'button',
        title: project.directory,
        disabled: busy,
        onClick: () => onOpen(project),
        style: {
          flex: '1 1 auto',
          minWidth: 0,
          textAlign: 'left',
          padding: '3px 4px',
          fontSize: '12px',
          color: openable ? '#c9d1d9' : '#8b949e',
          background: 'transparent',
          border: 'none',
          borderRadius: '4px',
          cursor: busy ? 'default' : 'pointer',
          overflow: 'hidden',
        },
      },
      createElement(
        'span',
        { style: { fontWeight: 600, marginRight: '4px' } },
        project.name,
      ),
      createElement(
        'span',
        {
          style: {
            fontSize: '10px',
            opacity: 0.65,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          },
        },
        project.directory,
      ),
    ),
    openable
      ? null
      : createElement(
          'button',
          { type: 'button', title: '换新协调者', disabled: busy, onClick: () => onReplace(project), style: miniButtonStyle },
          '换协调者',
        ),
    createElement(
      'button',
      { type: 'button', title: '注销项目', disabled: busy, onClick: () => onRemove(project), style: miniButtonStyle },
      '×',
    ),
  )
}
