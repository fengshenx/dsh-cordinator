/**
 * 槽位会话的保留生命周期。
 *
 * 保留（`ctx.sessions.retain`）的副作用正是让宿主不回收该会话，释放是它唯一
 * 的解除方式。配对必须严格：多释放一次会让宿主引用计数错位，少释放一次就永久
 * 持有会话（宿主侧表现为会话回收不掉）。
 *
 * 这里把生命周期从 React 里拆出来，是为了能对配对关系直接断言——面板组件只负责
 * 把状态读数交给宿主，保留与释放的账本由本模块记。
 *
 * @module dsh-coordinator/client/slot-retain
 */

/**
 * 槽位会话保留器。
 */
export class SlotRetention {
  /**
   * @param {object} options - 选项
   * @param {(sessionId: string) => object} options.retain - 保留一个会话，返回带
   *   `ready` 与 `release` 的引用
   * @param {(sessionId: string, state: object) => void} options.onState - 读到会话
   *   快照时的回调
   * @param {(sessionId: string) => void} options.onDrop - 会话不再被保留时的回调
   */
  constructor({ retain, onState, onDrop }) {
    this.retain = retain
    this.onState = onState
    this.onDrop = onDrop
    /** @type {Map<string, { reference: object, unsubscribe?: () => void }>} */
    this.entries = new Map()
  }

  /**
   * 同步保留集合：保留新出现的、释放不再需要的。
   *
   * 释放先于保留——顺序反了会在同一轮里短暂多持有一个会话。
   *
   * @param {Iterable<string>} needed - 当前需要的会话 id
   */
  sync(needed) {
    for (const [sessionId, entry] of this.entries) {
      if (needed.has(sessionId)) continue
      this.drop(sessionId, entry)
    }
    for (const sessionId of needed) {
      if (this.entries.has(sessionId)) continue
      this.hold(sessionId)
    }
  }

  /**
   * 保留一个会话。
   *
   * 宿主不认识这个会话 id 时同步抛错——状态保持未知，不谎称空闲。
   *
   * @param {string} sessionId - 会话 id
   */
  hold(sessionId) {
    let reference
    try {
      reference = this.retain(sessionId)
    } catch {
      // 宿主不认识这个会话 id：状态保持未知，不谎称空闲
      return
    }
    const entry = { reference, unsubscribe: undefined }
    this.entries.set(sessionId, entry)
    reference.ready
      .then((binding) => {
        // 保留期间该槽位被撤掉：会话已被释放，不再订阅它的快照
        if (this.entries.get(sessionId) !== entry) return
        const read = () => {
          const snapshot = binding.session.getSnapshot()
          this.onState(sessionId, {
            running: snapshot.running === true,
            failed: typeof snapshot.lastAgentError === 'string' && snapshot.lastAgentError !== '',
          })
        }
        read()
        entry.unsubscribe = binding.session.subscribe(read)
      })
      .catch(() => {
        // 保留失败：状态表里不出现这一项，槽位显示为未知
      })
  }

  /**
   * 释放一个会话。
   *
   * @param {string} sessionId - 会话 id
   * @param {object} [entry] - 该会话的记录，缺省时取当前记录
   */
  drop(sessionId, entry = this.entries.get(sessionId)) {
    if (entry === undefined) return
    if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId)
    entry.unsubscribe?.()
    entry.reference.release()
    this.onDrop(sessionId)
  }

  /**
   * 释放全部保留的会话。
   *
   * 不回调 `onDrop`：面板卸载后没有状态可更新，回调只会徒增一次无用的渲染。
   */
  dispose() {
    for (const entry of this.entries.values()) {
      entry.unsubscribe?.()
      entry.reference.release()
    }
    this.entries.clear()
  }
}
