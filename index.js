/**
 * dsh-coordinator bundle 入口。
 *
 * bundle 只贡献一层插件配置（cordis.patch.yml），真正的实现从 src/host 载入。
 *
 * @module dsh-coordinator
 */

export const name = 'dsh-coordinator'

export { apply } from './src/host/index.js'
