/**
 * 左栏项目区块。
 *
 * 宿主侧的项目注册表是唯一真源，浏览器侧只做呈现与操作：列项目、加项目、打开
 * 项目的协调者会话、改名、换新协调者、注销项目。
 *
 * **加项目**：选目录 → 起名 → 注册。注册时宿主会在该目录里建一个协调者会话并
 * 与项目绑定，所以「加完项目」就已经有一个可用的协调者会话在等用户。
 *
 * **打开项目**：点项目名就打开它的协调者会话——项目的切换就是会话的切换，会话
 * 的工作目录在创建时定死。
 *
 * **项目树**：点项目行展开或收起该项目目录下的会话（协调者不在其中，它的入口在
 * 行的「更多」菜单里）。会话归属由宿主按目录判定——浏览器侧没有文件系统，做不了
 * 路径归一。
 *
 * **与官方工作区树并行**：项目下的会话不在官方工作区树里重复出现。官方没有
 * 「按项目排除会话」的扩展点，这层排除走渲染层（见 `workspace-exclusion.js`）。
 *
 * **位置**：宽侧栏里区块插在「自动化任务」面板行之下、工作区列表之上。左栏正文
 * 区只有 `sidebar.workspaces` 一个槽且已被官方工作区浏览占用，slot 机制没有装饰
 * 或包装能力，第三方无法在它旁边插入并列区块——所以这里按宿主左栏的结构，在
 * 面板列表之后安一个容器，用 portal 把内容渲染进去。锚点找不到时内容退回底部
 * 槽，不至于消失。
 *
 * 窄侧栏（56px 导轨）放不下列表，改为一个入口按钮 + 浮层。
 *
 * @module dsh-coordinator/client/project-panel
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ProjectSection } from './project-section.js'
import { productIcon } from './icons.js'
import {
  basenameOf,
  isProjectOpenable,
  openCoordinatorSession,
  validateProjectName,
} from './project-panel-logic.js'
import { isProjectRemoteReady, onProjectRemoteReady, projectRemoteError } from './project-remote.js'
import { createWorkspaceExclusion } from './workspace-exclusion.js'

/**
 * 项目区块。
 * @param {object} props - slot 注入的运行时属性
 * @param {boolean} props.wide - 侧栏是否宽（false 为 56px 导轨）
 * @param {(method: string, args: unknown[]) => Promise<unknown>} props.callRemote - 调用宿主远程方法
 * @param {() => object | undefined} props.getUiWorkspace - 取导航服务
 * @param {() => object | undefined} props.getSessions - 取会话服务
 * @returns {object} React 元素
 */
export function ProjectPanel(props) {
  const { wide, callRemote, getUiWorkspace, getSessions } = props
  const [projects, setProjects] = useState([])
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [floating, setFloating] = useState(false)
  /** 项目 id 到该项目的会话 id 列表。 */
  const [sessionsByProject, setSessionsByProject] = useState(() => new Map())
  /** 会话 id 到会话行（标题、运行状态、来源）。 */
  const [sessionRows, setSessionRows] = useState({})
  /** 展开了子会话列表的项目 id。 */
  const [expandedProjects, setExpandedProjects] = useState(() => new Set())
  /** 整个项目列表是否展开（区块标题可折叠）。 */
  const [listExpanded, setListExpanded] = useState(true)

  const refresh = useCallback(async () => {
    // 通道还没挂好时不发请求：报错只会写一条看不懂的「通道不可用」，
    // 通道就绪后会自动补刷。
    if (!isProjectRemoteReady()) return
    try {
      const value = await callRemote('list', [])
      setProjects(Array.isArray(value) ? value : [])
    } catch (error) {
      setNotice(`读取项目失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [callRemote])

  /**
   * 重读项目下的会话归属。
   *
   * 归属判据在宿主侧——浏览器没有文件系统，做不了路径归一，这里只取结果。
   * @returns {Promise<void>} 完成
   */
  const refreshSessionIndex = useCallback(async () => {
    if (!isProjectRemoteReady()) return
    try {
      const value = await callRemote('sessionsByProject', [])
      const grouped = new Map()
      for (const entry of Array.isArray(value) ? value : []) {
        if (typeof entry?.projectId !== 'string') continue
        grouped.set(entry.projectId, Array.isArray(entry.sessionIds) ? entry.sessionIds : [])
      }
      setSessionsByProject(grouped)
    } catch (error) {
      setNotice(`读取项目会话失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [callRemote])

  useEffect(() => {
    void refresh()
    void refreshSessionIndex()
    // 窗口重新获得焦点时刷新：项目也可能在另一个窗口里被增删。
    const onFocus = () => { void refresh(); void refreshSessionIndex() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh, refreshSessionIndex])

  // 通道挂好后补刷一次：挂载前那一次必然失败。挂载失败也要重渲染，错误原因
  // 才出现在界面上。
  const [, setChannelTick] = useState(0)
  useEffect(() => onProjectRemoteReady(() => {
    setChannelTick((tick) => tick + 1)
    void refresh()
    void refreshSessionIndex()
  }), [refresh, refreshSessionIndex])

  // 订阅会话列表：标题与运行状态随会话变化，归属也会因新会话而变。
  useEffect(() => {
    const sessions = getSessions?.()
    if (sessions?.list?.subscribe === undefined) return undefined
    let pending = null
    const sync = () => {
      const snapshot = sessions.list.getSnapshot()
      const rows = {}
      for (const [id, row] of Object.entries(snapshot.byId ?? {})) {
        rows[id] = {
          id,
          title: row.title,
          displayTitle: row.displayTitle,
          running: row.running,
          origin: row.origin,
        }
      }
      setSessionRows(rows)
      // 归属重算要过宿主，合并到一次延迟刷新里，避免每条事件都打一次远程调用。
      if (pending !== null) clearTimeout(pending)
      pending = setTimeout(() => { pending = null; void refreshSessionIndex() }, 1000)
    }
    sync()
    const unsubscribe = sessions.list.subscribe(sync)
    return () => {
      unsubscribe()
      if (pending !== null) clearTimeout(pending)
    }
  }, [getSessions, refreshSessionIndex])

  // 项目下的会话不在官方工作区树里重复出现。
  useEffect(() => {
    const exclusion = createWorkspaceExclusion()
    const excluded = new Set()
    for (const sessionIds of sessionsByProject.values()) {
      for (const sessionId of sessionIds) excluded.add(sessionId)
    }
    exclusion.update(excluded)
    return () => exclusion.dispose()
  }, [sessionsByProject])

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
      await callRemote('create', [draft.directory, draft.name])
      setDraft(null)
      await refresh()
    } catch (error) {
      setNotice(`注册项目失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callRemote, draft, refresh])

  const openProject = useCallback(async (project) => {
    if (!isProjectOpenable(project)) {
      setNotice(`项目「${project.name}」的协调者会话已被删除，请换新协调者。`)
      return
    }
    const uiWorkspace = getUiWorkspace?.()
    if (uiWorkspace === undefined) {
      setNotice('导航服务不可用：无法打开会话。')
      return
    }
    // 只有归属工作区的会话能被官方 UI 打开成主区域，先确保它挂上了。
    const result = await openCoordinatorSession({
      project,
      callRemote,
      openSession: (sessionId) => uiWorkspace.openSession(sessionId),
    })
    if (result.ok !== true) setNotice(result.message)
  }, [callRemote, getUiWorkspace])

  const renameProject = useCallback(async (project, name) => {
    if (busy) return
    const check = validateProjectName(name)
    if (!check.ok) {
      setNotice(check.error)
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await callRemote('rename', [project.id, name])
      await refresh()
    } catch (error) {
      setNotice(`改名失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callRemote, refresh])

  const replaceCoordinator = useCallback(async (project) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await callRemote('replaceCoordinator', [project.id])
      await refresh()
    } catch (error) {
      setNotice(`换新协调者失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callRemote, refresh])

  const removeProject = useCallback(async (project) => {
    if (busy) return
    setBusy(true)
    setNotice('')
    try {
      await callRemote('unregister', [project.id])
      await refresh()
    } catch (error) {
      setNotice(`注销项目失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, callRemote, refresh])

  const body = createElement(ProjectSection, {
    projects,
    busy,
    notice: isProjectRemoteReady()
      ? notice
      : `项目通道未就绪。${projectRemoteError()}${notice}`,
    draft,
    onAdd: () => { void startAdd() },
    onConfirmAdd: () => { void confirmAdd() },
    onCancelAdd: () => setDraft(null),
    onDraftName: (name) => setDraft((current) => (current === null ? current : { ...current, name })),
    onOpen: openProject,
    onRename: (project, name) => { void renameProject(project, name) },
    onReplace: (project) => { void replaceCoordinator(project) },
    onRemove: (project) => { void removeProject(project) },
    sessionsByProject,
    sessionRows,
    expandedProjects,
    listExpanded,
    onToggleList: () => setListExpanded((value) => !value),
    onToggleExpand: (projectId) => setExpandedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    }),
    onOpenSession: (sessionId) => {
      const uiWorkspace = getUiWorkspace?.()
      if (uiWorkspace === undefined) {
        setNotice('导航服务不可用：无法打开会话。')
        return
      }
      uiWorkspace.openSession(sessionId)
    },
  })

  if (!wide) {
    // 窄导轨放不下列表：图标入口 + 浮层。图标取工作区同款，工作区在导轨里也是
    // 一列图标。
    return createElement(
      'div',
      { style: { position: 'relative' } },
      createElement(
        'button',
        {
          type: 'button',
          title: '项目',
          'aria-label': '项目',
          onClick: () => setFloating((value) => !value),
          style: {
            width: '100%',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: floating ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            background: floating ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
            border: 'none',
            borderRadius: 'var(--dsw-radius-sm)',
            cursor: 'pointer',
          },
        },
        productIcon('workspace-tree-outline'),
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
                background: 'var(--dsw-specific-sidebar-fill)',
                border: '1px solid var(--dsw-alias-border-l4)',
                borderRadius: 'var(--dsw-radius-lg)',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                zIndex: 40,
              },
            },
            body,
          )
        : null,
    )
  }

  return createElement(SidebarPlacement, null, body)
}

/**
 * 找左栏根容器：向上找到第一个「直接子元素里有面板列表 nav」的祖先。
 *
 * 插槽 occupant 在宿主树里的层数随宿主版本变，固定层数会失配；「最近的、且直接
 * 含有 nav 的祖先」这个判据在宿主改版时自然落空，退回原位渲染。
 *
 * @param {Element} anchor - 锚点元素
 * @returns {Element | null} 左栏根容器
 */
function findSidebarRoot(anchor) {
  let node = anchor.parentElement
  while (node !== null) {
    if (node.querySelector(':scope > nav') !== null) return node
    node = node.parentElement
  }
  return null
}

/**
 * 把区块安到左栏的面板列表之下、工作区列表之上。
 *
 * 宿主左栏的正文区只有一个 `sidebar.workspaces` 槽（已被官方工作区浏览占用），
 * 第三方插件没有并列区块的注册位。宿主的面板列表是一个 `nav`，它的下一个兄弟
 * 元素就是工作区所在的滚动区——在两者之间插一个容器即可得到想要的位置。宿主
 * 改版导致找不到锚点时，内容退回原处渲染，功能不受影响。
 *
 * @param {object} props - 组件属性
 * @param {object} props.children - 区块内容
 * @returns {object} React 元素
 */
function SidebarPlacement(props) {
  const anchorRef = useRef(null)
  const [container, setContainer] = useState(null)

  useEffect(() => {
    const anchor = anchorRef.current
    if (anchor === null) return undefined
    const root = findSidebarRoot(anchor)
    if (root === null) return undefined
    const nav = root.querySelector(':scope > nav')
    if (nav === null) return undefined
    const host = document.createElement('div')
    host.setAttribute('data-dsh-coordinator-projects', '')
    host.style.flex = 'none'
    nav.insertAdjacentElement('afterend', host)
    setContainer(host)
    return () => {
      host.remove()
      setContainer(null)
    }
  }, [])

  return createElement(
    'div',
    // 锚点自身不参与布局：内容移到宿主容器后，锚点只剩一个定位点；宿主结构变了
    // 导致没移成时，内容就落回这个锚点里，仍然可见。
    { ref: anchorRef, style: { display: 'contents' } },
    container === null ? props.children : createPortal(props.children, container),
  )
}
