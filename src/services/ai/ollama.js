/**
 * Ollama 本地模型适配器
 * 直接调用 Ollama REST API（不依赖 OpenAI SDK）
 */

import { BaseAIAdapter } from './base'
import logger from '../logger'

const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_MODEL = 'qwen2.5:7b-instruct-q4_K_M'
const HEALTH_TTL = 30000

/** 健康检查缓存 */
let _healthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }

export class OllamaAdapter extends BaseAIAdapter {
  get name() { return `Ollama(${OLLAMA_MODEL})` }

  /**
   * 检查 Ollama 是否可用（带 30 秒 TTL 缓存 + 并发去重）
   */
  async isAvailable() {
    const now = Date.now()

    if (now - _healthCache.checkedAt < HEALTH_TTL) {
      return _healthCache.available
    }

    if (_healthCache.checking && _healthCache.checkPromise) {
      return _healthCache.checkPromise
    }

    _healthCache.checking = true
    _healthCache.checkPromise = (async () => {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5000)

        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
          method: 'GET',
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = await response.json()
        const models = data.models || []
        const hasModel = models.some(m => m.name?.startsWith(OLLAMA_MODEL.split(':')[0]))

        _healthCache.available = hasModel
        _healthCache.checkedAt = now
        logger.info(`[Ollama] 健康检查通过，模型 ${OLLAMA_MODEL} ${hasModel ? '已找到' : '未找到'}`)
        return hasModel
      } catch (err) {
        _healthCache.available = false
        _healthCache.checkedAt = now
        logger.warn('[Ollama] 健康检查失败:', err.message)
        return false
      } finally {
        _healthCache.checking = false
        _healthCache.checkPromise = null
      }
    })()

    return _healthCache.checkPromise
  }

  /**
   * 使健康缓存失效（请求失败时调用）
   */
  invalidateHealth() {
    _healthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }
  }

  /**
   * 发送聊天请求到 Ollama
   */
  async chat(systemPrompt, userPrompt, options = {}) {
    const { timeoutMs = 180000 } = options

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    const startTime = Date.now()

    try {
      logger.info(`[AI] request_start | model=${this.name} | promptLength=${userPrompt.length}`)

      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt + '\n\n请严格返回 JSON 格式，不要包含任何其他文字。' }
          ],
          stream: false,
          format: 'json'
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`Ollama API 请求失败: ${response.status}`)
      }

      const requestTime = Date.now() - startTime
      logger.info(`[AI] request_complete | model=${this.name} | requestTime=${requestTime}ms`)

      const data = await response.json()
      return data.message?.content || ''
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/** 单例导出 */
export const ollamaAdapter = new OllamaAdapter()
