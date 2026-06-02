/**
 * AI 适配器基类
 * 定义统一的 LLM 接口，所有具体适配器必须实现这些方法
 */

export class BaseAIAdapter {
  /** 适配器名称 */
  get name() { throw new Error('Not implemented') }

  /** 检查该适配器是否可用 */
  async isAvailable() { throw new Error('Not implemented') }

  /**
   * 发送聊天请求并返回原始文本
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户提示词
   * @param {object} [options] - 可选参数
   * @param {number} [options.maxTokens] - 最大 token 数
   * @param {number} [options.timeoutMs] - 超时毫秒数
   * @returns {Promise<string>} 模型返回的原始文本
   */
  async chat(systemPrompt, userPrompt, options = {}) {
    throw new Error('Not implemented')
  }
}
