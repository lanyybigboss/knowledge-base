/**
 * 后台分析子进程
 * 由 electron/main.js 通过 child_process.fork() 启动
 * 负责：文件读取 → 文本提取（PDF/DOCX/OCR） → AI 分析 → 结果回传
 *
 * 通信协议（process.send / process.on('message')）：
 *
 * 收到：
 *   { type: 'analyze', id, filePath, fileName, fileType, title }
 *
 * 发出：
 *   { type: 'progress', id, stage, percent, message }
 *   { type: 'result', id, data }
 *   { type: 'error', id, error }
 */

const fs = require('fs')
const path = require('path')

// ===== 配置 =====
const OLLAMA_BASE_URL = 'http://localhost:11434'
const OLLAMA_MODEL = 'qwen3:8b'
const AI_TIMEOUT = 180000

// DeepSeek API 配置（降级方案）
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

// ===== 日志（子进程用 console，因为没有 logger 模块） =====
function log(level, ...args) {
  const ts = new Date().toISOString()
  const prefix = `[Analyzer ${ts}] [${level}]`
  if (level === 'ERROR') console.error(prefix, ...args)
  else if (level === 'WARN') console.warn(prefix, ...args)
  else console.log(prefix, ...args)
}

// ===== 进度上报 =====
function report(id, stage, percent, message) {
  process.send({ type: 'progress', id, stage, percent, message })
}

// ===== 文件文本提取 =====

async function extractText(filePath, fileType, id) {
  const ext = (fileType || path.extname(filePath).replace('.', '')).toLowerCase()

  // 文本文件
  const textExts = ['txt', 'md', 'csv', 'json', 'html', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'log', 'bat', 'sh', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less']
  if (textExts.includes(ext)) {
    report(id, 'reading', 50, '读取文本文件')
    const content = fs.readFileSync(filePath, 'utf-8')
    report(id, 'reading', 100, '文本读取完成')
    return content
  }

  // DOCX
  if (ext === 'docx') {
    report(id, 'extracting', 10, '解析 DOCX 文档')
    try {
      const mammoth = require('mammoth')
      const buffer = fs.readFileSync(filePath)
      const result = await mammoth.extractRawText({ buffer })
      report(id, 'extracting', 100, 'DOCX 解析完成')
      return result.value || ''
    } catch (e) {
      log('WARN', `DOCX 解析失败: ${e.message}`)
      return ''
    }
  }

  // PDF
  if (ext === 'pdf') {
    report(id, 'extracting', 10, '解析 PDF 文档')
    try {
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
      const data = new Uint8Array(fs.readFileSync(filePath))
      const pdf = await pdfjsLib.getDocument({ data }).promise
      let fullText = ''

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items.map(item => item.str).join(' ')
        fullText += pageText + '\n'
        report(id, 'extracting', Math.round((i / pdf.numPages) * 80), `PDF 第 ${i}/${pdf.numPages} 页`)
      }

      const text = fullText.trim()
      if (text.length > 50) {
        report(id, 'extracting', 100, `PDF 文本提取完成 (${text.length} 字符)`)
        return text
      }

      // 扫描件 PDF — 文本太少，跳过 OCR（子进程中 OCR 配置复杂）
      report(id, 'extracting', 100, 'PDF 文本层内容过少，跳过 OCR')
      return text
    } catch (e) {
      log('WARN', `PDF 解析失败: ${e.message}`)
      return ''
    }
  }

  // 其他二进制文件
  return ''
}

// ===== Ollama AI 分析 =====

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

3. detailedSummary: 详细摘要（300-500字），段落式

4. keywords: 提取5-8个关键词，按数组格式

5. tags: 生成2-3个标签，格式为"YYYYMMDD-简短描述"

6. entities: 提取文档中出现的实体
   - people: 人物名称数组
   - organizations: 组织机构数组
   - locations: 地点名称数组
   - dates: 重要日期数组

7. smartTitle: 简短中文标题（不超过20字）

严格返回 JSON 格式，不要包含任何其他文字。`

async function callOllama(systemPrompt, userPrompt) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT)

  try {
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

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`)

    const data = await response.json()
    return data.message?.content || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * DeepSeek API 调用（Ollama 不可用时的降级方案）
 */
async function callDeepSeek(systemPrompt, userPrompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) throw new Error('DeepSeek API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT)

  try {
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
          { role: 'user', content: userPrompt + '\n\n请严格返回 JSON 格式，不要包含任何其他文字。' }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
      signal: controller.signal
    })

    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`)

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * MiMo Token Plan 调用（第二降级方案）
 */
async function callMimo(systemPrompt, userPrompt) {
  const apiKey = process.env.MIMO_API_KEY || ''
  if (!apiKey) throw new Error('MiMo API Key 未配置')

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT)

  try {
    const response = await fetch('https://token-plan-cn.xiaomimimo.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'mimo-v2-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      }),
      signal: controller.signal
    })

    if (!response.ok) throw new Error(`MiMo HTTP ${response.status}`)

    const data = await response.json()
    return data.choices?.[0]?.message?.content || ''
  } finally {
    clearTimeout(timeoutId)
  }
}

function safeParseJson(rawText) {
  // 提取 JSON
  let cleaned = rawText.trim()
  try { JSON.parse(cleaned); return JSON.parse(cleaned) } catch { /* ignore */ }

  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim()
    try { return JSON.parse(cleaned) } catch { /* ignore */ }
  }

  const startIdx = rawText.indexOf('{')
  const endIdx = rawText.lastIndexOf('}')
  if (startIdx !== -1 && endIdx > startIdx) {
    cleaned = rawText.substring(startIdx, endIdx + 1).trim()
  }

  // 修复 + 清洗
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1')
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // eslint-disable-line no-control-regex
  return JSON.parse(cleaned)
}

function normalizeResult(analysis) {

  const safeStr = (val, fallback = '') => {
    if (!val) return fallback
    return typeof val === 'string' ? val : String(val)
  }

  return {
    category: analysis.category || 'other',
    summary: safeStr(analysis.summary).substring(0, 200),
    detailedSummary: safeStr(analysis.detailedSummary, safeStr(analysis.summary)).substring(0, 2000),
    keywords: (analysis.keywords || []).filter(Boolean).slice(0, 8),
    tags: (analysis.tags || []).slice(0, 3),
    entities: analysis.entities || { people: [], organizations: [], locations: [], dates: [] },
    smartTitle: safeStr(analysis.smartTitle).substring(0, 20)
  }
}

// ===== 主处理流程 =====

async function handleAnalyze(msg) {
  const { id, filePath, fileName, fileType, title } = msg

  try {
    // 阶段 1：读取文件文本
    report(id, 'reading', 0, '开始处理')
    const content = await extractText(filePath, fileType, id)

    if (!content || content.trim().length < 20) {
      process.send({ type: 'result', id, data: { _fallback: true, reason: '内容过短或无法提取文本' } })
      return
    }

    // 阶段 2：AI 分析（Ollama → MiMo → DeepSeek 降级链）
    report(id, 'analyzing', 0, '调用 AI 分析')
    const contentText = content || ''
    let truncatedContent
    if (contentText.length <= 8000) {
      truncatedContent = contentText
    } else {
      truncatedContent = contentText.substring(0, 5000) +
        '\n\n[...文档中间部分已省略...]\n\n' +
        contentText.substring(contentText.length - 3000)
    }
    const userPrompt = `文档标题：${title || fileName}\n文档内容：${truncatedContent}`

    let rawText
    let usedModel = 'unknown'
    try {
      // 优先 Ollama
      try {
        rawText = await callOllama(SYSTEM_PROMPT, userPrompt)
        usedModel = 'ollama'
      } catch (ollamaErr) {
        log('WARN', `Ollama 不可用: ${ollamaErr.message}，尝试 MiMo...`)

        // 降级到 MiMo
        try {
          rawText = await callMimo(SYSTEM_PROMPT, userPrompt)
          usedModel = 'mimo'
        } catch (mimoErr) {
          log('WARN', `MiMo 不可用: ${mimoErr.message}，尝试 DeepSeek...`)

          // 降级到 DeepSeek
          rawText = await callDeepSeek(SYSTEM_PROMPT, userPrompt)
          usedModel = 'deepseek'
        }
      }

      if (!rawText || rawText.trim().length === 0) {
        throw new Error('AI 返回空内容')
      }
    } catch (aiErr) {
      log('WARN', `全链路 AI 失败: ${aiErr.message}`)
      process.send({ type: 'result', id, data: { _fallback: true, reason: `AI 错误: ${aiErr.message}` } })
      return
    }

    log('INFO', `AI 分析完成 | model=${usedModel} | contentLen=${content.length}`)

    report(id, 'analyzing', 80, '解析 AI 响应')

    // 阶段 3：解析结果
    let parsed
    try {
      parsed = safeParseJson(rawText)
    } catch (parseErr) {
      log('WARN', `JSON 解析失败: ${parseErr.message}`)
      process.send({ type: 'result', id, data: { _fallback: true, reason: `JSON 解析失败: ${parseErr.message}` } })
      return
    }

    const result = normalizeResult(parsed)
    report(id, 'analyzing', 100, '分析完成')
    process.send({ type: 'result', id, data: result })

  } catch (err) {
    log('ERROR', `分析异常 [${id}]:`, err.message)
    process.send({ type: 'error', id, error: err.message })
  }
}

// ===== 消息监听 =====

process.on('message', (msg) => {
  if (!msg || !msg.type) return

  switch (msg.type) {
    case 'analyze':
      handleAnalyze(msg)
      break
    case 'ping':
      process.send({ type: 'pong' })
      break
    case 'exit':
      log('INFO', '收到退出指令')
      process.exit(0)
      break
    default:
      log('WARN', `未知消息类型: ${msg.type}`)
  }
})

process.on('uncaughtException', (err) => {
  log('ERROR', '未捕获异常:', err.message)
  process.send({ type: 'error', id: null, error: `子进程异常: ${err.message}` })
})

log('INFO', `分析子进程已启动 (pid=${process.pid})`)
process.send({ type: 'ready' })
