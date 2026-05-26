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

class BackgroundAnalysisService {
  constructor() {
    this._scanTimer = null
    this._running = false
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
          logger.warn(`[BackgroundAnalysis] 跳过（内容过短）: "${title || fileName}"`)
          await storageService.updateDocument(doc.id, { _aiAttemptedAt: Date.now() })
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
          // 降级/失败：不设置 aiAnalyzed，避免界面显示空摘要；使用 _aiAttemptedAt 防止重复扫描
          await storageService.updateDocument(doc.id, { _aiAttemptedAt: Date.now() })
          this._pendingIds.delete(doc.id)
          logger.warn(`[BackgroundAnalysis] AI 分析降级/失败（已标记尝试，不覆蓋）: "${title || fileName}"`)
          return null
        }

        // 写入前最终安全校验：确认 summary/keywords/tags 有实质内容
        const hasValidSummary = (result.summary || '').replace(/[\s\u3000]/g, '').length >= 3
        const hasValidKeywords = (result.keywords || []).length >= 1
        if (!hasValidSummary && !hasValidKeywords) {
          logger.warn(`[BackgroundAnalysis] 写入前校验失败（summary/keywords 均无效），标记降级: "${title || fileName}"`)
          await storageService.updateDocument(doc.id, { _aiAttemptedAt: Date.now() })
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
        // 异常情况下标记已尝试，防止死循环，但不设 aiAnalyzed
        try {
          await storageService.updateDocument(doc.id, { _aiAttemptedAt: Date.now() })
        } catch (e) { /* ignore */ }
        this._pendingIds.delete(doc.id)
        throw error
      }
    })

    this._running = true
    logger.info('[BackgroundAnalysis] 服务已启动，扫描间隔: 30 秒')

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
    if (!this._running) return
    this._scanTimer = setTimeout(async () => {
      await this._scanLoop()
      if (this._running) {
        this._scheduleScan()
      }
    }, SCAN_INTERVAL)
  }

  /**
   * 执行扫描：找出未分析文档并入队
   */
  async _scanLoop() {
    try {
      // 优先允许 Ollama 可用时即使未配置 DeepSeek API Key 也继续扫描
      const ollamaAvailable = await isOllamaAvailable().catch(() => false)
      if (!hasApiKey() && !ollamaAvailable) {
        logger.debug('[BackgroundAnalysis] 未配置 DeepSeek API Key，且 Ollama 不可用，跳过扫描')
        return
      }

      const allDocs = await storageService.getDocuments()
      const unanalyzed = allDocs
        .filter(doc => !doc.aiAnalyzed && !doc._aiAttemptedAt && !this._pendingIds.has(doc.id))
        .slice(0, MAX_PER_SCAN)

      if (unanalyzed.length === 0) {
        logger.debug('[BackgroundAnalysis] 扫描完成，无待分析文档')
        return
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
}

// 单例导出
const backgroundAnalysisService = new BackgroundAnalysisService()
export default backgroundAnalysisService
export { backgroundAnalysisService }