/**
 * 给 `agents.create` / `agents.resume` 补上 agent preset 的组合层。
 *
 * 宿主把内建工具挂在 agent preset 的组合里（`web-app/presets/standard.patch.yml`
 * 逐条挂 `tool-bash`、`tool-read`、`tool-write` 等），而挂载只发生在
 * `sessionController.create`（`composeAgent()` → `agentPresets.mount(agentCtx, id)`）。
 * 直接走 `agents.create` 的会话不挂 preset，工具面里就只剩全局注册的工具，
 * bash / read 这些全没有。worker 是根会话，必须自己挂一次。
 *
 * 没有 `agentPresets` 服务的组合（headless / sdk）返回空对象：这类 profile 本
 * 就没有 preset 组合，退化到宿主默认即可，不该让会话建不出来。
 *
 * @module dsh-coordinator/host/agent-preset
 */

/**
 * 造传给 `agents.create` / `agents.resume` 的 setup 片段。
 *
 * 省略 preset id 用宿主的默认 preset：本 bundle 建的会话不换 preset，冷恢复
 * 也用默认即可，不用去翻会话投影里记的 id。
 *
 * @param {object} ctx - Cordis 上下文
 * @returns {{ setup?: (agentCtx: object) => Promise<void> }} setup 片段
 */
export function agentPresetSetup(ctx) {
  const presets = ctx.get('agentPresets')
  // 下限 rc.2 就有 `agentPresets.mount(ctx, id?)`；这里的类型判是给被部署替换
  // 掉的组合留退化路径，不是版本探测。
  if (presets === undefined || typeof presets.mount !== 'function') return {}
  return {
    setup: async (agentCtx) => {
      await presets.mount(agentCtx)
    },
  }
}
