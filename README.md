# dsh-coordinator

DeepSeek Harness 的协调者/执行者编排 bundle。把 Telov 的多 Agent 编排协议层移植到 dsh：协议 skill、项目初始化工具、后台派工与完成唤醒、任务看板卡片，以及后续阶段的交付看板 UI。

当前状态：**P3（骨架 + 协议层 + 初始化 + 派工唤醒 + 卡片存储与卡片工具 + 右栏看板 UI + 项目注册表与左栏项目区块 + 角色槽位注入）**。信号灯投影与卡片按项目分区待做。

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
| 项目工具 | `src/host/tools/projects.js` | `list_projects` / `add_project` / `switch_project` / `remove_project`：列项目、注册项目、切项目、注销项目 |
| 项目存储与服务 | `src/host/projects/` | 项目注册表（`projects.json`）与项目服务：建项目连带建协调者会话并绑定，失败整体回滚 |
| 项目通道 | `src/host/projects/remote.js` | 浏览器侧 → 宿主侧的 Typert 远程通道（命名空间 `projects`，走官方 `/api` 共享通道） |
| 会话归属 | `src/host/projects/session-index.js` | 按 realpath 把会话归到项目目录，得出「项目 → 会话」映射 |
| 角色槽位 | `src/host/slots/` | 读项目目录的 `SLOTS.md`，按卡片 `slots` 字段绑定到会话，作为运行时上下文注入 |
| skill provider | `src/host/skills.js` | 把 bundle 内的 skill 注册进 `ctx.skills`，让模型能通过 dsh 的 `skill` 工具发现与加载 |
| 右栏看板 Tab | `src/client/index.js` | 浏览器侧注册「看板」Tab 类型与面板主体 |
| 看板面板 | `src/client/board.js` | 订阅本会话事件窗口，重放卡片投影还原看板 |
| 左栏项目区块 | `src/client/project-panel.js` | 左栏「项目」区块：在「自动化任务」之下、工作区之上（DOM 注入取位），加项目、打开协调者会话、换新协调者、注销项目 |
| 项目树 | `src/client/project-section.js` | 点标题折叠/展开整个项目列表，点项目行展开/收起该项目目录下的会话（协调者不在其中，worker 会话带执行者标记）；项目名后面不跟路径 |
| 产品图标 | `src/client/icons.js` | 内联图标路径（宿主 web 端运行时没有 sprite，`<use>` 引用必然落空） |
| 官方树排除 | `src/client/workspace-exclusion.js` | 把项目下的会话从官方工作区树里隐藏（渲染层，官方数据层不动） |

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
| 列项目 / 注册项目 / 切项目 / 注销项目 | `list_projects` / `add_project` / `switch_project` / `remove_project` | 本 bundle |

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
6. **管理项目**：项目是显式注册的实体，不是目录。`add_project` 在目标目录里建好协调者会话并与项目绑定，`list_projects` 列出全部项目，`switch_project` 给出目标项目的协调者会话 id，`remove_project` 注销项目（协调者会话保留）。浏览器左栏有「项目」区块（在「自动化任务」之下、工作区之上）：点标题「项目」收起或展开整个列表，点项目行展开或收起该目录下的会话（协调者不在其中），行的「更多」菜单里是打开协调者会话、重命名、换新协调者、注销项目。项目名后面不跟路径（悬停可见）。这些会话不再出现在官方工作区树里。
7. **配角色槽位**：在项目目录写 `SLOTS.md`，按 `## <槽位名>` 分节写角色的工作方法与人设；在卡片的 `slots` 字段把槽位名绑到会话 id，该会话每轮 turn 都会注入对应槽位正文，改动 `SLOTS.md` 在下一轮 turn 生效。槽位只贡献提示词文本，不授予工具权限。

协议层也随 bundle 分发到 `skills/` 下；项目内若自行放置 `.agents/skills/coordinator-mode/`，项目副本优先（dsh 的 skill 发现按来源层级取优）。

## 协议层从 Telov 搬来了什么

保留的是编排纪律与方法学内核，删掉的是 Telov 仓库专有内容：

- **保留**：任务接力顺序、事件调度与卡片检查点、传话纪律（首轮简报只给边界与验收、不抄已落盘正文）、验收裁决条件、进展说明口径、并行与串行的划分原则。
- **改写**：Telov 的 15 个兄弟专项技能（`telov-how`/`telov-why`/`telov-architect` 等）替换为方法表——保留「什么情况下用什么方法」，去掉 Telov 专有技能依赖；Telov 的工具名（`SpawnWorker`/`MessageWorker`/`CreateCard` 等）落到 dsh 侧的真实工具（见上表），协议层写明对应关系与差异。
- **删除**：指向 Telov 仓库文档的链接（`docs/architecture.md`、治理文档、e2e 取证文档）、pstack 对照表、审查 bot 分诊——这些属于 Telov 的仓库治理，不通用。

## 已知限制

- **后台编排只适用于长驻组合**（web / desktop / sdk）。headless 是一次性 CLI，会话在 turn 结束后即被销毁，届时没有载体接收完成通知——这是宿主语义，不是本 bundle 的缺陷。
- **看板只覆盖当前会话**。卡片数据随会话事件持久化，看板重放本会话的投影——别的会话建的卡不会出现在这里。面板会主动加载该会话的完整历史（会话事件按页加载，最多翻 20 页；到顶会标注「仅显示已加载的历史片段」）。信号灯（停滞判定）尚未实现。
- **项目区块靠 DOM 注入取位**。dsh 的左栏正文区只有 `sidebar.workspaces` 一个槽且已被宿主占用，slot 机制没有包装能力，第三方插不进并列区块——本仓在左栏的「面板列表 nav」之后插容器并用 portal 渲染，位置是「自动化任务之下、工作区之上」；宿主结构变化导致找不到锚点时内容退回原槽，功能不受影响。
- **项目树是自建的，与官方工作区树并存**。官方只有按工作区分组的会话树，没有「项目」维度。本仓的项目树按目录挂会话（协调者不在子列表里，worker 会话带执行者标记），归属由宿主按 realpath 判定后下发。
- **「项目会话不出现在官方工作区树」是渲染层排除，不是数据层**。官方没有按外部集合排除行的扩展点，本仓认 `data-row-key="session:<id>"` 给命中排除集的行加隐藏类。代价：官方分组行上的会话计数仍包含被隐藏的会话；被隐藏的行仍在 DOM 里，官方搜索仍能命中。
- **子目录里的会话不算项目下的会话**。归属按会话 cwd 与项目目录的 realpath 精确相等判定；两个项目指向同一目录时先注册的归属。
- **图标数据与宿主 `artwork.ts` 耦合**。宿主 web 端把图标在构建期内联进产物，运行时 DOM 里没有 sprite 节点，第三方 bundle 在运行时渲染只能自己带路径数据——本仓内联的路径取自宿主 `dsh-client-ui-primitives` 的 `artwork.ts`（regular 字重），宿主改图标时本仓要同步。
- **卡片编号是全局的**。卡片不按项目分区，编号跨项目不复用也不分区——将来若要求按项目编号，需迁移存量卡片。
- **不能新增 session event 类型**：dsh 要求仓外事件带 `ignorable` 标记且不进读路径，因此卡片与通知状态走自有落盘文件。
- **浏览器侧 → 宿主侧走 Typert 远程通道**（命名空间 `projects`，经官方 `/api` 共享通道）。dsh 的 `connection.rpc.handle` 对仓外插件不可用（注册作用域拿不到 `webServer`），`/api` 又被官方 gateway 占用；Typert 的 SRC 回退通道允许第三方按协议形状注册服务，但代价是**手写的协议形状与宿主版本耦合**——本仓对齐宿主 `0.2.1-rc.2`（标记属性名、`version:1` 描述符、`typertRemote` 绑定字段、方法形参即 wire 字段名），宿主改契约时本仓要同步改。远程方法名还要避开官方命名空间服务的保留字（撞名会让整个命名空间挂不上）。

## 开发

```sh
npm test           # node --test，零依赖
npm run check      # 语法检查 + 测试
npm run build:client  # 构建浏览器侧产物 lib/client.js（esbuild）
```

浏览器侧产物不入库（`.gitignore` 忽略 `lib/`），发布时由 `prepublishOnly` 重建。`cordis.patch.yml` 的插件行名必须是**纯包名**——写成子路径，浏览器侧定位不到包 manifest，宿主便不下发 client bundle。

协议层的相对链接完整性由测试守住——搬动文件后链接断裂会直接测试失败。
