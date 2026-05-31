/**
 * AI 智能服务 - 调用 DeepSeek API / Ollama 本地模型
 * 用于文档内容深度分析、自动分类、标签生成、详细摘要
 */

import logger from './logger'

// DeepSeek API 配置
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

// Ollama API 配置
const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_MODEL = 'qwen2.5:7b-instruct-q4_K_M'
const OLLAMA_HEALTH_TTL = 30000 // 健康状态缓存 30 秒

// 从 localStorage 获取 API Key
function getApiKey() {
  const key = localStorage.getItem('deepseek_api_key') || ''
  // 校验 Key 合法性：DeepSeek API Key 通常以 "sk-" 开头，至少 20 个字符
  if (key && typeof key === 'string' && key.trim().length >= 20) {
    return key.trim()
  }
  return ''
}

/**
 * 保存 API Key
 */
export function saveApiKey(key) {
  localStorage.setItem('deepseek_api_key', key)
}

/**
 * 检查是否已配置 API Key
 */
export function hasApiKey() {
  return !!getApiKey()
}

/**
 * 调用 DeepSeek API（带超时和重试）
 * @param {Array} messages - 消息数组
 * @param {number} maxTokens - 最大 token 数
 * @param {number} timeoutMs - 超时毫秒数（默认 60 秒）
 */
async function callDeepSeek(messages, maxTokens = 2048, timeoutMs = 60000) {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('请先配置 DeepSeek API Key')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const startTime = Date.now()
  let requestTime = 0

  try {
    logger.info(`[AI] deepseek_request_start | model=${DEEPSEEK_MODEL} | messageCount=${messages.length}`)
    
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3
      }),
      signal: controller.signal
    })

    // 记录请求完成时间
    requestTime = Date.now() - startTime
    logger.info(`[AI] deepseek_request_complete | requestTime=${requestTime}ms`)

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error?.message || `API 请求失败: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content
    logger.info(`[AI] deepseek_response_received | contentLength=${content.length} | totalTime=${Date.now() - startTime}ms`)
    return content
  } finally {
    clearTimeout(timeoutId)
  }
}

// ===== Ollama 本地模型支持 =====

/** Ollama 健康状态缓存 */
let _ollamaHealthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }

/**
 * 检测 Ollama 服务是否可用（带缓存）
 * @returns {Promise<boolean>}
 */
export async function isOllamaAvailable() {
  const now = Date.now()
  
  // 缓存有效期内直接返回
  if (now - _ollamaHealthCache.checkedAt < OLLAMA_HEALTH_TTL) {
    return _ollamaHealthCache.available
  }

  // 正在检测中，复用结果
  if (_ollamaHealthCache.checking && _ollamaHealthCache.checkPromise) {
    return _ollamaHealthCache.checkPromise
  }

  _ollamaHealthCache.checking = true
  _ollamaHealthCache.checkPromise = (async () => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
        method: 'GET',
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      const models = data.models || []
      const hasModel = models.some(m => m.name?.startsWith(OLLAMA_MODEL.split(':')[0]))

      _ollamaHealthCache.available = hasModel
      _ollamaHealthCache.checkedAt = now
      logger.info(`[Ollama] 健康检测通过，模型 ${OLLAMA_MODEL} ${hasModel ? '已找到' : '未找到'}`)
      return hasModel
    } catch (err) {
      _ollamaHealthCache.available = false
      _ollamaHealthCache.checkedAt = now
      logger.warn(`[Ollama] 健康检测失败:`, err.message)
      return false
    } finally {
      _ollamaHealthCache.checking = false
      _ollamaHealthCache.checkPromise = null
    }
  })()

  return _ollamaHealthCache.checkPromise
}

/**
 * 使 Ollama 健康状态缓存失效（Ollama 报错后调用，避免持续重试已挂的服务）
 */
export function invalidateOllamaHealth() {
  _ollamaHealthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }
}

/**
 * 检测文本是否为乱码（Mojibake / 编码损坏）
 * - U+FFFD 替换字符（UTF-8 解码失败标记）
 * - 非空白控制字符（0x00-0x1F，排除 \t \n \r）
 * - CJK 与 Latin-1 高字节混合模式（经典 Mojibake 特征）
 * @param {string} str
 * @returns {boolean}
 */
function _isTextGarbled(str) {
  if (!str || typeof str !== 'string') return false
  // U+FFFD replacement character
  if (str.includes('\uFFFD')) return true
  // Non-whitespace control characters
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(str)) return true
  // CJK mixed with Latin-1 high-byte (classic mojibake pattern)
  const hasCJK = /[\u4e00-\u9fff]/.test(str)
  const hasHighLatin = /[\x80-\xFF]/.test(str)
  if (hasCJK && hasHighLatin) return true
  return false
}

/**
 * 尝试修复 JSON 文本中的常见问题（尾随逗号等）
 * @param {string} text
 * @returns {{ text: string, repaired: boolean }}
 */
function _tryJsonRepair(text) {
  let repaired = text
  let repairedCount = 0
  
  // 1. 修复尾随逗号
  const afterCommaFix = repaired.replace(/,\s*([}\]])/g, '$1')
  if (afterCommaFix !== repaired) {
    repaired = afterCommaFix
    repairedCount++
  }
  
  // 2. 修复单引号（简单场景：key 或 value 用单引号）
  // 只修复明显的单引号场景，避免误修
  const afterQuoteFix = repaired.replace(/'([^']*)'/g, '"$1"')
  if (afterQuoteFix !== repaired) {
    repaired = afterQuoteFix
    repairedCount++
  }
  
  // 3. 修复未加引号的 key（简单场景：key 是字母数字下划线）
  const afterKeyFix = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
  if (afterKeyFix !== repaired) {
    repaired = afterKeyFix
    repairedCount++
  }
  
  return { text: repaired, repaired: repairedCount > 0 }
}

/**
 * 调用 Ollama 进行文档分析
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userPrompt - 用户提示词
 * @returns {Promise<object>} 分析结果（JSON 对象）
 */
async function analyzeDocumentOllama(systemPrompt, userPrompt) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 180000)
  const startTime = Date.now()
  let requestTime = 0
  let parseTime = 0

  try {
    logger.info(`[AI] request_start | model=Ollama(${OLLAMA_MODEL}) | promptLength=${userPrompt.length}`)

    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt + '\n\n请严格返回 JSON 格式，不要包含其他文字。' }
        ],
        stream: false
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`Ollama API 请求失败: ${response.status}`)
    }

    // 记录请求完成时间
    requestTime = Date.now() - startTime
    logger.info(`[AI] request_complete | model=Ollama | requestTime=${requestTime}ms`)

    const data = await response.json()
    const text = data.message?.content || ''

    // [raw_response] 完整输出 Ollama 原始响应
    logger.info(`[AI] raw_response | model=Ollama | textLength=${text.length} | text="${text}"`)

    // 解析 Ollama 返回的 JSON（多层降级策略）
    let cleaned = text
    let extractMethod = 'none'
    
    // 策略1：尝试直接解析整个文本（快速路径）
    try {
      JSON.parse(text.trim())
      cleaned = text.trim()
      extractMethod = 'direct'
      logger.info(`[AI] json_extract_success | model=Ollama | method=${extractMethod}`)
    } catch (e1) {
      // 策略2：从最后一个 ```json ... ``` 代码块提取（模型常在 JSON 前后添加解释）
      const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
      if (fenceMatches.length > 0) {
        const lastMatch = fenceMatches[fenceMatches.length - 1][1].trim()
        try {
          JSON.parse(lastMatch)
          cleaned = lastMatch
          extractMethod = 'fence-last'
          logger.info(`[AI] json_extract_success | model=Ollama | method=${extractMethod} | blockCount=${fenceMatches.length}`)
        } catch (e2) {
          // 策略3：从第一个代码块提取（降级）
          const firstMatch = fenceMatches[0][1].trim()
          cleaned = firstMatch
          extractMethod = 'fence-first'
          logger.info(`[AI] json_extract_fallback | model=Ollama | method=${extractMethod}`)
        }
      } else {
        // 策略4：提取第一个 { 到最后一个 } 之间的内容（处理非标准输出）
        const startIdx = text.indexOf('{')
        const endIdx = text.lastIndexOf('}')
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          const extracted = text.substring(startIdx, endIdx + 1).trim()
          try {
            JSON.parse(extracted)
            cleaned = extracted
            extractMethod = 'brace-match'
            logger.info(`[AI] json_extract_success | model=Ollama | method=${extractMethod}`)
          } catch (e3) {
            cleaned = extracted
            extractMethod = 'brace-match-fallback'
            logger.info(`[AI] json_extract_fallback | model=Ollama | method=${extractMethod}`)
          }
        }
      }
    }
    logger.info(`[AI] json_extracted | model=Ollama | cleanedLength=${cleaned.length} | text="${cleaned.substring(0, 200)}"`)

    // 尝试 JSON 修复（尾随逗号等）
    const repairResult = _tryJsonRepair(cleaned)
    if (repairResult.repaired) {
      logger.info(`[AI] json_repaired | model=Ollama | fixed trailing comma`)
      cleaned = repairResult.text
    }

    try {
      const parseStart = Date.now()
      const parsed = JSON.parse(cleaned)
      parseTime = Date.now() - parseStart
      
      logger.info(`[AI] parsed_result | model=Ollama | parsed=`, JSON.stringify(parsed, null, 2))
      logger.info(`[AI] performance | model=Ollama | requestTime=${requestTime}ms | parseTime=${parseTime}ms | totalTime=${Date.now() - startTime}ms`)

      // 检查 summary 是否为空
      if (!parsed.summary || String(parsed.summary).trim() === '') {
        logger.warn(`[AI] EMPTY_SUMMARY_AFTER_PARSE | model=Ollama | parsed keys: ${Object.keys(parsed).join(',')}`)
      }

      // 检查 keywords 是否乱码
      if (parsed.keywords && Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
        const rawKeywords = parsed.keywords.map(k => String(k))
        const garbledKws = rawKeywords.filter(kw => _isTextGarbled(kw))
        if (garbledKws.length > 0) {
          logger.warn(`[AI] GARBLED_KEYWORDS_DETECTED | model=Ollama | garbledCount=${garbledKws.length} | keywords=`, parsed.keywords, ' | charCodes=', rawKeywords.map(k => Array.from(k).map(c => c.charCodeAt(0)).join(',')))
        }
      }

      return parsed
    } catch (parseErr) {
      // JSON 解析失败，标记为降级（不再穿透到 DeepSeek）
      logger.warn('[Ollama] JSON 解析失败，标记降级:', parseErr.message)
      return { ...normalizeResult({ category: 'other' }), _fallback: true }
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 规范化 AI 分析结果（统一格式）
 * 手册要求：normalizeResult() 接受部分字段，补齐默认值
 */
function normalizeResult(analysis) {
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  // 规范化标签：确保格式为 YYYYMMDD-内容摘要
  const tags = (analysis.tags || []).map(tag => {
    if (typeof tag !== 'string' || !tag.trim()) return null
    // 如果标签已有日期前缀则保留，否则自动添加
    if (!/^\d{8}-/.test(tag)) return `${dateStr}-${tag}`
    return tag
  }).filter(Boolean)  // 过滤 null/空值

  // 如果标签不足 2 个，用摘要或标题自动补齐
  while (tags.length < 2) {
    const fallbackText = analysis.summary?.substring(0, 15) || analysis.smartTitle?.substring(0, 15) || '文档'
    // 确保文本不含换行和特殊字符
    const safeText = fallbackText.replace(/[\r\n\t]/g, ' ').replace(/[<>:"/\\|?*]/g, '').substring(0, 15)
    if (safeText) {
      tags.push(`${dateStr}-${safeText}`)
    } else {
      tags.push(`${dateStr}-文档`)
    }
  }

  // 安全转字符串：兼容 Ollama 返回对象类型字段（如 detailedSummary 为嵌套对象）
  const safeStr = (val, fallback = '') => {
    if (!val) return fallback
    if (typeof val === 'string') return val
    try { return JSON.stringify(val) } catch (e) { return String(val) }
  }

  return {
    category: analysis.category || 'other',
    summary: safeStr(analysis.summary).replace(/[\x00-\x1F\x7F]/g, ''),
    detailedSummary: safeStr(analysis.detailedSummary, safeStr(analysis.summary)).replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, ''),
    keywords: (analysis.keywords || []).filter(Boolean).slice(0, 8),
    tags: tags.slice(0, 3),
    entities: analysis.entities || { people: [], organizations: [], locations: [], dates: [] },
    smartTitle: safeStr(analysis.smartTitle).substring(0, 20).replace(/[\x00-\x1F\x7F]/g, '')
  }
}

/**
 * 字段校验：验证 normalizeResult 的输出是否有实质内容
 * 流程：AI成功 → JSON合法 → 字段校验 → 写入summary/tags → aiAnalyzed=true
 * @param {object} normalized - normalizeResult() 的输出
 * @returns {{ valid: boolean, reason: string }}
 */
function validateAnalysisResult(normalized) {
  const summaryOk = (normalized.summary || '').replace(/[\s\u3000]/g, '').length >= 3
  const detailedOk = (normalized.detailedSummary || '').replace(/[\s\u3000]/g, '').length >= 20
  const keywordsOk = (normalized.keywords || []).length >= 2
  const smartTitleOk = (normalized.smartTitle || '').trim().length >= 2

  // 排除仅靠自动补齐标签（内容为"文档"）的伪有效结果：
  // 标签中只有 auto-filled 的 '文档' 标签不算有效分析
  const hasRealTag = (normalized.tags || []).some(tag => {
    // 标签格式：YYYYMMDD-内容，排除纯占位标签
    const contentPart = tag.replace(/^\d{8}-/, '')
    return contentPart && contentPart !== '文档' && contentPart.trim().length >= 1
  })

  // 校验规则：至少满足以下任意一组
  // A) 有摘要 + 关键词
  if (summaryOk && keywordsOk) return { valid: true, reason: '' }
  // B) 有详细摘要
  if (detailedOk) return { valid: true, reason: '' }
  // C) 有智能标题 + 关键词
  if (smartTitleOk && keywordsOk) return { valid: true, reason: '' }
  // D) 有摘要 + 智能标题 + 真实标签
  if (summaryOk && smartTitleOk && hasRealTag) return { valid: true, reason: '' }

  // 不满足任何一组 → 判定无效
  if (!summaryOk && !detailedOk) return { valid: false, reason: '缺少有效摘要（summary/detailedSummary 为空或过短）' }
  if (!keywordsOk) return { valid: false, reason: '关键词不足（少于2个）' }
  return { valid: false, reason: '分析结果内容不足' }
}

/**
 * 智能分析文档内容 - 深度分析版
 * 返回: { category, summary, detailedSummary, keywords, tags, entities }
 * 
 * 降级策略（v1.5.1）：
 *   Ollama (qwen2.5:7b) 优先 → DeepSeek API 后备 → 返回降级结果(_fallback:true)
 */
export async function analyzeDocument(content, title, fileName) {
  const systemPrompt = `你是一个专业的文档分析助手。请对文档内容进行深度分析，返回 JSON 格式的分析结果。

分析要求：
1. category: 从以下分类中选择最匹配的一个（只返回分类ID）：
   - technology: 技术文档（编程、开发、技术方案、系统架构等）
   - business: 商业文档（合同、报告、商业计划、财务分析等）
   - research: 研究资料（论文、研究报告、数据分析、学术文献等）
   - education: 教育学习（教程、课程资料、学习笔记、教学材料等）
   - personal: 个人笔记（日记、随笔、个人记录、会议记录、工作计划等）
   - other: 其他（不属于以上分类的文档）

2. summary: 用一句话概括文档核心内容（不超过30字，用于列表显示）

3. detailedSummary: 详细摘要（300-500字，类似学术论文摘要格式）：
   - 文档的主要目的/主题
   - 关键发现或结论
   - 重要数据或事实
   - 如果涉及人物，需提及具体人名和其角色
   - 如果涉及项目，需提及项目名称和进展
   - 如果涉及技术，需提及具体技术名称
   格式要求：段落形式，语言流畅，信息密度高，内容充实

4. keywords: 提取5-8个关键词（数组格式），要具体、有区分度

5. tags: 生成2-3个标签，格式为"YYYYMMDD-内容摘要"：
   - 第一个标签：当前日期 + 文档核心主题
   - 第二个标签：当前日期 + 文档类型/用途
   - 第三个标签（可选）：当前日期 + 涉及的人物/组织
   例如：["20260520-张三项目方案", "20260520-商业计划书"]

6. entities: 提取文档中出现的实体（对象格式）：
   - people: 人名数组（如 ["张三", "李四"]）
   - organizations: 组织名数组（如 ["阿里巴巴", "腾讯"]）
   - locations: 地点数组（如 ["北京", "上海"]）
   - dates: 重要日期数组（如 ["2026年5月", "2025年Q4"]）

7. smartTitle: 为文档生成一个简洁的中文标题（不超过20字），要求：
   - 提炼文档最核心的主题
   - 用人能理解的自然语言描述
   - 适合用于快速识别和模糊搜索
   - 不要包含日期、编号等元信息
   - 例如："深度学习模型部署方案"、"Q2季度财务分析报告"、"江浙沪客户拜访记录"

请严格返回 JSON 格式，不要包含其他文字。确保分析结果具体、有信息量，避免笼统的描述。`

  const userPrompt = `文档标题：${title || fileName || '未命名文档'}
文档内容：${(content || '').substring(0, 4000)}`

  try {
    let analysis = null
    let usedModel = 'none'

    // === 第一层：优先尝试 Ollama（免费本地模型）===
    const ollamaOk = await isOllamaAvailable()
    if (ollamaOk) {
      try {
        analysis = await analyzeDocumentOllama(systemPrompt, userPrompt)
        usedModel = 'Ollama'
        logger.info(`[Ollama] 分析成功: "${title || fileName}"`)
      } catch (ollamaErr) {
        logger.warn('[Ollama] 分析失败，降级到 DeepSeek:', ollamaErr.message)
        invalidateOllamaHealth()
        usedModel = 'Ollama-failed'
      }
    }

    // === 第二层：降级到 DeepSeek ===
    if (!analysis || analysis._fallback) {
      if (getApiKey()) {
        try {
          logger.info(`[AI] request_start | model=DeepSeek(${DEEPSEEK_MODEL}) | promptLength=${userPrompt.length}`)

          const result = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ], 2048)

          // [raw_response] 完整输出 DeepSeek 原始响应
          logger.info(`[AI] raw_response | model=DeepSeek | textLength=${result.length} | text="${result}"`)

          let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          logger.info(`[AI] json_extracted | model=DeepSeek | cleanedLength=${cleaned.length} | text="${cleaned.substring(0, 200)}"`)

          // 尝试 JSON 修复
          const repairResult = _tryJsonRepair(cleaned)
          if (repairResult.repaired) {
            logger.info(`[AI] json_repaired | model=DeepSeek | fixed trailing comma`)
            cleaned = repairResult.text
          }

          const parsed = JSON.parse(cleaned)
          logger.info(`[AI] parsed_result | model=DeepSeek | parsed=`, JSON.stringify(parsed, null, 2))

          // 检查 summary 是否为空
          if (!parsed.summary || String(parsed.summary).trim() === '') {
            logger.warn(`[AI] EMPTY_SUMMARY_AFTER_PARSE | model=DeepSeek | parsed keys: ${Object.keys(parsed).join(',')}`)
          }

          // 检查 keywords 是否乱码
          if (parsed.keywords && Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
            const rawKeywords = parsed.keywords.map(k => String(k))
            const garbledKws = rawKeywords.filter(kw => _isTextGarbled(kw))
            if (garbledKws.length > 0) {
              logger.warn(`[AI] GARBLED_KEYWORDS_DETECTED | model=DeepSeek | garbledCount=${garbledKws.length} | keywords=`, parsed.keywords, ' | charCodes=', rawKeywords.map(k => Array.from(k).map(c => c.charCodeAt(0)).join(',')))
            }
          }

          analysis = parsed
          usedModel = 'DeepSeek'
          logger.info(`[DeepSeek] 分析成功: "${title || fileName}"`)
        } catch (dsErr) {
          logger.warn('[DeepSeek] 分析失败:', dsErr.message)
          usedModel = 'DeepSeek-failed'
        }
      } else {
        usedModel = 'no-api-key'
      }
    }

    // === 结果处理 ===
    if (analysis) {
      const normalized = { ...normalizeResult(analysis), ...(analysis._fallback && { _fallback: true }) }
      // [validated_result] 字段类型校验
      const validation = validateAnalysisResult(normalized)
      logger.info(`[AI] validated_result | model=${usedModel} | valid=${validation.valid} | reason="${validation.reason}" | summary=typeof:${typeof normalized.summary}(${normalized.summary?.length || 0}) | keywords=Array.isArray:${Array.isArray(normalized.keywords)}(${normalized.keywords?.length || 0}) | category=typeof:${typeof normalized.category}`)
      if (!validation.valid) {
        logger.warn(`[AI] 字段校验未通过 (${validation.reason})，标记降级: "${title || fileName}"`)
        return { ...normalized, _fallback: true }
      }
      return normalized
    }

    // 全部失败 → 返回降级结果
    logger.warn(`[AI] 分析完全失败 (${usedModel})，返回降级结果: "${title || fileName}"`)
    const today = new Date()
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const fallbackTitle = (title || fileName || '文档').substring(0, 20)
    
    return {
      category: 'other',
      summary: '',
      detailedSummary: '',
      keywords: [],
      tags: [`${dateStr}-${fallbackTitle}`],
      entities: { people: [], organizations: [], locations: [], dates: [] },
      smartTitle: `未命名-${dateStr}`,
      _fallback: true
    }
  } catch (error) {
    logger.error('AI 分析失败:', error)
    // 返回降级结果对象（手册要求：analyzeDocument() 永不返回 null，始终返回有效对象）
    // 调用方应检查 _fallback 标记，若为 true 则不应覆盖已有的分析结果
    const today = new Date()
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const fallbackTitle = (title || fileName || '文档').substring(0, 20)
    
    return {
      category: 'other',
      summary: '',
      detailedSummary: '',
      keywords: [],
      tags: [`${dateStr}-${fallbackTitle}`],
      entities: { people: [], organizations: [], locations: [], dates: [] },
      smartTitle: `未命名-${dateStr}`,
      _fallback: true
    }
  }
}

/**
 * 生成文档详细预览摘要
 */
export async function generateDetailedPreview(content, title) {
  const systemPrompt = `你是一个专业的文档摘要生成器。请为文档生成一份详细的预览摘要，格式类似学术论文摘要。

要求：
1. 摘要长度：300-500字
2. 包含以下要素：
   - 背景/目的：文档要解决什么问题或达成什么目的
   - 方法/内容：文档的主要内容或方法
   - 结果/发现：关键发现、结论或数据
   - 意义/价值：文档的价值或意义
3. 如果文档涉及具体人物，必须提及人名
4. 如果涉及项目、技术、数据，必须具体说明
5. 语言专业、流畅、信息密度高
6. 段落形式，不要使用列表

请直接返回摘要文本，不要包含其他内容。`

  const userPrompt = `文档标题：${title || '未命名'}
文档内容：${(content || '').substring(0, 5000)}`

  try {
    const result = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], 2048)

    return result.trim()
  } catch (error) {
    logger.error('生成预览摘要失败:', error)
    return (content || '').substring(0, 300) + '...'
  }
}

/**
 * 批量分析文档
 * @param {Array} files - 文件对象数组 [{ file: File, content: string }]
 *   file: 原始 File 对象（用于自动读取文本文件）
 *   content: 已提取的文本内容（用于 OCR 或 DOCX 提取后的文件）
 */
export async function analyzeDocuments(files) {
  const results = []
  
  for (const item of files) {
    try {
      let content = ''
      const file = item.file || item
      const fileContent = item.content || ''

      if (fileContent) {
        content = fileContent
      } else {
        const textTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html']
        if (textTypes.includes(file.type) || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
          content = await file.text()
        }
      }

      if (!content || content.trim().length < 20) {
        logger.warn(`文件 ${file.name} 内容太少（<20字符），跳过 AI 分析`)
        results.push({ fileName: file.name, _fallback: true, category: 'other', summary: '', detailedSummary: '', keywords: [], tags: [], entities: { people: [], organizations: [], locations: [], dates: [] }, smartTitle: '' })
        continue
      }

      const analysis = await analyzeDocument(content, file.name.replace(/\.[^/.]+$/, ''), file.name)
      results.push({ fileName: file.name, ...analysis })
    } catch (error) {
      logger.error(`分析文件 ${item.file?.name || item.name} 失败:`, error)
      results.push({ fileName: item.file?.name || item.name, _fallback: true, category: 'other', summary: '', detailedSummary: '', keywords: [], tags: [], entities: { people: [], organizations: [], locations: [], dates: [] }, smartTitle: '' })
    }
  }

  return results
}
