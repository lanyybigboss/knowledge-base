/**
 * 角色匹配服务
 * 从 AI 分析的 actionItems 中提取待办，匹配用户身份后触发推送
 */

import storageService from './storageService'
import { pushTodosToWebhook } from './webhookService'
import logger from './logger'

/**
 * 处理文档的 actionItems：创建待办 + 角色匹配 + Webhook 推送
 * @param {string} documentId - 文档 ID
 * @param {Array} actionItems - AI 提取的行动项数组
 * @param {string} source - 来源: 'ai' | 'manual'
 * @returns {Promise<Array>} 创建的待办数组（仅匹配当前用户的项）
 */
export async function processActionItems(documentId, actionItems, source = 'ai') {
  if (!actionItems || actionItems.length === 0) return []

  const profile = await storageService.getUserProfile()
  const matchedTodos = []

  for (const item of actionItems) {
    // 创建待办到数据库
    const todo = await storageService.addTodo({
      documentId,
      title: item.title,
      targetRole: item.targetRole || '',
      targetPerson: item.targetPerson || '',
      dueDate: item.dueDate || null,
      source
    })

    // 角色匹配：是否与当前用户相关
    if (isMatchForCurrentUser(todo, profile)) {
      matchedTodos.push(todo)
    }
  }

  logger.info(`[RoleMatching] 文档 ${documentId}: ${actionItems.length} 个行动项, ${matchedTodos.length} 个匹配当前用户`)

  // 仅推送匹配当前用户的待办
  if (matchedTodos.length > 0) {
    try {
      const doc = await storageService.getDocument(documentId)
      await pushTodosToWebhook(matchedTodos, doc?.title || doc?.smartTitle || '')
    } catch (e) {
      logger.error('[RoleMatching] Webhook 推送失败:', e.message)
    }
  }

  return matchedTodos
}

/**
 * 检查待办是否匹配当前用户
 * 匹配规则：
 *   1. targetPerson 包含用户姓名 → 直接匹配
 *   2. targetRole 包含用户角色关键词 → 匹配
 *   3. targetRole 包含用户自定义关键词 → 匹配
 *
 * @param {object} todo - 待办对象 { targetRole, targetPerson, ... }
 * @param {object} userProfile - 用户档案 { name, role, keywords }
 * @returns {boolean}
 */
export function isMatchForCurrentUser(todo, userProfile) {
  if (!userProfile) return false

  const { name, role, keywords = [] } = userProfile

  // 用户未配置身份信息，不触发匹配
  if (!name && !role && keywords.length === 0) return false

  // 规则 1：直接人名匹配
  if (todo.targetPerson && name) {
    if (todo.targetPerson.toLowerCase().includes(name.toLowerCase())) {
      return true
    }
  }

  // 规则 2：角色名称匹配
  if (todo.targetRole && role) {
    const targetLower = todo.targetRole.toLowerCase()
    const roleLower = role.toLowerCase()
    if (targetLower.includes(roleLower) || roleLower.includes(targetLower)) {
      return true
    }
  }

  // 规则 3：关键词匹配
  if (todo.targetRole && keywords.length > 0) {
    const targetLower = todo.targetRole.toLowerCase()
    if (keywords.some(kw => kw && targetLower.includes(kw.toLowerCase()))) {
      return true
    }
  }

  // 无 targetRole 也无 targetPerson → 通用待办，不自动匹配
  return false
}
