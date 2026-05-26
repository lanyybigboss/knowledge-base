/**
 * 知识库管理系统 - 统一 API 服务层
 * 自动检测运行环境（Vite 开发 | Electron 生产），提供一致的接口
 */

import logger from './logger'

// 检测当前运行环境
const isElectron = typeof window !== 'undefined' && !!window.electronAPI
const API_BASE = '' // Vite 开发模式下使用相对路径

/**
 * 统一的请求封装
 */
async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(error.error || `请求失败: ${res.status}`)
  }
  return res.json()
}

export const apiService = {
  // ==================== 文件操作 ====================

  /**
   * 保存上传文件到本地
   */
  async saveUploadFile(fileName, content, isBase64 = false) {
    // Electron 环境：通过 IPC 调用
    if (isElectron) {
      return window.electronAPI.saveUploadFile({ fileName, content, isBase64 })
    }
    // Vite 开发环境：通过 HTTP API
    return request('/api/upload-file', {
      method: 'POST',
      body: JSON.stringify({ fileName, content, isBase64 })
    })
  },

  /**
   * 用系统默认程序打开文件
   */
  async openFile(filePath) {
    if (isElectron) {
      return window.electronAPI.openFile(filePath)
    }
    return request('/api/open-file', {
      method: 'POST',
      body: JSON.stringify({ filePath })
    })
  },

  /**
   * 在文件管理器中定位文件
   */
  async locateFile(filePath) {
    if (isElectron) {
      return window.electronAPI.locateFile(filePath)
    }
    return request('/api/locate-file', {
      method: 'POST',
      body: JSON.stringify({ filePath })
    })
  },

  // ==================== Strm 引用文件操作 ====================

  /**
   * 创建 .strm 引用文件
   * @param {string} strmFileName - 引用文件名（不含路径）
   * @param {string} originalFilePath - 原始文件绝对路径
   */
  async saveStrmFile(strmFileName, originalFilePath) {
    if (isElectron) {
      return window.electronAPI.saveStrmFile({ strmFileName, originalFilePath })
    }
    return request('/api/save-strm-file', {
      method: 'POST',
      body: JSON.stringify({ strmFileName, originalFilePath })
    })
  },

  /**
   * 读取 .strm 引用文件，获取原始文件路径
   * @param {string} strmFilePath - .strm 文件的路径
   */
  async readStrmFile(strmFilePath) {
    if (isElectron) {
      return window.electronAPI.readStrmFile(strmFilePath)
    }
    return request('/api/read-strm-file', {
      method: 'POST',
      body: JSON.stringify({ strmFilePath })
    })
  },

  /**
   * 删除 .strm 引用文件
   * @param {string} strmFilePath - .strm 文件的路径
   */
  async deleteStrmFile(strmFilePath) {
    if (isElectron) {
      return window.electronAPI.deleteStrmFile(strmFilePath)
    }
    return request('/api/delete-strm-file', {
      method: 'POST',
      body: JSON.stringify({ strmFilePath })
    })
  },

  /**
   * 打开文件夹
   */
  async openFolder(folderPath) {
    if (isElectron) {
      return window.electronAPI.openFolder(folderPath)
    }
    // Vite 开发环境下有限支持
    logger.warn('[apiService] openFolder 在 Vite 开发模式下不可用')
    return { success: false, error: '仅在 Electron 环境下支持' }
  },

  /**
   * 选择文件夹（弹出系统对话框）
   */
  async selectFolder() {
    if (isElectron) {
      return window.electronAPI.selectFolder()
    }
    // Vite 开发模式下不支持
    logger.warn('[apiService] selectFolder 在 Vite 开发模式下不可用')
    return null
  },

  // ==================== 存储信息 ====================

  /**
   * 获取存储目录信息
   */
  async getStorageInfo() {
    if (isElectron) {
      return window.electronAPI.getStorageInfo()
    }
    return request('/api/storage-info')
  },

  // ==================== 文件夹监控（多文件夹支持） ====================

  /**
   * 启动文件夹监控（支持单路径或路径数组）
   */
  async watcherStart(folderPath) {
    if (isElectron) {
      return window.electronAPI.watcherStart(folderPath)
    }
    const data = Array.isArray(folderPath) ? { paths: folderPath } : { path: folderPath }
    return request('/api/watcher/start', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  },

  /**
   * 停止所有文件夹监控
   */
  async watcherStop() {
    if (isElectron) {
      return window.electronAPI.watcherStop()
    }
    return request('/api/watcher/stop', { method: 'POST' })
  },

  /**
   * 获取监控状态（合并所有文件夹）
   */
  async watcherStatus() {
    if (isElectron) {
      return window.electronAPI.watcherStatus()
    }
    return request('/api/watcher/status')
  },

  /**
   * 获取所有监控目录文件列表
   */
  async watcherFiles() {
    if (isElectron) {
      return window.electronAPI.watcherFiles()
    }
    return request('/api/watcher/files')
  },

  /**
   * 添加单个监控文件夹
   */
  async watcherAdd(folderPath) {
    if (isElectron) {
      return window.electronAPI.watcherAdd(folderPath)
    }
    return request('/api/watcher/add', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath })
    })
  },

  /**
   * 移除单个监控文件夹
   */
  async watcherRemove(folderPath) {
    if (isElectron) {
      return window.electronAPI.watcherRemove(folderPath)
    }
    return request('/api/watcher/remove', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath })
    })
  },

  /**
   * 获取待处理的 Strm 文件列表
   */
  async getPendingStrmFiles() {
    if (isElectron) {
      return window.electronAPI.getPendingStrmFiles()
    }
    return request('/api/watcher/pending-files')
  },

  /**
   * 标记 Strm 文件已处理完成
   */
  async markStrmProcessed(strmFileName) {
    if (isElectron) {
      return window.electronAPI.markStrmProcessed(strmFileName)
    }
    return request('/api/watcher/mark-processed', {
      method: 'POST',
      body: JSON.stringify({ strmFileName })
    })
  },

  /**
   * 读取原始文件内容（按路径读取，返回 base64）
   */
  async readOriginalFile(filePath) {
    if (isElectron) {
      return window.electronAPI.readOriginalFile(filePath)
    }
    return request('/api/read-raw-file', {
      method: 'POST',
      body: JSON.stringify({ filePath })
    })
  },

  /**
   * 监听监控事件（仅 Electron）
   */
  onWatcherEvent(callback) {
    if (isElectron) {
      return window.electronAPI.onWatcherEvent(callback)
    }
    // Vite 开发模式下通过轮询实现
    logger.warn('[apiService] onWatcherEvent 在 Vite 开发模式下通过轮询模拟')
    return () => {} // 返回空清理函数
  },

  // ==================== 跨模式数据同步 ====================

  /**
   * 写入同步数据到共享文件
   */
  async syncWrite(data) {
    if (isElectron) {
      return window.electronAPI.syncWrite(data)
    }
    return request('/api/sync/write', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  },

  /**
   * 读取共享文件中的同步数据
   */
  async syncRead() {
    if (isElectron) {
      return window.electronAPI.syncRead()
    }
    return request('/api/sync/read')
  },

  /**
   * 获取共享文件的最后修改时间戳
   */
  async syncTimestamp() {
    if (isElectron) {
      return window.electronAPI.syncTimestamp()
    }
    return request('/api/sync/timestamp')
  },

  /**
   * 获取开机自启动状态（仅桌面应用模式有效）
   */
  async getAutoStart() {
    if (isElectron) {
      return window.electronAPI.getAutoStart()
    }
    return request('/api/auto-start/status')
  },

  /**
   * 设置开机自启动（仅桌面应用模式有效）
   */
  async setAutoStart(enabled) {
    if (isElectron) {
      return window.electronAPI.setAutoStart(enabled)
    }
    return request('/api/auto-start/set', {
      method: 'POST',
      body: JSON.stringify({ enabled })
    })
  }
}

export default apiService
