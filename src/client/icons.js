/**
 * 宿主图标复用。
 *
 * 宿主把全部产品图标放在一个全局 sprite 里（每个字形一个
 * `<symbol id="dsh-icon-<字形>-<字重>">`）。第三方 bundle 与宿主同处一个页面，
 * 直接 `<use>` 引用即可：不必复制路径数据，也自动跟随主题的图标替换。
 *
 * @module dsh-coordinator/client/icons
 */

import { createElement } from 'react'

/**
 * 造一个引用宿主 sprite 的图标元素。
 * @param {string} glyph - 字形名，如 `folder-close`
 * @param {object} [options] - 选项
 * @param {string} [options.weight] - 字重，默认 `regular`
 * @param {number} [options.size] - 边长，默认 16
 * @returns {object} React 元素
 */
export function productIcon(glyph, options = {}) {
  const { weight = 'regular', size = 16 } = options
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      'aria-hidden': 'true',
      focusable: 'false',
      style: { flex: 'none', display: 'block' },
    },
    createElement('use', { href: `#dsw-icon-${glyph}-${weight}` }),
  )
}
