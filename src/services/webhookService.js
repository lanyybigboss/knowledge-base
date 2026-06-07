/**
 * Webhook 推送服务
 * 将匹配到的待办通过企业微信/钉钉/飞书群机器人推送到手机
 */

import storageService from './storageService'
import logger from './logger'

/**
 * 推送待办到 Webhook
 * @param {Array} todos - 待推送的待办数组
 * @param {string} documentTitle - 来源文档标题
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
export async function pushTodosToWebhook(todos, documentTitle) {
  if (!todos || todos.length === 0) {
    return { success: false, reason: 'no_todos' }
  }

  const settings = await storageService.getSettings()
  const webhookUrl = settings.webhookUrl

  if (!webhookUrl) {
    logger.info('[Webhook] 未配置 Webhook URL，跳过推送')
    return { success: false, reason: 'no_url' }
  }

  // 构造推送内容
  const lines = [`📋 新待办提醒 — ${documentTitle}`]
  for (const todo of todos) {
    const dueStr = todo.dueDate ? ` (截止: ${todo.dueDate})` : ''
    const roleStr = todo.targetRole ? ` [${todo.targetRole}]` : ''
    lines.push(`• ${todo.title}${roleStr}${dueStr}`)
  }
  const content = lines.join('\n')

  // 企业微信 Webhook 格式
  const payload = {
    msgtype: 'text',
    text: { content }
  }

  try {
    if (window.electronAPI && window.electronAPI.pushWebhook) {
      // Electron 环境：通过主进程发送（绕过 CORS）
      const result = await window.electronAPI.pushWebhook({ url: webhookUrl, payload })
      if (result.success) {
        logger.info(`[Webhook] 推送成功: ${todos.length} 个待办`)
      } else {
        logger.error(`[Webhook] 推送失败: ${result.error}`)
      }
      return result
    } else {
      // Vite 开发环境：直接 fetch
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        logger.error(`[Webhook] HTTP ${response.status}`)
        return { success: false, reason: `HTTP ${response.status}` }
      }
      logger.info(`[Webhook] 推送成功: ${todos.length} 个待办`)
      return { success: true }
    }
  } catch (e) {
    logger.error('[Webhook] 推送异常:', e.message)
    return { success: false, reason: e.message }
  }
}
