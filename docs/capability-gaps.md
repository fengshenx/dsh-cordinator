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

**影响**：看板 UI 必须有 client 半边——package.json 声明 `dsh.client`（`platform:'web'`、`exports:'./client'`、`external` 列非 baseline 模块），并产出 `lib/client.js`（closure-factory 格式，React 等 baseline 模块由宿主提供）。构建链见第 19 条，插件行名的硬约束见第 18 条。

### 16. 读子会话原始回合内容没有默认可用的工具

**实测**：`session_event_read` / `session_search` / `session_trace` 属 `@deepseek-ai/dsh-tool-session-query`（experimental），base bundle 未启用；其「authorized session」授权校验在 dsh 内部，仓外插件无法零依赖正确复刻。

**影响**：Telov 的 `ReadWorkerTurn` 没有直接对应物，降级为「完成通知携带产物摘要」；需要深挖时用 `send_message` 向该 worker 追问（会唤醒它开新回合）。若要直读子会话原始事件，须显式安装 `tool-session-query` 并接受其 experimental 状态。

### 17. storage domain 需要 dsh 内部包与 zod，与「bundle 零内部依赖」冲突

**实测**：`defineDomain` / `domainTable`（`packages/storage/storage-domain/src/spec.ts:107`）要求 zod schema，存储域服务本身是 `@deepseek-ai/dsh-storage-domain` peer 依赖，dsh 按 peer 版本与宿主严格校验。

**影响**：卡片与通知队列改用自建落盘（原子写 + 读-改-写串行化），落在 `$DSH_HOME/dsh-coordinator/`。代价是不享受 dsh 的存储域生态（迁移、备份、跨端同步），换来的是零版本耦合。

### 18. 插件行名必须是纯包名，否则浏览器侧发现不到 client 半边

**实测**：`packages/client/modules/src/index.ts:892` 的 `locatePkgJson` 要求 Loader 行名可解析成包名：`exactPackageSpecifier` 不接受含 `/` 的子路径。行名写成 `dsh-coordinator/src/host` 时定位不到包 manifest，该行不会被识别为 client row——宿主不下发 client bundle，浏览器侧完全没有本包的 UI。

**实测（修复后）**：行名改为 `dsh-coordinator`（纯包名）→ web profile 的 boot manifest 从 70 条目变 71 条目，多出的条目即本包，附带 `plugins/??dsh-coordinator/client.js` 下发路径；浏览器右栏随即出现本包注册的 Tab。

**影响**：bundle 的插件行名不能为了定位子模块而写成子路径；子模块仍可通过 `exports` 映射（如 `"./src/host"`）供包内引用。

### 19. client 产物得自己产出 closure-factory 封装

**实测**：dsh 的 `clientBundle` 预设（`packages/client/tsdown.client.ts`）绑定仓内 `PLATFORM_MODULES` 等多个模块，第三方仓无法直接引用；宿主按 closure-factory 约定加载产物——`window.__ModuleLoader__.load({ id, factory: (require) => { var module = { exports: {} }; … return module.exports; } })`。

**影响**：本 bundle 用 esbuild 自建轻量构建链（`build/client.mjs`）：产物体是 CJS，banner 注册工厂并注入 require，footer 交回 exports；宿主模块表里的行（React 等）由 `dsh.client.external` 声明，运行时由工厂的 require 解析。

### 20. 面板读会话事件要走 `ctx.sessions`，不是纯 session projection

**实测**：`ctx.sessions.retain(sessionId, { source })` → `reference.ready` → `reference.binding.eventSource`（`ObservableSnapshot<SessionEventWindow>`）→ `getSnapshot().entries` 里筛 `entry.type === 'event' && entry.event.type === 'tool/result'`。纯 session projection 路线走不通：仓外事件类型不进宿主读路径（见第 8 条）。

**影响**：看板面板按事件顺序重放卡片投影——全量投影（`scope:'all'`）清空视图，单卡投影（`scope:'card'`）覆盖一张卡。面板挂在 `sidebar.right.pane.tab` 座，scope 是 session，运行时 props 自带 `sessionId`。

**事件窗口是分页的**：初始只装最近一页，`SessionEventWindow.hasMore` 标志更早历史未加载。面板必须驱动 `SessionFace.loadOlder()` 逐页加载到没有更早历史再重放投影，否则早期建卡/改卡不在窗口内；更糟的是窗口内若恰有 `list_cards` 的全量投影，它本应是完整列表，却被当成窗口内的部分视图看待，破坏「全量投影是权威快照」的前提。`loadOlder` 失败时宿主只记日志不抛错，故翻页设了上限（20 页），到顶则标注「仅显示已加载的历史片段」。

### 21. `ctx.sessions.list()` 只返回 live session——从会话推导的列表会随重启漂移

**实测**：`ctx.sessions.list()` 的注释明写「All live sessions, in creation order」（`packages/core/session/src/index.ts:1359`），只含进程内活着的会话。持久化语料在 `ctx.sessionQuery.listSessions()`（`packages/session-query/session-query/src/index.ts:174`），它合并持久化记录与 live session、live 优先（`packages/session-query/session-query/src/corpus.ts:62`），每条带 `header.cwd`。

**影响**：任何「列表」都不能只用 `ctx.sessions.list()`——进程重启后，未加载的历史会话不在其中，昨天还在的条目今天会从列表消失。项目列表因此**不**从会话推导，而是显式注册表（`projects.json`），真源是注册表而不是会话语料。

### 22. 持久化会话头里没有标题与更新时间

**实测**：`SessionHeader` 只有 `version`、`id`、`createdAt`、`cwd`、`parentSession`、`isSeeded`、`origin`、`delegationDepth`、`agentPreset`（`packages/core/session/src/types.ts:95-138`），没有 `title` 与 `updatedAt`——那是客户端投影（`SessionSummary`）才有的字段。

**影响**：宿主侧从持久化语料挑会话时，只能按 `createdAt` 与 live 优先排序，取不到「最近更新」；客户端侧用 `ctx.sessions.list` 的 `SessionSummary` 才能按 `updatedAt` 排。项目名存在项目记录里，不依赖会话头。

### 23. 客户端构建产物不能用 `node:` 内置模块

**实测**：`build/client.mjs` 的 esbuild 配置是浏览器平台，引入 `node:path` 直接报 `Could not resolve "node:path"`。client 半边跑在浏览器进程里，没有 Node 内置模块。

**影响**：路径末段名称这类小工具在 client 侧得自己实现（`src/client/project-switcher.js` 的 `basenameOf`），且要同时认 `/` 与 `\` 两种分隔符——宿主可能在 Windows 上把工作目录写成反斜杠形式。

---

### 24. 系统提示词消息是会话级固定的——动态内容必须走运行时上下文

**Telov 现状**：角色槽位正文作为 role_context 随每轮 turn 构造注入，读的是当轮的文件内容，改完文件下一轮即生效。

**dsh 实测**：`systemPrompt.section()` 注册的段进的是**系统提示词消息**，而那条消息只在请求序列重启时重新投影（`packages/core/agent-loop/src/agent.ts:407-425` 的 `systemPrompt.project`；`startsSeries` 为假时不追加新消息）。会话建立后再注册进去的段，在后续请求的系统提示词里始终不出现——注册成功、不报错、静默失效。

**替代通道**：运行时上下文（`assembly.contexts`）没有这个限制，provider 每轮组装时重新求值（`packages/core/system-prompt/src/index.ts:582-602` 的 `refreshContext`），快照有变化才作为一条 user 消息追加（`packages/core/agent-loop/src/runtime-context.ts:152-163`）。宿主自己的 `working-directory` 上下文就是这么做的（`packages/session/working-directory/src/index.ts:97`）。

**附加约束**：上下文必须**注册成 provider**，不能只在组装事件（`system-prompt/assemble` waterfall）里临时追加——`refreshContext` 按注册表重新求值，注册表里没有的临时项在运行时被抑制时会被丢弃（`packages/core/system-prompt/src/index.ts:591`）。

**影响**：任何「随时间变化、但要进模型视野」的内容（角色、租户配置、能力开关）都得走运行时上下文，不能走 section。

### 25. `systemPrompt` 不声明在 inject 里就拿不到——即使只是要注册 provider

**dsh 实测**：`ctx.on('system-prompt/assemble', ...)` 这类绑定在服务上的事件，在插件未声明 `systemPrompt` 依赖时不触发；声明后即触发。同一段注册代码在「声明」与「不声明」两种 `inject` 下行为不同，且不报错——只是注入内容不出现。

**影响**：`systemPrompt` 需与其他核心服务一样进 `inject`。它在全部官方 bundle 都有（base 挂载、`packages/bundle/base/cordis.patch.yml:505`；sdk-minimal 自带一行；headless 在 base 之上覆盖 config），声明为必需依赖是安全的——与 `sessionController`、`workspaceRegistry` 那类「只在部分 bundle 存在、声明会让插件挂起」的服务不同。

### 26. `connection.rpc.handle` 对仓外插件不可用——但 Typert 的 SRC 通道可用

**Telov 现状**：渲染进程的 IPC 通道是宿主提供的固定接口，插件只要拿到通道句柄就能调宿主。

**dsh 实测**：`connection` 服务提供 `rpc.handle(channel, handler)` 与 `rpc.fetch.register(route)`，但它们把路由注册到**读取 connection 的那个作用域**上（`packages/client/connection/src/rpc-host.ts:253-277` 的 `owner.webServer.register(route)`）。作用域属性访问要求该服务在作用域链上可注入，第三方 bundle 读到的 connection 服务副本带着「读取者作用域」——而 `webServer` 只挂在 web-app bundle 上，读取者作用域拿不到它的 inject 声明，注册必抛 `cannot get property "webServer" without inject`。dsh 内部也没有任何 `handle` 的使用者：官方 gateway 走的是 `rpc.intercept('/api', …)`，而 `/api` 每条通道只允许一个拦截器，第三方插不进去。

**可走的路：Typert 的 SRC 通道**。宿主 gateway 在 strict 生成描述符缺失时走 SRC 回退（`packages/api/gateway/src/index.ts:868-879` 的 `resolveDescriptor` → `resolveSrcDescriptor`），它按服务原型上的方法标记与实例上的服务绑定还原调用描述符，参数名从方法源码的形参解析。标记契约是**稳定字符串 + 版本化描述符**（协议包 `@deepseek-ai/dsh-typert-protocol` 把标记写在原型属性 `@deepseek-ai/dsh-typert-protocol/remote-methods` 上，值为 `{version:1, methods:[{method, invocation:{kind:'direct'}}]}`），宿主读标记时**不校验来源包的版本**——第三方手写同样的形状即可，不必安装 dsh 内部包。

**要满足的条件**（缺一即失败）：

- 服务必须以 Cordis 服务身份注册（`ctx.provide(key, instance)` 会把 `ctx.reflect.props[key]` 记为 `{type:'service'}`，SRC 回退按这个标记遍历）；
- 实例上要有 `typertRemote` 绑定，字段为 `{service, serviceKey, namespace}`，其中 `service` 必须指向实例本身（宿主拿它与调用时取到的实例比对）；
- 原型上要有方法标记，方法名与实例方法名逐字一致；
- 方法的形参名就是 wire 字段名，宿主按源码解析形参，客户端必须传同名字段，多一个少一个都会被 `gateway/arguments-invalid` 拒掉；
- 客户端侧 `$mount` 的贡献里每个入参都要带 strict codec（`requireStrictInputs` 会拒收没有 strict codec 的描述符），宿主侧的 SRC 描述符则一律 `src-json`。

**影响**：浏览器侧 → 宿主侧的调用不必自建 Web 路由（那条路要自己处理同源校验与错误形状，鉴权弱于官方 `/api`），也不必装 dsh 内部包（装它会被宿主的 peer/engines 校验卡住）。本仓取 Typert SRC 通道，见[项目作用域与角色槽位](.agents/notes/2026-10-23-项目作用域与角色槽位.md)。代价是手写的协议形状与宿主版本耦合——宿主改标记契约时本仓要同步改。

### 27. 左栏没有与工作区并列的区块槽——第三方只能靠 DOM 注入取位

**Telov 现状**：左栏是三个并列区块（项目类目 → 置顶区 → 工作区类目），项目区目是独立的一等公民。

**dsh 实测**：左栏正文区只有**一个** `sidebar.workspaces` 槽（single，已被宿主的 `WorkspaceBrowser` 占；重复注册抛 `single slot "sidebar.workspaces" already has a registration`，`packages/client/ui-slots/src/index.ts:1220-1222`），slot 机制没有 decorator/HOC 或包装能力（`packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` 与 `deriveGroups` 都未导出，无法复用渲染逻辑）。左栏可用的 list 槽只有两个：`sidebar.panellist`（occupant 只放 glyph，须与 `main` 同 id 成对注册）与 `sidebar.footer.action`（occupant 可渲染任意内容，位置在工作区下方、设置按钮上方，`packages/client/ui-sidebar/src/client/SidebarRoot.tsx:405-412`）。

**可行的取位办法**：左栏的 DOM 结构是「面板列表 `nav` → 工作区滚动区 → 底部区」（同文件 `:395-412`）。footer occupant 里放一个锚点，向上找到第一个「直接子元素含 `nav`」的祖先作为左栏根，在 `nav` 之后插一个容器，用 React portal 把内容渲染进去，位置就是「自动化任务之下、工作区之上」。宿主结构变了导致找不到锚点时，内容退回原槽渲染，功能不受影响——降级路径必须留着。

### 28. Typert 远程方法的名字要避开官方命名空间服务的保留字

**dsh 实测**：客户端挂载贡献时，官方命名空间服务逐个检查方法名（`packages/api/gateway/src/client/index.ts` 的 `RemoteNamespaceService.assertMethodAvailable`）：撞上命名空间服务自身的字段（`ctx`、`name`、`methods`、`namespace` 等）或 Cordis 服务原型的成员即拒收整个命名空间，报 `client api: method "projects/remove" conflicts with its namespace service`。`remove` 正是 Cordis 服务原型上的成员。

**影响**：第三方远程方法要挑业务前缀足够远的名字（本仓把 `remove` 改成 `unregister`），否则整个命名空间挂不上，表现为界面上一片「通道未就绪」而不是某个方法缺失。


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
| 右栏看板 client 半边 | 通过 | web profile boot manifest 含本包条目（71 条目）；浏览器右栏出现「看板」Tab 并显示卡片；插件行名须为纯包名（见第 18 条） |
| 面板读会话事件 | 通过 | `ctx.sessions.retain` → `binding.eventSource` → 筛 `tool/result` 事件取 `meta`（见第 20 条） |
| 项目注册表（host 侧） | 通过 | `add_project` 落盘 `projects.json` 并建协调者会话；`list_projects` 返回注册表条目并标注协调者是否存活（见第 26 条） |
| 解析目标项目（host 侧） | 通过 | `switch_project` 按 id 或名字返回该项目的协调者会话；协调者会话已删时如实说明需换新协调者 |
| 项目区块（client 侧） | 通过 | web profile 实测：左栏「项目」区块位于「自动化任务」之下、工作区之上，列出已注册项目（含目录路径）；数据走 Typert SRC 通道，浏览器实测取回列表（见第 26 条） |
| 角色槽位注入 | 通过 | `ctx.systemPrompt.context()` 注册运行时上下文（见第 24–25 条）；改 `SLOTS.md` 正文后下一轮 turn 注入新正文；注入前后两轮请求的工具定义数组逐字节一致（32 个工具） |

---

## 五、待验证

- **worktree 隔离**：team 明确不提供 worktree；`dsh-experimental-worktree` 是否能接入编排约定，未实测。
- **真实模型下的协议遵循**：本轮用 mock 触发的工具调用验证了工具通路，未验证模型在真实推理下是否按协议层派工。
- **web 组合下的唤醒**：P1 的完整链路在 sdk profile 验证；web profile 的组合更接近真实使用，但其会话由 UI 创建，尚未用同一套探针跑通。
- **`list_agents` 能否列出本 bundle 派出的 worker**：源码路径一致（同一 `ctx.subagents` 与 catalog 投影），但未跑实测。
- **看板的信号灯**：信号灯纯投影尚未实现（P2 剩余项）。槽位绑定已在 P3 接上——卡片 `slots` 字段的反查索引与 `SLOTS.md` 正文注入均已落地并实测，信号灯仍待做。

