/**
 * 项目切换器（React 组件）。
 *
 * 面板挂在右栏，作用域是当前会话，因此切换器是「从当前会话跳到另一个项目的
 * 会话」——会话的工作目录在创建时定死，切换项目只能是切换会话。
 *
 * 导航走 `ctx.get('uiWorkspace')` 惰性获取：该服务由 web-app bundle 提供，第三方
 * bundle 不能把它写进 `inject`（缺服务会让整个插件挂起）。缺失时降级为提示用户
 * 在目标目录新建会话。
 *
 * @module dsh-coordinator/client/project-switcher-ui
 */

import { createElement, useCallback, useEffect, useState } from 'react'
import { groupSessionsByProject, pickProjectSession, projectPathOf } from './project-switcher.js'

/**
 * 订阅会话列表快照。
 *
 * @param {object | undefined} sessions - 会话服务
 * @returns {object[]} 会话行
 */
function useSessionRows(sessions) {
  const [rows, setRows] = useState([])
  useEffect(() => {
    if (sessions === undefined || sessions === null) return undefined
    const read = () => {
      const snapshot = sessions.list.getSnapshot()
      setRows(Object.values(snapshot.byId ?? {}))
    }
    read()
    return sessions.list.subscribe(read)
  }, [sessions])
  return rows
}

/**
 * 项目切换器。
 *
 * @param {object} props - slot 注入的运行时属性
 * @param {string} props.sessionId - 面板所属会话
 * @param {() => object | undefined} props.getSessions - 取会话服务的延迟取值器
 * @param {() => object | undefined} props.getUiWorkspace - 取导航服务的延迟取值器
 * @returns {object} React 元素
 */
export function ProjectSwitcher(props) {
  const { sessionId, getSessions, getUiWorkspace } = props
  const sessions = getSessions()
  const rows = useSessionRows(sessions)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)

  const projects = groupSessionsByProject(rows)
  const currentPath = projectPathOf(rows, sessionId)

  const switchTo = useCallback(async (project) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const uiWorkspace = getUiWorkspace?.()
      if (uiWorkspace === undefined || uiWorkspace === null) {
        setNotice('导航服务不可用：请在目标目录新建会话。路径已复制。')
        await copyToClipboard(project.path)
        return
      }
      const target = pickProjectSession(project.sessions)
      const sessionIdToOpen = target?.id ?? await sessions.create({ cwd: project.path })
      uiWorkspace.openSession(sessionIdToOpen)
      setNotice(`已切到「${project.name}」的会话 ${sessionIdToOpen}。`)
    } catch (error) {
      setNotice(`切换失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, getUiWorkspace, sessions])

  if (projects.length === 0) {
    return createElement(
      'div',
      { style: { padding: '8px 10px', fontSize: '12px', color: '#8b949e' } },
      '还没有项目——项目即会话的工作目录，新建会话即新建项目。',
    )
  }

  return createElement(
    'div',
    { style: { padding: '8px 10px', borderBottom: '1px solid rgba(125, 133, 144, 0.25)' } },
    createElement(
      'div',
      { style: { fontSize: '12px', color: '#8b949e', marginBottom: '4px' } },
      `项目（${projects.length}）`,
    ),
    createElement(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
      projects.map((project) => {
        const isCurrent = project.path === currentPath
        return createElement(
          'button',
          {
            key: project.path,
            type: 'button',
            disabled: isCurrent || busy,
            onClick: () => { void switchTo(project) },
            title: project.path,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              width: '100%',
              textAlign: 'left',
              padding: '4px 6px',
              fontSize: '13px',
              color: isCurrent ? '#c9d1d9' : '#8b949e',
              background: isCurrent ? 'rgba(125, 133, 144, 0.12)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              cursor: isCurrent || busy ? 'default' : 'pointer',
            },
          },
          createElement('span', { style: { fontWeight: 600 } }, project.name),
          createElement(
            'span',
            { style: { fontSize: '11px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            project.path,
          ),
          isCurrent
            ? createElement('span', { style: { marginLeft: 'auto', fontSize: '11px' } }, '当前')
            : null,
        )
      }),
    ),
    notice === null
      ? null
      : createElement(
          'div',
          { style: { marginTop: '6px', fontSize: '11px', color: '#d29922' } },
          notice,
        ),
  )
}

/**
 * 把文本写入剪贴板。
 *
 * 剪贴板不可用不是错误——降级路径本身已经提示了用户路径内容。
 *
 * @param {string} text - 待复制文本
 * @returns {Promise<void>} 复制完成
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch (error) {
    // 剪贴板被浏览器策略拒绝时无可挽回，调用方已另行提示路径。
  }
}
