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
        if (docs.length > 0) {
          await db.documents.bulkPut(docs)
        }
      }

      // 迁移分类
      const localCategories = localStorage.getItem(STORAGE_KEYS.CATEGORIES)
      if (localCategories) {
        const categories = JSON.parse(localCategories)
        if (categories.length > 0) {
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

      // 迁移成功后清除 localStorage（保留 kb_counters 给 generateDocumentNumber 向后兼容）
      // 但不再依赖 localStorage 作为主要存储
      logger.info('[StorageService] localStorage → IndexedDB 迁移完成')
    } catch (error) {
      logger.error('[StorageService] 迁移失败:', error)
      throw error
    }
  }

  // ==================== 文档操作 ====================

  /**
   * 获取所有文档
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
   * 获取单个文档
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
      await db.documents.clear()
      if (docs.length > 0) {
        await db.documents.bulkPut(docs)
      }
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
      await db.categories.clear()
      if (cats.length > 0) {
        await db.categories.bulkPut(cats)
      }
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
      const operations = []

      if (data.documents) {
        operations.push(db.documents.clear())
        operations.push(db.documents.bulkPut(data.documents))
      }
      if (data.categories) {
        operations.push(db.categories.clear())
        operations.push(db.categories.bulkPut(data.categories))
      }
      if (data.numberingRules) {
        operations.push(db.kvStore.put({ key: 'numberingRules', value: data.numberingRules }))
      }
      if (data.settings) {
        operations.push(db.kvStore.put({ key: 'settings', value: data.settings }))
      }
      if (data.counters) {
        operations.push(db.kvStore.put({ key: 'counters', value: data.counters }))
        localStorage.setItem(STORAGE_KEYS.COUNTERS, JSON.stringify(data.counters))
      }

      await Promise.all(operations)
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
