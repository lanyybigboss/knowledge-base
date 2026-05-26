/**
 * 知识库管理系统 - 内置日志系统
 * 
 * 用法:
 *   import logger from '../services/logger'
 *   logger.info('用户点击了上传按钮')
 *   logger.error('文件解析失败', { fileName: 'test.pdf', error: err })
 *   logger.debug('API响应数据', responseData)
 * 
 * 日志存储: localStorage 持久化
 * 日志导出: 可通过 UI 导出为文本文件
 */

const LOG_LEVELS = {
  DEBUG: { priority: 0, label: 'DEBUG', color: '#808080' },
  INFO: { priority: 1, label: 'INFO', color: '#2196F3' },
  WARN: { priority: 2, label: 'WARN', color: '#FF9800' },
  ERROR: { priority: 3, label: 'ERROR', color: '#F44336' },
  FATAL: { priority: 4, label: 'FATAL', color: '#D32F2F' }
}

const MAX_LOG_COUNT = 500  // 最大保留日志条数
const STORAGE_KEY = 'kb_logs'

class LoggerService {
  constructor() {
    this.logs = []
    this.listeners = new Set()
    this._loadFromStorage()
  }

  /**
   * 添加日志监听器（用于 UI 实时显示）
   */
  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 通知所有监听器
   */
  _notify(logEntry) {
    this.listeners.forEach(fn => {
      try { fn(logEntry) } catch (e) { /* ignore */ }
    })
  }

  /**
   * 从 localStorage 恢复日志
   */
  _loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        this.logs = JSON.parse(stored)
      }
    } catch (e) {
      this.logs = []
    }
  }

  /**
   * 持久化日志到 localStorage
   */
  _saveToStorage() {
    try {
      // 只保留最近 N 条
      if (this.logs.length > MAX_LOG_COUNT) {
        this.logs = this.logs.slice(-MAX_LOG_COUNT)
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs))
    } catch (e) {
      // localStorage 可能满了，清理一半
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        this.logs = this.logs.slice(-Math.floor(MAX_LOG_COUNT / 2))
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs))
        } catch (e2) { /* ignore */ }
      }
    }
  }

  /**
   * 记录日志
   */
  _log(level, message, data = null) {
    const entry = {
      id: Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('zh-CN', { 
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }),
      level: level.label,
      levelColor: level.color,
      priority: level.priority,
      message,
      data: data ? (typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)) : null
    }

    this.logs.push(entry)
    this._saveToStorage()
    this._notify(entry)

    // 同时输出到控制台
    const prefix = `[${entry.time}] [${level.label}]`
    if (level.priority >= LOG_LEVELS.ERROR.priority) {
      console.error(prefix, message, data || '')
    } else if (level.priority >= LOG_LEVELS.WARN.priority) {
      console.warn(prefix, message, data || '')
    } else {
      console.log(prefix, message, data || '')
    }

    return entry
  }

  debug(message, data = null) {
    return this._log(LOG_LEVELS.DEBUG, message, data)
  }

  info(message, data = null) {
    return this._log(LOG_LEVELS.INFO, message, data)
  }

  warn(message, data = null) {
    return this._log(LOG_LEVELS.WARN, message, data)
  }

  error(message, data = null) {
    return this._log(LOG_LEVELS.ERROR, message, data)
  }

  fatal(message, data = null) {
    return this._log(LOG_LEVELS.FATAL, message, data)
  }

  /**
   * 获取所有日志
   */
  getAll() {
    return [...this.logs]
  }

  /**
   * 按级别过滤日志
   */
  getByLevel(level) {
    return this.logs.filter(l => l.level === level.toUpperCase())
  }

  /**
   * 获取最近 N 条日志
   */
  getRecent(count = 50) {
    return this.logs.slice(-count)
  }

  /**
   * 清空日志
   */
  clear() {
    this.logs = []
    localStorage.removeItem(STORAGE_KEY)
    this._notify({ type: 'clear' })
  }

  /**
   * 导出日志为文本
   */
  exportToText() {
    const header = '=== 知识库管理系统 日志导出 ===\n'
    const footer = `\n=== 共 ${this.logs.length} 条日志，导出时间: ${new Date().toLocaleString()} ===`
    
    const lines = this.logs.map(log => {
      let line = `[${log.time}] [${log.level}] ${log.message}`
      if (log.data) {
        line += `\n    └─ 数据: ${log.data}`
      }
      return line
    })

    return header + lines.join('\n') + footer
  }

  /**
   * 导出日志为 JSON
   */
  exportToJSON() {
    return JSON.stringify(this.logs, null, 2)
  }

  /**
   * 自动记录 React 错误
   */
  createReactErrorHandler() {
    return (error, errorInfo) => {
      this.error('React 渲染错误', {
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack
      })
    }
  }

  /**
   * 捕获未处理的 Promise 异常
   */
  setupGlobalCatch() {
    window.addEventListener('unhandledrejection', (event) => {
      this.error('未处理的 Promise 异常', {
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack
      })
    })

    window.addEventListener('error', (event) => {
      this.error('全局错误', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      })
    })
  }
}

// 单例导出
const logger = new LoggerService()

// 自动设置全局错误捕获
logger.setupGlobalCatch()

// 记录应用启动
logger.info('日志系统已初始化')
logger.info(`用户代理: ${navigator.userAgent}`)
logger.info(`应用运行环境: ${window.electronAPI ? 'Electron' : '浏览器'}`)
logger.info(`存储密钥可用: ${typeof localStorage !== 'undefined'}`)

export default logger
