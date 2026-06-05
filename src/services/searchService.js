/**
 * 搜索服务 - 基于 Fuse.js 的模糊搜索
 * 提供文档索引构建和快速搜索能力
 */

import Fuse from 'fuse.js'
import storageService from './storageService'
import logger from './logger'

/** 搜索权重配置 */
const FUSE_OPTIONS = {
  keys: [
    { name: 'searchIndex', weight: 0.6 },
    { name: 'smartTitle', weight: 0.4 },
    { name: 'fileName', weight: 0.5 },
    { name: 'keywords', weight: 0.3 },
    { name: 'summary', weight: 0.2 },
    { name: 'content', weight: 0.1 }
  ],
  threshold: 0.4,
  distance: 100,
  includeScore: true,
  minMatchCharLength: 1
}

class SearchService {
  constructor() {
    /** @type {Fuse|null} */
    this._fuse = null
    this._documents = []
    this._initialized = false
    this._buildIndexTimer = null
  }

  /**
   * 构建搜索索引（带防抖）
   * @param {Array} documents - 文档数组
   * @param {boolean} immediate - 是否立即构建（跳过防抖）
   */
  buildIndex(documents, immediate = false) {
    // 清除之前的定时器
    if (this._buildIndexTimer) {
      clearTimeout(this._buildIndexTimer)
      this._buildIndexTimer = null
    }

    if (immediate) {
      this._doBuildIndex(documents)
    } else {
      // 防抖：500ms 内多次调用只执行一次
      this._buildIndexTimer = setTimeout(() => {
        this._doBuildIndex(documents)
        this._buildIndexTimer = null
      }, 500)
    }
  }

  /**
   * 实际执行索引构建
   * @param {Array} documents - 文档数组
   */
  _doBuildIndex(documents) {
    if (!documents || documents.length === 0) {
      this._fuse = null
      this._documents = []
      logger.info('[SearchService] 索引为空（无文档）')
      return
    }

    this._documents = documents
    this._fuse = new Fuse(documents, FUSE_OPTIONS)
    this._initialized = true
    logger.info(`[SearchService] 索引已构建，共 ${documents.length} 个文档`)
  }

  /**
   * 从数据库刷新索引（使用元数据，减少内存占用）
   */
  async refreshIndex() {
    try {
      // 使用元数据而不是完整文档，减少内存占用
      const documents = await storageService.getDocumentMetadata(0, 0)
      this.buildIndex(documents, true) // 立即构建，不使用防抖
      logger.info(`[SearchService] 索引已刷新，共 ${documents.length} 个文档`)
    } catch (error) {
      logger.error('[SearchService] 刷新索引失败:', error.message)
    }
  }

  /**
   * 执行模糊搜索
   * @param {string} query - 搜索关键词
   * @param {number} limit - 返回结果数量
   * @returns {Array<{ item: object, score: number }>}
   */
  search(query, limit = 10) {
    if (!this._fuse || !query || query.trim().length === 0) {
      return []
    }

    try {
      const results = this._fuse.search(query.trim(), { limit })
      return results.map(r => ({
        item: r.item,
        score: r.score
      }))
    } catch (error) {
      logger.error('[SearchService] 搜索异常:', error.message)
      return []
    }
  }

  /**
   * 检查是否已初始化
   */
  isReady() {
    return this._initialized
  }

  /**
   * 获取已索引的文档数量
   */
  getDocumentCount() {
    return this._documents.length
  }
}

// 单例导出
const searchService = new SearchService()
export default searchService
export { searchService }
