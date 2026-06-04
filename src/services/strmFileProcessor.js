/**
 * Strm 文件处理器（从 AppContext.jsx 提取）
 * 负责 PDF 解析、DOCX 提取、OCR、Obsidian frontmatter 解析、AI 分析等逻辑
 */

/**
 * 处理 Strm 文件：读取原始文件、提取文本、AI 分析、入库
 * @param {string} strmFileName - strm 文件名
 * @param {string} originalFilePath - 原始文件路径
 * @param {string} strmFilePath - strm 文件路径
 * @param {boolean} isObsidianNote - 是否为 Obsidian 笔记
 * @param {object} deps - 依赖注入 { dispatch, storageService, analyzeDocument, logger, ADD_DOCUMENT_ACTION }
 * @returns {Promise<boolean>}
 */
export async function processStrmFile(strmFileName, originalFilePath, strmFilePath, isObsidianNote, { dispatch, storageService, analyzeDocument, logger, ADD_DOCUMENT_ACTION }) {
  try {
    logger.info(`[Strm 刮削] 开始处理: ${strmFileName}`)

    // 1. 读取原始文件内容
    const apiService = (await import('./apiService')).default
    const fileResult = await apiService.readOriginalFile(originalFilePath)
    if (!fileResult || !fileResult.success) {
      logger.warn(`[Strm 刮削] 读取原始文件失败: ${strmFileName}`)
      // 即使读取失败，也创建基本文档条目
      const ext = (strmFileName.split('.').filter(s => s !== 'strm').pop() || '').toLowerCase()
      const baseName = strmFileName.replace(/\.strm$/i, '')
      await storageService.addDocument({
        title: baseName,
        fileName: strmFileName,
        fileSize: 0,
        fileType: ext,
        category: 'uncategorized',
        content: `[${ext.toUpperCase()} 文件] 使用系统默认软件打开查看`,
        localFilePath: strmFilePath || '',
        isStrmRef: true,
        source: 'watcher',
        aiAnalyzed: false
      })
      logger.info(`[Strm 刮削] ✅ 基本条目入库: "${baseName}"`)
      return true
    }

    // 2. 解析文件信息
    const ext = (strmFileName.split('.').filter(s => s !== 'strm').pop() || '').toLowerCase()
    const baseName = strmFileName.replace(/\.strm$/i, '')
    let title = baseName
    let content = ''
    let tags = []
    let categoryHint = null
    const binaryStr = atob(fileResult.content)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
    const blob = new Blob([bytes], { type: fileResult.mimeType || 'application/octet-stream' })

    // Obsidian 笔记：解析 frontmatter + 提取纯文本
    if (isObsidianNote && ext === 'md') {
      const { parseFrontmatter, stripMarkdownSyntax } = await import('./obsidianService')
      const rawContent = binaryStr
      const { frontmatter, body } = parseFrontmatter(rawContent)
      const plainText = stripMarkdownSyntax(body)
      content = plainText
      title = frontmatter.title || frontmatter.aliases?.[0] || baseName.replace(/\.md$/i, '')
      if (frontmatter.tags) tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags]
      if (frontmatter.category) categoryHint = frontmatter.category
      logger.info(`[Obsidian] 解析笔记: "${title}" (frontmatter: ${Object.keys(frontmatter).length} 字段, 正文: ${plainText.length} 字符)`)
    }

    // 3. 根据文件类型提取文本（非 Obsidian 笔记时）
    let aiResult = null
    const textExts = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'css', 'log', 'ini', 'cfg', 'yaml', 'yml', 'toml']
    const pdfExts = ['pdf']
    const docxExts = ['docx', 'doc']
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif']

    try {
      if (content) {
        // 已由 Obsidian 分支提取内容，跳过普通文件处理
      } else if (textExts.includes(ext)) {
        // 纯文本文件
        content = binaryStr
        logger.info(`[Strm 刮削] 文本文件: ${strmFileName} (${content.length} 字符)`)
      } else if (pdfExts.includes(ext)) {
        logger.info(`[Strm 刮削] PDF 文件: ${strmFileName}，尝试提取文本...`)
        try {
          const pdfjsLib = await import('pdfjs-dist')
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`
          const pdf = await pdfjsLib.getDocument({ data: bytes.buffer }).promise
          let fullText = ''
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i)
            const textContent = await page.getTextContent()
            fullText += textContent.items.map(item => item.str).join(' ') + '\n'
          }
          content = fullText.trim()
          logger.info(`[Strm 刮削] PDF 文本提取完成: ${content.length} 字符`)
        } catch (pdfErr) {
          logger.warn(`[Strm 刮削] PDF 文本提取失败，尝试 OCR: ${pdfErr.message}`)
          // OCR fallback - 使用 tesseract.js
          try {
            const { recognize } = await import('tesseract.js')
            const ocrResult = await recognize(blob, 'chi_sim+eng', {
              logger: (m) => { if (m.status === 'recognizing text') logger.info(`[Strm 刮削 OCR] ${parseInt(m.progress * 100)}%`) }
            })
            content = ocrResult.data.text
            logger.info(`[Strm 刮削] OCR 完成: ${content.length} 字符`)
          } catch (ocrErr) {
            logger.warn(`[Strm 刮削] OCR 也失败: ${ocrErr.message}`)
          }
        }
      } else if (docxExts.includes(ext)) {
        logger.info(`[Strm 刮削] DOCX 文件: ${strmFileName}`)
        try {
          const mammoth = await import('mammoth')
          const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer })
          content = result.value
          logger.info(`[Strm 刮削] DOCX 提取完成: ${content.length} 字符`)
        } catch (docxErr) {
          logger.warn(`[Strm 刮削] DOCX 提取失败: ${docxErr.message}`)
        }
      } else if (imageExts.includes(ext)) {
        logger.info(`[Strm 刮削] 图片文件: ${strmFileName}，尝试 OCR...`)
        try {
          const { recognize } = await import('tesseract.js')
          const ocrResult = await recognize(blob, 'chi_sim+eng', {
            logger: (m) => { if (m.status === 'recognizing text') logger.info(`[Strm 刮削 OCR] ${parseInt(m.progress * 100)}%`) }
          })
          content = ocrResult.data.text
          logger.info(`[Strm 刮削] 图片 OCR 完成: ${content.length} 字符`)
        } catch (ocrErr) {
          logger.warn(`[Strm 刮削] 图片 OCR 失败: ${ocrErr.message}`)
        }
      } else {
        content = `[${ext.toUpperCase()} 文件] 使用系统默认软件打开查看`
      }
    } catch (extractErr) {
      logger.warn(`[Strm 刮削] 文本提取异常: ${extractErr.message}`)
    }

    // 4. AI 分析（Ollama 优先，DeepSeek 降级）
    if (content && content.trim().length > 10) {
      try {
        logger.info(`[Strm 刮削] 调用 DeepSeek AI 分析: ${strmFileName}`)
        aiResult = await analyzeDocument(content, title, strmFileName)
        if (aiResult?._fallback) {
          logger.warn(`[Strm 刮削] AI 分析降级，已有数据不受影响: ${strmFileName}`)
          aiResult = null  // 降级结果不用于覆盖已有数据
        } else {
          logger.info(`[Strm 刮削] AI 分析完成: ${strmFileName}`)
        }
      } catch (aiErr) {
        logger.warn(`[Strm 刮削] AI 分析异常: ${aiErr.message}`)
      }
    }

    // 5. 入库
    const docData = {
      title,
      fileName: strmFileName,
      fileSize: fileResult.fileSize || 0,
      fileType: ext,
      category: aiResult?.category || categoryHint || 'uncategorized',
      tags: [...new Set([...(tags || []), ...(aiResult?.tags || [])])].slice(0, 5),
      keywords: aiResult?.keywords || [],
      content: content || `[${ext.toUpperCase()} 文件] 使用系统默认软件打开查看`,
      localFilePath: strmFilePath || '',
      isStrmRef: true,
      source: isObsidianNote ? 'obsidian' : 'watcher',
      summary: aiResult?.summary || '',
      detailedSummary: aiResult?.detailedSummary || '',
      entities: aiResult?.entities || { people: [], organizations: [], locations: [], dates: [] },
      smartTitle: aiResult?.smartTitle || '',
      searchIndex: aiResult ? [
        strmFileName,
        aiResult.smartTitle || '',
        aiResult.summary || '',
        ...(aiResult.keywords || [])
      ].filter(Boolean).join(' ').substring(0, 512) : '',
      aiAnalyzed: !!aiResult
    }

    const newDoc = await storageService.addDocument(docData)
    if (newDoc) {
      dispatch({ type: ADD_DOCUMENT_ACTION, payload: newDoc })
      logger.info(`[Strm 刮削] ✅ 入库成功: "${title}"${aiResult ? ' (含 AI 摘要)' : ''}`)
      return true
    }
    return false
  } catch (e) {
    logger.error(`[Strm 刮削] ❌ 处理异常 ${strmFileName}:`, e.message)
    return false
  }
}
