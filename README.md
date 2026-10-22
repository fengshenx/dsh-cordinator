# dsh-coordinator

DeepSeek Harness 的协调者/执行者编排 bundle。把 Telov 的多 Agent 编排协议层移植到 dsh：协议 skill、项目初始化工具，以及后续阶段的交付看板。

当前状态：**P0（骨架 + 协议层 + 初始化）**。

## 组成

| 部件 | 位置 | 说明 |
|---|---|---|
| 协议层 skill | `skills/coordinator-mode/` | `SKILL.md` + 4 个 playbook + 2 份参考：派工、接力、事件调度、卡片检查点、传话纪律、验收裁决、进度说明 |
| 初始化 skill | `skills/init-project/` | 一次性把仓库工程约定写入目标项目 |
| `init_project` 工具 | `src/host/tools/init-project.js` | 写入 AGENTS.md 受管区块，幂等 |
| skill provider | `src/host/skills.js` | 把 bundle 内的 skill 注册进 `ctx.skills`，让模型能通过 dsh 的 `skill` 工具发现与加载 |

bundle **零运行时依赖**：只用 Node 内置模块与 Cordis 注入的 `ctx`，不 peer 依赖任何 dsh 内部包——避免宿主解析失败导致整个 bundle 加载失败。

## 安装

开发期用 profile link 安装（改代码即生效）：

```sh
dsh plugin --profile dev add ../dsh-coordinator
```

快速试跑（不装进 profile）：

```sh
cd /path/to/deepseek-harness
pnpm dsh web --patch ../dsh-coordinator/cordis.patch.yml
```

分发到 npm 后：

```sh
dsh plugin --profile dev add dsh-coordinator
```

`engines.dsh` 声明了支持的 dsh 版本范围；不满足时安装与启动会被拒绝——dsh 处于 developer preview，版本范围需随 dsh 跟进。

## 使用

1. **让模型加载协议层**：`skill` 工具会列出 `coordinator-mode`。协调者会话先读 `playbooks/program.md`，再按阶段读对应 playbook。
2. **初始化项目**：调用 `init_project`，参数 `path` 指向项目目录。约定写入项目的 `AGENTS.md` 受管区块，dsh 读取 `AGENTS.md` 作为系统提示段落，因此写入即对模型生效。重复调用只替换受管区块，不动项目已有内容。

协议层也随 bundle 分发到 `skills/` 下；项目内若自行放置 `.agents/skills/coordinator-mode/`，项目副本优先（dsh 的 skill 发现按来源层级取优）。

## 协议层从 Telov 搬来了什么

保留的是编排纪律与方法学内核，删掉的是 Telov 仓库专有内容：

- **保留**：任务接力顺序、事件调度与卡片检查点、传话纪律（首轮简报只给边界与验收、不抄已落盘正文）、验收裁决条件、进展说明口径、并行与串行的划分原则。
- **改写**：Telov 的 15 个兄弟专项技能（`telov-how`/`telov-why`/`telov-architect` 等）替换为方法表——保留「什么情况下用什么方法」，去掉 Telov 专有技能依赖；Telov 的工具名（`SpawnWorker`/`MessageWorker`/`CreateCard` 等）改为角色描述。
- **删除**：指向 Telov 仓库文档的链接（`docs/architecture.md`、治理文档、e2e 取证文档）、pstack 对照表、审查 bot 分诊——这些属于 Telov 的仓库治理，不通用。

## 已知限制

- **交付看板尚未实现**。协议层提到的卡片工具与右栏看板在 P2 交付；当前阶段协调者只能依赖 dsh 原生的执行者能力。
- **角色槽位尚未实现**（P3）。协议层现在用通用方法描述代替槽位指派。
- **dsh 的 `agent-team` 仍是 experimental**：单进程、单共享 checkout、无嵌套 team、无稳定性承诺。编排层若依赖它，风险随 dsh 版本变化。
- **不能新增 session event 类型**：dsh 要求仓外事件带 `ignorable` 标记且不进读路径，因此后续的卡片与项目状态只能走独立存储域 + session projection。

## 开发

```sh
npm test        # node --test，零依赖
npm run check   # 语法检查 + 测试
```

协议层的相对链接完整性由测试守住——搬动文件后链接断裂会直接测试失败。
