# 看板入口按会话过滤，看板对项目 worker 开放

## 背景

用户报告：右栏「开始」页里，普通会话也能看见「看板」入口。这与「只有协调者与 worker 的会话才有看板」的预期不符。

两件事叠在一起：

1. **入口从来是全局的**。宿主右栏的 tab 类型与 guide 入口是静态注册，注册表没有按会话过滤的扩展点（`docs/capability-gaps.md` 第 15 条；上一版决策也记过这条限制）。`2026-10-29` 的 note 只收紧了自动弹出与面板内容，入口本身对所有会话可见。
2. **看板内容在 #19 被收紧到协调者**，worker 打开也是一句「看板只在项目协调者会话中打开」。用户对「项目会话有看板」的预期里包含 worker。

## 决策

### 入口由本插件接管渲染

`sidebar.right.tab.guide.entry` 是 keyed slot，键是 tab 类型的 `providerId`（本插件是 `dsh-coordinator`）。注册自己的渲染器后，guide 页里这一枚胶囊由本插件画：项目会话画，其余返回 `null`。

- 胶囊样式复刻宿主 `EntryBox`（`ui-sidebar-right` 的 `GuideBody.module.css`）：380px 宽、56px 最小高、14/20 内边距、14px 图标间距、`--dsw-radius-xl` 圆角、`--dsw-alias-*` 令牌。宿主改版式时本仓要跟——这是接管渲染的固定成本，与「图标从宿主 artwork 抄路径」同类，写进 capability-gaps 第 15 条。
- 点击走 `tab.actions.openTab(kind, { replaceTab: true })` 再 `close()`，与宿主 guide 的开门方式一致（指南页被替换，不叠第二个 tab）。
- 可见性判定跟面板读同一套纯函数：`boardViewState(project, sessionId, isWorker)`。协调者已失效时入口保留——点开是「去左栏换新协调者」的引导，藏起来等于把出口也藏掉。

### 看板对项目会话开放

`boardViewState` 增加 `worker` 出口：项目协调者与该项目派出的 worker 都可看板，同目录里的普通会话仍不可看（提示去协调者或 worker 会话）。

worker 判定走 `projects/sessionsByProject`：worker 是普通根会话，会话头没有身份标记，只有宿主侧的 worker 登记表知道谁是 worker。客户端一次问全量再按 `projectId` 查表，比按会话逐个问省往返。

**判不出来按普通会话处理**（`fetchProjectWorkers` 失败、`sessionQuery` 缺失、worker 表里没有该会话）：宁可把入口藏起来，也不给一个没权限的会话画入口。

### 复核节奏

面板的 30 秒项目复核顺带刷新 worker 判定（`load()` 里先解析项目，非协调者才多问一次 worker 表），卡片取数 effect 的依赖加上 `worker`。guide 入口在挂载、会话切换与窗口聚焦时各判一次——项目可能在另一个窗口里被建出来或换过协调者。

## 边界

- **guide 的 More 菜单仍会列出「看板」**：`sidebar.right.tab.guide.actions` 是 root scope，拿不到会话，入口名单无法按会话过滤。用户点 More 里的看板仍能打开面板（面板自己会给提示）。要彻底消除需要宿主给 guide 入口加条件注册。
- **隐藏时外层 cell 仍渲染**：`GuideBody` 用 `.entryCell`（380px 宽、flex 列里 14px gap）包住每个入口的渲染结果，插件只能返回 `null`，没法让 cell 一起消失。普通会话的指南页因此可能多出约 14px 的列内间距，视觉上是一次轻微居中偏移。
- **入口判定是异步的**：每次挂载要一次 `resolveProject`，非协调者再一次 `sessionsByProject`；判完之前不画（不闪一个会消失的入口）。
- 面板内容仍以项目为单位：worker 看到的是同一张项目看板，不是「自己那几张卡」。

## 取舍

- 接管渲染换来入口诚实，代价是胶囊样式与宿主耦合；不接管则普通会话永远有一枚点开即空的入口。
- 把 worker 放进可看范围，推翻 #19 的「只属于协调者」：项目看板对项目内的会话可见是更自然的语义，协调者仍持有调度权（工具面与派工权限不变）。

## 验证

- `tests/project-board-data.test.js`：`boardViewState` 的五种出口、`isBoardEntryVisible`、`fetchProjectWorkers` / `isProjectWorker`。双向验证：把 `isBoardEntryVisible` 改成恒 `true`，入口用例变红；还原后全绿。
- `npm run check`：452 项通过；`npm run build:client` 产物包含 `sidebar.right.tab.guide.entry` 与胶囊类名。
