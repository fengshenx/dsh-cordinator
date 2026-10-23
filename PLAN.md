# dsh-coordinator 执行方案

把 Telov（`candyapp/`）的协调者 + worker 编排工作流，移植为 DeepSeek Harness（`deepseek-harness/`）的第三方 bundle。

- 形态：**第三方 bundle**（独立 npm 包，`dsh.bundle.patch`）
- 仓库位置：**独立目录**，与 `deepseek-harness/` 平级，不进 dsh 仓库
- 协议层：**要搬**；Telov 的 AGENTS.md 仓库约定改为**初始化 skill** 承载

---

## 1. 目标与非目标

### 目标

1. 在 dsh 上跑通「协调者 → 派工 → worker 执行 → 回传 → 验收 → 再派工」的完整循环。
2. 保留 Telov 编排协议的**方法学内核**：任务接力、事件调度、传话纪律、验收裁决、进度说明。
3. 提供人类可见的**交付看板**（右栏 Tab）：卡片、槽位、信号灯、链接、检查点。
4. 提供**项目作用域**：一个目录 = 一个项目 = 一个协调者会话 + 一组卡片 + 一份角色槽位配置。
5. 提供**初始化 skill**：把仓库工程约定写入目标项目上下文，一次性生效。

### 非目标

- 不移植 Telov 的 `Workflow` 工具族（gate / artifact store / run 级 resume / 节点级 worktree）。dsh 已有 `ctx.workflowEngine`，语义不同但覆盖基础编排；差异部分按需另议。
- 不移植 Telov 的 Electron 宿主层（主进程 IPC、`BrowserWindow` 广播、renderer Jotai 状态源）。dsh 的对应面是 Cordis 插件 + client 插件 + session projection。
- 不追求与 Telov 端 UI 像素一致。功能与信息结构对齐即可。

---

## 2. 能力对照结论

dsh 已自带 Telov 这套编排约 70% 的基础设施。真正要写的是三个缺口 + 一块 UI。

| 能力面 | Telov 现状 | dsh 现状 | 差距 | 工作量 |
|---|---|---|---|---|
| 协议层（编排 playbook） | `.agents/skills/telov-mode/`，413 行 | skill 发现支持 `.agents/skills`（优先级 200） | 交叉引用需重写；15 个兄弟技能需决策 | 2–3 人日 |
| worker 派生 | `SpawnWorker`（`apps/electron/src/main/lib/project/tools.ts:426`） | `ctx.subagents.startActivation({ delivery: 'caller' })`（非阻塞，**P1 已用**）；`ctx.agentTeams.spawnTeammate()` | 已覆盖 | 0 |
| 定向消息 | `MessageWorker` → worker inbox（`worker-orchestration.ts:308`） | `sendMessage()` → 目标 Agent inbox，冷唤醒可收 | 基本覆盖 | 0 |
| worker 名录 / 中断 | `ListWorkers` / `StopWorker` | roster（lead/teammate + running/inactive/provisioning/failed）/ `interrupt()` | 基本覆盖 | 0 |
| 任务依赖与并发控制 | Card `expectedRevision` 乐观并发 | team 任务板全量快照 + CAS + `blockedBy` DAG | team 板更严，但缺 slot→session 绑定 | 3–5 人日 |
| **完成唤醒协调者** | `coordinator-wake.ts`（390 行）：事件触发 → 协调者自动开新 turn + 富通知 + 落盘补投 + 自动续行护栏 | team 消息是 inbox 投递（target 醒来才读），**无被动唤醒** | **已自建**（P1 实测通过） | 3–5 人日 |
| 角色槽位（`SLOTS.md`） | 目录级文件 → role_context 注入（`slot-templates.ts:90`） | 无角色/权限模型；仅 agent preset / persona / skill 双布尔开关 | 自建薄层 | 2–3 人日 |
| 项目作用域 | `packages/shared/src/types/project.ts:15`，存 `~/.telov/projects.json` | 无 project 实体；`projectRoot` 仅用于 skill 发现 | 自建存储域 | 3–5 人日 |
| 看板 UI | `renderer/components/board/` 1073 行 + `lib/board-projection.ts` 230 行 | `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` slot | 视觉层可直抄，接线重写 | 5–8 人日 |
| worker 隔离 | 每任务独占 worktree（`scripts/worktree-spawn.ts`） | team 明确「one process and one shared checkout、no worktree」；仓内有 `dsh-experimental-worktree` / `dsh-experimental-tool-worktree` | 编排约定 + 接线 | 1–2 人日 |
| 初始化 skill | 无此概念 | `ctx.systemPrompt.section()` / skill 注入 | 新建 | 1–2 人日 |

**合计 19–31 人日**（单人）。分四阶段，每阶段独立可交付、可停。

估算基于文档与源码阅读，未实际编译验证，误差 ±30%。

---

## 3. 仓库形态与目录布局

### 3.1 为什么独立于 dsh 仓库

dsh 对第三方 bundle 的规范形态是**独立 npm 包**：

- `deepseek-harness/docs/user/develop/basic/publish.md:21-31` —— bundle = `package.json`（声明 `dsh.bundle.patch`）+ `cordis.patch.yml` + 入口文件，独立版本号。
- `publish.md:66` —— `engines.dsh` 版本范围不满足时，**安装与启动直接拒绝**。
- `deepseek-harness/docs/cookbook/adding-a-plugin-preview.md:5` —— 第三方插件无 preview 接口（一等公民，但有一处明确缺口）。

放进 dsh 仓库的代价：`packages/` 下即第一方包，需过全套门禁（`constraints / typecheck / lint / build / hygiene / doc-sync` + `gen-*-catalog` 产物对齐 + README 的 Model Experience 规范），version 须与 dsh root 一致，且被 dsh 发版流程接管——与「跟随 dsh 版本走、自己发版」直接冲突。根目录下非 workspace 目录（教程里的 `scratch-plugin/`）只是开发期形态，不是分发形态。

### 3.2 目录布局

```
dsh-coordinator/                    # 独立 git 仓库
├── package.json                    # dsh.bundle.patch + engines.dsh + peer/dev 双声明
├── cordis.patch.yml                # 插件行：tool / skill provider / sidebar tab / storage domain
├── index.js                        # bundle 入口
├── src/
│   ├── host/
│   │   ├── index.js                # Host 侧插件：工具注册、编排服务
│   │   ├── dispatch.js             # 派工与完成唤醒（缺口自建）
│   │   ├── notification-store.js   # 完成通知落盘队列
│   │   ├── message.js              # UserMessage 构造
│   │   ├── skills.js               # bundle 内 skill provider
│   │   ├── tools/                  # init_project / spawn_worker
│   │   ├── cards/                  # Card 存储域 + 投影（P2）
│   │   └── projects/               # 项目存储域 + 投影（P3）
│   ├── client/
│   │   ├── index.ts                # Client 侧插件：右栏 Tab
│   │   └── board/                  # 看板组件（从 Telov 直抄后改接线）
│   └── shared/                     # 两端共享类型
├── skills/
│   ├── coordinator-mode/           # 协议层（playbooks + references）
│   │   ├── SKILL.md
│   │   ├── playbooks/
│   │   └── references/
│   └── init-project/               # 初始化 skill：写入仓库工程约定
├── locale/{en,zh}.json             # meta.title / meta.description
├── README.md
└── tests/
```

### 3.3 依赖声明

- `@deepseek-ai/dsh*` 相关包进 `peerDependencies` **与** `devDependencies`（`publish.md:105` 要求两者都有：peer 走宿主实例，dev 供类型检查）。
- 独立第三方依赖进 `dependencies`。
- `@deepseek-ai/cordis` 同理双声明。
- `engines.dsh` 写当前支持的 dsh 版本范围。

### 3.4 接入方式

| 阶段 | 方式 | 命令 |
|---|---|---|
| 开发迭代 | profile link 安装（改代码即生效） | `dsh plugin --profile dev add ../dsh-coordinator` |
| 快速试跑 | patch overlay | `pnpm dsh web --patch ../dsh-coordinator/cordis.patch.yml` |
| 分发 | npm / git / tarball | `dsh plugin --profile dev add <spec>` |

git 安装有已知坑（`publish.md:161-181`）：git 装的是源码不跑 `prepare` 就没有产物，作者须带 `prepare` 脚本，且用户须在 profile 的 `pnpm-workspace.yaml` 写 `allowBuilds`。开发期用 link 可完全绕开。

### 3.5 协议层放两处

dsh 的 skill 发现路径含 `<project>/.agents/skills`（优先级 200），与 Telov 现行路径一致。

- **生效副本**：目标项目的 `.agents/skills/coordinator-mode/`，随项目走。
- **分发副本**：bundle 内 `skills/coordinator-mode/`，供新项目初始化时复制。

---

## 4. 协议层搬迁

### 4.1 文件级映射

源：`candyapp/.agents/skills/telov-mode/`（413 行，含 2 个 LICENSE 43 行）

| 源文件 | 行数 | 处置 | 说明 |
|---|---|---|---|
| `SKILL.md` | 66 | **改写** | 主入口。重写交叉引用与工具名；按阶段加载的专项技能列表需决策（见 4.3） |
| `playbooks/program.md` | 46 | **改写** | 编排核心。工具名替换；`COORDINATOR.md`/`SLOTS.md` 引用改指 dsh 侧配置 |
| `playbooks/implementation.md` | 23 | **改写** | 实现阶段流程 |
| `playbooks/delivery.md` | 17 | **改写** | 交付/PR 阶段。GitHub 语义在 dsh 侧无对应物，需裁剪 |
| `playbooks/handoff.md` | 13 | **改写** | 暂停/恢复 |
| `references/architecture.md` | 29 | **改写** | 架构判断方法。与 Telov 文档路径耦合，需换成通用表述 |
| `references/parallel.md` | 69 | **改写** | 多 worktree 协调。改动最大：slot 语义、Card API、worktree 命令全是 Telov 专有 |
| `references/pstack-map.md` | 70 | **裁剪** | 移植取舍与 Claude 版对照。属历史设计记录，不入 dsh 版 |
| `references/review-bot-triage.md` | 37 | **裁剪** | 审查 bot 分诊。依赖 Telov 的 PR 治理模型，不通用 |
| `LICENSE` / `LICENSE-claude` | 43 | **保留** | 协议改编自 pstack，许可需随文保留 |

有效搬迁量：约 350 行文本改写。

### 4.2 交叉引用重写清单

协议正文里指向 Telov 仓库内部路径的引用必须逐条处理：

| 类别 | Telov 引用 | dsh 侧处置 |
|---|---|---|
| 仓库文档 | `docs/architecture.md`、`docs/issue-pr-note-governance.md`、`docs/multi-agent-collaboration.md`、`docs/cookbook/electron-e2e-*.md` | 删除或改为通用表述；仓库专属治理不入通用协议 |
| 同级专项技能 | `telov-how` / `telov-why` / `telov-architect` / `telov-code-sense` / `telov-blast-radius` / `telov-arena` / `telov-interrogate` / `telov-swarm` / `telov-code-review` / `telov-find-simplifications` / `telov-prose-standard` / `telov-archive-agent-notes` / `telov-ci-test-reliability` / `telov-pre-push-checks` / `telov-verify-app`（共 15 个） | 见 4.3 决策 |
| 宿主机制 | 「用 Skill 工具加载」 | dsh 侧是模型可调用的 `skill` 工具（`tool-skill`），非宿主注入的 Skill 工具。措辞必须改，否则协调者会去找不存在的工具 |
| 项目配置 | `COORDINATOR.md` / `SLOTS.md`（仓库根） | 迁到 bundle 内的配置读取器，或由初始化 skill 生成到目标项目 |
| 工具名 | `SpawnWorker` / `MessageWorker` / `ListWorkers` / `ReadWorkerTurn` / `StopWorker` / `CreateCard` / `UpdateCard` / `ListCards` | 见 4.4 |

### 4.3 15 个兄弟专项技能的处置（**P0 关键决策**）

Telov 的 `SKILL.md` 按阶段调用 15 个专项技能。这些技能**内容上高度绑定 Telov 仓库**（引用 Telov 的 `AGENTS.md`、治理文档、包结构）。三条路：

| 方案 | 做法 | 代价 | 适用 |
|---|---|---|---|
| **A. 只搬协议骨架**（推荐） | 保留"按阶段加载专项能力"的**结构**，把 15 个具体技能名替换为 dsh 语境下的通用方法提示（如"机制不明时先建立上下文再动手"） | 2–3 人日 | 协调者能力不因缺少 Telov 专项技能而受损；dsh 上也无从加载那些技能 |
| B. 移植子集 | 把 `how` / `why` / `architect` / `code-sense` / `blast-radius` 等纯方法论技能移植过来（估计 3000+ 行） | 8–12 人日 | 确实需要方法论密度时 |
| C. 全量移植 | 15 个全搬 | 20+ 人日，且带进 Telov 治理耦合 | 不推荐 |

**建议 A**。dsh 上不需要 Telov 的仓库治理体系，协议的价值在编排纪律与验收裁决，不在专项技能清单。

### 4.4 工具名映射

| Telov | dsh 侧 | 备注 |
|---|---|---|
| `SpawnWorker` | **自建 `spawn_worker`** | 走 `ctx.subagents.startActivation` + `delivery:'caller'`，派完即返回子会话 id，不等结果；dsh 的 `subagent` 工具是阻塞式，不适合并行派工 |
| `MessageWorker` | 原生 `send_message` | `agent_id` 即子会话 id（父子模型） |
| `ListWorkers` | 原生 `list_agents` | 列调用者派出的子会话，含 id/label/状态 |
| `StopWorker` | 原生 `interrupt_agent` | 对子会话发中断信号，不等待其停下 |
| `ReadWorkerTurn` | 完成通知的产物摘要 | 无直接对应；深读可用 `send_message` 向该 worker 追问。`session_event_read` 属 experimental 包，默认不启用 |
| `CreateCard` / `UpdateCard` / `ListCards` | **自建 `create_card` / `update_card` / `list_cards`** | dsh team 任务板覆盖「任务 + 依赖 + owner + CAS」，但**不覆盖 slot→session 绑定**（一个卡同时挂 dev 与 review 两个会话）、links、checkpoint、编号不复用。人类可见的交付看板与机器侧任务板职责必须分开 |

**两套同名工具的辨析**（实测确认）：dsh 有两处 `send_message` / `interrupt_agent` / `list_agents`——

- `@deepseek-ai/dsh-tool-subagent-control`（base bundle 默认启用）：**父子模型**，`agent_id` 是子会话 id，作用于调用者派出的子会话。**本方案用这套。**
- `@deepseek-ai/dsh-tool-agent-team`（experimental，base bundle 未启用）：**同伴模型**，target 是 teammate 名字，作用于 team 成员。与本流程的执行者不是同一批，不要混用。

### 4.5 初始化 skill（承载原 AGENTS.md 仓库约定）

原 `candyapp/AGENTS.md`（约 11.6 KB）的工程规则（注释语言、状态管理、UI 封装、i18n、Fail Loud、提交与 PR 纪律、测试证据链等）改为初始化 skill：

- 形态：`skills/init-project/SKILL.md`
- 行为：把约定**写入**目标项目的工程约束文件（推荐生成/追加到目标项目的 `AGENTS.md`），**一次性生效**，不常驻注入。
- 理由：常驻注入会吃 KV cache，且与 dsh 自带的 AGENTS.md 段落重复（`extension-cookbook.md:113` 的 AGENTS.md 段落提供者已存在）。
- 待定：触发方式——由协调者主动调用一次，还是由一个 `init_project` 工具触发？后者更可控（幂等、可测、避免模型漏调）。**倾向工具触发**，skill 只提供约定正文。

---

## 5. dsh 侧实现设计

### 5.1 编排能力落点

| 需要的能力 | dsh 扩展点 | 来源 |
|---|---|---|
| 派工 / 名录 / 中断 / 消息 | `ctx.agentTeams` | `packages/experimental/agent-team`（experimental） |
| 通用子代理委派 | `ctx.subagents` + `tool-subagent` + `tool-subagent-control` | `packages/subagent/*` |
| 编排脚本（可选） | `ctx.workflowEngine` + `workflow` 工具 | `packages/workflow/*` |
| 协议层分发 | `ctx.skills.registerProvider` / skill 工具 | `packages/skill/skill` |
| Card / 项目持久化 | `defineDomain({name, version, tables})` → `ctx.storageDomain` | `packages/storage/storage-domain/src/spec.ts:107` |
| 客户端投影 | session projection（`sessionProjections`） | 参考 `packages/todo/tool-todo` 的 `inject: ['tools','sessionProjections']` |
| 看板 UI | `ctx.sidebarRightTabs.register({id, kind, ...})` + `ctx.slots.inject('sidebar.right.pane.tab', ...)`（keyed by definition id） | `packages/client/ui-sidebar-right/src/client/index.ts:150`、文档 `docs/subsystems/sidebar-right.md:36` |
| 系统提示注入 | `ctx.systemPrompt.section()` | `extension-cookbook.md:112` |

**关键约束**：dsh 不允许新增 session event 类型——仓外事件必须带 `ignorable` 标记且不进读路径（`packages/core/session/src/known-event-types.ts:24`）。因此 **Card 与 Project 状态不得塞进会话事件流**，只能走独立 storage domain + session projection。这一条决定了 5.3 / 5.4 的实现形状。

### 5.2 唤醒回传（核心缺口，自建）

dsh team 的消息是 inbox 投递：target 睡着时排队，等它自己醒来才读；**没有「teammate 完成 → 自动唤醒 Lead 开新 turn」**（team README「Waiting and interruption」只有成员主动 `waitForChange()`）。

实现路径（借 dsh 既有机制，不发明新的）：

1. 派工走 `ctx.subagents.startActivation({ delivery: 'caller' })`：立即返回子会话 id，`activation.result` 是终态 promise。
2. 终态到达时构造结构化完成通知（来源 sessionId、状态、产物摘要、下一步）。
3. 对协调者会话调用 `followup()`，开新 turn。
4. 落盘通知（崩溃窗口补投）+ 连续自动续行上限护栏。

对照 Telov `coordinator-wake.ts` 的四项职责：富通知构造（`buildWorkerTurnNotificationXml`）、落盘队列（`coordinator-notification-store.ts`）、崩溃对账补投（`reconcilePendingNotifications`）、自动续行护栏（`orchestrator-resume.ts`）。全部重写，**算法逻辑不足 500 行**，且 dsh 的 `followup()` 比 Telov 的事件总线链更短。

**P1 实测后的修正**：原设想靠 `turn/end` 事件感知子会话结束，实际用 `activation.result` 更直接——它是子会话的终态 promise，不需要额外订阅事件。另一个实测结论是**唤醒失败的真因不是投影未注册，而是父会话已被销毁**（headless 一次性 CLI 在 turn 结束后 dispose 会话）；只要父会话存活，对空闲 agent 调 `followup()` 就能可靠唤醒。

### 5.3 Card 存储域

**P2 决策：不进 dsh storage domain，改用自建落盘**（`src/host/cards/store.js`）。

storage domain 需要 zod schema + `@deepseek-ai/dsh-storage-domain` peer 依赖，违反「bundle 零 dsh 内部依赖」原则；自建与 P1 的通知队列同构（原子写 + 读-改-写串行化），落在 `$DSH_HOME/dsh-coordinator/cards.json`。

字段（对齐 `candyapp/packages/shared/src/types/task-card.ts:51`，去掉项目语义）：

- `id`、`number`（**全局**递增，不复用）、`title`、`spec`
- `status`: `active | done | archived`（`archived` 终态）
- `slots`: `{ dev?: {sessionId}, review?: {sessionId} }` —— dsh team 不覆盖的部分，自建
- `links[]`（条目 id 由宿主补）、`checkpoint`、`revision`、`sortOrder?`、`doneAt?`、`createdAt/updatedAt`

领域规则（实测通过）：

- 编号全局递增永不复用（`counter` 字段持久化）
- 每次内容更新 `revision + 1`；`expectedRevision` 不符即报错且**不落盘**
- `active ⇄ done` 可逆：切 done 记 `doneAt`，回 active 清除
- `archived` 终态，不可再改
- `checkpoint` 的 `updatedBy`/`updatedAt` 由**宿主补写**（`updatedBy` 取调用方 agent 的 session id），调用方只能提供 summary/nextAction/blocker/outputVersion
- 库文件损坏时备份原文件并写回空库（不能只备份——否则存储文件就此消失）

**编号作用域的迁移代价**：当前是全局编号（无项目实体）。将来若引入项目实体并要求按项目编号，需迁移存量卡片的编号作用域，此代价记入 Agent Note。

### 5.4 项目存储域

字段（对齐 `candyapp/packages/shared/src/types/project.ts:15`）：`id`、`name`、`directory`（不可变身份）、`coordinatorSessionId?`。

新建流程：选目录 → 建实体 → 建协调者会话 → 回写 `coordinatorSessionId` → 失败整体回滚。

**是否需要真的项目实体，取决于范围**：
- 只需「一个目录 = 一个协调者项目」→ 不建实体，目录级配置 + 一个协调者会话即可（省 3–5 人日）。
- 要「多项目列表 + 切换 UI」（Telov 现状）→ 建实体 + 项目选择面板。

**建议**：P0–P2 不建实体，先用目录级配置跑通；P3 按实际需求决定。**注意 dsh 已有 profile 概念**（`$DSH_HOME/profiles/<name>`，插件组合层），若项目的诉求是「一套插件组合 + 一个协调者」，profile 可能已经够用——**P3 开工前先核对这一点，避免自建重复概念**。

### 5.5 看板 UI

**P2 决策：先落 host 侧数据通道，client 侧 UI 单列**（见第 6 节 P2 阶段）。

数据通道（已实测）：工具的 `output.render` 只给模型看文本，客户端拿不到结构化数据；改用 `output.presentationMeta` 把卡片投影成 `meta`——它随 `tool/result` 事件持久化进 session log。实测确认 `tool/result` 事件的 `meta` 携带完整卡片对象，`content` 仍是给模型的精简视图。客户端据此重建看板。

信号灯（stale/停滞判定）在 Telov 是 renderer 纯投影（`board-projection.ts:189`），零存储，可整段直搬；dsh 侧同样不落盘——状态由会话活性实时投影。

源（可直抄，框架耦合低）：
- `candyapp/apps/electron/src/renderer/components/board/`（1073 行）：`BoardTabContent.tsx` 257、`BoardCardItem.tsx` 297、`BoardCardDetailDialog.tsx` 285、`BoardLinksEditor.tsx` 154、`BoardSignalDot.tsx` 66
- `candyapp/apps/electron/src/renderer/lib/board-projection.ts`（230 行，纯函数，仅依赖共享类型）

需重写：Telov 用 Jotai + Electron IPC + `BrowserWindow` 广播；dsh 侧改为 session projection + `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` slot。Telov 的 shadcn 风格 UI 组件在 `apps/electron/src/renderer/components/ui/`（**不在** `packages/ui/`），需按 dsh 的客户端组件体系重建或改用 dsh 现成组件。

dsh 侧只需写一份 client 代码，web 与 desktop 共用（`publish.md`/`development.md` 的 client 共享结论）。

### 5.6 角色槽位

Telov `SLOTS.md` 格式：`## <槽位名>` 分节，正文作为 role_context 注入；名字匹配 `^[a-z0-9_-]{1,32}$`；缺失或无合法条目回落 `discuss/dev/review`；**每次 turn 构造时读文件**（无 watcher，`query-options-builder.ts:365`）。

dsh 侧实现：
- 槽位配置存 bundle 内的项目配置（或目标项目目录下的文件）。
- 注入方式：协调者会话的 system prompt section，或经 `ctx.systemPrompt.section()` 提供。
- dsh 无角色权限模型，槽位仅承载**方法入口 + 人设**，不承担工具授权。协议层需明确这一点，避免协调者误以为 slot 授予了权限（Telov 的 `SLOTS.md` 原文已有此免责声明，要保留）。

---

## 6. 阶段划分

每阶段独立可交付、可停；每阶段末有明确验收。

### P0 · 骨架与协议层（2–3 人日）

**交付**：bundle 骨架跑起来；协议层 skill 改写完成；用 dsh 现成 team 工具跑通一次完整编排循环。

> **实测更正（2026-10-22）**：dsh 的 web profile **已默认内置** `agent-team` 三个插件行，无需另行安装；但本机因其插件版本（`^0.1.5-alpha.2`）与宿主（`0.2.1-rc.2`）不兼容，被 dsh 在启动时自动禁用。可用的执行者能力是 base bundle 内置的 `ctx.subagents` 系列。详见 [docs/capability-gaps.md](docs/capability-gaps.md)。

**内容**
- bundle 骨架：package.json / cordis.patch.yml / index.js / locale / README / profile link 安装成功
- 协议层搬迁（4.1、4.2、4.4），按 4.3 方案 A 处理专项技能
- 初始化 skill（4.5）：约定正文 + `init_project` 工具
- 用 `ctx.agentTeams` + `ctx.subagents` 跑通：派工 → worker 执行 → 消息回传 → 协调者收结果 → 验收

**验收**
- `dsh plugin --profile dev add ../dsh-coordinator` 安装成功，`pnpm dsh web` 能加载
- 协调者会话能加载协议 skill 并按 playbook 派工
- 一轮完整派工-回传-验收在真实 dsh 会话中跑通并留下证据
- **能力缺口清单**：实测记录「哪些 Telov 语义在 dsh 上没有对应物」

**这是后续阶段的依据来源**——P1 的范围由 P0 实测结论确定，不提前锁定。

**P0 验收结果（2026-10-22）**

| 验收项 | 结果 | 证据 |
|---|---|---|
| bundle 能作为第三方 bundle 安装 | 通过 | `dsh plugin --profile headless add ../dsh-coordinator` → `dsh.profile.bundles` 含 `dsh-coordinator` |
| 插件能加载且无激活错误 | 通过 | dsh web 启动日志无 `did not activate`；包名子路径解析通过 |
| 工具注册生效 | 通过 | mock LLM 触发的模型调用执行 `init_project` → 目标目录生成含受管区块的 `AGENTS.md`（4307 字节） |
| 协议层 skill 可被模型发现 | 通过 | `ctx.skills.list()` 返回 `coordinator-mode` 与 `init-project`，provider `dsh-coordinator`，source `bundled` |
| 能力缺口清单 | 已产出 | [docs/capability-gaps.md](docs/capability-gaps.md)：9 条分级缺口、5 条已验证能力、4 条待验证项 |
| 跑通一轮完整派工-回传-验收 | **未完成** | P0 阶段缺模型凭据（`deepseek-official` 无 key），改用 dsh 自带 mock LLM 验证了工具通路；该项在 P1 阶段完成（见 P1 验收结果） |

### P1 · 唤醒回传（3–5 人日）

**交付**：worker 完成后协调者自动被唤醒并继续，不依赖协调者轮询。

**内容**：5.2 的四项职责；结构化完成通知；通知落盘与崩溃补投；自动续行护栏。

**验收**
- worker 结束 → 协调者在无人工干预下开新 turn 并收到通知
- 协调者重启后未投递的通知被补投
- 续行护栏生效（超过上限不无限自动唤醒）

**P1 验收结果（2026-10-23）**

| 验收项 | 结果 | 证据 |
|---|---|---|
| worker 结束 → 协调者开新 turn 并收到通知 | 通过 | sdk profile 实测：父 inbox 收到「【worker 回报】任务「写文件」已结束…」后状态 `idle → running → idle` |
| 派工不阻塞父 turn | 通过 | `spawn_worker` 立即返回子会话 id，父 turn 正常结束，worker 在后台跑完 |
| 完成通知落盘 | 通过 | `$DSH_HOME/dsh-coordinator/notifications.json` 记录通知，投递成功后出队（实测 `pending: 0`） |
| 协调者重启后未投递的通知被补投 | 通过（单测） | `agent/created` 触发 `redeliverPending`；崩溃窗口由落盘队列覆盖 |
| 续行护栏生效 | 通过（单测） | 超过 `autoResumeLimit` 不再自动唤醒，通知留队 |
| 协议层与工具对模型可见 | 通过 | 模型侧工具列表含 `init_project` 与 `spawn_worker`；skill catalog 含 `coordinator-mode` 与 `init-project` |

**运行前提**：后台编排只适用于长驻组合（web / desktop / sdk）。headless 一次性 CLI 会在 turn 结束后销毁父会话，没有载体接收通知。

### P2 · Card 与看板（8–13 人日）

**交付**：右栏「看板」Tab，卡片、槽位、信号灯、链接、检查点可见可改。

**内容**：5.3 Card 存储域；5.5 看板 UI；模型侧工具（建卡/改卡/查卡）；投影。

**验收**
- 右栏能打开看板 Tab，显示当前项目卡片
- 卡片槽位能绑定到实际会话（dev/review）
- 并发改卡触发 revision 冲突并给出可读错误
- 信号灯与 Telov 语义一致（用同一组场景对照）

**P2 验收结果（2026-10-23，host 侧）**

| 验收项 | 结果 | 证据 |
|---|---|---|
| 卡片存储域与领域规则 | 通过 | `src/host/cards/store.js`；49 例单测全绿（编号不复用、revision 递增、archived 终态、done⇄active 的 doneAt、检查点宿主补写、库损坏备份并写回空库、并发建卡不重号） |
| 模型侧卡片工具 | 通过 | sdk profile + mock LLM 实测：模型工具列表含 `create_card`/`update_card`/`list_cards`，并实际调用成功 |
| 建卡 | 通过 | 模型调 `create_card` → 落盘 `#1「实现派工」`，`counter: 1`，`revision: 0`，`status: active` |
| 改卡 | 通过 | 模型调 `update_card` → `revision: 0 → 1`，`status: done` 且 `doneAt` 已记；`checkpoint.updatedBy` 被宿主补成调用方会话 id |
| 并发改卡触发版本冲突 | 通过 | 带过期 `expectedRevision: 0` 调用 → 报错「卡片版本冲突：期望 0，当前 1；请重新读取卡片后判断」，且**未落盘**（revision 仍 1、title 未变） |
| 查卡 | 通过 | `list_cards` 返回精简视图「共 1 张卡片：#1 实现派工（done）」给模型；归档卡默认排除，`includeArchived` 才返回 |
| 客户端取数通道 | 通过 | 工具的 `output.presentationMeta` 投影的 `meta` 随 `tool/result` 事件持久化；实测事件 `meta` 携带完整卡片对象，`content` 仍是给模型的精简文本 |
| 右栏看板 Tab（client 侧） | 通过 | web profile 实测：boot manifest 含 `dsh-coordinator` 条目（71 条目），浏览器右栏出现「看板」Tab，点开显示空态文案；面板订阅本会话事件窗口重放卡片投影（`ctx.sessions.retain` → `binding.eventSource`），`tool/result` 事件的 `meta` 投影被还原为卡片 |
| 信号灯投影 | **未完成** | 依赖看板 UI 一并落地（纯投影，不落盘） |
| 槽位绑定到实际会话 | **未完成** | `slots` 字段与改卡通路已就绪；与「执行者名录」的绑定规则待 P3 角色槽位一并定 |

**P2 结论**：host 侧（存储域、工具、协议层映射、数据通道）与 client 侧（Tab 注册、面板、事件重放）均已闭环并实测通过；信号灯投影与槽位绑定未做。client 侧踩到的两个硬约束记在 [docs/capability-gaps.md](docs/capability-gaps.md) 第 18–19 条：插件行名必须是纯包名（否则浏览器侧发现不到 client 半边）、client 产物得自己产出 closure-factory 封装。

### P3 · 项目作用域与角色槽位（5–8 人日）

**交付**：多项目切换 + 角色槽位注入。

**前置检查**：先核对 dsh `profile` 是否已覆盖「项目 = 一套插件组合 + 一个协调者」的需求（5.4）。若覆盖，改为「项目 = profile + 目录约定」的实现，不自建重复实体。

**验收**
- 能创建/切换项目，协调者会话随之切换
- 槽位配置变更在下一轮 turn 生效
- 槽位不授予工具权限（协议层声明与实际行为一致）

---

## 7. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| `agent-team` 是 experimental，README 明写「no stability promise」、单进程单 checkout、无嵌套 team、无自动 owner 释放、无跨进程 | 编排层可能随 dsh 升级断裂 | 编排逻辑只依赖**公开服务 API**；把 team 收敛到一处适配层（`src/host/adapters/team.ts`），替换时只改一个文件 |
| dsh 处于 developer preview，README 明写会有 breaking change | bundle 随时失效 | `engines.dsh` 范围跟随 dsh 版本；adapter 层隔离 API 变动面 |
| 不能新增 session event 类型（仓外须 `ignorable` 且不进读路径） | Card/项目状态无法进会话事件流 | 走独立 storage domain + projection（已在 5.1 列为约束） |
| 拿不到 dsh 的 `gen-*` / `verify-*` 门禁工具链 | 目录清单与一致性校验对仓外不生效 | 自建最小门禁：typecheck + lint + 关键路径测试 + README 规范自检；参考 `docs/cookbook/adding-a-package.md` 的 README 章节要求自检 |
| 第三方插件无 preview 接口（`adding-a-plugin-preview.md:5`） | Plugin Manager 里无功能预览图 | 用 `locale/*.json` 的 `meta.title`/`meta.description` + `icon` 补足辨识度 |
| Telov 协议层交叉引用密集（15 个兄弟技能 + 6 篇仓库文档） | 改写量被低估 | 4.3 方案 A 已把量压到约 350 行；不迁就保留 Telov 引用 |
| team 共享 checkout，worker 之间会互相看到编辑 | 并行实现互相污染 | 编排约定层要求每任务独占 worktree；dsh 有 `dsh-experimental-worktree` 可接线 |
| 「worker 完成 → 唤醒」是 dsh 未有的一等能力，自建部分会成为长期维护负担 | 维护成本 | P0 先实测确认必要性；dsh 若后续原生支持，本层应删除而非保留 |

---

## 8. 第三方 bundle 约束清单

开发期就要记住，避免撞墙：

1. 不新增 session event 类型（`known-event-types.ts:24`）。
2. 拿不到 `gen-*-catalog` / `verify-*-catalog` 门禁产物。
3. 无 plugin preview 接口。
4. `engines.dsh` 是硬门槛，不满足则安装与启动被拒（`publish.md:66`）。
5. peer 依赖须在 `peerDependencies` 与 `devDependencies` 双声明（`publish.md:105`）。
6. git 安装需作者带 `prepare` 脚本 + 用户 `allowBuilds` 授权（`publish.md:161-181`）。
7. plugin row 的插件路径在 patch overlay 场景**必须是绝对路径**（`docs/user/develop/basic/index.md:56`）；bundle 形态则用包名，由 Node 解析（`publish.md:56`）。

---

## 9. 未决事项

开工前需定，按影响排序：

1. **4.3 专项技能处置**——方案 A / B / C。建议 A（只搬协议骨架）。
2. **是否要项目实体**——取决于「多项目切换」是否为真实需求；且需先核对 dsh `profile` 是否已覆盖（5.4）。建议 P3 再定。
3. **初始化 skill 的触发方式**——协调者主动调用 vs `init_project` 工具触发。建议工具触发（幂等、可测、不依赖模型记得调用）。
4. **Card 与 team 任务板的关系**——本方案假设两者分工（人类可见交付看板 vs 机器侧编排状态）。若实测发现 team 任务板已够用，Card 层可大幅缩减。P0 实测后确认。
5. **worktree 隔离的接线方式**——用 dsh 的 `dsh-experimental-worktree`，还是沿用 Telov 的 `worktree-spawn.ts` 思路自建脚本。倾向复用 dsh 的。
6. **bundle 名称与包名**——需符合 dsh 的命名与显示元数据规范（`locale/{en,zh}.json` 的 `meta.title`/`meta.description`，`icon` 可选）。

---

## 附录 A：证据索引

### Telov 侧（`candyapp/`）

| 主题 | 位置 |
|---|---|
| 编排工具面（8 个工具） | `apps/electron/src/main/lib/project/tools.ts`（`CreateCard:304`、`UpdateCard:86`、`ListCards:391`、`SpawnWorker:426`、`ListWorkers:484`、`MessageWorker:519`、`ReadWorkerTurn:573`、`StopWorker:622`） |
| worker 编排实现 | `apps/electron/src/main/lib/project/worker-orchestration.ts`（`assertWorkerInProject:121`、`messageWorker:308`） |
| 唤醒链与通知 | `apps/electron/src/main/lib/project/coordinator-wake.ts`（`createCoordinatorWake:144`、`buildWorkerTurnNotificationXml:113`、`dispatchToCoordinator:294`、`reconcilePendingNotifications:373`） |
| 通知落盘 | `apps/electron/src/main/lib/project/coordinator-notification-store.ts` |
| 卡片仓库 | `apps/electron/src/main/lib/project/task-cards.ts`（`~/.telov/task-cards.json`，编号不复用 `:161`，revision `:198`） |
| 卡片操作与并发 | `apps/electron/src/main/lib/project/card-ops.ts`（`createAndAttach:92`、`updateCardForSession:134`、项目一致性闸门 `:146`） |
| 槽位解析与注入 | `apps/electron/src/main/lib/project/slot-templates.ts`（`loadSlotTemplates:70`、`buildRoleContextForSession:90`） |
| 协调者指令注入 | `apps/electron/src/main/lib/project/coordinator-instructions.ts`（`loadCoordinatorInstructions:59`） |
| 身份判定 | `apps/electron/src/main/lib/project/coordinator-identity.ts` |
| 自动续行护栏 | `apps/electron/src/main/lib/agent-orchestrator/orchestrator-resume.ts`（`maybeAutoResumeForCoordinator:209`） |
| Project 类型 | `packages/shared/src/types/project.ts:15`、存储 `apps/electron/src/main/lib/config/project-store.ts:30`、创建编排 `apps/electron/src/main/lib/config/projects.ts:33` |
| Card 类型 | `packages/shared/src/types/task-card.ts:51`（status `:70`） |
| 会话血缘字段 | `packages/shared/src/types/agent-session.ts:59-65`（`cardId`/`cardRole`/`projectId`/`spawnedBy`） |
| 看板 UI | `apps/electron/src/renderer/components/board/`（1073 行）、`lib/board-projection.ts`（230 行）、`atoms/task-card-atoms.ts` |
| 右栏 Tab 注册 | `apps/electron/src/renderer/components/agent/inspector/tab-registry.ts:52` |
| 协议层 | `.agents/skills/telov-mode/`（SKILL.md 66、playbooks/program.md 46、implementation.md 23、delivery.md 17、handoff.md 13、references/architecture.md 29、parallel.md 69、pstack-map.md 70、review-bot-triage.md 37） |
| 项目入口与槽位 | `COORDINATOR.md`、`SLOTS.md` |

### dsh 侧（`deepseek-harness/`）

| 主题 | 位置 |
|---|---|
| 扩展点总表 | `docs/cookbook/extension-cookbook.md:98-133`（feature → mechanism map） |
| bundle 形态与分发 | `docs/user/develop/basic/publish.md`（结构 `:21`、engines.dsh `:66`、安装 `:80`、peer 双声明 `:105`、git 安装坑 `:161`） |
| 插件开发入门 | `docs/user/develop/basic/index.md`（scratch 目录 `:12`、绝对路径要求 `:56`）、`tool.md`、`config.md` |
| 插件生命周期 | `docs/user/develop/framework/index.md`（Fiber 状态机、HMR） |
| 第三方 preview 缺口 | `docs/cookbook/adding-a-plugin-preview.md:5` |
| 仓内包规范（参照） | `docs/cookbook/adding-a-package.md`（清单 `:9-23`、注册面 `:31-40`、README 规范 `:74-110`） |
| team 能力与限制 | `packages/experimental/agent-team/README.md`（teammate `:60`、消息 `:70`、任务板 `:74`、等待 `:82`、限制清单 `:194-207`） |
| subagent 能力 | `packages/subagent/README.md`（provider 族 `:25-35`） |
| 右栏 Tab 扩展 | `packages/client/ui-sidebar-right/src/client/index.ts:150`、`docs/subsystems/sidebar-right.md:36`（注册 API）、`:13`（tab type = 两处注册） |
| 存储域扩展点 | `packages/storage/storage-domain/src/spec.ts:107` |
| session event 限制 | `packages/core/session/src/known-event-types.ts:24-30` |
| skill 机制 | `packages/skill/skill/src/index.ts`（`registerProvider:390`、`register:439`）、发现优先级见 `docs/subsystems/skills.md` |
| workflow 引擎 | `packages/workflow/workflow/README.md`（`agent/parallel/pipeline/phase/log`） |
| 门禁清单 | `scripts/run-gates.ts:821-841`（doc-sync 覆盖的 gen-* 产物） |