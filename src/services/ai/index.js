/**
 * AI 服务统一入口
 * 从 manager.js 重新导出所有公开 API，保持与原 aiService.js 完全兼容
 */

export {
  analyzeDocument,
  analyzeDocuments,
  generateDetailedPreview,
  isOllamaAvailable,
  invalidateOllamaHealth,
  saveApiKey,
  hasApiKey
} from './manager'

export { saveMimoApiKey, hasMimoApiKey } from './mimo'
