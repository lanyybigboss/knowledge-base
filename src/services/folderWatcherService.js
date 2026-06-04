/**
 * 文件夹监控服务
 * 通过统一 API 层与后端通信（Vite 插件 | Electron IPC）
 */

import logger from './logger'
import apiService from './apiService'

export const watcherService = {
  /**
   * 启动监控指定文件夹
   * @param {string|string[]} folderPath - 单路径或路径数组
   */
  async start(folderPath) {
    return apiService.watcherStart(folderPath)
  },

  /**
   * 停止所有监控
   */
  async stop() {
    return apiService.watcherStop()
  },

  /**
   * 获取合并监控状态
   */
  async getStatus() {
    return apiService.watcherStatus()
  },

  /**
   * 获取所有监控目录文件列表
   */
  async getFiles() {
    return apiService.watcherFiles()
  },

  /**
   * 添加单个监控文件夹
   * @param {string} folderPath
   */
  async addFolder(folderPath) {
    return apiService.watcherAdd(folderPath)
  },

  /**
   * 移除单个监控文件夹
   * @param {string} folderPath
   */
  async removeFolder(folderPath) {
    return apiService.watcherRemove(folderPath)
  },

  /**
   * 定时轮询状态
   */
  pollStatus(callback, interval = 3000) {
    const poll = async () => {
      try {
        const status = await this.getStatus()
        callback(status)
      } catch (e) {
        // ignore polling errors
      }
    }
    poll()
    const timer = setInterval(poll, interval)
    return () => clearInterval(timer)
  },

  /**
   * 获取待处理的 Strm 文件列表
   */
  async getPendingFiles() {
    try {
      return await apiService.getPendingStrmFiles()
    } catch (e) {
      logger.warn('[Watcher] 获取待处理列表失败:', e.message)
      return { success: false, files: [] }
    }
  },

  /**
   * 标记 Strm 文件已处理
   */
  async markProcessed(strmFileName) {
    try {
      return await apiService.markStrmProcessed(strmFileName)
    } catch (e) {
      logger.warn('[Watcher] 标记处理失败:', e.message)
      return { success: false }
    }
  },

  /**
   * 读取原始文件内容
   */
  async readOriginalFile(filePath) {
    try {
      return await apiService.readOriginalFile(filePath)
    } catch (e) {
      logger.warn('[Watcher] 读取原始文件失败:', e.message)
      return { success: false }
    }
  },

  /**
   * 启动自动处理待处理的 Strm 文件
   * @param {function} processor - 处理函数，接收 (strmFileName, originalFilePath)，返回 true 表示处理成功
   * @param {number} interval - 轮询间隔（毫秒）
   * @returns {function} 停止函数
   */
  startAutoProcessing(processor, interval = 5000) {
    const process = async () => {
      try {
        const result = await this.getPendingFiles()
        if (result.success && result.files && result.files.length > 0) {
          for (const file of result.files) {
            logger.info(`[Strm 自动处理] 开始处理: ${file.strmFileName}`)
            try {
              const ok = await processor(file.strmFileName, file.originalFilePath, file.strmFilePath || '', file.isObsidianNote || false)
              if (ok) {
                await this.markProcessed(file.strmFileName)
                logger.info(`[Strm 自动处理] ✅ 已完成: ${file.strmFileName}`)
              }
            } catch (e) {
              logger.error(`[Strm 自动处理] ❌ 处理失败 ${file.strmFileName}:`, e.message)
            }
          }
        }
      } catch (e) {
        // ignore polling errors
      }
    }
    process()
    const timer = setInterval(process, interval)
    return () => clearInterval(timer)
  }
}

export default watcherService
