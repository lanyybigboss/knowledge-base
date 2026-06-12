/**
 * Ollama 本地模型适配器
 * 直接调用 Ollama REST API（不依赖 OpenAI SDK）
 */

import { BaseAIAdapter } from './base'
import logger from '../logger'

const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_MODELS = ['qwen2.5:7b-instruct-q4_K_M', 'qwen3:8b']
const HEALTH_TTL = 30000

/** 健康检查缓存 */
let _healthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }

export class OllamaAdapter extends BaseAIAdapter {
  get name() { return `Ollama(${OLLAMA_MODELS[0]})` }

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
        const modelNames = models.map(m => m.name || '')
        const hasModel = OLLAMA_MODELS.some(m => modelNames.some(n => n.startsWith(m.split(':')[0])))

        _healthCache.available = hasModel
        _healthCache.checkedAt = now
        logger.info(`[Ollama] 健康检查通过，模型 ${hasModel ? '已找到' : '未找到'} (${OLLAMA_MODELS.join(', ')})`)
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
   * 发送聊天请求到 Ollama（模型降级链：7b → 3b）
   */
  async chat(systemPrompt, userPrompt, options = {}) {
    const { timeoutMs = 300000 } = options // qwen3:8b 需要更长时间，设置为 5 分钟
    const startTime = Date.now()

    for (const model of OLLAMA_MODELS) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      // qwen3 系列默认开启思考，需添加 /no_think 禁用
      const thinkDisable = model.startsWith('qwen3') ? '/no_think\n\n' : ''
      const fullPrompt = thinkDisable + userPrompt + '\n\n请严格返回 JSON 格式，不要包含任何其他文字。'

      try {
        logger.info(`[AI] request_start | model=Ollama(${model}) | promptLength=${userPrompt.length}`)

        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: fullPrompt }
            ],
            stream: false,
            format: 'json',
            think: false // 明确禁用思考模式
          }),
          signal: controller.signal
        })

        if (!response.ok) {
          logger.warn(`[Ollama] ${model} 返回 ${response.status}，尝试下一个模型...`)
          continue
        }

        const requestTime = Date.now() - startTime
        logger.info(`[AI] request_complete | model=Ollama(${model}) | requestTime=${requestTime}ms`)

        const data = await response.json()
        return data.message?.content || ''
      } catch (err) {
        logger.warn(`[Ollama] ${model} 请求失败: ${err.message}，尝试下一个模型...`)
      } finally {
        clearTimeout(timeoutId)
      }
    }

    throw new Error('所有 Ollama 模型均不可用')
  }
}

/** 单例导出 */
export const ollamaAdapter = new OllamaAdapter()
