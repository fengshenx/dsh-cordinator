# 开发实例与 worktree 封装

**状态**：implemented（2026-10-29）
**范围**：`scripts/dev.mjs`、`scripts/dev-plan.mjs`、`scripts/worktree-spawn.mjs`、`scripts/worktree-common.mjs`、`package.json`、`.gitignore`、`README.md`、`AGENTS.md`

## 背景

原来的 `dev` 脚本是 `npm run build:client && dsh plugin --profile web add "$PWD" && dsh web`。它做对了一件事——让插件指向当前目录——但有两处会在并行开发时出事：

- `plugin add` 改的是 `~/.dsh/profiles/web`，也就是**用户日常的那个 profile**。几个 worktree 先后跑 `npm run dev`，后跑的把先前那个覆盖掉；worktree 删了还留下悬空链接。
- `dsh web` 用默认 `DSH_HOME`，开发实例与日常实例共用会话、项目、卡片。协调者插件在这些数据上写（`projects.json`、`cards.json`、`workers.json`），混用会互相干扰，也会把调试产生的脏数据留在用户的项目里。

## 决策

**数据根落在工作树内**：`.dev/home`（gitignore 忽略）。会话、项目、卡片都在里面，删掉即重置，worktree 删掉时一起消失。

**profile 从源 HOME 派生，不重新安装**。`package.json` 照抄源 profile 的依赖与 `dsh.profile.bundles`（复现日常组合，否则「本地跑得起来、装进 profile 就坏」这类问题测不出来），只把 `dsh-coordinator` 的依赖换成 `link:<工作树>`，`bundles` 缺它就补上（源里没装过本插件时也能起）。

**`node_modules` 逐条符号链接到源 profile，只有插件本体指工作树**。依赖仍由源里那一份承担：源里升级 dsh 或增删插件，开发实例自动跟随。`dsh` 启动不校验 `package.json` 的 `link:` 路径与磁盘链接是否一致，所以这样造出来的 profile 能正常加载——实测过（见验证）。

**端口默认交给系统分配**（`--port 0`），启动日志打印带 token 的 URL；要固定就 `DEV_PORT`。不按 worktree 名算固定端口：算出来撞车时只能重试或报错，而自动分配没有失败路径。

**`worktree-spawn` 对齐仓库既有约定**：目录 `.worktrees/<任务名>`、分支 `feature/<任务名>`、base 取最新 `origin/main`（取不到降级本地 main）、幂等守卫（目录或分支已存在就拒绝）、失败回滚（`worktree remove --force` + 删本次建的分支）。依赖不重装，符号链接主 checkout 的 `node_modules`——本仓依赖只有 esbuild 与 minidenticons，代价是改 `package.json` 要在主 checkout 安装。

**`npm run check` 的语法检查扩到 `scripts/` 与 `build/`**。原来只查 `index.js` 与 `src/**/*.js`，新增的 `.mjs` 脚本就落在门禁外面。

**AGENTS.md 存在，是为了让这些宿主约束在下一个会话里可见**。「宿主 API 按 `engines.dsh` 下限挑」这条规则是靠一次 `TypeError`（`definitions()` 在 0.2.1-rc.2 上不存在，落在 `agent/created` 上）换来的；它必须写在新会话一定会读的地方，而不是埋在 `/tmp` 或某次对话里。结构参照 Telov 的 AGENTS.md：核心铁律 → 按任务查阅 → 目录 → 常用命令 → 测试 → 风格 → 宿主契约 → 提交与 PR，每条自包含或一行断言加链接。

## 验证

- `npm run check`：417 例全绿（新增 `tests/dev-plan.test.js` 9 例、`tests/worktree-common.test.js` 3 例）。`npm run build:client` 通过。
- 双向验证：把 `planNodeModules` 的插件链接改成指向源 profile → 「node_modules 逐条链到源，只有插件本体指工作树」红；还原后全绿。
- 真机（`dsh 0.2.1-rc.2`，隔离实例）：`npm run dev` 一条命令起实例，页面项目区与输入框都在；数据根只有 `profiles/ sessions/ storages/`；`profiles/web/node_modules/dsh-coordinator` 指向工作树，其余条目指向源 profile。
- 重复运行幂等：第二次 `npm run dev` 复用现有 profile，`DEV_PORT=5877` 生效。
- **代码即生效**：临时把 `project-section.js` 的标题改成「项目·工作树」，`npm run dev` 后页面读到新文案，确认加载的是工作树当前代码而非某个装好的旧版本；改回后 `git diff` 无残留。

## 边界

- **源 profile 是前置条件**：`~/.dsh/profiles/web` 必须已存在且装过一次本插件（或用 `DSH_HOME_SOURCE` 指向别的 HOME），否则脚本报错退出并给出命令。
- **依赖共享意味着写共享**：在 worktree 里跑 `npm install` 会落到主 checkout。本仓依赖极少，约定是依赖变更回主 checkout 做。
- **并行实例共享源 `node_modules` 的只读假设**：多个 worktree 的 dev 实例同时跑时，读的是同一份依赖；只要没人往源 profile 装包就安全。
- **Windows 未实测**：符号链接用 `junction`（对目录有效），文件型条目未覆盖到。
- **客户端改动要重跑 `npm run dev` 或 `npm run build:client`**：没有 watch。
