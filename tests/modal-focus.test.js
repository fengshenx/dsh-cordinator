import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  escapeAction,
  isKeyboardEventBlocked,
  nextFocusTarget,
  pickInitialFocus,
} from '../src/client/modal-focus.js'

/**
 * 造一个键盘事件。
 * @param {object} [overrides] - 覆盖字段
 * @returns {object} 键盘事件
 */
function keyEvent(overrides = {}) {
  return {
    key: 'Tab',
    shiftKey: false,
    repeat: false,
    defaultPrevented: false,
    isComposing: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
  }
}

test('初始焦点优先取标记元素，其次第一个可聚焦元素，都没有则取容器', () => {
  const root = { id: 'root' }
  const marked = { id: 'marked' }
  const focusable = { id: 'focusable' }
  const query = (element, selector) => {
    if (element !== root) return null
    if (selector === '[data-modal-autofocus]') return marked
    if (selector.includes('button')) return focusable
    return null
  }
  assert.equal(pickInitialFocus(root, query), marked)
  const withoutMarked = (element, selector) => (selector.includes('button') ? focusable : null)
  assert.equal(pickInitialFocus(root, withoutMarked), focusable)
  assert.equal(pickInitialFocus(root, () => null), root)
})

test('Tab 到最后一个元素时绕回第一个', () => {
  const first = { id: 'first' }
  const middle = { id: 'middle' }
  const last = { id: 'last' }
  const items = [first, middle, last]
  const result = nextFocusTarget(items, last, false)
  assert.equal(result.target, first)
  assert.equal(result.preventDefault, true)
})

test('Shift+Tab 到第一个元素时绕回最后一个', () => {
  const first = { id: 'first' }
  const last = { id: 'last' }
  const items = [first, last]
  const result = nextFocusTarget(items, first, true)
  assert.equal(result.target, last)
  assert.equal(result.preventDefault, true)
})

test('焦点在中间时不干预，交给浏览器默认移动', () => {
  const first = { id: 'first' }
  const middle = { id: 'middle' }
  const last = { id: 'last' }
  const items = [first, middle, last]
  const result = nextFocusTarget(items, middle, false)
  assert.equal(result.target, null)
  assert.equal(result.preventDefault, false)
})

test('焦点不在可聚焦元素里时收进边缘', () => {
  const first = { id: 'first' }
  const last = { id: 'last' }
  const items = [first, last]
  assert.equal(nextFocusTarget(items, null, false).target, first)
  assert.equal(nextFocusTarget(items, { id: 'outside' }, false).target, first)
  assert.equal(nextFocusTarget(items, { id: 'outside' }, true).target, last)
})

test('没有可聚焦元素时落到兜底元素并阻止默认行为', () => {
  const fallback = { id: 'dialog' }
  const result = nextFocusTarget([], null, false, fallback)
  assert.equal(result.target, fallback)
  assert.equal(result.preventDefault, true)
})

test('组合输入与修饰键的按键不被浮层处理', () => {
  assert.equal(isKeyboardEventBlocked(keyEvent({ isComposing: true })), true)
  assert.equal(isKeyboardEventBlocked(keyEvent({ ctrlKey: true })), true)
  assert.equal(isKeyboardEventBlocked(keyEvent({ altKey: true })), true)
  assert.equal(isKeyboardEventBlocked(keyEvent({ metaKey: true })), true)
  assert.equal(isKeyboardEventBlocked(keyEvent({ defaultPrevented: true })), true)
  assert.equal(isKeyboardEventBlocked(keyEvent()), false)
})

test('Escape 关闭浮层，长按只阻止默认行为，Shift+Escape 不处理', () => {
  assert.equal(escapeAction(keyEvent({ key: 'Escape' })), 'close')
  assert.equal(escapeAction(keyEvent({ key: 'Escape', repeat: true })), 'prevent-only')
  assert.equal(escapeAction(keyEvent({ key: 'Escape', shiftKey: true })), 'ignore')
  assert.equal(escapeAction(keyEvent({ key: 'Enter' })), 'ignore')
})
