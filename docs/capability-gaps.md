# 能力缺口清单（P0–P1 实测）

本清单由 P0–P1 阶段在真实 dsh（0.2.1-rc.2）上实测得出，不是文档推断。每条给出 Telov 现状、dsh 实测现状、证据与影响。

复现环境：macOS arm64，dsh `0.2.1-rc.2`，web、headless 与 sdk 三个 profile。

---

## 一、阻断级

### 1. `agent-team` 的版本耦合（P1 期间已解除，但结论保留）

**Telov 现状**：协调者的执行者能力是产品级能力，不受宿主版本漂移影响。

**P0 实测**：web profile 的 `dsh.profile.bundles` 里有三个 team 插件行，dsh 启动时全部拒绝激活：

```
dsh: disabling profile plugin row "agent-team": Plugin @deepseek-ai/dsh-experimental-agent-team@0.1.5-alpha.2
is incompatible with dsh 0.2.1-rc.2: requirements {"@deepseek-ai/dsh-llm":"^0.1.5-alpha.2", ...}
```

`^0.1.5-alpha.2` 在 semver 下只允许 `0.1.x`，宿主已是 `0.2.1-rc.2`，因此整组被拒。启动日志里共 8 条同类拒绝（agent-team / tool-agent-team / ui-agent-team）。

**P1 期间更新**：team 已升到 `0.2.1-rc.2`，在 web profile 正常激活。

**结论保留**：被拒不是配置问题，是 dsh 的插件版本策略在预览期的必然结果。dsh 的 `engines.dsh` 机制意味着**任何依赖 dsh 内部包的 bundle 都会周期性失效**；本 bundle 零 dsh 内部依赖的设计因此是必要的，不是保守。编排层用 `ctx.subagents` 系列（见缺口 2），不依赖 team；team 若恢复可用，只需换 adapter（把 team 调用收敛到单一文件）。

### 2. dsh 没有「完成唤醒协调者」——P1 已自建补齐

**Telov 现状**：`coordinator-wake.ts`（390 行）实现「worker 跑完 → 事件触发 → 协调者自动开新 turn 并收到富通知」，外加通知落盘、崩溃补投与自动续行护栏。协调者派完活继续思考，不阻塞。

**dsh 实测**：base bundle 内置 `subagent-spawn-in-process`、`tool-subagent-control`、`tool-subagent-list-agents`（`packages/bundle/base/cordis.patch.yml:362-377`），可用；但 subagent 工具的语义是**父 agent 调工具 → 子 agent 跑完 → 工具返回结果**，父 turn 在调用处阻塞。dsh 侧没有等价的「子会话结束后父会话被动醒来」机制；team 有 inbox 投递但同样不主动唤醒 Lead（team README「Waiting and interruption」只有成员主动 `waitForChange()`）。

**P1 的解法**：不改 dsh，只用它的公开入口自建三条链路：

- **派工**：`ctx.subagents.startActivation({ delivery: 'caller' })` 立即返回子会话 id，`activation.result` 是终态 promise——dsh 原生 spawn 工具是阻塞式，做不到「派完即返回」。
- **唤醒**：`agent.followup(userMessage)`，dsh 唯一能开新 turn 的入口。
- **落盘**：完成通知先写盘再唤醒，进程在唤醒前崩溃不丢通知；投递失败的通知留在队列，父会话重新打开时补投。

**实测结论**（sdk profile，mock LLM，全链路一次通过）：父派工 → 子会话建立并执行 → 子终态 → 父 inbox 收到「【worker 回报】任务「写文件」已结束…」→ 父状态 `idle → running → idle`（真的被唤醒并开了新 turn）→ 通知队列清空。

---

## 二、形态级

### 3. 插件模块从 profile 目录解析，不从 dsh 安装目录解析

**实测**：用 `--patch` 加载时，插件行写包名会失败：

```
Cannot find package 'dsh-coordinator' imported from /Users/mxwu/.dsh/profiles/web/
```

把包 link 进 dsh 仓库的 `node_modules` 无效——解析基准是 profile 目录。

**应对**：bundle 必须装进 profile（`dsh plugin --profile <name> add <spec>`）。开发期可另用绝对路径 patch（`docs/user/develop/basic/index.md:56` 要求绝对路径），但那是开发形态，不是分发形态。

### 4. 用户 profile 里的坏 bundle 会阻塞 plugin CLI

**实测**：`~/.dsh/profiles/web/package.json` 里的 `@dsh-external/dsh-super-injector` 指向 `/Users/mxwu/Documents/code/dsh-routing-suite/injector`，该目录已不存在。于是：

```
Error: dsh: cannot resolve profile bundle "@dsh-external/dsh-super-injector" ...
at runProfilePnpm (packages/boot/plugin-manager/src/operations.ts:523:15)
```

`dsh plugin --profile web add ...` 在写入 `dsh.profile.bundles` 之前就抛错，导致**依赖装上了但 bundle 层没写入**的半完成状态。

**应对**：这是宿主环境问题，不是 bundle 问题；但它意味着「按官方命令安装」在真实机器上可能失败。安装流程需要具备「plugin CLI 失败后回退到手工写 profile patch 层」的预案。

---

## 三、能力级

### 5. 无角色与权限模型

dsh 的 skill 只有 `modelInvocable` / `userInvocable` 两个布尔开关（`packages/skill/skill/src/index.ts:49-54`），没有 per-skill 工具白名单或角色声明。粗粒度角色只能靠 agent preset 换工具集 + persona 换人设。

**影响**：Telov 的 `SLOTS.md` 槽位机制（角色名 → role_context 注入）无对应物。**应对**：P3 自建薄层，只承载方法入口与人设，不承担工具授权——协议层需保留「技能不授予权限」的声明。

### 6. 无跨会话的项目实体

session 类型里没有 `projectId`；`projectRoot` 只用于 skill 发现与 agent-instructions。最接近的持久实体是 team 的任务板（绑定单一 Lead Session）、todo（单会话整表）、goal（单会话一个目标）。

**影响**：Telov 的 Project（目录绑定 + coordinatorSessionId + 卡片外键）需自建。**但**：dsh 的 `profile` 概念可能已覆盖「一套插件组合 + 一个协调者」的诉求，P3 开工前必须先核对，避免自建重复概念。

### 7. team 任务板不覆盖 slot→session 绑定

即便 team 可用，其任务板提供任务、依赖 DAG、owner、revision CAS，**没有**「一个卡片同时挂 dev 与 review 两个会话」的槽位绑定，也没有 links、checkpoint、编号不复用。

**影响**：人类可见的交付看板必须自建存储域，不能硬塞进 team 任务板。两者职责需分开：team 板是机器侧编排状态，自建 Card 是人类侧交付状态。

### 8. 仓外插件不能新增 session event 类型

dsh 要求仓外事件必须带 `ignorable` 标记且不进读路径（`packages/core/session/src/known-event-types.ts:24-30`）。

**影响**：卡片与项目状态不能写进会话事件流，只能走独立存储域 + session projection。这决定了 P2/P3 的实现形状。

### 9. session 日志在 headless 下未落盘内容

**实测**：headless 会话产生的 `session.v4.jsonl.zstd` 解压后仅 198 字节，无工具调用、无 skill catalog 记录。`~/.dsh/storages/session_projcache/` 里有工具名，但没有 skill catalog。

**影响**：不能指望 session log 做编排状态的持久化或审计。编排状态与卡片状态需要自己的持久化。

### 10. `agents` 注册表在插件根作用域不可见

**实测**：`ctx.get('agents')` 抛 `cannot get required service "agents" in inactive context`——`agents` 是 agent-scoped 服务，根作用域的插件拿不到。

**影响**：插件无法在任意时刻反查任意会话的 agent。唤醒与补投只能依赖「派工时持有的父 agent 活对象」加 `agent/created` / `agent/disposed` 事件。

### 11. `sessionController` 只挂在 web-app bundle

**实测**：`@deepseek-ai/dsh-api-session-controller` 由 `packages/bundle/web-app/cordis.patch.yml:121` 挂载。它有 30 余个 peer 依赖，还需 `fileUploads` 与 `workspaceRegistry` 两个服务；headless profile 补齐不现实，实测报 `pending (waiting for services: fileUploads, workspaceRegistry)`。

**影响**：不能把 `sessionController` 声明为插件的必需 inject——否则不含该服务的 profile 整个插件挂起。本 bundle 改用 `ctx.get()` 惰性获取，缺失时回退到派工时持有的 agent。

### 12. headless 一次性 CLI 会销毁父会话——唤醒失败的真因

**实测**：headless profile 下父会话在 turn 结束后被 dispose（`agent/disposed`），此后 `followup()` 没有载体，投递报 `cannot read inbox state: its projection registration is not active`。web 与 sdk 等长驻组合里父会话存活，唤醒正常。

**影响**：后台编排只适用于长驻组合（web / desktop / sdk）；headless 的一次性任务模式不适用——这是宿主语义，不是本 bundle 的缺陷。

### 13. 两套同名工具：父子模型与同伴模型

**实测**：dsh 有两处 `send_message` / `interrupt_agent` / `list_agents`：

| 来源 | 模型 | 寻址 | 作用域 |
|---|---|---|---|
| `@deepseek-ai/dsh-tool-subagent-control`（base bundle 默认启用） | 父子 | `agent_id` 即子会话 id | 调用者派出的子会话 |
| `@deepseek-ai/dsh-tool-agent-team`（experimental，base bundle 未启用） | 同伴 | teammate 名字 | team 成员 |

**影响**：本流程用**父子模型**那套（`tool-subagent-control`）。早期方案文档按 team 工具写过映射表，是错的——team 的 `sendMessage` 走 `ctx.agentTeams`，管不到用 `ctx.subagents.startActivation` 派出的子会话。协议层已按实测订正，并显式提示「不要与同伴模型那套混用」。

### 14. 工具的结构化结果不进事件流 content，只在 `presentationMeta` 投影的 `meta` 里

**实测**：`tool/result` 事件的 `message.content` 只有 `output.render` 给模型的文本；`output.value`（结构化结果）不出现在事件里。`output.presentationMeta(args, value)` 投影的 `meta` 才随事件持久化（`tool/result` 事件的 `data.meta`），并被客户端的 `ToolResultNode.meta` 读回。

**影响**：客户端要拿结构化数据，只能走 `presentationMeta`。本 bundle 的卡片工具据此投影 `meta`（`{kind:'dsh-coordinator-cards', scope, cards}`），客户端据此重建看板。

### 15. 右栏 tab 注册与 slot body 都在浏览器侧，host 插件够不着

**实测**：`ctx.sidebarRightTabs.register` 与 `ctx.slots.inject('sidebar.right.pane.tab', …)` 是 client 服务（`packages/client/ui-sidebar-right`，browser-side UI plugin layer），host 进程（Node 侧插件）注册不了。

**影响**：看板 UI 必须有 client 半边——package.json 声明 `dsh.client`（`platform:'web'`、`exports:'./client'`、`external` 列非 baseline 模块），并用 tsdown 产出 `lib/client.js`（closure-factory 格式，React 等 baseline 模块由宿主提供）。这是 P2 剩余工作的主要成本。

### 16. 读子会话原始回合内容没有默认可用的工具

**实测**：`session_event_read` / `session_search` / `session_trace` 属 `@deepseek-ai/dsh-tool-session-query`（experimental），base bundle 未启用；其「authorized session」授权校验在 dsh 内部，仓外插件无法零依赖正确复刻。

**影响**：Telov 的 `ReadWorkerTurn` 没有直接对应物，降级为「完成通知携带产物摘要」；需要深挖时用 `send_message` 向该 worker 追问（会唤醒它开新回合）。若要直读子会话原始事件，须显式安装 `tool-session-query` 并接受其 experimental 状态。

### 17. storage domain 需要 dsh 内部包与 zod，与「bundle 零内部依赖」冲突

**实测**：`defineDomain` / `domainTable`（`packages/storage/storage-domain/src/spec.ts:107`）要求 zod schema，存储域服务本身是 `@deepseek-ai/dsh-storage-domain` peer 依赖，dsh 按 peer 版本与宿主严格校验。

**影响**：卡片与通知队列改用自建落盘（原子写 + 读-改-写串行化），落在 `$DSH_HOME/dsh-coordinator/`。代价是不享受 dsh 的存储域生态（迁移、备份、跨端同步），换来的是零版本耦合。

---

## 四、工具级（已验证可用，无缺口）

| 能力 | 实测结果 | 证据 |
|---|---|---|
| bundle 作为第三方 bundle 分发 | 通过 | `dsh plugin --profile headless add ../dsh-coordinator` 后 `dsh.profile.bundles` 含 `dsh-coordinator` |
| `ctx.tools.register` | 通过 | 模型调用 `init_project` 成功，目标目录生成 `AGENTS.md`（4307 字节，含受管区块） |
| `ctx.skills.registerProvider` | 通过 | `ctx.skills.list()` 返回 `coordinator-mode` 与 `init-project`，provider `dsh-coordinator`，source `bundled` |
| 免凭据跑真实会话 | 通过 | dsh 自带 mock LLM server（`packages/test-support/llm-mock-server`）+ `DEEPSEEK_BASE_URL` 覆盖 |
| 包名子路径解析 | 通过 | `exports` 映射 `"./src/host": "./src/host/index.js"`；ESM 不支持目录索引，必须指到文件 |
| 后台派工（派完即返回） | 通过 | `spawn_worker` 立即返回子会话 id，父 turn 正常结束，worker 在后台继续 |
| 完成自动唤醒 | 通过 | 父 inbox 收到「【worker 回报】…」后状态 `idle → running → idle`，通知队列清空 |
| 协议层与工具对模型可见 | 通过 | 模型侧工具列表同时含 `init_project` 与 `spawn_worker`；skill catalog 含 `coordinator-mode` 与 `init-project` |
| 原生工具管理子会话 | 通过（源码核验） | base bundle 启用 `tool-subagent-control` 与 `tool-subagent-control/list-agents`；`agent_id` 即子会话 id |
| 卡片存储与领域规则 | 通过 | 49 例单测全绿；sdk profile + mock LLM 实测建卡/改卡/查卡/版本冲突 |
| 客户端取数通道 | 通过 | `output.presentationMeta` 投影的 `meta` 随 `tool/result` 事件持久化，实测携带完整卡片对象 |

---

## 五、待验证

- **worktree 隔离**：team 明确不提供 worktree；`dsh-experimental-worktree` 是否能接入编排约定，未实测。
- **右栏看板 client 半边**（P2 剩余）：`dsh.client` 声明、tsdown 构建链、tab body 取会话 tool-result 节点的 API，均未实测。
- **真实模型下的协议遵循**：本轮用 mock 触发的工具调用验证了工具通路，未验证模型在真实推理下是否按协议层派工。
- **web 组合下的唤醒**：P1 的完整链路在 sdk profile 验证；web profile 的组合更接近真实使用，但其会话由 UI 创建，尚未用同一套探针跑通。
- **`list_agents` 能否列出本 bundle 派出的 worker**：源码路径一致（同一 `ctx.subagents` 与 catalog 投影），但未跑实测。

