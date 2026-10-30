# 被隐藏的会话不再点亮它所在的工作区

**日期**：2026-10-30
**状态**：accepted

## 问题

左栏的官方工作区树里，一个目录既可以是项目（项目区块），也可以是工作区。用户在项目目录里手动开一个会话（工作区分组点亮成蓝），再点项目行打开协调者，工作区的目录图标**仍然是蓝的**（激活态）。可那个分组里已经没有可见的会话行了——协调者会话在渲染层被排除。

根因是两套机制的边界没对齐：

- 官方按「当前会话属于哪个分组」点亮目录图标（`Rows.tsx` 的 `active = containsCurrentDescendant || (group.expanded && group.containsCurrent)`，颜色是 `.folderActive` 的 `--dsw-alias-state-business-primary`）；
- 本仓把项目的协调者与 worker 会话从官方树里隐藏（`workspace-exclusion.js`），但点亮判定仍按数据层算。

两边都对，合起来就是「开着的分组里空无一人」。

## 做法

在渲染层把点亮压掉：当前会话（`sessions.list` 快照里 `retainedBy.mainView > 0` 的那条，与宿主 `WorkspaceBrowser` 的 `current` 同判据）落在排除集里时，从 `workspaces.list` 快照的 `items` 反查它所属的工作区，给那一行加 `dsh-coordinator-quiet-workspace`，CSS 把行首图标槽的颜色压回 `--dsw-alias-label-tertiary`（未激活时官方也是这个三级标签色，见 `Rows.module.css` 的 `.slot`）。

判定抽成两个纯函数（`project-panel-logic.js` 的 `currentSessionIdOf` / `quietWorkspaceOf`）：面板只负责订阅两个快照并把结果喂给排除器（`update(sessionIds, quietWorkspaceIds)`）。

## 边界

- **只在分组视图下压当前会话所属的那一组**。树模式（`groupBy: 'workspace-tree'`）下宿主会让**祖先分组**也点亮（`containsCurrentDescendant`），祖先行不会被压——浏览器侧拿不到分组层级与「当前会话的祖先链」的对应关系，扩展它要复制宿主的 `nestWorkspaces` 逻辑，收益不及成本。
- **不改宿主数据层**。点亮是宿主内部状态，没有「别点亮」的接口；`groupExpansion` 这类视图状态是宿主插件内部的 store（持久化在 `dsh.workspace.view.v5`），第三方写它等于耦合宿主内部实现。
- **面板卸载即恢复原样**。排除器随项目面板挂载/卸载，侧栏收起时面板卸载，隐藏与会话排除一起失效——与既有排除机制同一生命周期，不是新引入的缺口。
- **判定随当前会话变化**。用户在官方树里点回一个正常会话，压灰立即撤销（同一个 `sync` 触发重算）。

## 验证

真机（隔离实例 `DSH_HOME=/tmp/dsh-verify-home`，宿主 `dsh 0.2.1-rc.2`，无头 Chrome 走 CDP 探针，`window-size=1440,900`）：

| 步骤 | 修复前 | 修复后 |
|---|---|---|
| 展开 `dsh-coordinator` 工作区并打开组内普通会话 | `folderActive`，`rgb(65, 118, 230)` | 同左（基线一致） |
| 点项目行打开协调者 | `folderActive`，`rgb(65, 118, 230)`（仍蓝） | `folderActive` + `quiet` 类，`rgb(129, 133, 140)` |

撤销方式是把 `markWorkspaceRow` 里 `quieted.has(id)` 换成 `false` 重建产物，读数回到 `rgb(65, 118, 230)`；还原后重新变灰——双向成立。

单测：`tests/workspace-exclusion.test.js` 新增 4 条（标记、非命中、变化后恢复、两类行各认各的前缀），`tests/project-panel.test.js` 新增 3 条（当前会话取 `mainView` 那条、被排除时压灰、没被排除/不在工作区视图里时不压）。`npm run check` 468 全绿（含新增 7 条）。

未 GUI 实测的部分：树模式下的祖先分组点亮（见边界第一条）。
