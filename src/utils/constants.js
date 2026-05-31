/**
 * 知识库管理系统 - 常量定义
 */

// 预设分类
export const PRESET_CATEGORIES = [
  { id: 'technology', name: '技术文档', icon: '💻', color: '#3b82f6' },
  { id: 'business', name: '商业资料', icon: '💼', color: '#10b981' },
  { id: 'research', name: '研究报告', icon: '🔬', color: '#8b5cf6' },
  { id: 'education', name: '教育培训', icon: '📚', color: '#f59e0b' },
  { id: 'personal', name: '个人笔记', icon: '📝', color: '#ec4899' },
  { id: 'archive', name: '归档文件', icon: '📦', color: '#6b7280' }
]

// 文件类型映射
export const FILE_TYPE_MAP = {
  pdf: { label: 'PDF', icon: '📄', color: '#ef4444' },
  doc: { label: 'Word', icon: '📝', color: '#2563eb' },
  docx: { label: 'Word', icon: '📝', color: '#2563eb' },
  xls: { label: 'Excel', icon: '📊', color: '#16a34a' },
  xlsx: { label: 'Excel', icon: '📊', color: '#16a34a' },
  ppt: { label: 'PPT', icon: '📽️', color: '#ea580c' },
  pptx: { label: 'PPT', icon: '📽️', color: '#ea580c' },
  txt: { label: '文本', icon: '📃', color: '#6b7280' },
  md: { label: 'Markdown', icon: '📝', color: '#6366f1' },
  csv: { label: 'CSV', icon: '📊', color: '#059669' },
  json: { label: 'JSON', icon: '📋', color: '#d97706' },
  xml: { label: 'XML', icon: '📋', color: '#7c3aed' },
  html: { label: 'HTML', icon: '🌐', color: '#dc2626' },
  png: { label: '图片', icon: '🖼️', color: '#0891b2' },
  jpg: { label: '图片', icon: '🖼️', color: '#0891b2' },
  jpeg: { label: '图片', icon: '🖼️', color: '#0891b2' },
  gif: { label: '图片', icon: '🖼️', color: '#0891b2' },
  svg: { label: '图片', icon: '🖼️', color: '#0891b2' },
  zip: { label: '压缩包', icon: '🗜️', color: '#78716c' },
  rar: { label: '压缩包', icon: '🗜️', color: '#78716c' },
  '7z': { label: '压缩包', icon: '🗜️', color: '#78716c' }
}

// 编号规则默认配置
export const DEFAULT_NUMBERING_RULES = {
  prefix: 'DOC',
  dateFormat: 'YYYYMMDD',
  separator: '-',
  digitCount: 4,
  enabled: true
}

// 排序选项
export const SORT_OPTIONS = [
  { value: 'createdAt-desc', label: '最新创建' },
  { value: 'createdAt-asc', label: '最早创建' },
  { value: 'updatedAt-desc', label: '最近更新' },
  { value: 'title-asc', label: '标题 A-Z' },
  { value: 'title-desc', label: '标题 Z-A' },
  { value: 'fileSize-desc', label: '文件最大' },
  { value: 'fileSize-asc', label: '文件最小' }
]

// 每页显示数量
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// 存储键名
export const STORAGE_KEYS = {
  DOCUMENTS: 'kb_documents',
  CATEGORIES: 'kb_categories',
  NUMBERING_RULES: 'kb_numbering_rules',
  SETTINGS: 'kb_settings',
  COUNTERS: 'kb_counters'
}

// 支持的文件类型
export const SUPPORTED_FILE_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/html',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml'
]

// 最大文件大小 (50MB)
export const MAX_FILE_SIZE = 50 * 1024 * 1024

// ==================== [OBSIDIAN_ENABLED] 取消注释以启用 Obsidian 集成 ====================
// export const SOURCE_OBSIDIAN = 'obsidian'
// export const OBSIDIAN_FRONTMATTER_AI_FIELDS = ['ai_summary', 'ai_category', 'ai_tags', 'ai_keywords', 'ai_entities', 'analyzed_at']

