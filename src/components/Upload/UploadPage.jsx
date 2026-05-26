/**
 * 上传文档页面 - 拖拽即上传，自动 AI 分析
 * 流程：拖拽文件 → 自动上传 → AI 分析 → 自动命名/分类/打标签
 */

import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { useApp } from '../../services/AppContext'
import { formatFileSize, getFileTypeInfo, getFileExtension } from '../../utils/helpers'
import { PRESET_CATEGORIES, MAX_FILE_SIZE } from '../../utils/constants'
import { analyzeDocuments, hasApiKey, isOllamaAvailable, invalidateOllamaHealth } from '../../services/aiService'
import logger from '../../services/logger'
import apiService from '../../services/apiService'
import Modal from '../Common/Modal'
import './UploadPage.css'

// 从 mammoth 提取 Word 文档文本
async function extractDocxText(file) {
  try {
    const mammoth = await import('mammoth')
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.default.extractRawText({ arrayBuffer })
    return result.value || ''
  } catch (e) {
    logger.warn('mammoth 提取 DOCX 文本失败:', e)
    return ''
  }
}

/**
 * 从 PDF 提取文本（使用 pdfjs-dist）
 * 先尝试提取文本层；如果提取结果太少（扫描件 PDF），自动降级为 OCR
 */
async function extractPdfText(file, onProgress) {
  try {
    const pdfjsLib = await import('pdfjs-dist')
    
    // 设置 worker（使用 CDN 版本，避免 Vite 打包 worker 文件的问题）
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

    let fullText = ''
    const totalPages = pdf.numPages

    // 第1步：尝试提取文本层
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i)
      const textContent = await page.getTextContent()
      const pageText = textContent.items.map(item => item.str).join(' ')
      fullText += pageText + '\n'

      if (onProgress) {
        onProgress(Math.round((i / totalPages) * 30)) // 文本提取占 0-30%
      }
    }

    fullText = fullText.trim()

    // 如果文本层内容足够多，直接返回
    if (fullText.length > 50) {
      logger.info(`[PDF 文本提取成功] ${file.name}: ${totalPages} 页, ${fullText.length} 字符`)
      return fullText
    }

    // 第2步：文本太少（扫描件 PDF），降级为 OCR
    logger.info(`[PDF 文本提取] ${file.name}: 文本层内容太少 (${fullText.length} 字符)，降级为 OCR...`)
    return await ocrPdfPages(pdf, file.name, totalPages, (pct) => {
      if (onProgress) onProgress(30 + Math.round(pct * 0.7)) // OCR 占 30-100%
    })

  } catch (e) {
    logger.warn(`PDF 文本/OCR 提取失败 ${file.name}:`, e)
    return ''
  }
}

/**
 * 对 PDF 每页渲染为图片后执行 OCR（用于扫描件 PDF）
 */
/**
 * tesseract.js v7 在浏览器中会从 CDN 加载 3 个资源：
 * 1. Worker 脚本（importScripts 加载） → 本地文件避免 CDN 问题
 * 2. Tesseract Core（Wasm，importScripts 加载） → 使用 jsDelivr（默认）
 * 3. 语言数据（fetch 加载） → 使用 jsDelivr（默认）
 *
 * 如果网络环境无法访问 jsDelivr，可修改 corePath/langPath 为国内镜像：
 *   corePath: 'https://unpkg.com/tesseract.js-core@7.0.0'
 *   注意：langPath 不支持简单替换为 unpkg（路径结构不兼容）
 */
const TESSERACT_OPTIONS = {
  workerPath: '/tesseract-worker.min.js'  // 本地 Worker 脚本（public/ 目录）
}

async function ocrPdfPages(pdf, fileName, totalPages, onProgress) {
  const { recognize } = await import('tesseract.js')
  let combinedText = ''

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 }) // 2x 清晰度
    
    // 创建 canvas 渲染页面
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({ canvasContext: context, viewport: viewport }).promise

    // canvas → blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))

    // OCR 识别（使用 v7 的 named export `recognize`）
    const result = await recognize(blob, 'chi_sim+eng', {
      ...TESSERACT_OPTIONS,
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          const pageProgress = ((i - 1) / totalPages) * 100 + (m.progress / totalPages) * 100
          onProgress(Math.round(pageProgress))
        }
      }
    })

    const pageText = (result.data.text || '').trim()
    combinedText += pageText + '\n'
    logger.info(`[PDF OCR 页 ${i}/${totalPages}] ${fileName}: ${pageText.length} 字符`)
  }

  logger.info(`[PDF OCR 完成] ${fileName}: ${totalPages} 页, ${combinedText.length} 字符`)
  return combinedText.trim()
}

// OCR 识别图片文字（中文+英文）
async function ocrImage(file, onProgress) {
  try {
    // tesseract.js v7 使用 named export，没有 default 导出
    const { recognize } = await import('tesseract.js')
    const result = await recognize(
      file,
      'chi_sim+eng',  // 中英文混合识别
      {
        ...TESSERACT_OPTIONS,
        logger: m => {
          if (m.status === 'recognizing text' && onProgress) {
            const pct = Math.round(m.progress * 100)
            onProgress(pct)
          }
        }
      }
    )
    const text = result.data.text || ''
    if (text.length > 0) {
      logger.info(`[OCR 识别成功] ${file.name}: ${text.length} 字符`)
    } else {
      logger.warn(`[OCR 识别] ${file.name}: 未识别出文字`)
    }
    return text
  } catch (e) {
    logger.error(`[OCR 识别失败] ${file.name}:`, e.message || e)
    logger.error(`[OCR 识别] 完整错误信息:`, JSON.stringify(e, Object.getOwnPropertyNames(e)))
    return ''
  }
}

// 将文件读取为 base64（用于保存二进制文件）
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function UploadPage() {
  const navigate = useNavigate()
  const { addDocument, showNotification, categories } = useApp()
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStatus, setUploadStatus] = useState('') // 状态提示
  const [showApiKeyModal, setShowApiKeyModal] = useState(false)  // 不再页面加载时弹窗，Ollama 可能已在线
  const [apiKeyInput, setApiKeyInput] = useState(localStorage.getItem('deepseek_api_key') || '')
  const [uploadedCount, setUploadedCount] = useState(0)
  const [useStrmRef, setUseStrmRef] = useState(false) // 默认复制文件，勾选后创建引用
  const [aiReady, setAiReady] = useState({ ollama: false, deepseek: false }) // AI 可用状态

  // 页面加载时检测 Ollama 状态
  useEffect(() => {
    const checkAi = async () => {
      const ollama = await isOllamaAvailable()
      setAiReady({ ollama, deepseek: hasApiKey() })
    }
    checkAi()
  }, [])

  const allCategories = [
    ...PRESET_CATEGORIES,
    ...categories
  ]

  // 核心：拖拽文件后自动处理
  const processFiles = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return

    // 检查 AI 是否可用：Ollama 在线 或 DeepSeek Key 已配置，两者至少有一个
    // 先使缓存失效，确保获取实时状态（避免使用启动时的过期缓存）
    invalidateOllamaHealth()
    const ollamaReady = await isOllamaAvailable()
    const deepseekReady = hasApiKey()
    if (!ollamaReady && !deepseekReady) {
      setShowApiKeyModal(true)
      return
    }

    setUploading(true)
    setUploadedCount(0)
    setUploadStatus(`正在分析 ${acceptedFiles.length} 个文件...`)

    try {
      // 1. 读取文件内容（支持文本和二进制文件）
      const fileContents = await Promise.all(
        acceptedFiles.map(async (file) => {
          let content = ''
          let previewType = 'none'
          const ext = file.name.split('.').pop()?.toLowerCase()
          
          // 文本文件 - 直接读取内容
          const textTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html']
          const textExts = ['txt', 'md', 'csv', 'json', 'html', 'xml', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'log', 'bat', 'sh', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less']
          
          if (textTypes.includes(file.type) || textExts.includes(ext)) {
            try {
              content = await file.text()
              previewType = 'text'
            } catch (e) {
              logger.warn(`无法读取 ${file.name} 内容:`, e)
            }
          } 
          // DOCX - 使用 mammoth 提取实际文本并保存原始文件
          else if (ext === 'docx') {
            try {
              // 提取文本用于分析
              content = await extractDocxText(file)
              if (content && content.trim().length > 0) {
                previewType = 'text'
                logger.info(`[DOCX 文本提取成功] ${file.name}: ${content.length} 字符`)
              } else {
                content = ''
                previewType = 'unsupported'
              }
            } catch (e) {
              logger.warn(`提取 DOCX ${file.name} 文本失败:`, e)
              content = ''
              previewType = 'unsupported'
            }
          }
          // PDF - 使用 pdfjs-dist 提取文本，扫描件自动降级 OCR
          else if (ext === 'pdf') {
            setUploadStatus(`📄 处理 PDF 文件 (${file.name})...`)
            try {
              content = await extractPdfText(file, (pct) => {
                // 内部：0-30% 文本提取, 30-100% OCR
                setUploadProgress(Math.round(pct * 0.85))
              })
              if (content && content.trim().length > 20) {
                previewType = 'text'
                logger.info(`[PDF 内容提取成功] ${file.name}: ${content.length} 字符`)
              } else {
                content = ''
                previewType = 'unsupported'
                logger.info(`[PDF] ${file.name}: 无法提取任何文本内容`)
              }
            } catch (e) {
              logger.warn(`处理 PDF ${file.name} 失败:`, e)
              content = ''
              previewType = 'unsupported'
            }
          }
          // 旧版 DOC / Excel - 读取二进制保存
          else if (['doc', 'xls', 'xlsx'].includes(ext)) {
            content = ''
            previewType = 'unsupported'
          }
          // 图片 - 使用 OCR 识别文字（扩展名检测作为 MIME 后备）
          else if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif'].includes(ext)) {
            setUploadStatus(`🔍 OCR 识别图片文字 (${file.name})...`)
            try {
              content = await ocrImage(file, (pct) => {
                setUploadProgress(pct * 0.8 + 10) // OCR 进度占总进度 10-90%
              })
              if (content && content.trim().length > 10) {
                previewType = 'text'
                logger.info(`[图片OCR成功] ${file.name}: ${content.length} 字符`)
              } else {
                content = ''
                previewType = 'image'
                logger.info(`[图片OCR] ${file.name}: 未识别出文字内容`)
              }
            } catch (e) {
              logger.warn(`OCR 识别 ${file.name} 失败:`, e)
              content = ''
              previewType = 'image'
            }
          }
          
          // 读取二进制 base64 用于保存原始文件
          let base64Content = ''
          try {
            base64Content = await readFileAsBase64(file)
          } catch (e) {
            logger.warn(`读取 ${file.name} 二进制数据失败:`, e)
          }
          
          return { file, content, previewType, base64Content }
        })
      )

      // 2. 检查哪些文件有实际文本内容（可以用于 AI 分析）
      const textFiles = fileContents.filter(fc => fc.previewType === 'text')
      const nonTextFiles = fileContents.filter(fc => fc.previewType !== 'text')

      // 3. AI 批量分析（只分析有文本内容的文件）
      // 将文件内容和提取的文本一并传给 AI，确保 OCR 识别的文字也能被分析
      let aiResults = []
      if (textFiles.length > 0) {
        setUploadStatus(`🤖 AI 智能分析 ${textFiles.length} 个可读文本文件...`)
        aiResults = await analyzeDocuments(
          textFiles.map(fc => ({
            file: fc.file,
            content: fc.content  // 传递已提取的文本（OCR/DOCX/直接读取）
          }))
        )
      }

      // 4. 逐个上传并应用 AI 结果
      for (let i = 0; i < fileContents.length; i++) {
        const { file, content, previewType, base64Content } = fileContents[i]
        const isTextFile = previewType === 'text'
        
        // 找到对应的 AI 分析结果（过滤掉 _fallback 降级结果）
        const textFileIndex = textFiles.indexOf(fileContents[i])
        const rawResult = isTextFile && textFileIndex >= 0 ? aiResults[textFileIndex] : null
        const aiResult = rawResult && !rawResult._fallback ? rawResult : null

        // 写入前安全校验：确认摘要/关键词有实质内容，否则不标 aiAnalyzed
        const hasValidSummary = aiResult && (aiResult.summary || '').replace(/[\s\u3000]/g, '').length >= 3
        const hasValidKeywords = aiResult && (aiResult.keywords || []).length >= 1
        const aiValid = aiResult && (hasValidSummary || hasValidKeywords)
        
        // 生成新文件名
        const baseName = file.name.replace(/\.[^/.]+$/, '')
        const ext = file.name.split('.').pop()
        const summary = aiResult?.summary || ''
        const newFileName = summary
          ? `${summary}_${baseName}.${ext}`
          : file.name

        // 生成标题：优先用摘要，其次用文件名
        const title = summary || baseName

        // 保存文件到本地磁盘 uploads 目录
        let localFilePath = ''
        let isStrmRef = false
        
        if (useStrmRef) {
          // Strm 引用模式：创建 .strm 指针文件，不复制原始文件
          try {
            // Electron 环境下，File 对象有 path 属性（实际磁盘路径）
            const originalPath = file.path || null
            if (originalPath) {
              // 创建 .strm 引用文件（内容为原始文件路径）
              const strmResult = await apiService.saveStrmFile(newFileName, originalPath)
              if (strmResult.success) {
                localFilePath = strmResult.filePath
                isStrmRef = true
                logger.info(`[Strm 引用创建成功] ${localFilePath} → ${originalPath}`)
              } else {
                logger.warn('创建引用失败，回退到复制文件:', strmResult.error)
                // 回退：复制文件到 uploads
                const saveData = await apiService.saveUploadFile(newFileName, base64Content, true)
                if (saveData.success) {
                  localFilePath = saveData.filePath
                }
              }
            } else {
              // 浏览器模式：无法获取原始路径，回退到复制文件
              logger.warn('[Strm] 浏览器模式无法获取原始文件路径，回退到复制文件')
              const saveData = await apiService.saveUploadFile(newFileName, base64Content, true)
              if (saveData.success) {
                localFilePath = saveData.filePath
              }
            }
          } catch (e) {
            logger.warn('Strm 引用创建失败，回退到复制文件:', e.message)
            // 回退：复制文件
            try {
              const saveData = await apiService.saveUploadFile(newFileName, base64Content, true)
              if (saveData.success) localFilePath = saveData.filePath
            } catch (e2) {
              logger.warn('回退复制也失败:', e2.message)
            }
          }
        } else {
          // 传统模式：复制文件到 uploads 目录
          try {
            const saveData = await apiService.saveUploadFile(newFileName, base64Content, true)
            if (saveData.success) {
              localFilePath = saveData.filePath
              logger.info(`[原始文件已保存] ${localFilePath}`)
            }
          } catch (e) {
            logger.warn('保存原始文件到本地失败（不影响上传）:', e.message)
          }
        }

        // 添加到存储（包含 AI 分析结果和本地文件路径）
        addDocument({
          title,
          fileName: newFileName,
          fileSize: file.size,
          fileType: getFileExtension(file.name),
          category: aiResult?.category || 'other',
          content: content || `[${ext.toUpperCase()} 文件] 使用系统默认软件打开查看内容`,
          localFilePath: localFilePath,
          isStrmRef: isStrmRef,
          source: 'auto_upload',
          // AI 分析结果（仅当字段校验通过后才写入）—— 流程：AI成功 → JSON合法 → 字段校验 → 写入 → aiAnalyzed=true
          summary: aiResult?.summary || '',
          detailedSummary: aiResult?.detailedSummary || '',
          keywords: aiResult?.keywords || [],
          tags: aiResult?.tags || [],
          entities: aiResult?.entities || { people: [], organizations: [], locations: [], dates: [] },
          aiAnalyzed: aiValid  // ← 字段校验通过后才设为 true
        })

        setUploadedCount(i + 1)
        setUploadProgress(((i + 1) / fileContents.length) * 100)
        setUploadStatus(`✅ ${file.name} → ${newFileName}`)
      }

      // 4. 完成
      setUploadStatus(`🎉 成功上传 ${fileContents.length} 个文件，AI 自动完成分类、命名、打标签`)
      showNotification('success', `成功上传 ${fileContents.length} 个文档（AI 自动处理）`)
      
      // 延迟跳转到文档列表
      setTimeout(() => navigate('/documents'), 1500)

    } catch (error) {
      logger.error('上传处理失败:', error)
      setUploadStatus(`❌ 处理失败: ${error.message}`)
      showNotification('error', `上传失败: ${error.message}`)
    } finally {
      setUploading(false)
    }
  }, [addDocument, navigate, showNotification])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: processFiles,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
      'text/html': ['.html'],
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.svg']
    },
    maxSize: MAX_FILE_SIZE,
    disabled: uploading // 上传中禁用拖拽
  })

  const handleSaveApiKey = () => {
    if (apiKeyInput.trim()) {
      localStorage.setItem('deepseek_api_key', apiKeyInput.trim())
      setShowApiKeyModal(false)
      showNotification('success', 'API Key 已保存，现在可以拖拽文件上传了')
    }
  }

  return (
    <div className="upload-page">
      <div className="upload-page-header">
        <h1 className="upload-page-title">上传文档</h1>
        <p className="upload-page-subtitle">拖拽文件到下方区域，自动完成 AI 分析、分类、命名和打标签</p>
      </div>

      {/* 上传模式选择 - Strm 引用切换 */}
      <div className="upload-mode-bar" style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '12px 16px', background: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)', marginBottom: '16px',
        border: '1px solid var(--border)'
      }}>
        <span className="upload-mode-bar-icon" style={{ fontSize: '1.2rem' }}>📎</span>
        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>文件存储方式：</span>
        <button
          className={`btn btn-sm ${useStrmRef ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => { setUseStrmRef(false); showNotification('info', '已切换为复制文件到知识库') }}
          style={{ padding: '4px 12px', fontSize: '0.8rem' }}
        >
          📋 复制文件
        </button>
        <button
          className={`btn btn-sm ${useStrmRef ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => { setUseStrmRef(true); showNotification('info', '已切换为创建引用（文件保留在原位置）') }}
          style={{ padding: '4px 12px', fontSize: '0.8rem' }}
        >
          🔗 创建引用
        </button>
        {useStrmRef && (
          <span style={{
            fontSize: '0.75rem', color: 'var(--warning)', marginLeft: '8px',
            padding: '2px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: '4px'
          }}>
            ⚡ 文件保留在原位置，仅创建 .strm 指针文件
          </span>
        )}
      </div>

      {/* AI 状态栏 */}
      <div className="upload-ai-bar">
        <div className="upload-ai-bar-info">
          <span className="upload-ai-bar-icon">🤖</span>
          <span>AI 智能处理</span>
          <span className={`upload-ai-bar-status ${(aiReady.ollama || aiReady.deepseek) ? 'upload-ai-bar-status--active' : ''}`}>
            {(aiReady.ollama || aiReady.deepseek) ? '已就绪' : '未配置'}
          </span>
          {aiReady.ollama && (
            <span style={{ fontSize: '0.7rem', color: '#059669', marginLeft: '8px', background: '#05966915', padding: '1px 8px', borderRadius: '10px' }}>
              🟢 Ollama 在线
            </span>
          )}
          {aiReady.deepseek && !aiReady.ollama && (
            <span style={{ fontSize: '0.7rem', color: '#6366f1', marginLeft: '8px', background: '#6366f115', padding: '1px 8px', borderRadius: '10px' }}>
              🟣 DeepSeek API
            </span>
          )}
          {!aiReady.ollama && !aiReady.deepseek && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
              （需要配置 Ollama 或 DeepSeek API Key）
            </span>
          )}
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowApiKeyModal(true)}
        >
          ⚙️ 配置 API
        </button>
      </div>

      {/* 拖拽上传区域 */}
      <div
        {...getRootProps()}
        className={`upload-dropzone ${isDragActive ? 'upload-dropzone--active' : ''} ${uploading ? 'upload-dropzone--disabled' : ''}`}
      >
        <input {...getInputProps()} />
        <div className="upload-dropzone-content">
          {uploading ? (
            <>
              <span className="upload-dropzone-icon">⏳</span>
              <p className="upload-dropzone-text">{uploadStatus}</p>
              <div className="progress-bar" style={{ width: '60%', marginTop: '16px' }}>
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${uploadProgress}%`,
                    background: 'var(--primary)',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
              <p className="upload-dropzone-hint">
                已处理 {uploadedCount} 个文件
              </p>
            </>
          ) : isDragActive ? (
            <>
              <span className="upload-dropzone-icon">📂</span>
              <p className="upload-dropzone-text">释放文件，自动上传并 AI 分析</p>
            </>
          ) : (
            <>
              <span className="upload-dropzone-icon">📤</span>
              <p className="upload-dropzone-text">
                拖拽文件到此处，自动完成一切
              </p>
              <p className="upload-dropzone-hint">
                支持 PDF、Word、Excel、TXT、MD、CSV、JSON、HTML、图片等格式
              </p>
              <p className="upload-dropzone-hint">
                单个文件最大 {formatFileSize(MAX_FILE_SIZE)} · 拖拽即上传，AI 自动分类/命名/打标签
              </p>
            </>
          )}
        </div>
      </div>

      {/* 处理流程说明 */}
      {!uploading && (
        <div className="upload-flow">
          <div className="upload-flow-step">
            <span className="upload-flow-step-icon">📤</span>
            <span className="upload-flow-step-text">拖拽文件</span>
          </div>
          <span className="upload-flow-arrow">→</span>
          <div className="upload-flow-step">
            <span className="upload-flow-step-icon">🤖</span>
            <span className="upload-flow-step-text">AI 分析</span>
          </div>
          <span className="upload-flow-arrow">→</span>
          <div className="upload-flow-step">
            <span className="upload-flow-step-icon">🏷️</span>
            <span className="upload-flow-step-text">自动分类/标签</span>
          </div>
          <span className="upload-flow-arrow">→</span>
          <div className="upload-flow-step">
            <span className="upload-flow-step-icon">✅</span>
            <span className="upload-flow-step-text">完成</span>
          </div>
        </div>
      )}

      {/* API Key 配置弹窗 */}
      <Modal
        isOpen={showApiKeyModal}
        onClose={() => setShowApiKeyModal(false)}
        title="AI 分析未就绪"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowApiKeyModal(false)}>
              跳过，稍后配置
            </button>
            <button className="btn btn-primary" onClick={handleSaveApiKey}>
              保存并开始使用
            </button>
          </>
        }
      >
        <div className="upload-api-key-form">
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '16px', lineHeight: 1.6 }}>
            本地 Ollama 模型未检测到，且 DeepSeek API Key 未配置。
            AI 智能分析需要至少启用一项。
          </p>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginBottom: '16px' }}>
            💡 提示：你也可以安装 Ollama 本地模型作为第一优先级分析引擎（免费、无须 Key）
          </p>
          <div className="input-group">
            <label>DeepSeek API Key（备选方案）</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="sk-xxxxxxxxxxxxxxxx"
              autoFocus
            />
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem', marginTop: '8px' }}>
            获取 API Key: <a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer">platform.deepseek.com</a>
          </p>
        </div>
      </Modal>
    </div>
  )
}
