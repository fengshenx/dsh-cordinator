/**
 * 构建客户端半边产物。
 *
 * 宿主按 closure-factory 约定加载 `lib/client.js`：工厂把自己的 require 交给
 * 产物，产物用它解析宿主提供的模块行。dsh 自带的 `clientBundle` 预设绑定仓内
 * 多个模块，第三方仓无法直接引用，因此这里用 esbuild 复刻那一层封装：
 * 产物体是 CJS，banner 注册工厂并注入 require，footer 交回 exports。
 *
 * 外部模块（宿主模块表里的行）保持 import，由工厂的 require 解析；其余依赖
 * 打进产物。React 等宿主 baseline 模块在 `dsh.client.external` 声明的清单里。
 */

import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/**
 * 宿主模块表里的行：产物不打包它们，运行时由工厂的 require 解析。
 * @returns {Promise<string[]>} 外部模块说明符
 */
async function readExternals() {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  return manifest.dsh?.client?.external ?? []
}

const id = 'dsh-coordinator'
const external = await readExternals()

await build({
  entryPoints: [join(root, 'src/client/index.js')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external,
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'warning',
})
