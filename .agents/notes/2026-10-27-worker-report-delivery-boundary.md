# worker 回报的投递边界

**状态**：implemented（2026-10-27）
**范围**：`src/host/dispatch.js`、`src/host/index.js`、`tests/dispatch.test.js`

## 背景

用户反馈：worker 回报在前端会显示在「消息队列」里，希望不显示。

查证宿主机制（`packages/core/agent-loop/src/agent.ts` 与 `packages/core/agent-loop/src/inbox.ts`）：

- 宿主 agent 的所有投递都经 `inbox.splice(target, …)`，inbox 只有两个边界：`next-turn` 与 `next-step`。
- `followup` = `send(input, 'next-turn', true)`；`steer` = `send(input, 'next-step', true)`；`inject` = `send(input, 'next-step', false)`。
- 输入框上方的「消息队列」面板（`ui-conversation` 的 `QueueDock`）读 `useProjection('inbox')` 的 **`next-turn` 队列**，`next-step` 的消息不进那个面板。
- `inbox.claim(target, turn)` 在**每个 step 开始时**都会取走整个 `next-step` 队列；`next-turn` 只在 turn 边界取一条。
- inbox 投影由 `api-session-controller` 的客户端从事件流重建，第三方没有插过滤位——想「不显示」只能让消息不进 `next-turn`。

## 决策

**完成通知投递从 `followup` 改成 `steer`**（投到 `next-step` 边界）。

- 不进 `next-turn` 队列 → 不进宿主的消息队列面板。
- 每个 step 开始就会被取走 → 协调者在**当前 turn 期间**就能收到回报，不必等 turn 结束。Telov 侧的 worker 回报本就是打断式的（协调者立刻知道），`steer` 与之对齐。
- `steer` 带唤醒标志：协调者当前 turn 结束后一定会开新 turn 把它取走，不会滞留。

## 边界

- **web 端没能复现出队列显示**：三个变体（自定义 source kind + `steer` / 自定义 kind + `followup` / 旧形态 `kind='user'` + `followup`）在协调者 busy 的窗口里，Chat 与 Trajectory 两个页签都没有任何队列面板元素（`[data-queue-dock]` 不存在，全页也没有含「队列/入队/排队」的元素）。所以「消息队列」具体指哪个界面尚未确认；本改动是按机制做的预防性收口，不宣称已复现该现象。
- Trajectory 里 worker 回报归类为 `CONTEXT` 行（宿主按 `source.kind` 分类，与投递边界无关）。若用户指的是这个，改投递边界无效。
- `steer` 会在协调者当前 turn 中途插入回报：协调者可能先处理回报，原步骤延后一步。这是打断式语义，与 Telov 一致。
- 若宿主未来给 agent 换掉 `steer`，投递会抛错并被 `deliver` 的 catch 兜住：通知留在落盘队列等待补投（不会丢）。

## 证据

- 单测 274 例全绿（`tests/dispatch.test.js` 的父 agent 假身改记 `steer` 调用）。
- 真实实例（隔离 mock profile + mock LLM，mock 里 worker 慢 8 秒、协调者某步慢 12 秒以造出 busy 窗口）：协调者 busy 期间 worker 回报到达并被消费，转录里气泡数 3 → 4；队列面板始终不存在；console 无报错。
