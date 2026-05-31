/**
 * 跨模式数据同步服务
 * 实现 Web（localhost:3000）和 Electron 桌面端数据共享
 * 
 * 同步机制：
 *   操作 → IndexedDB 写入 → 脏标记 → 定时检查(500ms)距上次推送≥2秒 → 推送全量数据
 *   另一端 5秒轮询检测 → 发现变更 → 拉取同步
 */

import storageService from './storageService'
import apiService from './apiService'
import logger from './logger'

class SyncService {
  constructor() {
    /** 本地数据是否有变更 */
    this._dirty = false
    /** 上次推送时间戳 */
    this._lastPushTime = 0
    /** 上次从远端拉取的 updatedAt */
    this._lastRemoteUpdatedAt = null
    /** 定时器句柄 */
    this._pushTimer = null
    this._pullTimer = null
    /** 是否正在执行同步 */
    this._syncing = false
    /** 停止标志 */
    this._running = false
  }

  /**
   * 启动同步服务（应用初始化时调用）
   */
  start() {
    if (this._running) {
      logger.warn('[SyncService] 服务已在运行')
      return
    }

    this._running = true
    logger.info('[SyncService] 同步服务已启动')

    // 1. 首次启动：比较本地和远端时间戳，拉取最新数据
    this._initialSync()

    // 2. 脏标记 + 定时检查，距上次推送≥2秒则自动推送
    this._startPushLoop()

    // 3. 每 5 秒轮询远端变更
    this._startPullLoop()
  }

  /**
   * 停止同步服务
   */
  stop() {
    this._running = false
    if (this._pushTimer) {
      clearInterval(this._pushTimer)
      this._pushTimer = null
    }
    if (this._pullTimer) {
      clearInterval(this._pullTimer)
      this._pullTimer = null
    }
    logger.info('[SyncService] 同步服务已停止')
  }

  /**
   * 标记本地数据已变更（增/删/改后调用）
   */
  markDirty() {
    this._dirty = true
  }

  // ==================== 内部实现 ====================

  /**
   * 首次同步：拉取远端数据（如果远端更新则覆盖本地）
   */
  async _initialSync() {
    try {
      const remoteData = await apiService.syncRead()
      if (!remoteData || !remoteData.success || !remoteData.data) {
        logger.info('[SyncService] 初始同步：无远端数据，跳过')
        return
      }

      const { documents = [], categories = [], numberingRules = {}, settings = {}, updatedAt } = remoteData.data

      if (!updatedAt) {
        logger.warn('[SyncService] 初始同步：远端数据缺 updatedAt，跳过')
        return
      }

      this._lastRemoteUpdatedAt = updatedAt

      // 比较远端时间戳：如果远端更新，拉取覆盖本地
      const localEntry = await storageService.getSettings()
      const localUpdatedAt = localEntry?._syncUpdatedAt || ''

      if (remoteData.data._updatedAt && remoteData.data._updatedAt > localUpdatedAt) {
        logger.info(`[SyncService] 初始同步：远端更新 (${remoteData.data._updatedAt}) > 本地 (${localUpdatedAt})，正在拉取...`)

        await storageService.replaceAllDocuments(documents)
        await storageService.replaceAllCategories(categories)

        if (Object.keys(numberingRules).length > 0) {
          await storageService.updateNumberingRules(numberingRules)
        }
        if (Object.keys(settings).length > 0) {
          const cleanSettings = { ...settings }
          delete cleanSettings._syncUpdatedAt
          await storageService.updateSettings(cleanSettings)
        }

        // 记录同步时间戳
        await storageService.updateSettings({ _syncUpdatedAt: remoteData.data._updatedAt })

        logger.info(`[SyncService] 初始同步完成：${documents.length} 文档, ${categories.length} 分类`)
      } else {
        logger.info(`[SyncService] 初始同步：本地已是最新 (${localUpdatedAt} >= ${remoteData.data._updatedAt})`)

        // 本地更新但远端旧，推送一次
        await this._pushToRemote()
      }
    } catch (err) {
      logger.warn('[SyncService] 初始同步异常:', err.message)
    }
  }

  /**
   * 启动脏标记推送循环（每 500ms 检查一次）
   */
  _startPushLoop() {
    this._pushTimer = setInterval(() => {
      if (!this._running) return
      if (!this._dirty) return

      const now = Date.now()
      // 距上次推送不够 2 秒，等待
      if (now - this._lastPushTime < 2000) return

      this._pushToRemote()
    }, 500)
  }

  /**
   * 推送本地数据到远端共享文件
   */
  async _pushToRemote() {
    if (this._syncing) return

    this._syncing = true
    try {
      const [documents, categories, settings, numberingRules] = await Promise.all([
        storageService.getDocuments(),
        storageService.getCategories(),
        storageService.getSettings(),
        storageService.getNumberingRules()
      ])

      const updatedAt = new Date().toISOString()
      const cleanSettings = { ...settings }
      delete cleanSettings._syncUpdatedAt

      const syncData = {
        documents,
        categories,
        numberingRules,
        settings: cleanSettings,
        updatedAt,
        _updatedAt: updatedAt
      }

      const result = await apiService.syncWrite(syncData)

      if (result && result.success) {
        this._dirty = false
        this._lastPushTime = Date.now()
        await storageService.updateSettings({ _syncUpdatedAt: updatedAt })
        logger.debug(`[SyncService] 推送成功: ${documents.length} 文档, ${categories.length} 分类`)
      } else {
        logger.warn(`[SyncService] 推送失败: ${result?.error || '未知错误'}`)
      }
    } catch (err) {
      logger.warn('[SyncService] 推送异常:', err.message)
    } finally {
      this._syncing = false
    }
  }

  /**
   * 启动拉取循环（每 5 秒轮询远端变更）
   */
  _startPullLoop() {
    this._pullTimer = setInterval(() => {
      if (!this._running) return
      this._pullFromRemote()
    }, 5000)
  }

  /**
   * 从远端拉取数据
   */
  async _pullFromRemote() {
    if (this._syncing) return

    this._syncing = true
    try {
      const result = await apiService.syncRead()
      if (!result || !result.success || !result.data) return

      const { documents = [], categories = [], numberingRules = {}, settings = {}, _updatedAt } = result.data

      if (!_updatedAt) return

      // 如果远端时间戳与上次相同，跳过
      if (_updatedAt === this._lastRemoteUpdatedAt) return

      // 已推送过（本地时间戳 = 远端时间戳），跳过
      const localEntry = await storageService.getSettings()
      if (localEntry._syncUpdatedAt === _updatedAt) {
        this._lastRemoteUpdatedAt = _updatedAt
        return
      }

      logger.info(`[SyncService] 检测到远端变更，正在拉取: ${_updatedAt}`)

      await storageService.replaceAllDocuments(documents)
      await storageService.replaceAllCategories(categories)

      if (Object.keys(numberingRules).length > 0) {
        await storageService.updateNumberingRules(numberingRules)
      }
      if (Object.keys(settings).length > 0) {
        const cleanSettings = { ...settings }
        delete cleanSettings._syncUpdatedAt
        await storageService.updateSettings(cleanSettings)
      }

      await storageService.updateSettings({ _syncUpdatedAt })
      this._lastRemoteUpdatedAt = _updatedAt

      logger.info(`[SyncService] 拉取完成: ${documents.length} 文档, ${categories.length} 分类`)
    } catch (err) {
      logger.warn('[SyncService] 拉取异常:', err.message)
    } finally {
      this._syncing = false
    }
  }
}

// 单例导出
const syncService = new SyncService()
export default syncService
export { syncService }
