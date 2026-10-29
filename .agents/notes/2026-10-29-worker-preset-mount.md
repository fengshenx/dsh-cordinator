# worker 必须自己挂 agent preset，否则没有 bash / read

## 现象

合并 #17 / #19 之后，在 dsh-coordinator 项目里派出的 worker 打开后没有任何内建工具：没有 `bash`，没有 `read`，任务里的 `pwd` 都跑不了。协调者会话正常。

## 根因

宿主的工具面分两层：全局注册的工具 + **agent preset 组合**里的工具。`bash` / `read` / `write` 这些内建件属于后者（`packages/bundle/web-app/presets/standard.patch.yml` 逐条挂 `tool-bash`、`tool-read`），而挂 preset 只发生在 `sessionController.create()` 的 `composeAgent()` 里（`presets.resolve(id)` → `setup: agentCtx => presets.mount(agentCtx, resolvedId)`）。

本 bundle 的 worker 为了常驻、可下钻、冷恢复，直接走 `agents.create({ sessionId })`——它接受 `setup`，但不会自己解析或挂 preset。于是 worker 的作用域里只有全局工具，内建工具全缺。

#17 把**协调者**建会话改走 `sessionController.create`（预生成 id 先登记身份），协调者因此拿到了 preset；worker 与「没有 `sessionController` 时建协调者」的回退路径没跟着改，问题就露在 worker 上。

## 修法

新增 `src/host/agent-preset.js`，导出 `agentPresetSetup(ctx)`：有 `agentPresets` 服务时返回 `{ setup: agentCtx => presets.mount(agentCtx) }`，没有时返回空对象（headless / sdk 组合本来就没有 preset 层，不该让会话建不出来）。

三处调用点都摊上：

- `worker-sessions.spawn()`：建 worker 时传 `setup`；
- `worker-sessions.send()` 的冷恢复分支：`agents.resume()` 建的是新作用域，preset 不会自己回来，同样传 `setup`；
- `projects/service.js` 的 `createCoordinatorSessionWithCtx()` 回退路径（没有 `sessionController` 的 profile）：同样传 `setup`。

省略 preset id 用宿主 `defaultId`：本 bundle 建的会话不换 preset，冷恢复也用默认即可，不去读会话投影里记的 id。

## 验证

- 单测 440 → 443：worker 建会话挂 preset、没有 preset 服务时不传 `setup`、冷恢复也挂 preset、协调者回退路径挂 preset。
- 双向验证三条，撤掉对应调用点各使 1–2 例变红，还原后全绿。
- 未做真机复验：需要 web profile 实例派一次工，看 worker 的工具面里有没有 `bash` / `read`。

## 遗留

- 用户若在 UI 里给 worker 换过 preset，冷恢复会落回默认 preset（`agents.resume` 的 `setup` 拿不到会话投影里的 id）。本 bundle 不提供换 preset 的入口，暂不处理；将来若要支持，从 `agentPresets.presetForSession()` 读。
- 这类「绕开官方建会话路径就要自己补组合」的缺口都记在 `docs/capability-gaps.md` 第 38 条。
