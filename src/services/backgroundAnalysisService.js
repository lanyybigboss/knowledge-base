/**
 * 后台 AI 分析调度服务
 * 定时扫描未分析文档，通过 taskQueueService 排队执行 AI 分析
 */

import storageService from './storageService'
import taskQueueService from './taskQueueService'
import logger from './logger'
import { analyzeDocument, hasApiKey, isOllamaAvailable } from './aiService'

/** 扫描间隔（毫秒） */
const SCAN_INTERVAL = 30000
/** AI 分析超时时间（毫秒） */
const ANALYSIS_TIMEOUT = 120000
/** 每次扫描最多处理的文档数 */
const MAX_PER_SCAN = 3
/** 连续空扫描次数阈值，达到后进入待机 */
const EMPTY_SWEEP_THRESHOLD = 2

class BackgroundAnalysisService {
  constructor() {
    this._scanTimer = null
    this._running = false
    /** 是否处于待机模式 */
    this._standby = false
    /** 连续空扫描计数 */
    this._emptySweepCount = 0
    /** 预热中标记 */
    this._preheating = false
    /** 正在处理的文档 ID 集合（去重） */
    this._pendingIds = new Set()
    /** AI 分析写入成功后回调，由 AppContext 注册，用于触发 UI 刷新 */
    this.onDocumentUpdated = null
  }

  /**
   * 启动后台分析服务
   */
  start() {
    if (this._running) {
      logger.warn('[BackgroundAnalysis] 服务已在运行')
      return
    }

    // 注册 AI_ANALYZE 任务处理器
    taskQueueService.registerHandler('AI_ANALYZE', async (task) => {
      const doc = task.payload
      try {
        logger.info(`[BackgroundAnalysis] 开始分析: "${doc.title || doc.fileName}" (${doc.id})`)

        const content = doc.content || ''
        const title = doc.title || ''
        const fileName = doc.fileName || ''

        if (!content || content.trim().length < 20) {
          logger.warn(`[BackgroundAnalysis] 跳过（内容过短，永久标记）: "${title || fileName}"`)
          await storageService.updateDocument(doc.id, { _aiRetryCount: 99 })
          this._pendingIds.delete(doc.id)
          return null
        }

        // 调用 AI 分析（带 120 秒超时）
        let result = null
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI 分析超时（120 秒）')), ANALYSIS_TIMEOUT)
          )
          result = await Promise.race([
            analyzeDocument(content, title, fileName),
            timeoutPromise
          ])
        } catch (err) {
          logger.error(`[BackgroundAnalysis] AI 分析异常: "${title || fileName}"`, err.message)
        }

        if (!result || result._fallback) {
          // 降级/失败：累计重试次数，最多重试 3 次
          const retryCount = (doc._aiRetryCount || 0) + 1
          if (retryCount >= 3) {
            await storageService.updateDocument(doc.id, { _aiRetryCount: retryCount })
            logger.warn(`[BackgroundAnalysis] AI 分析重试 ${retryCount} 次仍失败，永久跳过: "${title || fileName}"`)
          } else {
            await storageService.updateDocument(doc.id, { _aiRetryCount: retryCount })
            logger.warn(`[BackgroundAnalysis] AI 分析降级/失败（第 ${retryCount}/3 次，下次扫描重试）: "${title || fileName}"`)
          }
          this._pendingIds.delete(doc.id)
          return null
        }

        // 写入前最终安全校验：确认 summary/keywords/tags 有实质内容
        const hasValidSummary = (result.summary || '').replace(/[\s\u3000]/g, '').length >= 3
        const hasValidKeywords = (result.keywords || []).length >= 1
        if (!hasValidSummary && !hasValidKeywords) {
          logger.warn(`[BackgroundAnalysis] 写入前校验失败（summary/keywords 均无效），标记永久跳过: "${title || fileName}"`)
          await storageService.updateDocument(doc.id, { _aiRetryCount: 99 })
          this._pendingIds.delete(doc.id)
          return null
        }

        // 计算 searchIndex
        const searchIndex = [
          fileName,
          result.smartTitle || '',
          result.summary || '',
          ...(result.keywords || [])
        ].filter(Boolean).join(' ').substring(0, 512)

        // AI成功 → JSON合法 → 字段校验 → 写入summary/tags → 最后 aiAnalyzed=true
        logger.info(`[AI] storage_write_start | id=${doc.id} | title="${title || fileName}" | summary="${(result.summary || '').substring(0, 40)}" | keywords=${JSON.stringify(result.keywords || [])} | category="${result.category}"`)
        await storageService.updateDocument(doc.id, {
          category: result.category || 'other',
          summary: result.summary || '',
          detailedSummary: result.detailedSummary || '',
          keywords: result.keywords || [],
          tags: result.tags || [],
          entities: result.entities || { people: [], organizations: [], locations: [], dates: [] },
          smartTitle: result.smartTitle || '',
          searchIndex: searchIndex,
          aiAnalyzed: true  // ← 最后才设 aiAnalyzed
        })
        logger.info(`[AI] storage_write_success | id=${doc.id} | summaryLength=${(result.summary || '').length} | keywordCount=${(result.keywords || []).length}`)

        logger.info(`[BackgroundAnalysis] 分析完成: "${title || fileName}", smartTitle: "${result.smartTitle || '-'}"`)
        this._pendingIds.delete(doc.id)

        // 通知 AppContext 触发 UI 刷新
        if (typeof this.onDocumentUpdated === 'function') {
          try {
            logger.info(`[UI_REFRESH] 触发 onDocumentUpdated 回调 | docId=${doc.id}`)
            this.onDocumentUpdated(doc.id)
          } catch (e) {
            logger.error('[UI_REFRESH] onDocumentUpdated 回调异常:', e.message)
          }
        }

        return result
      } catch (error) {
        logger.error(`[BackgroundAnalysis] 处理异常: "${doc.title || doc.fileName}"`, error.message)
        // 异常情况下累计重试，不设 aiAnalyzed
        try {
          const retryCount = (doc._aiRetryCount || 0) + 1
          await storageService.updateDocument(doc.id, { _aiRetryCount: retryCount >= 3 ? retryCount : retryCount })
        } catch (e) { /* ignore */ }
        this._pendingIds.delete(doc.id)
        throw error
      }
    })

    this._running = true
    this._standby = false
    this._emptySweepCount = 0
    this._preheating = false
    logger.info('[BackgroundAnalysis] 服务已启动，扫描间隔: 30 秒，待机阈值: 2 次空扫描')

    // 首次扫描延迟 5 秒（给应用初始化留时间）
    this._scanTimer = setTimeout(() => {
      this._scanTimer = null
      this._scheduleScan()
    }, 5000)
  }

  /**
   * 停止后台分析服务
   */
  stop() {
    this._running = false
    if (this._scanTimer) {
      clearTimeout(this._scanTimer)
      this._scanTimer = null
    }
    logger.info('[BackgroundAnalysis] 服务已停止')
  }

  /**
   * 立即触发一次扫描
   */
  async scanNow() {
    logger.info('[BackgroundAnalysis] 手动触发扫描')
    await this._scanLoop()
  }

  /**
   * 调度下一次扫描
   */
  _scheduleScan() {
    if (!this._running || this._standby) return
    this._scanTimer = setTimeout(async () => {
      await this._scanLoop()
      if (this._running && !this._standby) {
        this._scheduleScan()
      }
    }, SCAN_INTERVAL)
  }

  /**
   * 执行扫描：找出未分析文档并入队
   */
  async _scanLoop() {
    try {
      // 检查是否有可用的 AI 服务（Ollama 或 DeepSeek）
      const ollamaAvailable = await isOllamaAvailable()
      if (!hasApiKey() && !ollamaAvailable) {
        logger.debug('[BackgroundAnalysis] 无可用 AI 服务（Ollama 不可用 & DeepSeek 未配置），跳过扫描')
        return
      }

      // 预热模式下不做待机判断，专心预热
      if (this._preheating) {
        logger.info('[BackgroundAnalysis] 预热扫描中...')
      }

      const allDocs = await storageService.getDocuments()
        const unanalyzed = allDocs
        .filter(doc => !doc.aiAnalyzed && (!doc._aiRetryCount || doc._aiRetryCount < 3) && !this._pendingIds.has(doc.id))
        .slice(0, MAX_PER_SCAN)

      if (unanalyzed.length === 0) {
        logger.debug('[BackgroundAnalysis] 扫描完成，无待分析文档')

        // 预热结束
        if (this._preheating) {
          this._preheating = false
          logger.info('[BackgroundAnalysis] 预热完成，无待分析文档')
        }

        // 累计空扫描次数，达到阈值进入待机
        this._emptySweepCount++
        if (this._emptySweepCount >= EMPTY_SWEEP_THRESHOLD && !this._standby) {
          this._standby = true
          logger.info(`[BackgroundAnalysis] 连续 ${EMPTY_SWEEP_THRESHOLD} 次空扫描，进入待机模式（等待文件变动唤醒）`)
        }
        return
      }

      // 发现文档，重置计数
      this._emptySweepCount = 0
      if (this._preheating) {
        this._preheating = false
        logger.info('[BackgroundAnalysis] 预热完成，开始处理文档')
      }

      logger.info(`[BackgroundAnalysis] 发现 ${unanalyzed.length} 个待分析文档`)

      for (const doc of unanalyzed) {
        // 去重检查：如果已经在 pending 中则跳过
        if (this._pendingIds.has(doc.id)) continue

        this._pendingIds.add(doc.id)
        // 入队（不 await，让队列自行消费）
        taskQueueService.enqueue({
          id: doc.id,
          type: 'AI_ANALYZE',
          payload: doc
        }).catch(err => {
          logger.error(`[BackgroundAnalysis] 任务失败: "${doc.title || doc.fileName}"`, err.message)
        })
      }
    } catch (error) {
      logger.error('[BackgroundAnalysis] 扫描异常:', error.message)
    }
  }

  /**
   * 文件变动唤醒：从待机模式恢复扫描
   * @returns {boolean} 是否成功唤醒
   */
  wakeUp() {
    if (!this._running) return false
    if (!this._standby) {
      logger.debug('[BackgroundAnalysis] 服务未处于待机模式，无需唤醒')
      return false
    }
    this._standby = false
    this._emptySweepCount = 0
    this._preheating = true
    logger.info('[BackgroundAnalysis] 文件变动触发唤醒，预热中（2秒后开始扫描）...')
    // 预热扫描：延迟 2 秒让文件系统稳定
    setTimeout(() => {
      if (this._running) {
        this._preheating = false
        this._scheduleScan()
      }
    }, 2000)
    return true
  }
}

// 单例导出
const backgroundAnalysisService = new BackgroundAnalysisService()
export default backgroundAnalysisService
export { backgroundAnalysisService }
