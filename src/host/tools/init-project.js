/**
 * `init_project` 工具：把仓库工程约定写入目标项目。
 *
 * 约定正文由 bundle 内的 `skills/init-project/references/conventions.md` 提供，
 * 写入目标项目的 AGENTS.md 受管区块——dsh 读取 AGENTS.md 作为系统提示段落，
 * 因此写入即生效，且不会覆盖用户已有的其它约定。
 *
 * @module dsh-coordinator/host/tools/init-project
 */

import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const START_MARKER = '<!-- dsh-coordinator:conventions:start -->'
const END_MARKER = '<!-- dsh-coordinator:conventions:end -->'

/**
 * 组装受管区块正文。
 * @param {string} conventions - 约定正文
 * @returns {string} 完整区块
 */
function buildBlock(conventions) {
  return `${START_MARKER}\n${conventions.trim()}\n${END_MARKER}\n`
}

/**
 * 把约定正文并入已有 AGENTS.md 内容，替换旧受管区块或追加新块。
 * @param {string} existing - 已有文件内容
 * @param {string} conventions - 约定正文
 * @returns {string} 合并后的内容
 */
export function mergeConventions(existing, conventions) {
  const block = buildBlock(conventions)
  const start = existing.indexOf(START_MARKER)
  const end = existing.indexOf(END_MARKER)
  if (start !== -1 && end !== -1 && end > start) {
    return existing.slice(0, start) + block + existing.slice(end + END_MARKER.length + 1)
  }
  if (existing.trim() === '') return block
  return `${existing.trimEnd()}\n\n${block}`
}

/**
 * 创建 `init_project` 工具定义。
 * @param {object} options - 工具选项
 * @param {string} options.conventionsPath - 约定正文文件绝对路径
 * @returns {object} dsh 工具定义
 */
export function createInitProjectTool({ conventionsPath }) {
  return {
    name: 'init_project',
    description:
      '把本 bundle 提供的仓库工程约定写入目标项目的 AGENTS.md 受管区块。约定写入后由 dsh 的 AGENTS.md 段落机制读取并对模型生效。重复调用只替换受管区块，不动用户已有的其它内容。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目标项目目录的绝对路径。目录必须已存在。',
        },
        dryRun: {
          type: 'boolean',
          description: '只返回将要写入的内容，不实际落盘。',
        },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          updated: { type: 'boolean' },
          bytes: { type: 'number' },
          preview: { type: 'string' },
        },
        required: ['path', 'updated'],
      },
      render(args, value) {
        const result = /** @type {{ path: string, updated: boolean, bytes?: number, preview?: string }} */ (value)
        if (!result.updated) {
          return [{ type: 'text', text: `未写入（dry run）：${result.path}` }]
        }
        return [
          {
            type: 'text',
            text: `已写入工程约定：${result.path}（${result.bytes ?? 0} 字节）。约定已对模型生效。`,
          },
        ]
      },
    },
    async execute(args) {
      const input = /** @type {{ path: string, dryRun?: boolean }} */ (args)
      if (typeof input.path !== 'string' || input.path.trim() === '') {
        throw new Error('init_project: path 必须是目标项目目录的绝对路径')
      }
      // 入参 schema 在运行时不生效：dryRun 传字符串会让 `=== true` 落空，
      // 本该只预览的调用反而真的写文件。
      if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') {
        throw new Error('init_project: dryRun 必须是布尔值')
      }
      const directory = resolve(input.path)
      const info = await stat(directory).catch(() => undefined)
      if (info === undefined || !info.isDirectory()) {
        throw new Error(`init_project: 目标目录不存在或不是目录：${directory}`)
      }
      const conventions = await readFile(conventionsPath, 'utf8')
      const target = join(directory, 'AGENTS.md')
      const existing = await readFile(target, 'utf8').catch(() => '')
      const merged = mergeConventions(existing, conventions)
      if (input.dryRun === true) {
        return { path: target, updated: false, bytes: merged.length, preview: merged }
      }
      await writeFile(target, merged, 'utf8')
      return { path: target, updated: true, bytes: merged.length }
    },
  }
}
