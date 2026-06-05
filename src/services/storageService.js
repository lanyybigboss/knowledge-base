/**
 * 知识库管理系统 - 本地存储服务
 * 基于 Dexie.js (IndexedDB) 的 CRUD 操作
 */

import logger from './logger'

import Dexie from 'dexie'
import { STORAGE_KEYS, DEFAULT_NUMBERING_RULES } from '../utils/constants'
import { generateId, generateDocumentNumber } from '../utils/helpers'

// 创建 Dexie 数据库实例
const db = new Dexie('KnowledgeBaseDB')

// 定义数据库结构
db.version(1).stores({
  documents: '&id, category, fileType, starred, createdAt, updatedAt, title',
  categories: '&id',
  kvStore: '&key'
})

class StorageService {
  constructor() {
    this.initialized = false
    this._initPromise = null
  }

  /**
   * 初始化存储（从 localStorage 迁移到 IndexedDB）
   */
  async init() {
    if (this.initialized) return
    if (this._initPromise) return this._initPromise

    this._initPromise = this._migrateFromLocalStorage()
    await this._initPromise
    this.initialized = true
  }

  /**
   * 从 localStorage 迁移数据到 IndexedDB
   */
  async _migrateFromLocalStorage() {
    try {
      // 检查是否已迁移
      const migrated = await db.kvStore.get('_migrated')
      if (migrated) return

      // 迁移文档
      const localDocs = localStorage.getItem(STORAGE_KEYS.DOCUMENTS)
      if (localDocs) {
        const docs = JSON.parse(localDocs)
        if (Array.isArray(docs) && docs.length > 0) {
          await db.documents.bulkPut(docs)
        }
      }

      // 迁移分类
      const localCategories = localStorage.getItem(STORAGE_KEYS.CATEGORIES)
      if (localCategories) {
        const categories = JSON.parse(localCategories)
        if (Array.isArray(categories) && categories.length > 0) {
          await db.categories.bulkPut(categories)
        }
      }

      // 迁移设置
      const localSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS)
      if (localSettings) {
        await db.kvStore.put({ key: 'settings', value: JSON.parse(localSettings) })
      }

      // 迁移编号规则
      const localRules = localStorage.getItem(STORAGE_KEYS.NUMBERING_RULES)
      if (localRules) {
        await db.kvStore.put({ key: 'numberingRules', value: JSON.parse(localRules) })
      }

      // 迁移计数器
      const localCounters = localStorage.getItem(STORAGE_KEYS.COUNTERS)
      if (localCounters) {
        await db.kvStore.put({ key: 'counters', value: JSON.parse(localCounters) })
      }

      // 标记已迁移
      await db.kvStore.put({ key: '_migrated', value: true })

      // 清除 localStorage 旧数据（保留 kb_counters 给 generateDocumentNumber 向后兼容）
      const keysToClear = [STORAGE_KEYS.DOCUMENTS, STORAGE_KEYS.CATEGORIES, STORAGE_KEYS.SETTINGS, STORAGE_KEYS.NUMBERING_RULES]
      keysToClear.forEach(key => { try { localStorage.removeItem(key) } catch (e) { /* ignore */ } })
      logger.info('[StorageService] localStorage → IndexedDB 迁移完成')
    } catch (error) {
      logger.error('[StorageService] 迁移失败:', error)
      throw error
    }
  }

  // ==================== 文档操作 ====================

  /**
   * 获取所有文档（兼容旧代码，建议新代码使用 getDocumentsPaginated）
   * @deprecated 请使用 getDocumentsPaginated 或 getDocumentMetadata
   */
  async getDocuments() {
    try {
      return await db.documents.toArray()
    } catch (error) {
      logger.error('获取文档失败:', error)
      return []
    }
  }

  /**
   * 获取文档元数据列表（不含 content、detailedSummary 等大字段）
   * 用于列表展示，大幅减少内存占用
   * @param {number} limit - 限制数量，默认 100
   * @param {number} offset - 偏移量，默认 0
   * @returns {Promise<Array>} 文档元数据列表
   */
  async getDocumentMetadata(limit = 100, offset = 0) {
    try {
      const docs = await db.documents
        .offset(offset)
        .limit(limit)
        .toArray()
      return docs.map(doc => ({
        id: doc.id,
        title: doc.title,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        fileType: doc.fileType,
        category: doc.category,
        tags: doc.tags,
        keywords: doc.keywords,
        summary: doc.summary, // 保留简短摘要
        aiAnalyzed: doc.aiAnalyzed,
        starred: doc.starred,
        viewCount: doc.viewCount,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        docNumber: doc.docNumber,
        source: doc.source,
        isStrmRef: doc.isStrmRef,
        _aiRetryCount: doc._aiRetryCount,
        detailedSummary: doc.detailedSummary // DocumentDetail 需要此字段显示完整摘要
      }))
    } catch (error) {
      logger.error('获取文档元数据失败:', error)
      return []
    }
  }

  /**
   * 获取所有文档的实体数据（轻量级，仅用于知识图谱）
   * @returns {Promise<Array>} 包含 id, title, entities, keywords, createdAt, category 的文档列表
   */
  async getDocumentEntities() {
    try {
      const docs = await db.documents.toArray()
      return docs
        .filter(doc => {
          // 有实体数据
          if (doc.entities && (
            (doc.entities.people && doc.entities.people.length > 0) ||
            (doc.entities.organizations && doc.entities.organizations.length > 0) ||
            (doc.entities.locations && doc.entities.locations.length > 0) ||
            (doc.entities.dates && doc.entities.dates.length > 0)
          )) return true
          // 有关键词也可以（知识图谱会用 keywords 作为 topic 节点）
          if (doc.keywords && doc.keywords.length > 0) return true
          return false
        })
        .map(doc => ({
          id: doc.id,
          title: doc.title,
          entities: doc.entities || { people: [], organizations: [], locations: [], dates: [] },
          keywords: doc.keywords || [],
          createdAt: doc.createdAt,
          category: doc.category
        }))
    } catch (error) {
      logger.error('获取文档实体数据失败:', error)
      return []
    }
  }

  /**
   * 分页获取文档列表
   * @param {number} page - 页码（从 1 开始）
   * @param {number} pageSize - 每页数量
   * @param {boolean} includeContent - 是否包含完整内容
   * @returns {Promise<{data: Array, total: number, page: number, pageSize: number, totalPages: number}>}
   */
  async getDocumentsPaginated(page = 1, pageSize = 20, includeContent = false) {
    try {
      const offset = (page - 1) * pageSize
      const total = await db.documents.count()
      const totalPages = Math.ceil(total / pageSize)

      let data
      if (includeContent) {
        data = await db.documents
          .offset(offset)
          .limit(pageSize)
          .toArray()
      } else {
        data = await this.getDocumentMetadata(pageSize, offset)
      }

      return {
        data,
        total,
        page,
        pageSize,
        totalPages
      }
    } catch (error) {
      logger.error('分页获取文档失败:', error)
      return {
        data: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0
      }
    }
  }

  /**
   * 获取单个文档（完整数据）
   */
  async getDocument(id) {
    try {
      return await db.documents.get(id) || null
    } catch (error) {
      logger.error('获取文档失败:', error)
      return null
    }
  }

  /**
   * 添加文档
   */
  async addDocument(docData) {
    const now = new Date().toISOString()

    // 获取编号规则和计数器，生成文档编号
    let rules = await this.getNumberingRules()
    // 如果未配置编号规则，初始化默认规则
    if (!rules || Object.keys(rules).length === 0) {
      rules = { ...DEFAULT_NUMBERING_RULES }
      await this.updateNumberingRules(rules)
    }
    // 确保 enabled 字段存在
    if (rules.enabled === undefined) {
      rules.enabled = true
    }
    const counters = await this._getCounters()
    const docNumber = generateDocumentNumber(docData.category, rules, counters)
    // 保存更新后的计数器到 IndexedDB（generateDocumentNumber 会在内存中递增计数器）
    if (rules.enabled && docNumber) {
      await this._saveCounters(counters)
    }

    const newDoc = {
      id: generateId(),
      title: docData.title || '未命名文档',
      fileName: docData.fileName || '',
      fileSize: docData.fileSize || 0,
      fileType: docData.fileType || '',
      category: docData.category || 'uncategorized',
      tags: docData.tags || [],
      keywords: docData.keywords || [],
      content: docData.content || '',
      summary: docData.summary || '',
      detailedSummary: docData.detailedSummary || '',
      entities: docData.entities || { people: [], organizations: [], locations: [], dates: [] },
      smartTitle: docData.smartTitle || '',
      searchIndex: docData.searchIndex || '',
      aiAnalyzed: docData.aiAnalyzed || false,
      localFilePath: docData.localFilePath || '',
      isStrmRef: docData.isStrmRef || false,  // 是否为 .strm 引用文件
      docNumber: docData.docNumber || docNumber,
      source: docData.source || 'manual',
      starred: false,
      viewCount: 0,
      createdAt: now,
      updatedAt: now
    }

    await db.documents.put(newDoc)
    return newDoc
  }

  /**
   * 更新文档
   */
  async updateDocument(id, updates) {
    const doc = await db.documents.get(id)
    if (!doc) return null

    const updated = {
      ...doc,
      ...updates,
      updatedAt: new Date().toISOString()
    }

    await db.documents.put(updated)
    return updated
  }

  /**
   * 重置单个文档的 AI 分析状态（允许重试）
   * @param {string} id - 文档 ID
   * @returns {Promise<object|null>} 更新后的文档或 null
   */
  async resetAiAnalysis(id) {
    const doc = await db.documents.get(id)
    if (!doc) return null

    logger.info(`[StorageService] 重置 AI 分析状态: "${doc.title || doc.fileName}" (${id})`)

    return await this.updateDocument(id, {
      aiAnalyzed: false,
      _aiRetryCount: 0,
      // 保留已有的 AI 分析结果（用户可能想保留）
      // 如果要清除，可以取消注释以下行：
      // summary: '',
      // detailedSummary: '',
      // keywords: [],
      // tags: [],
      // entities: { people: [], organizations: [], locations: [], dates: [] },
      // smartTitle: ''
    })
  }

  /**
   * 重置所有失败文档的 AI 分析状态
   * 使用分页查询避免一次性加载所有文档到内存
   * @returns {Promise<number>} 重置的文档数量
   */
  async resetAllFailedAiAnalysis() {
    let count = 0
    let page = 1
    const pageSize = 50
    let hasMore = true

    logger.info(`[StorageService] 开始扫描失败文档...`)

    while (hasMore) {
      const result = await this.getDocumentsPaginated(page, pageSize, false)
      const failedDocs = result.data.filter(doc => 
        !doc.aiAnalyzed && 
        (doc._aiRetryCount >= 3 || doc._aiRetryCount === 99)
      )

      for (const doc of failedDocs) {
        await this.resetAiAnalysis(doc.id)
        count++
      }

      hasMore = page < result.totalPages
      page++
    }
    
    logger.info(`[StorageService] 已重置 ${count} 个文档的 AI 分析状态`)
    return count
  }

  /**
   * 删除文档
   */
  async deleteDocument(id) {
    const doc = await db.documents.get(id)
    if (!doc) return false
    await db.documents.delete(id)
    return true
  }

  /**
   * 批量删除文档
   */
  async deleteDocuments(ids) {
    let count = 0
    for (const id of ids) {
      const deleted = await this.deleteDocument(id)
      if (deleted) count++
    }
    return count
  }

  /**
   * 切换星标状态
   */
  async toggleStar(id) {
    const doc = await db.documents.get(id)
    if (!doc) return null
    return this.updateDocument(id, { starred: !doc.starred })
  }

  /**
   * 增加浏览次数
   */
  async incrementViewCount(id) {
    const doc = await db.documents.get(id)
    if (!doc) return null
    return this.updateDocument(id, { viewCount: (doc.viewCount || 0) + 1 })
  }

  // ==================== 分类操作 ====================

  /**
   * 获取所有分类
   */
  async getCategories() {
    try {
      return await db.categories.toArray()
    } catch (error) {
      logger.error('获取分类失败:', error)
      return []
    }
  }

  /**
   * 添加分类
   */
  async addCategory(categoryData) {
    const newCategory = {
      id: generateId(),
      name: categoryData.name,
      icon: categoryData.icon || '📁',
      color: categoryData.color || '#6b7280',
      description: categoryData.description || '',
      createdAt: new Date().toISOString()
    }
    await db.categories.put(newCategory)
    return newCategory
  }

  /**
   * 更新分类
   */
  async updateCategory(id, updates) {
    const cat = await db.categories.get(id)
    if (!cat) return null
    const updated = { ...cat, ...updates }
    await db.categories.put(updated)
    return updated
  }

  /**
   * 删除分类
   */
  async deleteCategory(id) {
    const cat = await db.categories.get(id)
    if (!cat) return false
    await db.categories.delete(id)
    return true
  }

  /**
   * 批量替换全部文档（用于同步）
   */
  async replaceAllDocuments(docs) {
    try {
      await db.transaction('rw', db.documents, async () => {
        await db.documents.clear()
        if (docs.length > 0) {
          await db.documents.bulkPut(docs)
        }
      })
      return docs.length
    } catch (error) {
      logger.error('批量替换文档失败:', error)
      return 0
    }
  }

  /**
   * 批量替换全部分类（用于同步）
   */
  async replaceAllCategories(cats) {
    try {
      await db.transaction('rw', db.categories, async () => {
        await db.categories.clear()
        if (cats.length > 0) {
          await db.categories.bulkPut(cats)
        }
      })
      return cats.length
    } catch (error) {
      logger.error('批量替换分类失败:', error)
      return 0
    }
  }

  // ==================== 设置操作 ====================

  /**
   * 获取设置
   */
  async getSettings() {
    try {
      const entry = await db.kvStore.get('settings')
      return entry ? entry.value : {}
    } catch (error) {
      logger.error('获取设置失败:', error)
      return {}
    }
  }

  /**
   * 更新设置
   */
  async updateSettings(settings) {
    try {
      const current = await this.getSettings()
      await db.kvStore.put({ key: 'settings', value: { ...current, ...settings } })
      return true
    } catch (error) {
      logger.error('保存设置失败:', error)
      return false
    }
  }

  /**
   * 获取编号规则
   */
  async getNumberingRules() {
    try {
      const entry = await db.kvStore.get('numberingRules')
      return entry ? entry.value : {}
    } catch (error) {
      logger.error('获取编号规则失败:', error)
      return {}
    }
  }

  /**
   * 更新编号规则
   */
  async updateNumberingRules(rules) {
    try {
      await db.kvStore.put({ key: 'numberingRules', value: rules })
      return true
    } catch (error) {
      logger.error('保存编号规则失败:', error)
      return false
    }
  }

  /**
   * 获取计数器（内部使用）
   */
  async _getCounters() {
    try {
      const entry = await db.kvStore.get('counters')
      return entry ? entry.value : {}
    } catch (error) {
      return {}
    }
  }

  /**
   * 保存计数器（内部使用，由 addDocument 调用）
   */
  async _saveCounters(counters) {
    try {
      await db.kvStore.put({ key: 'counters', value: counters })
      // 同步到 localStorage 以便 generateDocumentNumber 向后兼容
      localStorage.setItem(STORAGE_KEYS.COUNTERS, JSON.stringify(counters))
    } catch (error) {
      logger.error('保存计数器失败:', error)
    }
  }

  // ==================== 数据导入导出 ====================

  /**
   * 导出所有数据
   */
  async exportAllData() {
    const [documents, categories, numberingRules, settings, counters] = await Promise.all([
      this.getDocuments(),
      this.getCategories(),
      this.getNumberingRules(),
      this.getSettings(),
      this._getCounters()
    ])
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      documents,
      categories,
      numberingRules,
      settings,
      counters
    }
  }

  /**
   * 导入数据
   */
  async importData(data) {
    try {
      // clear + bulkPut 必须在同一事务中，防止并行执行导致数据丢失
      const tables = []
      if (data.documents) tables.push(db.documents)
      if (data.categories) tables.push(db.categories)
      if (tables.length > 0 || data.numberingRules || data.settings || data.counters) {
        if (!tables.includes(db.kvStore)) tables.push(db.kvStore)
      }

      await db.transaction('rw', tables, async () => {
        if (data.documents) {
          await db.documents.clear()
          await db.documents.bulkPut(data.documents)
        }
        if (data.categories) {
          await db.categories.clear()
          await db.categories.bulkPut(data.categories)
        }
        if (data.numberingRules) {
          await db.kvStore.put({ key: 'numberingRules', value: data.numberingRules })
        }
        if (data.settings) {
          await db.kvStore.put({ key: 'settings', value: data.settings })
        }
        if (data.counters) {
          await db.kvStore.put({ key: 'counters', value: data.counters })
        }
      })

      if (data.counters) {
        localStorage.setItem(STORAGE_KEYS.COUNTERS, JSON.stringify(data.counters))
      }

      return { success: true, message: '数据导入成功' }
    } catch (error) {
      return { success: false, message: `导入失败: ${error.message}` }
    }
  }

  /**
   * 清除所有数据
   */
  async clearAllData() {
    await Promise.all([
      db.documents.clear(),
      db.categories.clear(),
      db.kvStore.clear()
    ])
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key)
    })
  }
}

// 导出单例
export const storageService = new StorageService()
export default storageService
