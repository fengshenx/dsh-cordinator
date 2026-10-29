# 删除项目工具与卡片检查点，看板收紧到协调者会话

## 背景

三项功能在模型侧没有真实收益，一项可见性过宽：

1. 项目注册表有五个模型工具（`list_projects` / `add_project` / `switch_project` / `remove_project` / `init_project`），但左栏「项目」区块已经承担了全部增删改查；`switch_project` 只返回协调者会话 id，模型自己不能导航；`remove_project` 是没有二次确认的破坏性操作。
2. `init_project` 本质是把 `skills/init-project/references/conventions.md` 并入目标项目 `AGENTS.md` 的受管区块，纯文本操作，不需要工具。
3. `create_card` / `update_card` 的 `checkpoint` 字段（summary / nextAction / blocker / outputVersion）没有真实消费方：协议层不依赖它，`outputVersion` 在 UI 与代码里都不比对。
4. 项目归属按「会话 cwd 的 realpath 等于项目目录」判定，于是项目目录对应工作区里的普通会话、worker 会话都能在右栏看到项目卡片，用户要求看板只属于协调者。

## 决策

### 项目注册表只经 UI

模型不再有项目工具；建项目、切换、注销、换协调者都在左栏「项目」区块完成。协议层相应改写：模型不能声称能注册或切换项目。`spawn_worker` 的拒绝文案改成引导用户去左栏区块。

目录选择器不可用（宿主缺 web-app 的导航服务）时无法建项目，需要换用 web profile——这是一条显式限制，不保留工具兜底。

### 初始化改为纯 skill

`skills/init-project/SKILL.md` 不再调用工具：读 `references/conventions.md`，用宿主的文件编辑能力把正文并入 `AGENTS.md` 的受管区块（标记仍是 `dsh-coordinator:conventions:start/end`），重复执行只替换区块。受管区块的语义从代码搬到 skill 文本，幂等靠「替换同标记区块」保证。

### 删除 checkpoint

卡片只保留标题、规格、状态、链接、槽位绑定与 `revision`。`revision` 的乐观并发（`expectedRevision`）不动——它解决的是并发写冲突，与检查点无关。

已落盘卡片里的 `checkpoint` 字段不迁移：读取时原样保留但无消费者，下一次实质更新落盘时删掉（不为清理单独 bump revision）。

### 看板收紧到协调者会话

`resolveProjectOfSession` 的返回值补 `coordinatorSessionId`（卡片归属仍按 cwd 判定，worker 建的卡不丢归属）。客户端用它做两层收紧：

- 看板面板：非协调者会话不取卡、不保留槽位会话，只显示「看板只在项目协调者会话中打开」。
- 建卡监视器：屏幕会话不是项目协调者时不建立基线、不弹看板。

**宿主限制**：右栏 tab 类型与「开始」页的引导入口是全局静态注册，没有按会话过滤的扩展点。所以「看板」入口本身对所有会话可见，能收紧的只有自动弹出与面板内容。想在结构上消除入口需要宿主提供条件注册能力。

## 取舍

- 项目工具删除后，headless / 终端场景没有模型侧的建项目入口，只能靠 UI。接受：项目是编排语境，没有 UI 时本来也没有「协调者会话」可打开。
- 入口仍全局可见，用户可能在普通会话点开看板看到提示。接受：提示明确，比让项目卡片漏给执行者安全。
- checkpoint 的「任务事实」职责回归卡片 `spec` 与 `list_cards` 单卡查询；协议层只要求卡片保存稳定需求与当前调度摘要。
