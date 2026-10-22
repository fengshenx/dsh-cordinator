# 能力缺口清单（P0 实测）

本清单由 P0 阶段在真实 dsh（0.2.1-rc.2）上实测得出，不是文档推断。每条给出 Telov 现状、dsh 实测现状、证据与影响。

复现环境：macOS arm64，dsh `0.2.1-rc.2`，web 与 headless 两个 profile。

---

## 一、阻断级

### 1. `agent-team` 在本机被 dsh 自动禁用（版本耦合）

**Telov 现状**：协调者的执行者能力是产品级能力，不受宿主版本漂移影响。

**dsh 实测**：web profile 的 `dsh.profile.bundles` 里有三个 team 插件行，dsh 启动时全部拒绝激活：

```
dsh: disabling profile plugin row "agent-team": Plugin @deepseek-ai/dsh-experimental-agent-team@0.1.5-alpha.2
is incompatible with dsh 0.2.1-rc.2: requirements {"@deepseek-ai/dsh-llm":"^0.1.5-alpha.2", ...}
```

`^0.1.5-alpha.2` 在 semver 下只允许 `0.1.x`，宿主已是 `0.2.1-rc.2`，因此整组被拒。启动日志里共 8 条同类拒绝（agent-team / tool-agent-team / ui-agent-team）。

**影响**：Telov 编排模型最接近的现成件（Lead/teammate + 共享任务板 + inbox 消息）在本机**不可用**。这不是配置问题，是 dsh 的插件版本策略在预览期的必然结果。

**应对**：
- 短期：编排层用 `ctx.subagents` 系列（见缺口 2），不依赖 team。
- 中期：team 若恢复可用，编排层只需换 adapter（把 team 调用收敛到单一文件）。
- 结构性：dsh 的 `engines.dsh` 机制意味着**任何依赖 dsh 内部包的 bundle 都会周期性失效**；本 bundle 零 dsh 内部依赖的设计因此是必要的，不是保守。

### 2. dsh 的 subagent 是阻塞式，没有「完成唤醒协调者」

**Telov 现状**：`coordinator-wake.ts`（390 行）实现「worker 跑完 → 事件触发 → 协调者自动开新 turn 并收到富通知」，外加通知落盘、崩溃补投与自动续行护栏。协调者派完活继续思考，不阻塞。

**dsh 实测**：base bundle 内置 `subagent-spawn-in-process`、`tool-subagent-control`、`tool-subagent-list-agents`（`packages/bundle/base/cordis.patch.yml:362-377`），可用；但 subagent 工具的语义是**父 agent 调工具 → 子 agent 跑完 → 工具返回结果**，父 turn 在调用处阻塞。

**影响**：这是 Telov 与 dsh 编排模型的**核心语义差异**，直接决定 P1 的工作量。dsh 侧没有等价的「子会话结束后父会话被动醒来」机制；team 有 inbox 投递但同样不主动唤醒 Lead（team README「Waiting and interruption」只有成员主动 `waitForChange()`）。

**应对**：P1 用 `turn/end` 事件 → 父会话 `followup()` 自建唤醒（dsh 的 `/loop` 就是这个模式，`docs/cookbook/extension-cookbook.md:108`）。

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

---

## 四、工具级（已验证可用，无缺口）

| 能力 | 实测结果 | 证据 |
|---|---|---|
| bundle 作为第三方 bundle 分发 | 通过 | `dsh plugin --profile headless add ../dsh-coordinator` 后 `dsh.profile.bundles` 含 `dsh-coordinator` |
| `ctx.tools.register` | 通过 | 模型调用 `init_project` 成功，目标目录生成 `AGENTS.md`（4307 字节，含受管区块） |
| `ctx.skills.registerProvider` | 通过 | `ctx.skills.list()` 返回 `coordinator-mode` 与 `init-project`，provider `dsh-coordinator`，source `bundled` |
| 免凭据跑真实会话 | 通过 | dsh 自带 mock LLM server（`packages/test-support/llm-mock-server`）+ `DEEPSEEK_BASE_URL` 覆盖 |
| 包名子路径解析 | 通过 | `exports` 映射 `"./src/host": "./src/host/index.js"`；ESM 不支持目录索引，必须指到文件 |

---

## 五、待验证

- **完成唤醒**（P1 核心）：`turn/end` → `followup()` 是否能在 subagent 完成后可靠唤醒父会话，未实测。
- **worktree 隔离**：team 明确不提供 worktree；`dsh-experimental-worktree` 是否能接入编排约定，未实测。
- **右栏看板**（P2）：`ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` slot 的实际接线，未实测。
- **真实模型下的协议遵循**：本轮用 mock 触发的工具调用验证了工具通路，未验证模型在真实推理下是否按协议层派工。
