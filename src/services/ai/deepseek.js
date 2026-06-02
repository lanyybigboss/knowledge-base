/**
 * DeepSeek 云端 API 适配器
 */

import { BaseAIAdapter } from './base'
import logger from '../logger'

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

function getApiKey() {
  const key = localStorage.getItem('deepseek_api_key') || ''
  if (key && typeof key === 'string' && key.trim().length >= 20) {
    return key.trim()
  }
  return ''
}

export class DeepSeekAdapter extends BaseAIAdapter {
  get name() { return `DeepSeek(${DEEPSEEK_MODEL})` }

  /**
   * 检查是否有有效的 API Key
   */
  async isAvailable() {
    return !!getApiKey()
  }

  /**
   * 发送聊天请求到 DeepSeek API
   */
  async chat(systemPrompt, userPrompt, options = {}) {
    const { maxTokens = 2048, timeoutMs = 60000 } = options

    const apiKey = getApiKey()
    if (!apiKey) {
      throw new Error('未配置 DeepSeek API Key')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const startTime = Date.now()

    try {
      logger.info(`[AI] request_start | model=${this.name} | promptLength=${userPrompt.length}`)

      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: maxTokens,
          temperature: 0.3
        }),
        signal: controller.signal
      })

      const requestTime = Date.now() - startTime
      logger.info(`[AI] request_complete | model=${this.name} | requestTime=${requestTime}ms`)

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error?.message || `API 请求失败: ${response.status}`)
      }

      const data = await response.json()
      return data.choices[0].message.content
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/** 单例导出 */
export const deepseekAdapter = new DeepSeekAdapter()

/** 保存 API Key（保持向后兼容） */
export function saveApiKey(key) {
  localStorage.setItem('deepseek_api_key', key)
}

/** 检查是否有 API Key（保持向后兼容） */
export { getApiKey as hasApiKey }
