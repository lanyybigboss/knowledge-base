/**
 * Obsidian 集成服务
 * 解析 Obsidian vault 中的 Markdown 笔记，提取 frontmatter 和纯文本内容
 */

import logger from './logger'

/**
 * 解析 YAML frontmatter
 * @param {string} content - Markdown 文件完整内容
 * @returns {{ frontmatter: object, body: string }}
 */
export function parseFrontmatter(content) {
  const frontmatter = {}
  let body = content

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter, body: content }

  const yamlBlock = match[1]
  body = match[2] || ''

  const lines = yamlBlock.split('\n')
  let currentKey = null
  let currentArray = null

  for (const line of lines) {
    const arrayMatch = line.match(/^\s*-\s+(.+)$/)
    if (arrayMatch && currentKey) {
      if (!Array.isArray(currentArray)) {
        currentArray = []
        frontmatter[currentKey] = currentArray
      }
      currentArray.push(arrayMatch[1].replace(/^["']|["']$/g, '').trim())
      continue
    }

    const kvMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.*)$/)
    if (kvMatch) {
      currentKey = kvMatch[1]
      currentArray = null
      let value = kvMatch[2].trim()

      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          frontmatter[currentKey] = JSON.parse(value)
        } catch {
          frontmatter[currentKey] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
        }
      } else if (value === '') {
        frontmatter[currentKey] = null
      } else {
        frontmatter[currentKey] = value.replace(/^["']|["']$/g, '')
      }
      continue
    }

    if (currentKey && line.match(/^\s+/) && !arrayMatch) {
      const existing = frontmatter[currentKey]
      if (typeof existing === 'string') {
        frontmatter[currentKey] = existing + ' ' + line.trim()
      }
    }
  }

  return { frontmatter, body }
}

/**
 * 剥离 Markdown 语法，提取纯文本（用于 AI 分析）
 * @param {string} markdown - Markdown 正文
 * @returns {string} 纯文本
 */
export function stripMarkdownSyntax(markdown) {
  let text = markdown

  // wiki-link: [[target|alias]] → alias, [[target]] → target
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1')

  // 嵌入: ![[file]] → file
  text = text.replace(/!\[\[([^\]]+)\]\]/g, '$1')

  // 标准链接: [text](url) → text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // 图片: ![alt](url) → alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')

  // 标题标记
  text = text.replace(/^#{1,6}\s+/gm, '')

  // 粗体/斜体
  text = text.replace(/\*{1,3}(.+?)\*{1,3}/g, '$1')
  text = text.replace(/_{1,3}(.+?)_{1,3}/g, '$1')

  // 行内代码
  text = text.replace(/`([^`]+)`/g, '$1')

  // 代码块
  text = text.replace(/```[\s\S]*?```/g, '')

  // 引用
  text = text.replace(/^>\s*/gm, '')

  // 列表
  text = text.replace(/^[\s]*[-*+]\s+/gm, '')
  text = text.replace(/^[\s]*\d+\.\s+/gm, '')

  // 分隔线
  text = text.replace(/^[-*_]{3,}\s*$/gm, '')

  // 高亮 ==text==
  text = text.replace(/==(.+?)==/g, '$1')

  // 脚注
  text = text.replace(/\[\^\d+\]/g, '')

  // 清理多余空行
  text = text.replace(/\n{3,}/g, '\n\n')

  return text.trim()
}

/**
 * 构建带 AI 元数据的 YAML frontmatter
 * @param {object} original - 原始 frontmatter
 * @param {object} aiResult - AI 分析结果
 * @returns {string} 完整的 YAML frontmatter 字符串
 */
export function buildFrontmatter(original, aiResult) {
  const fm = { ...original }

  if (aiResult.summary && !fm.ai_summary) fm.ai_summary = aiResult.summary
  if (aiResult.category && !fm.ai_category) fm.ai_category = aiResult.category
  if (aiResult.keywords?.length > 0 && !fm.ai_keywords) fm.ai_keywords = aiResult.keywords
  if (aiResult.entities && !fm.ai_entities) fm.ai_entities = aiResult.entities
  if (!fm.analyzed_at) fm.analyzed_at = new Date().toISOString()

  if (aiResult.tags?.length > 0) {
    const existingTags = new Set(fm.tags || [])
    for (const tag of aiResult.tags) existingTags.add(tag)
    fm.tags = [...existingTags]
  }

  const lines = ['---']
  for (const [key, value] of Object.entries(fm)) {
    if (value === null || value === undefined) {
      lines.push(`${key}:`)
    } else if (Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const item of value) {
        lines.push(`  - ${typeof item === 'object' ? JSON.stringify(item) : item}`)
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}: ${JSON.stringify(value)}`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('---')

  return lines.join('\n')
}

/**
 * 将 AI 分析结果回写到 .md 文件的 frontmatter
 */
export async function writeBackToFrontmatter(readFile, writeFile, filePath, aiResult) {
  try {
    const rawContent = await readFile(filePath)
    if (!rawContent) {
      logger.warn(`[Obsidian] 回写失败：无法读取文件 ${filePath}`)
      return
    }

    const { frontmatter, body } = parseFrontmatter(rawContent)
    const newFrontmatter = buildFrontmatter(frontmatter, aiResult)
    const newContent = newFrontmatter + '\n' + body

    await writeFile(filePath, newContent)
    logger.info(`[Obsidian] 已回写 AI 元数据到 ${filePath}`)
  } catch (err) {
    logger.error(`[Obsidian] 回写失败: ${filePath}`, err.message)
  }
}

export default {
  parseFrontmatter,
  stripMarkdownSyntax,
  buildFrontmatter,
  writeBackToFrontmatter
}
