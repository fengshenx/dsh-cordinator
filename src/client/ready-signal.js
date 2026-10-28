/**
 * 一次性的就绪信号。
 *
 * 浏览器侧的若干服务由别的 bundle 提供，取到时可能还不是 `undefined`——插件的
 * 加载顺序不保证。订阅这类服务时，一次判空放弃等于永久失联：之后服务就绪也不会
 * 有人回头再试。把「已就绪」做成可订阅事件，订阅者拿到通知时再做真正的订阅。
 *
 * 状态放在闭包里而不是模块顶层：每个持有者一份，测试之间不会互相污染。
 *
 * @module dsh-coordinator/client/ready-signal
 */

/**
 * 造一个就绪信号。
 * @returns {object} 信号：`mark` / `isReady` / `subscribe`
 */
export function createReadySignal() {
  /** @type {Set<() => void>} 就绪订阅者 */
  const listeners = new Set()
  let ready = false

  return {
    /** 标记就绪并通知订阅者。重复标记只通知一次。 */
    mark() {
      if (ready) return
      ready = true
      for (const listener of listeners) listener()
    },

    /** @returns {boolean} 是否已就绪 */
    isReady() {
      return ready
    },

    /**
     * 订阅就绪。已就绪时用微任务补一次通知——调用方通常在同步代码里先判空再订阅，
     * 同步回调会在那次判空与订阅之间重入。
     *
     * @param {() => void} listener - 回调
     * @returns {() => void} 退订函数
     */
    subscribe(listener) {
      listeners.add(listener)
      if (ready) queueMicrotask(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
