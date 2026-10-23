# dsh-coordinator

DeepSeek Harness 的协调者/执行者编排 bundle。把 Telov 的多 Agent 编排协议层移植到 dsh：协议 skill、项目初始化工具、后台派工与完成唤醒、任务看板卡片，以及后续阶段的交付看板 UI。

当前状态：**P2（骨架 + 协议层 + 初始化 + 派工唤醒 + 卡片存储与卡片工具 + 右栏看板 UI）**。信号灯投影与角色槽位待做。

## 组成

| 部件 | 位置 | 说明 |
|---|---|---|
| 协议层 skill | `skills/coordinator-mode/` | `SKILL.md` + 4 个 playbook + 2 份参考：派工、接力、事件调度、卡片检查点、传话纪律、验收裁决、进度说明 |
| 初始化 skill | `skills/init-project/` | 一次性把仓库工程约定写入目标项目 |
| `init_project` 工具 | `src/host/tools/init-project.js` | 写入 AGENTS.md 受管区块，幂等 |
| `spawn_worker` 工具 | `src/host/tools/spawn-worker.js` | 把任务派给后台 worker，**立即返回**子会话 id，不等结果 |
| 派工与唤醒 | `src/host/dispatch.js` | 建子会话、收终态、落盘完成通知、唤醒父会话开新 turn |
| 通知落盘队列 | `src/host/notification-store.js` | 完成通知先写盘再唤醒；投递失败留队，父会话重开时补投 |
| 卡片工具 | `src/host/tools/cards.js` | `create_card` / `update_card` / `list_cards`：建卡、改卡、查卡 |
| 卡片存储 | `src/host/cards/store.js` | 卡片落盘与领域规则：编号不复用、revision 乐观并发、归档终态、检查点由宿主补写 |
| skill provider | `src/host/skills.js` | 把 bundle 内的 skill 注册进 `ctx.skills`，让模型能通过 dsh 的 `skill` 工具发现与加载 |
| 右栏看板 Tab | `src/client/index.js` | 浏览器侧注册「看板」Tab 类型与面板主体 |
| 看板面板 | `src/client/board.js` | 订阅本会话事件窗口，重放卡片投影还原看板 |

bundle **零运行时依赖**：只用 Node 内置模块与 Cordis 注入的 `ctx`，不 peer 依赖任何 dsh 内部包——避免宿主解析失败导致整个 bundle 加载失败。

## 编排动作与工具

| 动作 | 工具 | 来源 |
|---|---|---|
| 派工给后台 worker | `spawn_worker` | 本 bundle |
| 查执行者名录 | `list_agents` | dsh 原生（`agent_id` 即子会话 id） |
| 给执行者传话 | `send_message` | dsh 原生 |
| 中止执行者当前回合 | `interrupt_agent` | dsh 原生 |
| 读 worker 回报 | 完成通知 | 本 bundle 的唤醒器 |
| 建卡 / 改卡 / 查卡 | `create_card` / `update_card` / `list_cards` | 本 bundle |
| 写入仓库工程约定 | `init_project` | 本 bundle |

dsh 另有一套同名的同伴模型工具（`tool-agent-team`，experimental，base bundle 未启用），按 teammate 名字寻址，与本流程的子会话不是同一批，不要混用。

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
3. **派工**：调用 `spawn_worker`，参数 `task` 必填、`label` 可选。工具立即返回子会话 id；worker 结束后，协调者会被自动唤醒，收到一条「【worker 回报】」完成通知（任务、子会话、状态、产物摘要、下一步）。
4. **记任务事实**：调用 `create_card` 建卡（`title` 必填），`update_card` 改卡（`id` 必填，改内容带 `expectedRevision` 做乐观并发），`list_cards` 查卡（默认不含归档卡）。卡片落盘在 `$DSH_HOME/dsh-coordinator/cards.json`，编号全局递增不复用。
5. **看交付看板**：浏览器右栏打开「看板」Tab。卡片不另存一份——卡片工具把卡片结构投影到 `tool/result` 事件的 `meta` 上，与 session log 一起持久化；面板重放本会话的投影还原看板。因此**卡片要在同一个会话里产生**才会出现在该会话的看板上。

协议层也随 bundle 分发到 `skills/` 下；项目内若自行放置 `.agents/skills/coordinator-mode/`，项目副本优先（dsh 的 skill 发现按来源层级取优）。

## 协议层从 Telov 搬来了什么

保留的是编排纪律与方法学内核，删掉的是 Telov 仓库专有内容：

- **保留**：任务接力顺序、事件调度与卡片检查点、传话纪律（首轮简报只给边界与验收、不抄已落盘正文）、验收裁决条件、进展说明口径、并行与串行的划分原则。
- **改写**：Telov 的 15 个兄弟专项技能（`telov-how`/`telov-why`/`telov-architect` 等）替换为方法表——保留「什么情况下用什么方法」，去掉 Telov 专有技能依赖；Telov 的工具名（`SpawnWorker`/`MessageWorker`/`CreateCard` 等）落到 dsh 侧的真实工具（见上表），协议层写明对应关系与差异。
- **删除**：指向 Telov 仓库文档的链接（`docs/architecture.md`、治理文档、e2e 取证文档）、pstack 对照表、审查 bot 分诊——这些属于 Telov 的仓库治理，不通用。

## 已知限制

- **后台编排只适用于长驻组合**（web / desktop / sdk）。headless 是一次性 CLI，会话在 turn 结束后即被销毁，届时没有载体接收完成通知——这是宿主语义，不是本 bundle 的缺陷。
- **看板只覆盖当前会话**。卡片数据随会话事件持久化，看板重放本会话的投影——别的会话建的卡不会出现在这里。信号灯（停滞判定）尚未实现。
- **角色槽位尚未实现**（P3）。协议层现在用通用方法描述代替槽位指派。
- **卡片编号是全局的**。P2 没有项目实体，编号跨项目不复用也不分区——将来若引入项目并要求按项目编号，需迁移存量卡片。
- **不能新增 session event 类型**：dsh 要求仓外事件带 `ignorable` 标记且不进读路径，因此卡片与通知状态走自有落盘文件。

## 开发

```sh
npm test           # node --test，零依赖
npm run check      # 语法检查 + 测试
npm run build:client  # 构建浏览器侧产物 lib/client.js（esbuild）
```

浏览器侧产物不入库（`.gitignore` 忽略 `lib/`），发布时由 `prepublishOnly` 重建。`cordis.patch.yml` 的插件行名必须是**纯包名**——写成子路径，浏览器侧定位不到包 manifest，宿主便不下发 client bundle。

协议层的相对链接完整性由测试守住——搬动文件后链接断裂会直接测试失败。
