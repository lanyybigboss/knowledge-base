/**
 * AI 智能分析服务 — 薄代理层
 * 实际逻辑已迁移到 ./ai/ 目录（adapter 模式）
 * 保持此文件以兼容所有现有导入路径
 */

export {
  analyzeDocument,
  analyzeDocuments,
  generateDetailedPreview,
  isOllamaAvailable,
  invalidateOllamaHealth,
  saveApiKey,
  hasApiKey,
  saveMimoApiKey,
  hasMimoApiKey
} from './ai/index'
