/**
 * 通用任务队列服务
 * 支持按类型注册处理器，单任务串行执行，提供互斥锁保证
 */

import logger from './logger'

class TaskQueueService {
  constructor() {
    /** @type {{ type: string, handler: Function }[]} */
    this._handlers = new Map()
    /** @type {{ id: string, type: string, payload: any, resolve: Function, reject: Function }[]} */
    this._queue = []
    this._running = false
    this._currentTask = null
  }

  /**
   * 注册任务处理器
   * @param {string} type - 任务类型标识
   * @param {(task: { id: string, payload: any }) => Promise<any>} handler - 处理函数
   */
  registerHandler(type, handler) {
    if (this._handlers.has(type)) {
      logger.warn(`[TaskQueue] 覆盖已注册的处理器: ${type}`)
    }
    this._handlers.set(type, handler)
    logger.info(`[TaskQueue] 已注册处理器: ${type}`)
  }

  /**
   * 入队任务
   * @param {{ id: string, type: string, payload: any }} task
   * @returns {Promise<any>}
   */
  enqueue(task) {
    const { id, type, payload } = task
    if (!this._handlers.has(type)) {
      logger.warn(`[TaskQueue] 未注册的处理器类型: ${type}`)
      return Promise.reject(new Error(`未注册的处理器类型: ${type}`))
    }

    return new Promise((resolve, reject) => {
      this._queue.push({ id, type, payload, resolve, reject })
      logger.debug(`[TaskQueue] 任务入队: ${type}#${id}, 队列长度: ${this._queue.length}`)
      this._processNext()
    })
  }

  /**
   * 处理下一个任务（互斥保证同时只有一个任务执行）
   */
  async _processNext() {
    if (this._running) return

    const nextTask = this._queue.shift()
    if (!nextTask) return

    this._running = true
    this._currentTask = nextTask

    const handler = this._handlers.get(nextTask.type)
    if (!handler) {
      logger.error(`[TaskQueue] 任务处理失败: 未找到处理器 ${nextTask.type}`)
      nextTask.reject(new Error(`未找到处理器: ${nextTask.type}`))
      this._running = false
      this._processNext()
      return
    }

    try {
      logger.info(`[TaskQueue] 开始处理: ${nextTask.type}#${nextTask.id}`)
      const result = await handler({ id: nextTask.id, payload: nextTask.payload })
      nextTask.resolve(result)
      logger.info(`[TaskQueue] 处理完成: ${nextTask.type}#${nextTask.id}`)
    } catch (error) {
      logger.error(`[TaskQueue] 处理失败: ${nextTask.type}#${nextTask.id}`, error.message)
      nextTask.reject(error)
    } finally {
      this._running = false
      this._currentTask = null
      // 继续处理下一个任务
      this._processNext()
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      running: this._running,
      queueLength: this._queue.length,
      currentTask: this._currentTask ? {
        id: this._currentTask.id,
        type: this._currentTask.type
      } : null,
      registeredHandlers: Array.from(this._handlers.keys())
    }
  }

  /**
   * 清空等待队列（不影响正在执行的任务）
   */
  clearQueue() {
    const count = this._queue.length
    this._queue.forEach(task => {
      task.reject(new Error('队列已清空'))
    })
    this._queue = []
    logger.info(`[TaskQueue] 队列已清空，丢弃 ${count} 个任务`)
  }
}

// 单例导出
const taskQueueService = new TaskQueueService()
export default taskQueueService
export { taskQueueService }
