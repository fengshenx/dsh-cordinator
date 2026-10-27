# worker 回报的投递边界与时机

**状态**：implemented（2026-10-27）
**范围**：`src/host/dispatch.js`、`src/host/index.js`、`src/shared/worker-report.js`、`tests/dispatch.test.js`

## 背景

用户要求 worker 回报**走下一个 turn**，并且**不要显示在宿主输入框上方的「消息队列」里**。

查证宿主机制（`packages/core/agent-loop/src/agent.ts` 与 `packages/core/agent-loop/src/inbox.ts`）：

- 宿主 agent 的所有投递都经 `inbox.splice(target, …)`，inbox 只有两个边界：`next-turn` 与 `next-step`。
- `followup` = `send(input, 'next-turn', true)`；`steer` = `send(input, 'next-step', true)`；`inject` = `send(input, 'next-step', false)`。
- 输入框上方的「消息队列」面板（`ui-conversation` 的 `QueueDock`）读 `useProjection('inbox')` 的 **`next-turn` 队列**——`next-turn` 队列里未被消费的消息会显示在那里。
- `inbox.claim(target, turn)` 在**每个 step 开始时**都会取走整个 `next-step` 队列；`next-turn` 只在 turn 边界取一条。
- inbox 投影由 `api-session-controller` 的客户端从事件流重建，第三方没有插过滤位——想让消息不进面板，只能让它不进 `next-turn` 队列，**或者在它被消费前根本别投**。

## 决策

**完成通知走 `next-turn` 边界（`followup`），且只在父会话空闲时投递。**

两条要求各自对应一处事实：

- **走下一个 turn**：通知是「下一个 turn 的一次输入」，语义上就该排进下一轮，而不是插进协调者当前这一步里（`steer` 的 `next-step` 语义是打断）。
- **不在消息队列显示**：协调者正忙时把通知投进 `next-turn`，它会以「一条待发消息」的形态挂在宿主的面板上——那是用户的输入队列，不是后台通知该待的地方。改为忙时**不投**：通知留在落盘队列（`notifications.json`），进程内的等待表记着它，每 500ms 轮询父会话状态；检测到 `agent.status === 'idle'` 才投。投递即被消费，队列面板不会看到它。唤醒时机与排进 `next-turn` 几乎一样（两者都要等当前 turn 结束）。

## 实现要点

- 等待表 `waiting` 按父会话分组，存 `{ notification, agent }`——**必须记住 agent 活对象**：空闲检测没有第二个入口能拿到它（`ctx.get('sessionController')` 在部分组合下拿不到），只存通知会让通知永远投不出去。
- 投递前先查通知还在不在落盘队列里：父会话重新打开时补投通道（`redeliverPending`）可能已经投过同一条，重复投会让协调者收到两遍。
- 连续自动续行上限只在**真正投递时**计数：等待期间不消耗额度。
- 空闲检测的定时器 `unref()`，不拖住进程退出；通知仍在落盘队列里，重启后补投。插件卸载时（`ctx.on('dispose')`）停掉定时器。

## 边界

- **「消息队列」在 web 端始终没能复现出来**：三个变体（自定义 kind + `steer` / 自定义 kind + `followup` / 旧形态 `kind='user'` + `followup`）在协调者 busy 的窗口里，Chat 与 Trajectory 两个页签都没有任何队列面板元素（`[data-queue-dock]` 不存在，全页也没有含「队列/入队/排队」的元素）。所以「消息队列」具体指哪个界面仍未确认；本改动是按机制做的收口（不让消息在未消费时待在 `next-turn` 队列里），不宣称已复现该现象。
- Trajectory 里 worker 回报归类为 `CONTEXT` 行（宿主按 `source.kind` 分类，与投递边界无关）。若用户指的是这个，改投递边界无效。
- 等待中的通知在崩溃后由落盘队列兜住：重启、父会话重新打开时补投。
- 若宿主未来给 agent 换掉 `followup`，投递会抛错并被 `deliverNow` 的 catch 兜住：通知留在落盘队列等待补投（不会丢）。

## 证据

- 单测 279 例全绿，其中「父会话正忙时通知先留队，空闲后自动投递」覆盖等待与投递两段。
- 真实实例（隔离 mock profile + mock LLM，协调者 turn 里故意 sleep 8 秒造出 busy 窗口）：通知在第 1 秒到达并留在落盘队列（`lastError: 父会话正忙，等待空闲后投递`），期间页面无任何队列面板元素；第 8.8 秒父会话转空闲后自动投递，气泡出现、落盘队列清空。console 无报错。
