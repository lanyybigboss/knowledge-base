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
    { name: 'summary', weight: 0.2 }
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
  }

  /**
   * 构建搜索索引
   * @param {Array} documents - 文档数组
   */
  buildIndex(documents) {
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
   * 从数据库刷新索引
   */
  async refreshIndex() {
    try {
      const documents = await storageService.getDocuments()
      this.buildIndex(documents)
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
