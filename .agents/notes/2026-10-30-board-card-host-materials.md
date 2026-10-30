# 看板卡面改用宿主卡片材质

**状态**：implemented（P6，2026-10-30）
**范围**：`src/client/board-styles.js`

## 背景

[看板卡片视觉与交互](2026-10-27-board-card-visual-and-interaction.md) 定的卡面是「无边框无阴影、静态零装饰、hover 只出背景」。那一版解决的是信息结构与交互，视觉上把卡片做成了纯文字列表：卡与卡之间只有 6px 空隙，卡面与右栏背景同色，读完一段不知道它到哪结束。用户第二次指认「Card 的样式设计还是丑」，要求复用 dsh 自己的 design token。

宿主已经有成文的卡片材质，不需要自己发明数值：

- `docs/ui-radius.zh.md` 的「设置卡片材质」：`--dsw-radius-*` 圆角 + `0.5px solid var(--dsw-alias-settings-card-stroke)` + `var(--dsw-alias-settings-card-fill)`。
- `docs/web-styling.zh.md` 的层级规则：高层级表面 `border: 0` 加 `--dsw-elevation-*`，发丝描边画在 `box-shadow` 第一层；中性 `--dsw-alias-border-*` 的 border 与 elevation 投影**不得**同时出现（ui-theme 的 elevation spec 会拒绝）。
- 同类的实现：`packages/experimental/client-ui-agent-team` 的成员卡（sidebar 内多行状态卡）与 `packages/client/ui-sidebar-files` 的浮起树。

## 决策

**卡面走宿主行内卡片材质：`bg-layer-2` 底 + `elevation-stroke` 发丝描边**。`border: 0`，描边在 `box-shadow` 里，通过重绑 `--dsw-elevation-stroke-color` 换档而不是叠一层真 border——与宿主成员卡同一套机制，也就自动接受了「border 与 elevation 不得配对」这条约束。hover 时描边升一档并把投影升到 `--dsw-elevation-panel`。

**静态描边取 `border-l3`，比宿主成员卡的 `l2` 深一档**。成员卡浮在带模糊的菜单面上，`l2` 够用；看板卡直接在浅色 sidebar 底上独自立着，`l2` 在 1x 屏读不出边界。

**圆角取 `--dsw-radius-md`（12px）**。按 `ui-radius.zh.md` 的用途表，这是「标准控件或单行 cell」一档；看板卡是 sidebar 密集列表里的多行卡，既不是 R20 的独立内容卡片，也不该用树节点那种 8px。

**成品卡（done）不加材质**。完成的卡不需要抢注意力：透明行 + hover 出背景，与带卡面的 active 卡靠对比形成主次，而不是靠更浅的描边。

**编号与时间用 `--dsw-alias-label-caption`，不再叠 `opacity`**。alpha 与语义色叠加出来的颜色不属于任何一档 token，换主题时对不上；宿主把「比 tertiary 更弱」这件事本身做成了 token。

**链接 chip 用宿主的「可点击产物链接」示能**：`--dsw-alias-link` 着色 + `font-weight: 500` + 默认无下划线 + hover 时点状下划线（3px offset），外面套 `0.5px` 发丝线 + `--dsw-radius-sm` 的壳把它和卡面分开。原来的 `1px solid` 胶囊壳 + `opacity: 0.8` 同时违背发丝线宽度与「不叠 alpha」两条。

**焦点环走 `--dsw-focus-ring-*` 与内嵌 offset**。宿主 `focus.css` 提供颜色与 2px 宽度；卡面在被裁切的滚动容器里，外扩环会被切掉，所以 `outline-offset: -2px`（宿主对密集内容的同一取舍）。

**全圆与胶囊配对 `corner-shape: round`**。宿主 `corner-shape.css` 给所有圆角面套 superellipse(1.5)，`50%` 与 `999px` 若不退出会被压成方角。信号点、槽位点、`done-count`、详情页状态胶囊都补了这条。

**所有 `:hover` 规则包进 `@media (hover: hover)`**。触屏上 `:hover` 会被点按粘住；这是宿主样式规范的硬要求。

## 边界

- **视觉只保证结构对齐宿主，不保证像素一致**：宿主调 `--dsw-radius-*`、`elevation` 或色阶时本仓自动跟随，这正是复用 token 的目的；但卡面的行列结构、缩进（22px）、字号（13/11px）仍是本仓自己的数值，宿主不会替我们改。
- **`hover` 与焦点环未截图取证**：共享浏览器 Tab 没有悬停动作，两条都由 CSS 规则与宿主 spec 保证，未做渲染截图。浅色、深色、done 展开三种状态已真机截图。
- **1x 屏描边更淡**：0.5px 在 2x 屏渲染为一物理像素，1x 屏是混合值——宿主对自己的发丝线是同一取舍。
- **卡面根仍是 `role="button"` 且内嵌可聚焦控件**：ARIA 冲突与上一版一致，本次不动。

## 证据

隔离实例（`dsh 0.2.1-rc.2`，即 `engines.dsh` 下限）：`projects.json` 与 `cards.json` 直接 seed 出 3 张 active + 2 张 done，看板在右栏渲染；浅色与深色主题各截一张，done 折叠区展开截一张。改前（透明列表）与改后（卡面材质）取自同一会话的同一批卡片。`npm run check` 501 例全绿。截图不入库。
