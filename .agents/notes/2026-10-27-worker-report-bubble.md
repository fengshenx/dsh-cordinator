# worker 回报气泡的呈现

**状态**：implemented（2026-10-27）
**范围**：`src/shared/worker-report.js`、`src/host/message.js`、`src/host/dispatch.js`、`src/client/worker-report-*.js`、`src/client/index.js`、`tests/worker-report.test.js`

## 背景

worker 完成的完成通知此前是一条普通用户消息，正文带「【worker 回报】」前缀，在会话里渲染成右对齐的用户气泡。它读起来像用户自己在说话，而且气泡里混着一段协议口吻的前缀。

Telov 的做法是：worker 回报用**助手侧的形态**渲染——身份头（头像 + 名字）在气泡上方单独一行，气泡左对齐、带 1px 边框、中性底；正文里没有前缀（Telov 那边是视图层把信封句式 `你收到来自子代理「X」的回信：` 剥掉的）。

## 决策

**说话人标记放在 `source`，不放正文**。通知消息的 `source` 用自定义 kind `dsh-coordinator/worker-report`，带 `worker: { label, childSessionId }` 与通用契约的 `form: 'notice'` + `summary`。

- 正文是模型读的事实，前缀会同时污染模型上下文与用户界面；`source` 是宿主的归属字段，链路上原样透传。
- 宿主对 `source` 的唯一硬约束是「kind 是非空字符串」，自定义 kind 原样落进 `session.v4.jsonl`、重启后原样读回；宿主自己就有十几个这样的 kind（`agent-message`、`subagent-settled`、`webhook`、`goal`、`team-message` …），这是它预留的扩展位而不是越界。
- `form: 'notice'` + `summary` 是宿主给所有生产者的通用契约：万一本仓的渲染接管失败、降级成官方上下文行时，折叠行显示的是「任务「X」已结束。」而不是一个原始 kind 字符串。

**前缀在生成侧去掉，不靠「注入前缀再视图层剥离」**。Telov 走剥离路线是因为它的信封句式由别处生成；本仓的通知正文是自己拼的，直接不写前缀更省一层，也不会有解析失败时的兜底分支。

**新增独立 Chat node kind，用 exclusive claim 接管这类消息**（`src/client/worker-report-definition.js`）。

- 路径 A（抢占 `conversation.chat.node` 的 `user` key）会接管**所有**会话的所有用户消息，要完整复刻官方用户渲染器（右对齐布局、正文渲染、actions 行、pending/echo 态）——风险过大，否决。
- 路径 B（DOM 后处理）不可行：DOM 上没有 source / messageId / role，识别不出插件注入的消息，且 React 会覆盖外部 DOM 修改，否决。
- 路径 C：注册独立 kind 的 `ConversationNodeDefinition`，`match` 只认带本仓 source 标记的 `user/message`，返回 `exclusive: true`；再按 kind 注册 keyed renderer。影响面只有 worker 回报这一类消息，普通用户气泡零影响。宿主提供的官方样板是 `packages/client/ui-user-questions/src/client/question-reply.ts`（它同样接管一条官方也会匹配的 `user/message`）。

**`groupTree` 必须给 `'input'`**。这是本轮踩到的真问题：节点建好后渲染出来却**看不见**——宿主把「回合内、答案之前」的节点归进回合的**过程折叠区**并默认隐藏（`data-turn-process-hidden="true"` + `hidden="until-found"`）。判定看 `isAtOrOutside(node, 'turn')`，没有 `groupTree` 的节点一律落入过程区。官方给注入型消息（`waking`）的 `groupTree` 就是 `'input'`，本仓照抄。

**头像用 `minidenticons`（Telov 同款），种子取 worker 的身份名**。FNV-1a 哈希取模落到 63 个内置 seed，同名恒同图；底色与图案同色相、底色明度压到 36% 以过非文本 3:1 基线。种子必须用身份名（派工 label）而不是显示文案：显示文案由任务描述派生、随任务变，用它做种子同一 worker 会跨任务换脸。

## 边界

- **回报不进会话标题、turn 摘要与 markdown 转录导出**：宿主只把 `source.kind === 'user'` 的消息算作真人输入。这是自定义 kind 的代价，换来的是它不会被误当成用户说的话。
- **历史消息不追溯**：改造前发出的通知在 session log 里就是普通用户消息，重放时仍是老形态（右对齐、无头像）。
- **降级形态**：本仓的定义没注册上（或宿主改了 claim 语义）时，这条消息退化成官方渲染——因为 source 不是 `'user'`，它会渲染成上下文注入行，而不是右对齐的用户气泡；内容不会丢。
- **深色主题未实测**：气泡底色用 `--dsw-alias-bg-layer-1`，浅色主题下是白底；深色主题下的对比度没有实际截图验证。
- 客户端 bundle 多了唯一运行时依赖 `minidenticons`（纯 JS、无传递依赖），打进产物约 30 KB。

## 证据

- 单测 269 例全绿（新增 `tests/worker-report.test.js` 7 例：source 构造与逐层判型、正文取文本、通知正文无前缀、头像种子确定性与分布、节点定义只认带标记的消息、视图节点字段含 `groupTree: 'input'`）。
- 真实实例（隔离 mock profile + mock LLM）：协调者真实派工，worker 收工后通知注入父会话；session log 里该条 `user/message` 的 `source.kind` 为 `dsh-coordinator/worker-report`、正文无前缀；界面上出现带头像与「mock worker」名字的左侧气泡，用户自己的输入仍是右侧气泡，console 无报错。
