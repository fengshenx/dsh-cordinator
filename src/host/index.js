/**
 * dsh-coordinator 的宿主侧插件。
 *
 * 贡献两件事：bundle 内置 skill 的发现（协议层），以及项目初始化工具。
 * 客户端侧（交付看板）属于后续阶段，此处不注册。
 *
 * @module dsh-coordinator/host
 */

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createSkillProvider } from './skills.js'
import { createInitProjectTool } from './tools/init-project.js'

const here = dirname(fileURLToPath(import.meta.url))

/** bundle 根目录（src/host 的上两级）。 */
const bundleRoot = join(here, '..', '..')

export const name = 'dsh-coordinator-host'
export const inject = ['skills', 'tools']

/**
 * 挂载本 bundle 的能力。
 * @param {object} ctx - Cordis 上下文
 * @returns {void}
 */
export function apply(ctx) {
  ctx.skills.registerProvider(() =>
    createSkillProvider({
      skillsRoot: join(bundleRoot, 'skills'),
      providerName: 'dsh-coordinator',
    }),
  )

  ctx.tools.register(
    createInitProjectTool({
      conventionsPath: join(bundleRoot, 'skills', 'init-project', 'references', 'conventions.md'),
    }),
  )
}
