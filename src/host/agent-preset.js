/**
 * 给 `agents.create` / `agents.resume` 补上 agent preset 的组合层。
 *
 * 宿主把内建工具挂在 agent preset 的组合里（`web-app/presets/standard.patch.yml`
 * 逐条挂 `tool-bash`、`tool-pwsh`、`tool-fs`、`tool-fs-search` 等；`read` /
 * `write` 是 `tool-fs` 提供的工具名），而挂载只发生在 `sessionController` 的
 * `composeAgent()`（创建与 resume 都走它）。直接走 `agents.create` 的会话不挂
 * preset，工具面里就只剩全局注册的工具，bash / read 这些全没有。
 *
 * 没有 `agentPresets` 服务的组合（headless / sdk）返回空对象并记一行日志：
 * 这类 profile 本就没有 preset 组合，退化合理，但得让人在日志里看见。
 * 服务在却缺方法属于宿主契约变化，直接抛错——静默退化会让 worker 再次没有
 * bash / read，正是本模块要修的故障形态。
 *
 * @module dsh-coordinator/host/agent-preset
 */

/**
 * 写一条退化日志：优先用调用方给的 logger，其次用宿主上下文自带的。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {((message: string) => void) | undefined} logger - 调用方的日志函数
 * @param {string} message - 日志正文
 * @returns {void}
 */
function warn(ctx, logger, message) {
  if (typeof logger === 'function') {
    logger(message)
    return
  }
  ctx.logger?.warn?.(message)
}

/**
 * 取 agent preset 服务，缺方法时报错。
 *
 * @param {object} ctx - Cordis 上下文
 * @returns {object | undefined} preset 服务；组合里没有时 undefined
 */
function requirePresets(ctx) {
  const presets = ctx.get('agentPresets')
  if (presets === undefined) return undefined
  if (typeof presets.mount !== 'function' || typeof presets.resolve !== 'function') {
    throw new Error('dsh-coordinator: agentPresets 服务缺少 mount() / resolve()，宿主契约已变；为会话挂 preset 失败会让它没有 bash / read')
  }
  return presets
}

/**
 * 造新建会话要用的 preset 片段。
 *
 * 除了 `setup` 还回 preset id：宿主的 `meta.agentPreset` 是公开字段，
 * `sessionController` 建会话时就写它、resume 时从投影读回。不写的话这些会话的
 * preset 投影永远是空的，UI 与 `presetForSession()` 都读不到东西。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {((message: string) => void)} [logger] - 日志输出
 * @returns {Promise<{ agentPreset?: string, setup?: (agentCtx: object) => Promise<void> }>} preset 片段
 */
export async function agentPresetOptions(ctx, logger) {
  const presets = requirePresets(ctx)
  if (presets === undefined) {
    warn(ctx, logger, 'dsh-coordinator: 当前组合没有 agentPresets 服务，新建的会话不会挂 preset 组合（bash / read 等内建工具缺失）')
    return {}
  }
  const preset = await presets.resolve(undefined)
  return {
    agentPreset: preset.id,
    setup: async (agentCtx) => {
      await presets.mount(agentCtx, preset.id)
    },
  }
}

/**
 * 造冷恢复要用的 preset 片段。
 *
 * 冷恢复建的是新作用域，preset 组合不会自己回来。这里按会话投影里记的 preset
 * 挂（建会话时写进 `meta.agentPreset`，resume 时宿主也照它重建），旧会话没有
 * 记录时省略 id 用宿主的默认 preset。
 *
 * @param {object} ctx - Cordis 上下文
 * @param {((message: string) => void)} [logger] - 日志输出
 * @returns {{ setup?: (agentCtx: object, agent: object) => Promise<void> }} preset 片段
 */
export function agentPresetResumeSetup(ctx, logger) {
  const presets = requirePresets(ctx)
  if (presets === undefined) {
    warn(ctx, logger, 'dsh-coordinator: 当前组合没有 agentPresets 服务，冷恢复的会话不会挂 preset 组合（bash / read 等内建工具缺失）')
    return {}
  }
  return {
    setup: async (agentCtx, agent) => {
      const recorded = typeof presets.presetForSession === 'function'
        ? presets.presetForSession(agent.session)
        : undefined
      await presets.mount(agentCtx, recorded)
    },
  }
}
