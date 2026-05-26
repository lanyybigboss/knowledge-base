/**
 * 知识库管理系统 - 工具函数
 */

import { FILE_TYPE_MAP, DEFAULT_NUMBERING_RULES, STORAGE_KEYS } from './constants'

/**
 * 生成唯一ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

/**
 * 格式化日期
 */
export function formatDate(date, format = 'YYYY-MM-DD HH:mm:ss') {
  if (!date) return ''
  const d = new Date(date)
  const map = {
    YYYY: d.getFullYear(),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
    DD: String(d.getDate()).padStart(2, '0'),
    HH: String(d.getHours()).padStart(2, '0'),
    mm: String(d.getMinutes()).padStart(2, '0'),
    ss: String(d.getSeconds()).padStart(2, '0')
  }
  let result = format
  Object.entries(map).forEach(([key, value]) => {
    result = result.replace(key, value)
  })
  return result
}

/**
 * 获取文件扩展名
 */
export function getFileExtension(filename) {
  if (!filename) return ''
  return filename.split('.').pop()?.toLowerCase() || ''
}

/**
 * 获取文件类型信息
 */
export function getFileTypeInfo(filename) {
  const ext = getFileExtension(filename)
  return FILE_TYPE_MAP[ext] || { label: '未知', icon: '📁', color: '#9ca3af' }
}

/**
 * 生成文档编号
 * @param {string} categoryId - 分类ID
 * @param {object|null} rules - 编号规则（从外部传入，不传则从 localStorage 读取作为后备）
 * @param {object|null} counters - 计数器对象（从外部传入，不传则从 localStorage 读取作为后备）
 */
export function generateDocumentNumber(categoryId, rules = null, counters = null) {
  // 如果未传入规则，从 localStorage 读取（向后兼容）
  const numberingRules = rules || (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.NUMBERING_RULES)
      return saved ? JSON.parse(saved) : DEFAULT_NUMBERING_RULES
    } catch {
      return DEFAULT_NUMBERING_RULES
    }
  })()

  if (!numberingRules.enabled) return ''

  const { prefix, dateFormat, separator, digitCount } = numberingRules
  const dateStr = formatDate(new Date(), dateFormat)

  // 获取/初始化计数器
  const counterData = counters || (() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.COUNTERS) || '{}')
    } catch {
      return {}
    }
  })()

  const counterKey = `${categoryId || 'general'}`
  counterData[counterKey] = (counterData[counterKey] || 0) + 1

  // 如果传入了 counters 引用，调用方需要自己保存计数器
  // 如果没传入，直接写回 localStorage（向后兼容）
  if (!counters) {
    try {
      localStorage.setItem(STORAGE_KEYS.COUNTERS, JSON.stringify(counterData))
    } catch { /* ignore */ }
  }

  const number = String(counterData[counterKey]).padStart(digitCount, '0')
  return [prefix, dateStr, number].join(separator)
}

/**
 * 截断文本
 */
export function truncateText(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text || ''
  return text.substring(0, maxLength) + '...'
}

/**
 * 防抖函数
 */
export function debounce(func, wait = 300) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * 深拷贝
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj)
  if (obj instanceof Array) return obj.map(item => deepClone(item))
  if (obj instanceof Object) {
    const copy = {}
    Object.keys(obj).forEach(key => {
      copy[key] = deepClone(obj[key])
    })
    return copy
  }
  return obj
}

/**
 * 导出为JSON文件
 */
export function exportToJSON(data, filename = 'knowledge-base-export.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, filename)
}

/**
 * 导出为CSV文件
 */
export function exportToCSV(data, filename = 'knowledge-base-export.csv') {
  if (!data || data.length === 0) return
  
  const headers = Object.keys(data[0])
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header]
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`
        }
        return value
      }).join(',')
    )
  ].join('\n')
  
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, filename)
}

/**
 * 下载Blob文件
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 解析导入的JSON数据
 */
export function parseImportedJSON(jsonString) {
  try {
    const data = JSON.parse(jsonString)
    if (!data || typeof data !== 'object') {
      throw new Error('无效的数据格式')
    }
    return { success: true, data }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 计算文档统计信息
 */
export function calculateStatistics(documents) {
  if (!documents || documents.length === 0) {
    return {
      totalDocs: 0,
      totalSize: 0,
      categoryDistribution: {},
      typeDistribution: {},
      recentDocuments: []
    }
  }

  const categoryDistribution = {}
  const typeDistribution = {}
  let totalSize = 0

  documents.forEach(doc => {
    // 分类统计
    const category = doc.category || 'uncategorized'
    categoryDistribution[category] = (categoryDistribution[category] || 0) + 1

    // 文件类型统计
    const ext = getFileExtension(doc.fileName || doc.title)
    typeDistribution[ext] = (typeDistribution[ext] || 0) + 1

    // 总大小
    totalSize += doc.fileSize || 0
  })

  // 最近文档（按创建时间排序）
  const recentDocuments = [...documents]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10)

  return {
    totalDocs: documents.length,
    totalSize,
    categoryDistribution,
    typeDistribution,
    recentDocuments
  }
}

/**
 * 搜索过滤文档
 */
export function filterDocuments(documents, { search, category, type, sort, tags }) {
  let filtered = [...documents]

  // 搜索过滤
  if (search) {
    const keyword = search.toLowerCase()
    filtered = filtered.filter(doc => {
      const title = (doc.title || '').toLowerCase()
      const content = (doc.content || '').toLowerCase()
      const docNumber = (doc.docNumber || '').toLowerCase()
      const keywords = (doc.keywords || []).join(' ').toLowerCase()
      const fileName = (doc.fileName || '').toLowerCase()
      const smartTitle = (doc.smartTitle || '').toLowerCase()
      const searchIndex = (doc.searchIndex || '').toLowerCase()
      
      return title.includes(keyword) ||
             content.includes(keyword) ||
             docNumber.includes(keyword) ||
             keywords.includes(keyword) ||
             fileName.includes(keyword) ||
             smartTitle.includes(keyword) ||
             searchIndex.includes(keyword)
    })
  }

  // 分类过滤
  if (category && category !== 'all') {
    filtered = filtered.filter(doc => doc.category === category)
  }

  // 文件类型过滤
  if (type && type !== 'all') {
    filtered = filtered.filter(doc => {
      const ext = getFileExtension(doc.fileName || doc.title)
      return ext === type
    })
  }

  // 标签过滤
  if (tags && tags.length > 0) {
    filtered = filtered.filter(doc => {
      const docTags = doc.tags || []
      return tags.some(tag => docTags.includes(tag))
    })
  }

  // 排序
  if (sort) {
    const [field, order] = sort.split('-')
    filtered.sort((a, b) => {
      let aVal = a[field]
      let bVal = b[field]
      
      if (field === 'fileSize') {
        aVal = aVal || 0
        bVal = bVal || 0
      } else if (field === 'title') {
        aVal = (aVal || '').toLowerCase()
        bVal = (bVal || '').toLowerCase()
      } else {
        aVal = aVal ? new Date(aVal).getTime() : 0
        bVal = bVal ? new Date(bVal).getTime() : 0
      }
      
      if (order === 'asc') return aVal > bVal ? 1 : -1
      return aVal < bVal ? 1 : -1
    })
  }

  return filtered
}

/**
 * 分页
 */
export function paginateDocuments(documents, page = 1, pageSize = 20) {
  const total = documents.length
  const totalPages = Math.ceil(total / pageSize)
  const startIndex = (page - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, total)
  
  return {
    documents: documents.slice(startIndex, endIndex),
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: endIndex < total,
      hasPrev: page > 1
    }
  }
}
