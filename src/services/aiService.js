/**
 * AI ���ܷ��� - ���� DeepSeek API / Ollama ����ģ��
 * �����ĵ�������ȷ������Զ����ࡢ��ǩ���ɡ���ϸժҪ
 */

import logger from './logger'

// DeepSeek API ����
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

// Ollama API ����
const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_MODEL = 'qwen2.5:7b-instruct-q4_K_M'
const OLLAMA_HEALTH_TTL = 30000 // ����״̬���� 30 ��

// �� localStorage ��ȡ API Key
function getApiKey() {
  const key = localStorage.getItem('deepseek_api_key') || ''
  // У�� Key �Ϸ��ԣ�DeepSeek API Key ͨ���� "sk-" ��ͷ������ 20 ���ַ�
  if (key && typeof key === 'string' && key.trim().length >= 20) {
    return key.trim()
  }
  return ''
}

/**
 * ���� API Key
 */
export function saveApiKey(key) {
  localStorage.setItem('deepseek_api_key', key)
}

/**
 * ����Ƿ������� API Key
 */
export function hasApiKey() {
  return !!getApiKey()
}

/**
 * ���� DeepSeek API������ʱ�����ԣ�
 * @param {Array} messages - ��Ϣ����
 * @param {number} maxTokens - ��� token ��
 * @param {number} timeoutMs - ��ʱ��������Ĭ�� 60 �룩
 */
async function callDeepSeek(messages, maxTokens = 2048, timeoutMs = 60000) {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('�������� DeepSeek API Key')
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

    // ��¼�������ʱ��
    requestTime = Date.now() - startTime
    logger.info(`[AI] deepseek_request_complete | requestTime=${requestTime}ms`)

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new Error(error.error?.message || `API ����ʧ��: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices[0].message.content
    logger.info(`[AI] deepseek_response_received | contentLength=${content.length} | totalTime=${Date.now() - startTime}ms`)
    return content
  } finally {
    clearTimeout(timeoutId)
  }
}

// ===== Ollama ����ģ��֧�� =====

/** Ollama ����״̬���� */
let _ollamaHealthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }

/**
 * ��� Ollama �����Ƿ���ã������棩
 * @returns {Promise<boolean>}
 */
export async function isOllamaAvailable() {
  const now = Date.now()
  
  // ������Ч����ֱ�ӷ���
  if (now - _ollamaHealthCache.checkedAt < OLLAMA_HEALTH_TTL) {
    return _ollamaHealthCache.available
  }

  // ���ڼ���У����ý��
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
      logger.info(`[Ollama] �������ͨ����ģ�� ${OLLAMA_MODEL} ${hasModel ? '���ҵ�' : 'δ�ҵ�'}`)
      return hasModel
    } catch (err) {
      _ollamaHealthCache.available = false
      _ollamaHealthCache.checkedAt = now
      logger.warn(`[Ollama] �������ʧ��:`, err.message)
      return false
    } finally {
      _ollamaHealthCache.checking = false
      _ollamaHealthCache.checkPromise = null
    }
  })()

  return _ollamaHealthCache.checkPromise
}

/**
 * ʹ Ollama ����״̬����ʧЧ��Ollama ��������ã�������������ѹҵķ���
 */
export function invalidateOllamaHealth() {
  _ollamaHealthCache = { available: false, checkedAt: 0, checking: false, checkPromise: null }
}

/**
 * ����ı��Ƿ�Ϊ���루Mojibake / �����𻵣�
 * - U+FFFD �滻�ַ���UTF-8 ����ʧ�ܱ�ǣ�
 * - �ǿհ׿����ַ���0x00-0x1F���ų� \t \n \r��
 * - CJK �� Latin-1 ���ֽڻ��ģʽ������ Mojibake ������
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
 * �����޸� JSON �ı��еĳ������⣨β�涺�ŵȣ�
 * @param {string} text
 * @returns {{ text: string, repaired: boolean }}
 */
function _tryJsonRepair(text) {
  let repaired = text
  let repairedCount = 0
  
  // 1. �޸�β�涺��
  const afterCommaFix = repaired.replace(/,\s*([}\]])/g, '$1')
  if (afterCommaFix !== repaired) {
    repaired = afterCommaFix
    repairedCount++
  }
  
  // 2. �޸������ţ��򵥳�����key �� value �õ����ţ�
  // ֻ�޸����Եĵ����ų�������������
  const afterQuoteFix = repaired.replace(/'([^']*)'/g, '"$1"')
  if (afterQuoteFix !== repaired) {
    repaired = afterQuoteFix
    repairedCount++
  }
  
  // 3. �޸�δ�����ŵ� key���򵥳�����key ����ĸ�����»��ߣ�
  const afterKeyFix = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
  if (afterKeyFix !== repaired) {
    repaired = afterKeyFix
    repairedCount++
  }
  
  return { text: repaired, repaired: repairedCount > 0 }
}

/**
 * ���� Ollama �����ĵ�����
 * @param {string} systemPrompt - ϵͳ��ʾ��
 * @param {string} userPrompt - �û���ʾ��
 * @returns {Promise<object>} ���������JSON ����
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
          { role: 'user', content: userPrompt + '\n\n���ϸ񷵻� JSON ��ʽ����Ҫ�����������֡�' }
        ],
        stream: false
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`Ollama API ����ʧ��: ${response.status}`)
    }

    // ��¼�������ʱ��
    requestTime = Date.now() - startTime
    logger.info(`[AI] request_complete | model=Ollama | requestTime=${requestTime}ms`)

    const data = await response.json()
    const text = data.message?.content || ''

    // [raw_response] ������� Ollama ԭʼ��Ӧ
    logger.info(`[AI] raw_response | model=Ollama | textLength=${text.length} | text="${text}"`)

    // ���� Ollama ���ص� JSON����㽵�����ԣ�
    let cleaned = text
    let extractMethod = 'none'
    
    // ����1������ֱ�ӽ��������ı�������·����
    try {
      JSON.parse(text.trim())
      cleaned = text.trim()
      extractMethod = 'direct'
      logger.info(`[AI] json_extract_success | model=Ollama | method=${extractMethod}`)
    } catch (e1) {
      // ����2�������һ�� ```json ... ``` �������ȡ��ģ�ͳ��� JSON ǰ�����ӽ��ͣ�
      const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
      if (fenceMatches.length > 0) {
        const lastMatch = fenceMatches[fenceMatches.length - 1][1].trim()
        try {
          JSON.parse(lastMatch)
          cleaned = lastMatch
          extractMethod = 'fence-last'
          logger.info(`[AI] json_extract_success | model=Ollama | method=${extractMethod} | blockCount=${fenceMatches.length}`)
        } catch (e2) {
          // ����3���ӵ�һ���������ȡ��������
          const firstMatch = fenceMatches[0][1].trim()
          cleaned = firstMatch
          extractMethod = 'fence-first'
          logger.info(`[AI] json_extract_fallback | model=Ollama | method=${extractMethod}`)
        }
      } else {
        // ����4����ȡ��һ�� { �����һ�� } ֮������ݣ������Ǳ�׼�����
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

    // ���� JSON �޸���β�涺�ŵȣ�
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

      // ��� summary �Ƿ�Ϊ��
      if (!parsed.summary || String(parsed.summary).trim() === '') {
        logger.warn(`[AI] EMPTY_SUMMARY_AFTER_PARSE | model=Ollama | parsed keys: ${Object.keys(parsed).join(',')}`)
      }

      // ��� keywords �Ƿ�����
      if (parsed.keywords && Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
        const rawKeywords = parsed.keywords.map(k => String(k))
        const garbledKws = rawKeywords.filter(kw => _isTextGarbled(kw))
        if (garbledKws.length > 0) {
          logger.warn(`[AI] GARBLED_KEYWORDS_DETECTED | model=Ollama | garbledCount=${garbledKws.length} | keywords=`, parsed.keywords, ' | charCodes=', rawKeywords.map(k => Array.from(k).map(c => c.charCodeAt(0)).join(',')))
        }
      }

      return parsed
    } catch (parseErr) {
      // JSON ����ʧ�ܣ����Ϊ���������ٴ�͸�� DeepSeek��
      logger.warn('[Ollama] JSON ����ʧ�ܣ���ǽ���:', parseErr.message)
      return { ...normalizeResult({ category: 'other' }), _fallback: true }
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * �淶�� AI ���������ͳһ��ʽ��
 * �ֲ�Ҫ��normalizeResult() ���ܲ����ֶΣ�����Ĭ��ֵ
 */
/**
 * Fallback entity extraction from keywords/summary when AI returns empty entities
 */
function extractFallbackEntities(keywords, summary, detailedSummary) {
  const text = [summary || '', detailedSummary || ''].join(' ')
  const entities = { people: [], organizations: [], locations: [], dates: [] }

  // Extract dates
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
 * Strips markdown artifacts from AI-generated text for plain display
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

function normalizeResult(analysis) {
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

  // �淶����ǩ��ȷ����ʽΪ YYYYMMDD-����ժҪ
  const tags = (analysis.tags || []).map(tag => {
    if (typeof tag !== 'string' || !tag.trim()) return null
    // �����ǩ��������ǰ׺�����������Զ�����
    if (!/^\d{8}-/.test(tag)) return `${dateStr}-${tag}`
    return tag
  }).filter(Boolean)  // ���� null/��ֵ

  // �����ǩ���� 2 ������ժҪ������Զ�����
  while (tags.length < 2) {
    const fallbackText = analysis.summary?.substring(0, 15) || analysis.smartTitle?.substring(0, 15) || '�ĵ�'
    // ȷ���ı��������к������ַ�
    const safeText = fallbackText.replace(/[\r\n\t]/g, ' ').replace(/[<>:"/\\|?*]/g, '').substring(0, 15)
    if (safeText) {
      tags.push(`${dateStr}-${safeText}`)
    } else {
      tags.push(`${dateStr}-�ĵ�`)
    }
  }

  // ��ȫת�ַ��������� Ollama ���ض��������ֶΣ��� detailedSummary ΪǶ�׶���
  const safeStr = (val, fallback = '') => {
    if (!val) return fallback
    if (typeof val === 'string') return val
    try { return JSON.stringify(val) } catch (e) { return String(val) }
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
 * �ֶ�У�飺��֤ normalizeResult ������Ƿ���ʵ������
 * ���̣�AI�ɹ� �� JSON�Ϸ� �� �ֶ�У�� �� д��summary/tags �� aiAnalyzed=true
 * @param {object} normalized - normalizeResult() �����
 * @returns {{ valid: boolean, reason: string }}
 */
function validateAnalysisResult(normalized) {
  const summaryOk = (normalized.summary || '').replace(/[\s\u3000]/g, '').length >= 3
  const detailedOk = (normalized.detailedSummary || '').replace(/[\s\u3000]/g, '').length >= 20
  const keywordsOk = (normalized.keywords || []).length >= 2
  const smartTitleOk = (normalized.smartTitle || '').trim().length >= 2

  // �ų������Զ������ǩ������Ϊ"�ĵ�"����α��Ч�����
  // ��ǩ��ֻ�� auto-filled �� '�ĵ�' ��ǩ������Ч����
  const hasRealTag = (normalized.tags || []).some(tag => {
    // ��ǩ��ʽ��YYYYMMDD-���ݣ��ų���ռλ��ǩ
    const contentPart = tag.replace(/^\d{8}-/, '')
    return contentPart && contentPart !== '�ĵ�' && contentPart.trim().length >= 1
  })

  // У���������������������һ��
  // A) ��ժҪ + �ؼ���
  if (summaryOk && keywordsOk) return { valid: true, reason: '' }
  // B) ����ϸժҪ
  if (detailedOk) return { valid: true, reason: '' }
  // C) �����ܱ��� + �ؼ���
  if (smartTitleOk && keywordsOk) return { valid: true, reason: '' }
  // D) ��ժҪ + ���ܱ��� + ��ʵ��ǩ
  if (summaryOk && smartTitleOk && hasRealTag) return { valid: true, reason: '' }

  // �������κ�һ�� �� �ж���Ч
  if (!summaryOk && !detailedOk) return { valid: false, reason: 'ȱ����ЧժҪ��summary/detailedSummary Ϊ�ջ���̣�' }
  if (!keywordsOk) return { valid: false, reason: '�ؼ��ʲ��㣨����2����' }
  return { valid: false, reason: '����������ݲ���' }
}

/**
 * ���ܷ����ĵ����� - ��ȷ�����
 * ����: { category, summary, detailedSummary, keywords, tags, entities }
 * 
 * �������ԣ�v1.5.1����
 *   Ollama (qwen2.5:7b) ���� �� DeepSeek API �� �� ���ؽ������(_fallback:true)
 */
export async function analyzeDocument(content, title, fileName) {
  const systemPrompt = `����һ��רҵ���ĵ��������֡�����ĵ����ݽ�����ȷ��������� JSON ��ʽ�ķ��������

����Ҫ��
1. category: �����·�����ѡ����ƥ���һ����ֻ���ط���ID����
   - technology: �����ĵ�����̡�����������������ϵͳ�ܹ��ȣ�
   - business: ��ҵ�ĵ�����ͬ�����桢��ҵ�ƻ�����������ȣ�
   - research: �о����ϣ����ġ��о����桢���ݷ�����ѧ�����׵ȣ�
   - education: ����ѧϰ���̡̳��γ����ϡ�ѧϰ�ʼǡ���ѧ���ϵȣ�
   - personal: ���˱ʼǣ��ռǡ���ʡ����˼�¼�������¼�������ƻ��ȣ�
   - other: ���������������Ϸ�����ĵ���

2. summary: ��һ�仰�����ĵ��������ݣ�������30�֣������б���ʾ��

3. detailedSummary: ��ϸժҪ��300-500�֣�����ѧ������ժҪ��ʽ����
   - �ĵ�����ҪĿ��/����
   - �ؼ����ֻ����
   - ��Ҫ���ݻ���ʵ
   - ����漰������ἰ�������������ɫ
   - ����漰��Ŀ�����ἰ��Ŀ���ƺͽ�չ
   - ����漰���������ἰ���弼������
   ��ʽҪ�󣺶�����ʽ��������������Ϣ�ܶȸߣ����ݳ�ʵ

4. keywords: ��ȡ5-8���ؼ��ʣ������ʽ����Ҫ���塢�����ֶ�

5. tags: ����2-3����ǩ����ʽΪ"YYYYMMDD-����ժҪ"��
   - ��һ����ǩ����ǰ���� + �ĵ���������
   - �ڶ�����ǩ����ǰ���� + �ĵ�����/��;
   - ��������ǩ����ѡ������ǰ���� + �漰������/��֯
   ���磺["20260520-������Ŀ����", "20260520-��ҵ�ƻ���"]

6. entities: ��ȡ�ĵ��г��ֵ�ʵ�壨�����ʽ����
   - people: �������飨�� ["����", "����"]��
   - organizations: ��֯�����飨�� ["����Ͱ�", "��Ѷ"]��
   - locations: �ص����飨�� ["����", "�Ϻ�"]��
   - dates: ��Ҫ�������飨�� ["2026��5��", "2025��Q4"]��

7. smartTitle: Ϊ�ĵ�����һ���������ı��⣨������20�֣���Ҫ��
   - �����ĵ�����ĵ�����
   - �������������Ȼ��������
   - �ʺ����ڿ���ʶ���ģ������
   - ��Ҫ�������ڡ���ŵ�Ԫ��Ϣ
   - ���磺"���ѧϰģ�Ͳ��𷽰�"��"Q2���Ȳ����������"��"���㻦�ͻ��ݷü�¼"

���ϸ񷵻� JSON ��ʽ����Ҫ�����������֡�ȷ������������塢����Ϣ����������ͳ��������`

  const userPrompt = `�ĵ����⣺${title || fileName || 'δ�����ĵ�'}
�ĵ����ݣ�${(content || '').substring(0, 4000)}`

  try {
    let analysis = null
    let usedModel = 'none'

    // === ��һ�㣺���ȳ��� Ollama����ѱ���ģ�ͣ�===
    const ollamaOk = await isOllamaAvailable()
    if (ollamaOk) {
      try {
        analysis = await analyzeDocumentOllama(systemPrompt, userPrompt)
        usedModel = 'Ollama'
        logger.info(`[Ollama] �����ɹ�: "${title || fileName}"`)
      } catch (ollamaErr) {
        logger.warn('[Ollama] ����ʧ�ܣ������� DeepSeek:', ollamaErr.message)
        invalidateOllamaHealth()
        usedModel = 'Ollama-failed'
      }
    }

    // === �ڶ��㣺������ DeepSeek ===
    if (!analysis || analysis._fallback) {
      if (getApiKey()) {
        try {
          logger.info(`[AI] request_start | model=DeepSeek(${DEEPSEEK_MODEL}) | promptLength=${userPrompt.length}`)

          const result = await callDeepSeek([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ], 2048)

          // [raw_response] ������� DeepSeek ԭʼ��Ӧ
          logger.info(`[AI] raw_response | model=DeepSeek | textLength=${result.length} | text="${result}"`)

          let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          logger.info(`[AI] json_extracted | model=DeepSeek | cleanedLength=${cleaned.length} | text="${cleaned.substring(0, 200)}"`)

          // ���� JSON �޸�
          const repairResult = _tryJsonRepair(cleaned)
          if (repairResult.repaired) {
            logger.info(`[AI] json_repaired | model=DeepSeek | fixed trailing comma`)
            cleaned = repairResult.text
          }

          const parsed = JSON.parse(cleaned)
          logger.info(`[AI] parsed_result | model=DeepSeek | parsed=`, JSON.stringify(parsed, null, 2))

          // ��� summary �Ƿ�Ϊ��
          if (!parsed.summary || String(parsed.summary).trim() === '') {
            logger.warn(`[AI] EMPTY_SUMMARY_AFTER_PARSE | model=DeepSeek | parsed keys: ${Object.keys(parsed).join(',')}`)
          }

          // ��� keywords �Ƿ�����
          if (parsed.keywords && Array.isArray(parsed.keywords) && parsed.keywords.length > 0) {
            const rawKeywords = parsed.keywords.map(k => String(k))
            const garbledKws = rawKeywords.filter(kw => _isTextGarbled(kw))
            if (garbledKws.length > 0) {
              logger.warn(`[AI] GARBLED_KEYWORDS_DETECTED | model=DeepSeek | garbledCount=${garbledKws.length} | keywords=`, parsed.keywords, ' | charCodes=', rawKeywords.map(k => Array.from(k).map(c => c.charCodeAt(0)).join(',')))
            }
          }

          analysis = parsed
          usedModel = 'DeepSeek'
          logger.info(`[DeepSeek] �����ɹ�: "${title || fileName}"`)
        } catch (dsErr) {
          logger.warn('[DeepSeek] ����ʧ��:', dsErr.message)
          usedModel = 'DeepSeek-failed'
        }
      } else {
        usedModel = 'no-api-key'
      }
    }

    // === ������� ===
    if (analysis) {
      const normalized = { ...normalizeResult(analysis), ...(analysis._fallback && { _fallback: true }) }
      // [validated_result] �ֶ�����У��
      const validation = validateAnalysisResult(normalized)
      logger.info(`[AI] validated_result | model=${usedModel} | valid=${validation.valid} | reason="${validation.reason}" | summary=typeof:${typeof normalized.summary}(${normalized.summary?.length || 0}) | keywords=Array.isArray:${Array.isArray(normalized.keywords)}(${normalized.keywords?.length || 0}) | category=typeof:${typeof normalized.category}`)
      if (!validation.valid) {
        logger.warn(`[AI] �ֶ�У��δͨ�� (${validation.reason})����ǽ���: "${title || fileName}"`)
        return { ...normalized, _fallback: true }
      }
      return normalized
    }

    // ȫ��ʧ�� �� ���ؽ������
    logger.warn(`[AI] ������ȫʧ�� (${usedModel})�����ؽ������: "${title || fileName}"`)
    const today = new Date()
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const fallbackTitle = (title || fileName || '�ĵ�').substring(0, 20)
    
    return {
      category: 'other',
      summary: '',
      detailedSummary: '',
      keywords: [],
      tags: [`${dateStr}-${fallbackTitle}`],
      entities: { people: [], organizations: [], locations: [], dates: [] },
      smartTitle: `δ����-${dateStr}`,
      _fallback: true
    }
  } catch (error) {
    logger.error('AI ����ʧ��:', error)
    // ���ؽ�����������ֲ�Ҫ��analyzeDocument() �������� null��ʼ�շ�����Ч����
    // ���÷�Ӧ��� _fallback ��ǣ���Ϊ true ��Ӧ�������еķ������
    const today = new Date()
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
    const fallbackTitle = (title || fileName || '�ĵ�').substring(0, 20)
    
    return {
      category: 'other',
      summary: '',
      detailedSummary: '',
      keywords: [],
      tags: [`${dateStr}-${fallbackTitle}`],
      entities: { people: [], organizations: [], locations: [], dates: [] },
      smartTitle: `δ����-${dateStr}`,
      _fallback: true
    }
  }
}

/**
 * �����ĵ���ϸԤ��ժҪ
 */
export async function generateDetailedPreview(content, title) {
  const systemPrompt = `����һ��רҵ���ĵ�ժҪ����������Ϊ�ĵ�����һ����ϸ��Ԥ��ժҪ����ʽ����ѧ������ժҪ��

Ҫ��
1. ժҪ���ȣ�300-500��
2. ��������Ҫ�أ�
   - ����/Ŀ�ģ��ĵ�Ҫ���ʲô�������ʲôĿ��
   - ����/���ݣ��ĵ�����Ҫ���ݻ򷽷�
   - ���/���֣��ؼ����֡����ۻ�����
   - ����/��ֵ���ĵ��ļ�ֵ������
3. ����ĵ��漰������������ἰ����
4. ����漰��Ŀ�����������ݣ��������˵��
5. ����רҵ����������Ϣ�ܶȸ�
6. ������ʽ����Ҫʹ���б�

��ֱ�ӷ���ժҪ�ı�����Ҫ�����������ݡ�`

  const userPrompt = `�ĵ����⣺${title || 'δ����'}
�ĵ����ݣ�${(content || '').substring(0, 5000)}`

  try {
    const result = await callDeepSeek([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], 2048)

    return result.trim()
  } catch (error) {
    logger.error('����Ԥ��ժҪʧ��:', error)
    return (content || '').substring(0, 300) + '...'
  }
}

/**
 * ���������ĵ�
 * @param {Array} files - �ļ��������� [{ file: File, content: string }]
 *   file: ԭʼ File ���������Զ���ȡ�ı��ļ���
 *   content: ����ȡ���ı����ݣ����� OCR �� DOCX ��ȡ����ļ���
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
        logger.warn(`�ļ� ${file.name} ����̫�٣�<20�ַ��������� AI ����`)
        results.push({ fileName: file.name, _fallback: true, category: 'other', summary: '', detailedSummary: '', keywords: [], tags: [], entities: { people: [], organizations: [], locations: [], dates: [] }, smartTitle: '' })
        continue
      }

      const analysis = await analyzeDocument(content, file.name.replace(/\.[^/.]+$/, ''), file.name)
      results.push({ fileName: file.name, ...analysis })
    } catch (error) {
      logger.error(`�����ļ� ${item.file?.name || item.name} ʧ��:`, error)
      results.push({ fileName: item.file?.name || item.name, _fallback: true, category: 'other', summary: '', detailedSummary: '', keywords: [], tags: [], entities: { people: [], organizations: [], locations: [], dates: [] }, smartTitle: '' })
    }
  }

  return results
}
