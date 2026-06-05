/**
 * 小米 MiMo Token Plan 适配器
 * 兼容 OpenAI Chat Completions 格式
 */

import { BaseAIAdapter } from './base'
import logger from '../logger'

const MIMO_TOKEN_PLAN_URL = 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
const MIMO_MODELS = ['mimo-v2.5-pro', 'mimo-v2-flash']

function getApiKey() {
  const key = localStorage.getItem('mimo_api_key') || ''
  if (key && typeof key === 'string' && key.trim().length >= 10) {
    return key.trim()
  }
  return ''
}

export class MimoAdapter extends BaseAIAdapter {
  get name() { return `MiMo(${MIMO_MODELS[0]})` }

  async isAvailable() {
    return !!getApiKey()
  }

  async chat(systemPrompt, userPrompt, options = {}) {
    const { maxTokens = 2048, timeoutMs = 120000 } = options

    const apiKey = getApiKey()
    if (!apiKey) {
      throw new Error('未配置 MiMo Token Plan API Key')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const startTime = Date.now()

    try {
      logger.info(`[AI] request_start | model=${this.name} | promptLength=${userPrompt.length}`)

      const response = await fetch(MIMO_TOKEN_PLAN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: MIMO_MODELS[0],
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
        throw new Error(error.error?.message || error.message || `MiMo API 请求失败: ${response.status}`)
      }

      const data = await response.json()
      return data.choices[0].message.content
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/** 单例导出 */
export const mimoAdapter = new MimoAdapter()

/** 保存 MiMo API Key */
export function saveMimoApiKey(key) {
  localStorage.setItem('mimo_api_key', key)
}

/** 检查是否有 MiMo API Key */
export function hasMimoApiKey() {
  return !!getApiKey()
}
