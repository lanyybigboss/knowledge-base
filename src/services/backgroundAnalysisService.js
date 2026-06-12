/**
 * 后台 AI 分析调度服务
 * 定时扫描未分析文档，通过 taskQueueService 排队执行 AI 分析
 */

import storageService from './storageService'
import taskQueueService from './taskQueueService'
import logger from './logger'
import { analyzeDocument, hasApiKey, isOllamaAvailable } from './aiService'
import { generateSmartDocNumber } from '../utils/helpers'
import { writeBackToFrontmatter } from './obsidianService'

/** 扫描间隔（毫秒） */
const SCAN_INTERVAL = 30000
/** AI 分析超时时间（毫秒） */
const ANALYSIS_TIMEOUT = 120000
/** 每次扫描最多处理的文档数 */
const MAX_PER_SCAN = 3
/** 连续空扫描次数阈值，达到后进入待机 */
const EMPTY_SWEEP_THRESHOLD = 5
/** 待机超时时间（毫秒），达到后挂起高性能进程 */
const STANDBY_SUSPEND_TIMEOUT = 300000 // 5分钟

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
    /** 是否正在扫描（防止 scanNow 与定时扫描并发） */
    this._scanning = false
    /** AI 分析写入成功后回调，由 AppContext 注册，用于触发 UI 刷新 */
    this.onDocumentUpdated = null
    /** Electron IPC 分析器就绪状态 */
    this._analyzerReady = false
    /** 是否已挂起（暂停 AI 分析功能） */
    this._suspended = false
    /** 待机挂起定时器 */
    this._suspendTimer = null
  }

  /**
   * 检查是否在 Electron 环境且 analyzer 子进程可用
   */
  _isElectronAnalyzerAvailable() {
    return !!(window.electronAPI && window.electronAPI.analyzerAnalyze)
  }

  /**
   * 通过 Electron IPC 调用 analyzer 子进程分析文档
   * @returns {Promise<object|null>} 分析结果或 null
   */
  _analyzeViaIPC(doc) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup()
        resolve(null)
      }, ANALYSIS_TIMEOUT)

      let cleanup

      const onResult = (msg) => {
        if (msg.id !== doc.id) return
        cleanup()
        resolve(msg.data || null)
      }

      const onError = (msg) => {
        if (msg.id !== doc.id) return
        cleanup()
        resolve(null)
      }

      cleanup = () => {
        clearTimeout(timeout)
        window.electronAPI.onAnalyzerResult(onResult)  // 返回 unsubscribe
        window.electronAPI.onAnalyzerError(onError)
      }

      // 注册监听（返回 unsubscribe 函数）
      const unsubResult = window.electronAPI.onAnalyzerResult(onResult)
      const unsubError = window.electronAPI.onAnalyzerError(onError)
      cleanup = () => {
        clearTimeout(timeout)
        unsubResult()
        unsubError()
      }

      // 发送分析请求
      window.electronAPI.analyzerAnalyze({
        id: doc.id,
        filePath: doc.localFilePath,
        fileName: doc.fileName,
        fileType: doc.fileType,
        title: doc.title
      })
    })
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

        // 调用 AI 分析（带超时）
        let result = null
        let timeoutId = null

        if (this._isElectronAnalyzerAvailable() && doc.localFilePath) {
          // Electron 模式：通过 IPC 调用 analyzer 子进程
          logger.info(`[BackgroundAnalysis] 使用 IPC 子进程分析: "${title || fileName}"`)
          try {
            result = await this._analyzeViaIPC(doc)
          } catch (err) {
            logger.error(`[BackgroundAnalysis] IPC 分析异常: "${title || fileName}"`, err.message)
          }
        } else {
          // Vite 模式：直接调用 aiService
          try {
            const timeoutPromise = new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('AI 分析超时（120 秒）')), ANALYSIS_TIMEOUT)
            })
            result = await Promise.race([
              analyzeDocument(content, title, fileName),
              timeoutPromise
            ])
          } catch (err) {
            logger.error(`[BackgroundAnalysis] AI 分析异常: "${title || fileName}"`, err.message)
          } finally {
            if (timeoutId) clearTimeout(timeoutId)
          }
        }

        if (!result || result._fallback) {
          // 降级/失败：累计重试次数，最多重试 3 次
          const retryCount = (doc._aiRetryCount || 0) + 1
          if (retryCount >= 3) {
            // 达到最大重试次数，永久标记（99 表示永久跳过）
            await storageService.updateDocument(doc.id, { _aiRetryCount: 99 })
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
          docNumber: result.smartTitle ? generateSmartDocNumber(result.smartTitle, doc.createdAt) : doc.docNumber,
          searchIndex: searchIndex,
          aiAnalyzed: true  // ← 最后才设 aiAnalyzed
        })
        logger.info(`[AI] storage_write_success | id=${doc.id} | summaryLength=${(result.summary || '').length} | keywordCount=${(result.keywords || []).length}`)

        // 将分析结果回写到 Obsidian 笔记（如果是 Obsidian 笔记）
        if (doc.isObsidianNote && doc.localFilePath && doc.localFilePath.endsWith('.md')) {
          try {
            if (window.electronAPI && window.electronAPI.readRawFile) {
              const fileResult = await window.electronAPI.readRawFile(doc.localFilePath)
              if (fileResult.success) {
                const readFile = async (path) => {
                  const res = await window.electronAPI.readRawFile(path)
                  return res.success ? Buffer.from(res.content, 'base64').toString('utf-8') : null
                }
                const writeFile = async (path, content) => {
                  await window.electronAPI.saveUploadFile({ fileName: path.split('\\').pop(), content, isBase64: false })
                }
                await writeBackToFrontmatter(readFile, writeFile, doc.localFilePath, result)
              }
            }
          } catch (err) {
            logger.warn(`[Obsidian] 回写失败: ${doc.localFilePath}`, err.message)
          }
        }

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
          // 达到最大重试次数（3次）后永久标记（99 表示永久跳过）
          const newRetryCount = retryCount >= 3 ? 99 : retryCount
          await storageService.updateDocument(doc.id, { _aiRetryCount: newRetryCount })
          if (newRetryCount === 99) {
            logger.warn(`[BackgroundAnalysis] 异常重试 ${retryCount} 次仍失败，永久跳过: "${doc.title || doc.fileName}"`)
          }
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
    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer)
      this._suspendTimer = null
    }
    logger.info('[BackgroundAnalysis] 服务已停止')
  }

  /**
   * 立即触发一次扫描
   */
  async scanNow() {
    if (this._scanning) {
      logger.debug('[BackgroundAnalysis] 扫描正在进行中，跳过手动触发')
      return
    }
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
    if (this._scanning) return
    this._scanning = true
    try {
      // 检查是否有可用的 AI 服务（Ollama 或 DeepSeek）
      const ollamaAvailable = await isOllamaAvailable()
      const analyzerAvailable = this._isElectronAnalyzerAvailable()
      if (!hasApiKey() && !ollamaAvailable && !analyzerAvailable) {
        logger.debug('[BackgroundAnalysis] 无可用 AI 服务（Ollama/Analyzer/DeepSeek 均不可用），跳过扫描')
        return
      }

      // 预热模式下不做待机判断，专心预热
      if (this._preheating) {
        logger.info('[BackgroundAnalysis] 预热扫描中...')
      }

      // 使用轻量级元数据扫描（不含 content 大字段），避免内存暴涨
      const allMetaDocs = await storageService.getDocumentMetadata(500, 0)
      const candidateIds = allMetaDocs
        .filter(doc => !doc.aiAnalyzed && (!doc._aiRetryCount || doc._aiRetryCount < 3) && !this._pendingIds.has(doc.id))
        .slice(0, MAX_PER_SCAN)
        .map(doc => doc.id)

      if (candidateIds.length === 0) {
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
          logger.info(`[BackgroundAnalysis] 连续 ${EMPTY_SWEEP_THRESHOLD} 次空扫描，进入待机模式（等待文件变动唤醒，${STANDBY_SUSPEND_TIMEOUT/60000}分钟后挂起）`)
          // 启动待机挂起定时器
          this._startSuspendTimer()
        }
        return
      }

      // 发现文档，重置计数
      this._emptySweepCount = 0
      if (this._preheating) {
        this._preheating = false
        logger.info('[BackgroundAnalysis] 预热完成，开始处理文档')
      }

      logger.info(`[BackgroundAnalysis] 发现 ${candidateIds.length} 个待分析文档`)

      // 按需逐个加载完整文档（含 content），最多 MAX_PER_SCAN 个
      for (const docId of candidateIds) {
        // 去重检查：如果已经在 pending 中则跳过
        if (this._pendingIds.has(docId)) continue

        const fullDoc = await storageService.getDocument(docId)
        if (!fullDoc) {
          logger.warn(`[BackgroundAnalysis] 文档不存在，跳过: ${docId}`)
          continue
        }

        this._pendingIds.add(docId)
        // 入队（不 await，让队列自行消费）
        taskQueueService.enqueue({
          id: docId,
          type: 'AI_ANALYZE',
          payload: fullDoc
        }).catch(err => {
          // 任务被 reject（如 clearQueue），清理 pending 标记允许重新扫描
          this._pendingIds.delete(docId)
          logger.error(`[BackgroundAnalysis] 任务失败: "${fullDoc.title || fullDoc.fileName}"`, err.message)
        })
      }
    } catch (error) {
      logger.error('[BackgroundAnalysis] 扫描异常:', error.message)
    } finally {
      this._scanning = false
    }
  }

  /**
   * 文件变动唤醒：从待机模式恢复扫描
   * @returns {boolean} 是否成功唤醒
   */
  wakeUp() {
    if (!this._running) return false
    if (!this._standby && !this._suspended) {
      logger.debug('[BackgroundAnalysis] 服务未处于待机或挂起模式，无需唤醒')
      return false
    }
    // 清除挂起定时器
    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer)
      this._suspendTimer = null
    }
    this._standby = false
    this._suspended = false
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

  /**
   * 启动待机挂起定时器
   */
  _startSuspendTimer() {
    // 如果已有定时器，先清除
    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer)
    }
    this._suspendTimer = setTimeout(() => {
      this._suspend()
    }, STANDBY_SUSPEND_TIMEOUT)
    logger.info(`[BackgroundAnalysis] 待机挂起定时器已启动（${STANDBY_SUSPEND_TIMEOUT/60000}分钟后触发）`)
  }

  /**
   * 挂起高性能进程
   * 停止分析子进程，保留监听功能
   */
  _suspend() {
    if (!this._running || this._suspended) return
    this._suspended = true
    this._standby = false
    if (this._suspendTimer) {
      clearTimeout(this._suspendTimer)
      this._suspendTimer = null
    }
    // 通知 Electron 停止分析子进程
    if (window.electronAPI && window.electronAPI.stopAnalyzer) {
      window.electronAPI.stopAnalyzer()
    }
    logger.info('[BackgroundAnalysis] 已挂起高性能进程，仅保留监听功能')
  }

  /**
   * 恢复挂起状态
   * 重新启动分析子进程
   */
  resume() {
    if (!this._running || !this._suspended) return false
    this._suspended = false
    // 通知 Electron 启动分析子进程
    if (window.electronAPI && window.electronAPI.startAnalyzer) {
      window.electronAPI.startAnalyzer()
    }
    logger.info('[BackgroundAnalysis] 已恢复高性能进程')
    return true
  }

  /**
   * 获取当前服务状态
   */
  getStatus() {
    return {
      running: this._running,
      standby: this._standby,
      suspended: this._suspended,
      preheating: this._preheating,
      pendingCount: this._pendingIds.size
    }
  }
}

// 单例导出
const backgroundAnalysisService = new BackgroundAnalysisService()
export default backgroundAnalysisService
export { backgroundAnalysisService }
