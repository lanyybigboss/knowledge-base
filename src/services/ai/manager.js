/**
 * AI 管理器 — 统一调度 Ollama / DeepSeek，带降级和 JSON 修复
 *
 * 职责：
 * - 按优先级选择适配器（Ollama → DeepSeek → fallback）
 * - JSON 提取、修复、控制字符清洗
 * - 结果规范化和字段校验
 */

import { ollamaAdapter } from './ollama'
import { deepseekAdapter } from './deepseek'
import logger from '../logger'

// ===== JSON 修复工具 =====

/**
 * 检测文本是否为乱码（Mojibake）
 */
function isTextGarbled(str) {
  if (!str || typeof str !== 'string') return false
  if (str.includes('�')) return true
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(str)) return true
  const hasCJK = /[一-鿿]/.test(str)
  const hasHighLatin = /[\x80-\xFF]/.test(str)
  if (hasCJK && hasHighLatin) return true
  return false
}

/**
 * 尝试修复 JSON 中的常见问题（尾逗号、单引号、未加引号的 key）
 */
function tryJsonRepair(text) {
  let repaired = text
  let count = 0

  const afterComma = repaired.replace(/,\s*([}\]])/g, '$1')
  if (afterComma !== repaired) { repaired = afterComma; count++ }

  const afterQuote = repaired.replace(/'([^']*)'/g, '"$1"')
  if (afterQuote !== repaired) { repaired = afterQuote; count++ }

  const afterKey = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
  if (afterKey !== repaired) { repaired = afterKey; count++ }

  return { text: repaired, repaired: count > 0 }
}

/**
 * 从原始文本中提取 JSON（支持直接解析、代码块、花括号匹配）
 */
function extractJson(rawText) {
  let cleaned = rawText
  let method = 'none'

  // 策略 1：直接解析
  try {
    JSON.parse(cleaned.trim())
    return { text: cleaned.trim(), method: 'direct' }
  } catch { /* continue */ }

  // 策略 2：从 ```json ... ``` 代码块中提取
  const fenceMatches = [...rawText.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  if (fenceMatches.length > 0) {
    const lastMatch = fenceMatches[fenceMatches.length - 1][1].trim()
    try {
      JSON.parse(lastMatch)
      return { text: lastMatch, method: 'fence-last' }
    } catch {
      return { text: fenceMatches[0][1].trim(), method: 'fence-first' }
    }
  }

  // 策略 3：提取第一个 { 到最后一个 } 之间的内容
  const startIdx = rawText.indexOf('{')
  const endIdx = rawText.lastIndexOf('}')
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const extracted = rawText.substring(startIdx, endIdx + 1).trim()
    try {
      JSON.parse(extracted)
      return { text: extracted, method: 'brace-match' }
    } catch {
      return { text: extracted, method: 'brace-match-fallback' }
    }
  }

  return { text: cleaned, method: 'none' }
}

/**
 * 安全解析 JSON（清洗控制字符 + 修复 + 解析）
 */
function safeParseJson(rawText) {
  const { text: extracted, method } = extractJson(rawText)
  logger.info(`[AI] json_extract | method=${method} | length=${extracted.length}`)

  const repairResult = tryJsonRepair(extracted)
  if (repairResult.repaired) {
    logger.info('[AI] json_repaired | fixed trailing comma / quotes / keys')
  }

  // 清洗控制字符
  const sanitized = repairResult.text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  return JSON.parse(sanitized)
}

// ===== 结果规范化 =====

/**
 * 从摘要/关键词中提取后备实体（AI 未返回实体时）
 */
function extractFallbackEntities(keywords, summary, detailedSummary) {
  const text = [summary || '', detailedSummary || ''].join(' ')
  const entities = { people: [], organizations: [], locations: [], dates: [] }

  const datePatterns = [
    /\d{4}年\d{1,2}月/g, /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g,
    /\d{4}[-\/]\d{1,2}/g, /\d{4}年/g, /Q[1-4]/g
  ]
  for (const p of datePatterns) {
    const matches = text.match(p)
    if (matches) entities.dates.push(...matches.slice(0, 3))
  }
  entities.dates = [...new Set(entities.dates)].slice(0, 5)

  if (keywords && keywords.length > 0 && entities.dates.length === 0) {
    entities.dates = keywords.slice(0, 2)
  }

  return entities
}

/**
 * 去除 markdown 标记
 */
function cleanMarkdown(text) {
  if (!text || typeof text !== 'string') return text || ''
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 规范化 AI 分析结果
 */
function normalizeResult(analysis) {
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  const tags = (analysis.tags || []).map(tag => {
    if (typeof tag !== 'string' || !tag.trim()) return null
    if (!/^\d{8}-/.test(tag)) return `${dateStr}-${tag}`
    return tag
  }).filter(Boolean)

  while (tags.length < 2) {
    const fallbackText = analysis.summary?.substring(0, 15) || analysis.smartTitle?.substring(0, 15) || '文档'
    const safeText = fallbackText.replace(/[\r\n\t]/g, ' ').replace(/[<>:"/\\|?*]/g, '').substring(0, 15)
    tags.push(`${dateStr}-${safeText || '文档'}`)
  }

  const safeStr = (val, fallback = '') => {
    if (!val) return fallback
    if (typeof val === 'string') return val
    try { return JSON.stringify(val) } catch { return String(val) }
  }

  return {
    category: analysis.category || 'other',
    summary: cleanMarkdown(safeStr(analysis.summary).replace(/[\x00-\x1F\x7F]/g, '')),
    detailedSummary: cleanMarkdown(safeStr(analysis.detailedSummary, safeStr(analysis.summary)).replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '')),
    keywords: (analysis.keywords || []).filter(Boolean).slice(0, 8),
    tags: tags.slice(0, 3),
    entities: (() => {
      const e = analysis.entities || {}
      const hasEntities = (e.people && e.people.length) || (e.organizations && e.organizations.length) ||
        (e.locations && e.locations.length) || (e.dates && e.dates.length)
      if (hasEntities) return e
      return extractFallbackEntities(analysis.keywords, analysis.summary, analysis.detailedSummary)
    })(),
    smartTitle: safeStr(analysis.smartTitle).substring(0, 20).replace(/[\x00-\x1F\x7F]/g, '')
  }
}

/**
 * 字段校验：验证 normalizeResult 产出是否有效
 */
function validateAnalysisResult(normalized) {
  const summaryOk = (normalized.summary || '').replace(/[\s　]/g, '').length >= 3
  const detailedOk = (normalized.detailedSummary || '').replace(/[\s　]/g, '').length >= 20
  const keywordsOk = (normalized.keywords || []).length >= 2
  const smartTitleOk = (normalized.smartTitle || '').trim().length >= 2

  const hasRealTag = (normalized.tags || []).some(tag => {
    const contentPart = tag.replace(/^\d{8}-/, '')
    return contentPart && contentPart !== '文档' && contentPart.trim().length >= 1
  })

  if (summaryOk && keywordsOk) return { valid: true, reason: '' }
  if (detailedOk) return { valid: true, reason: '' }
  if (smartTitleOk && keywordsOk) return { valid: true, reason: '' }
  if (summaryOk && smartTitleOk && hasRealTag) return { valid: true, reason: '' }

  if (!summaryOk && !detailedOk) return { valid: false, reason: '缺少有效摘要' }
  if (!keywordsOk) return { valid: false, reason: '关键词不足' }
  return { valid: false, reason: '多项内容不足' }
}

// ===== 系统提示词 =====

const SYSTEM_PROMPT = `你是一个专业的文档分析助手。请对以下文档内容进行分析，以严格 JSON 格式返回分析结果，不要包含任何其他文字。

要求：
1. category: 从以下分类中选择最匹配的一个，只返回分类ID：
   - technology: 技术文档（编程、工程、系统架构等）
   - business: 商业文档（合同、企业计划、财务报告等）
   - research: 研究论文、学术报告、数据分析、科学实验等
   - education: 教育学习（教程、课程、学习笔记、教学系统等）
   - personal: 个人笔记、日记、个人记录、日程安排、个人计划等
   - other: 其他无法归类的文档

2. summary: 用一句话概括文档核心内容（不超过30字），不包含标点

3. detailedSummary: 详细摘要（300-500字），按学术文献摘要格式，包含：
   - 文档的主要目的/主题
   - 关键技术或方法
   - 重要数据或事实
   - 如涉及人物，请提及主要人物及其角色
   - 如涉及项目，请提及项目名称和进展
   - 如涉及技术，请提及技术栈和工具
   格式要求：段落式，不要使用列表，确保信息密度高，内容真实

4. keywords: 提取5-8个关键词，按数组格式

5. tags: 生成2-3个标签，格式为"YYYYMMDD-简短描述"：
   - 第一个标签：当前日期 + 文档核心主题
   - 第二个标签：当前日期 + 文档类型/用途
   - 第三个标签（可选）：当前日期 + 涉及的技术/组织

6. entities: 提取文档中出现的实体（按数组格式）
   - people: 人物名称数组
   - organizations: 组织机构数组
   - locations: 地点名称数组
   - dates: 重要日期数组

7. smartTitle: 为文档起一个简短的中文标题（不超过20字），要求：
   - 反映文档的核心主题
   - 使用自然流畅的中文表达
   - 适合在卡片列表中展示
   - 不要包含日期、序号等元信息

严格返回 JSON 格式，不要包含任何其他文字。确保所有字段都有值，使用双引号，不要有尾随逗号。`

// ===== AI 管理器 =====

class AIManager {
  constructor() {
    this.adapters = [ollamaAdapter, deepseekAdapter]
  }

  /**
   * 用第一个可用的适配器发送请求，返回解析后的 JSON
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @returns {Promise<{parsed: object|null, adapter: string, error?: string}>}
   */
  async chat(systemPrompt, userPrompt) {
    for (const adapter of this.adapters) {
      const available = await adapter.isAvailable()
      if (!available) continue

      try {
        const rawText = await adapter.chat(systemPrompt, userPrompt)
        logger.info(`[AI] raw_response | model=${adapter.name} | length=${rawText.length}`)

        const parsed = safeParseJson(rawText)
        logger.info(`[AI] parsed_result | model=${adapter.name}`)

        // 检测乱码关键词
        if (parsed.keywords && Array.isArray(parsed.keywords)) {
          const garbled = parsed.keywords.filter(k => isTextGarbled(String(k)))
          if (garbled.length > 0) {
            logger.warn(`[AI] GARBLED_KEYWORDS | model=${adapter.name} | count=${garbled.length}`)
          }
        }

        return { parsed, adapter: adapter.name }
      } catch (err) {
        logger.warn(`[${adapter.name}] 请求失败:`, err.message)
        if (adapter.invalidateHealth) adapter.invalidateHealth()
      }
    }

    return { parsed: null, adapter: 'none', error: '无可用 AI 服务' }
  }
}

const aiManager = new AIManager()

// ===== 公开 API（保持与原 aiService.js 完全一致） =====

export { ollamaAdapter as isOllamaAvailable_raw }

/**
 * 检查 Ollama 是否可用（兼容旧接口）
 */
export async function isOllamaAvailable() {
  return ollamaAdapter.isAvailable()
}

/**
 * 使 Ollama 健康缓存失效（兼容旧接口）
 */
export function invalidateOllamaHealth() {
  ollamaAdapter.invalidateHealth()
}

/**
 * 保存 API Key
 */
export function saveApiKey(key) {
  localStorage.setItem('deepseek_api_key', key)
}

/**
 * 检查是否有 API Key
 */
export function hasApiKey() {
  return deepseekAdapter.isAvailable()
}

/**
 * 智能分析文档（核心入口，保持原签名）
 * @param {string} content - 文档内容
 * @param {string} title - 文档标题
 * @param {string} fileName - 文件名
 * @returns {Promise<object>} 分析结果（永不返回 null，失败返回 _fallback: true）
 */
export async function analyzeDocument(content, title, fileName) {
  const userPrompt = `文档标题：${title || fileName || '未命名文档'}\n文档内容：${(content || '').substring(0, 4000)}`

  try {
    const { parsed, adapter, error } = await aiManager.chat(SYSTEM_PROMPT, userPrompt)

    if (parsed) {
      const normalized = { ...normalizeResult(parsed), ...(parsed._fallback && { _fallback: true }) }
      const validation = validateAnalysisResult(normalized)

      logger.info(`[AI] validated | model=${adapter} | valid=${validation.valid} | reason="${validation.reason}"`)

      if (!validation.valid) {
        logger.warn(`[AI] 字段校验未通过 (${validation.reason})，标记降级: "${title || fileName}"`)
        return { ...normalized, _fallback: true }
      }

      logger.info(`[Ollama/DeepSeek] 分析成功: "${title || fileName}", smartTitle: "${normalized.smartTitle || '-'}"`)
      return normalized
    }

    // 全部失败 → 返回降级结果
    logger.warn(`[AI] 全部分析失败 (${error})，返回降级结果: "${title || fileName}"`)
    return _buildFallback(title, fileName)
  } catch (error) {
    logger.error('AI 分析失败:', error)
    return _buildFallback(title, fileName)
  }
}

/**
 * 生成文档详细预览摘要
 */
export async function generateDetailedPreview(content, title) {
  const systemPrompt = `你是一个专业的文档摘要助手。请为以下文档生成一段详细的预览摘要，格式类似学术论文摘要。

要求：
1. 摘要长度：300-500字
2. 包含以下要素：
   - 主题/目的：文档要讲什么，解决什么目标
   - 方法/内容：文档的主要内容或方法
   - 结果/发现：关键数据、结论
   - 价值/意义：文档的价值所在
3. 如涉及人物，请提及
4. 如涉及项目，具体说明
5. 如涉及技术，请提及技术栈
6. 使用段落格式，不要使用列表

请直接返回摘要文本，不要包含其他内容。`

  const userPrompt = `文档标题：${title || '未定义'}\n文档内容：${(content || '').substring(0, 5000)}`

  try {
    // 直接用第一个可用适配器获取原始文本（不做 JSON 解析）
    for (const a of aiManager.adapters) {
      if (await a.isAvailable()) {
        const raw = await a.chat(systemPrompt, userPrompt)
        return raw.trim()
      }
    }
    return (content || '').substring(0, 300) + '...'
  } catch (error) {
    logger.error('生成预览摘要失败:', error)
    return (content || '').substring(0, 300) + '...'
  }
}

/**
 * 批量分析多个文档
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
        results.push({ fileName: file.name, ..._buildFallback(null, file.name) })
        continue
      }

      const analysis = await analyzeDocument(content, file.name.replace(/\.[^/.]+$/, ''), file.name)
      results.push({ fileName: file.name, ...analysis })
    } catch (error) {
      logger.error(`分析文件 ${item.file?.name || item.name} 失败:`, error)
      results.push({ fileName: item.file?.name || item.name, ..._buildFallback(null, item.file?.name || item.name) })
    }
  }

  return results
}

// ===== 内部工具 =====

function _buildFallback(title, fileName) {
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
    smartTitle: `未分析-${dateStr}`,
    _fallback: true
  }
}
