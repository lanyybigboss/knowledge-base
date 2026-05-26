/**
 * 知识库管理系统 - 全局状态上下文
 * 支持异步 IndexedDB 操作
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react'
import storageService from './storageService'
import logger from './logger'
import apiService from './apiService'
import watcherService from './folderWatcherService'
import { analyzeDocument, hasApiKey, isOllamaAvailable } from './aiService'
import backgroundAnalysisService from './backgroundAnalysisService'
import searchService from './searchService'
import syncService from './syncService'
import { getFileExtension, filterDocuments, paginateDocuments, calculateStatistics } from '../utils/helpers'

// 创建上下文
const AppContext = createContext(null)

// 动作类型
export const ACTIONS = {
  // 文档操作
  SET_DOCUMENTS: 'SET_DOCUMENTS',
  ADD_DOCUMENT: 'ADD_DOCUMENT',
  UPDATE_DOCUMENT: 'UPDATE_DOCUMENT',
  DELETE_DOCUMENT: 'DELETE_DOCUMENT',
  DELETE_DOCUMENTS: 'DELETE_DOCUMENTS',
  TOGGLE_STAR: 'TOGGLE_STAR',
  
  // 分类操作
  SET_CATEGORIES: 'SET_CATEGORIES',
  ADD_CATEGORY: 'ADD_CATEGORY',
  UPDATE_CATEGORY: 'UPDATE_CATEGORY',
  DELETE_CATEGORY: 'DELETE_CATEGORY',
  
  // 搜索和过滤
  SET_SEARCH: 'SET_SEARCH',
  SET_FILTERS: 'SET_FILTERS',
  SET_SORT: 'SET_SORT',
  SET_PAGE: 'SET_PAGE',
  SET_PAGE_SIZE: 'SET_PAGE_SIZE',
  
  // 设置
  SET_SETTINGS: 'SET_SETTINGS',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  SET_NUMBERING_RULES: 'SET_NUMBERING_RULES',
  
  // 数据管理
  IMPORT_DATA: 'IMPORT_DATA',
  CLEAR_ALL: 'CLEAR_ALL',
  
  // UI 状态
  SET_LOADING: 'SET_LOADING',
  SET_NOTIFICATION: 'SET_NOTIFICATION',
  CLEAR_NOTIFICATION: 'CLEAR_NOTIFICATION',
  SET_SELECTED_IDS: 'SET_SELECTED_IDS',
  TOGGLE_SIDEBAR: 'TOGGLE_SIDEBAR',
  TOGGLE_LOG_VIEWER: 'TOGGLE_LOG_VIEWER'
}

// 初始状态
const initialState = {
  // 数据
  documents: [],
  categories: [],
  
  // 搜索和过滤
  searchQuery: '',
  filters: {
    category: 'all',
    type: 'all',
    tags: []
  },
  sort: 'createdAt-desc',
  page: 1,
  pageSize: 20,
  
  // 设置
  settings: {},
  numberingRules: {},
  
  // UI 状态
  loading: false,
  dataLoaded: false,
  notification: null,
  selectedIds: [],
  sidebarOpen: true,
  logViewerOpen: false
}

// Reducer
function appReducer(state, action) {
  switch (action.type) {
    // ===== 文档操作 =====
    case ACTIONS.SET_DOCUMENTS:
      return { ...state, documents: action.payload }
    
    case ACTIONS.ADD_DOCUMENT:
      return { ...state, documents: [action.payload, ...state.documents] }
    
    case ACTIONS.UPDATE_DOCUMENT:
      return {
        ...state,
        documents: state.documents.map(doc =>
          doc.id === action.payload.id ? { ...doc, ...action.payload } : doc
        )
      }
    
    case ACTIONS.DELETE_DOCUMENT:
      return {
        ...state,
        documents: state.documents.filter(doc => doc.id !== action.payload)
      }
    
    case ACTIONS.DELETE_DOCUMENTS:
      return {
        ...state,
        documents: state.documents.filter(doc => !action.payload.includes(doc.id)),
        selectedIds: []
      }
    
    case ACTIONS.TOGGLE_STAR:
      return {
        ...state,
        documents: state.documents.map(doc =>
          doc.id === action.payload ? { ...doc, starred: !doc.starred } : doc
        )
      }
    
    // ===== 分类操作 =====
    case ACTIONS.SET_CATEGORIES:
      return { ...state, categories: action.payload }
    
    case ACTIONS.ADD_CATEGORY:
      return { ...state, categories: [...state.categories, action.payload] }
    
    case ACTIONS.UPDATE_CATEGORY:
      return {
        ...state,
        categories: state.categories.map(cat =>
          cat.id === action.payload.id ? { ...cat, ...action.payload } : cat
        )
      }
    
    case ACTIONS.DELETE_CATEGORY:
      return {
        ...state,
        categories: state.categories.filter(cat => cat.id !== action.payload)
      }
    
    // ===== 搜索和过滤 =====
    case ACTIONS.SET_SEARCH:
      return { ...state, searchQuery: action.payload, page: 1 }
    
    case ACTIONS.SET_FILTERS:
      return { ...state, filters: { ...state.filters, ...action.payload }, page: 1 }
    
    case ACTIONS.SET_SORT:
      return { ...state, sort: action.payload, page: 1 }
    
    case ACTIONS.SET_PAGE:
      return { ...state, page: action.payload }
    
    case ACTIONS.SET_PAGE_SIZE:
      return { ...state, pageSize: action.payload, page: 1 }
    
    // ===== 设置 =====
    case ACTIONS.SET_SETTINGS:
      return { ...state, settings: action.payload }
    
    case ACTIONS.UPDATE_SETTINGS:
      return { ...state, settings: { ...state.settings, ...action.payload } }
    
    case ACTIONS.SET_NUMBERING_RULES:
      return { ...state, numberingRules: action.payload }
    
    // ===== 数据管理 =====
    case ACTIONS.IMPORT_DATA:
      return {
        ...state,
        documents: action.payload.documents || state.documents,
        categories: action.payload.categories || state.categories,
        numberingRules: action.payload.numberingRules || state.numberingRules,
        settings: action.payload.settings || state.settings
      }
    
    case ACTIONS.CLEAR_ALL:
      return { ...initialState, dataLoaded: true }
    
    // ===== UI 状态 =====
    case ACTIONS.SET_LOADING:
      return { ...state, loading: action.payload }
    
    case ACTIONS.SET_NOTIFICATION:
      return { ...state, notification: action.payload }
    
    case ACTIONS.CLEAR_NOTIFICATION:
      return { ...state, notification: null }
    
    case ACTIONS.SET_SELECTED_IDS:
      return { ...state, selectedIds: action.payload }
    
    case ACTIONS.TOGGLE_SIDEBAR:
      return { ...state, sidebarOpen: !state.sidebarOpen }
    
    case ACTIONS.TOGGLE_LOG_VIEWER:
      return { ...state, logViewerOpen: !state.logViewerOpen }
    
    default:
      return state
  }
}

// Provider 组件
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)
  
  // 初始化加载数据
  useEffect(() => {
    let mounted = true
    logger.info('AppProvider 已挂载，正在初始化存储并加载数据...')
    
    const initialize = async () => {
      try {
        dispatch({ type: ACTIONS.SET_LOADING, payload: true })
        
        // 初始化 IndexedDB（首次使用会从 localStorage 迁移数据）
        await storageService.init()
        
        if (!mounted) return
        
        // 加载所有数据
        const [documents, categories, settings, numberingRules] = await Promise.all([
          storageService.getDocuments(),
          storageService.getCategories(),
          storageService.getSettings(),
          storageService.getNumberingRules()
        ])
        
        if (!mounted) return
        
        dispatch({ type: ACTIONS.SET_DOCUMENTS, payload: documents })
        dispatch({ type: ACTIONS.SET_CATEGORIES, payload: categories })
        dispatch({ type: ACTIONS.SET_SETTINGS, payload: settings })
        dispatch({ type: ACTIONS.SET_NUMBERING_RULES, payload: numberingRules })
        
        // 构建搜索索引
        searchService.buildIndex(documents)
        
        // 启动后台 AI 分析服务（扫描未分析文档）
        // 只要 Ollama 或 DeepSeek 任一可用就启动
        const ollamaOk = await isOllamaAvailable()
        if (ollamaOk || hasApiKey()) {
          backgroundAnalysisService.start()
          logger.info(`[AppContext] 后台 AI 分析服务已启动（Ollama: ${ollamaOk ? '可用' : '不可用'}, DeepSeek: ${hasApiKey() ? '已配置' : '未配置'}）`)
        } else {
          logger.info('[AppContext] 无可用 AI 服务（Ollama 不可用，DeepSeek 未配置），跳过后台 AI 分析')
        }
        
        logger.info(`数据加载完成: ${documents.length} 个文档, ${categories.length} 个分类`)

        // 启动跨模式数据同步
        syncService.start()
        logger.info('[AppContext] 跨模式数据同步已启动')
      } catch (error) {
        logger.error('初始化数据失败:', error)
        if (mounted) {
          dispatch({ type: ACTIONS.SET_NOTIFICATION, payload: { type: 'error', message: '数据加载失败，请刷新页面重试' } })
        }
      } finally {
        if (mounted) {
          dispatch({ type: ACTIONS.SET_LOADING, payload: false })
        }
      }
    }
    
    initialize()
    
    return () => { mounted = false }
  }, [])

  // ===== Strm 文件自动刮削（影子文件入库 + AI 分析） =====
  const stopAutoProcessRef = useRef(null)

  const processStrmFile = useCallback(async (strmFileName, originalFilePath, strmFilePath) => {
    try {
      logger.info(`[Strm 刮削] 开始处理: ${strmFileName}`)

      // 1. 读取原始文件内容
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
      const title = baseName
      const binaryStr = atob(fileResult.content)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      const blob = new Blob([bytes], { type: fileResult.mimeType || 'application/octet-stream' })

      // 3. 根据文件类型提取文本
      let content = ''
      let aiResult = null
      const textExts = ['txt', 'md', 'csv', 'json', 'xml', 'html', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'css', 'log', 'ini', 'cfg', 'yaml', 'yml', 'toml']
      const pdfExts = ['pdf']
      const docxExts = ['docx', 'doc']
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif']

      try {
        if (textExts.includes(ext)) {
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
        category: aiResult?.category || 'uncategorized',
        tags: aiResult?.tags || [],
        keywords: aiResult?.keywords || [],
        content: content || `[${ext.toUpperCase()} 文件] 使用系统默认软件打开查看`,
        localFilePath: strmFilePath || '',
        isStrmRef: true,
        source: 'watcher',
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
        dispatch({ type: ACTIONS.ADD_DOCUMENT, payload: newDoc })
        logger.info(`[Strm 刮削] ✅ 入库成功: "${title}"${aiResult ? ' (含 AI 摘要)' : ''}`)
        return true
      }
      return false
    } catch (e) {
      logger.error(`[Strm 刮削] ❌ 处理异常 ${strmFileName}:`, e.message)
      return false
    }
  }, [])

  // 启动/停止自动刮削轮询
  useEffect(() => {
    const processor = (strmFileName, originalFilePath) => {
      // 获取 strmFilePath 需要从 watcherService 获取完整信息
      return processStrmFile(strmFileName, originalFilePath, '')
    }
    stopAutoProcessRef.current = watcherService.startAutoProcessing(processor, 8000)
    logger.info('[Strm 刮削] 自动处理轮询已启动 (间隔 8 秒)')

    return () => {
      if (stopAutoProcessRef.current) {
        stopAutoProcessRef.current()
        logger.info('[Strm 刮削] 自动处理轮询已停止')
      }
    }
  }, [processStrmFile])
  
  const loadData = useCallback(async () => {
    try {
      const [documents, categories, settings, numberingRules] = await Promise.all([
        storageService.getDocuments(),
        storageService.getCategories(),
        storageService.getSettings(),
        storageService.getNumberingRules()
      ])
      dispatch({ type: ACTIONS.SET_DOCUMENTS, payload: documents })
      dispatch({ type: ACTIONS.SET_CATEGORIES, payload: categories })
      dispatch({ type: ACTIONS.SET_SETTINGS, payload: settings })
      dispatch({ type: ACTIONS.SET_NUMBERING_RULES, payload: numberingRules })
      searchService.buildIndex(documents)
    } catch (error) {
      logger.error('重新加载数据失败:', error)
    }
  }, [])

  // ===== 轻量文档重载（仅 reload documents 表，不碰 categories/settings/numberingRules）=====
  const reloadCountRef = useRef(0)
  const reloadDocuments = useCallback(async () => {
    try {
      const docs = await storageService.getDocuments()
      logger.info(`[UI_REFRESH] reloadDocuments 完成 | documents.length=${docs.length}`)
      dispatch({ type: ACTIONS.SET_DOCUMENTS, payload: docs })
      searchService.buildIndex(docs)
    } catch (error) {
      logger.error('[UI_REFRESH] reloadDocuments 失败:', error)
    }
  }, [])

  // ===== debounced reload (300ms 内多次触发合并为 1 次) =====
  const reloadTimerRef = useRef(null)
  const scheduleReloadDocuments = useCallback(() => {
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current)
    }
    reloadTimerRef.current = setTimeout(async () => {
      reloadCountRef.current++
      logger.info(`[UI_REFRESH] debounced reload triggered | reloadCount=${reloadCountRef.current}`)
      await reloadDocuments()
      reloadTimerRef.current = null
    }, 300)
  }, [reloadDocuments])

  // ===== 注册后台 AI 分析完成回调 =====
  useEffect(() => {
    backgroundAnalysisService.onDocumentUpdated = (docId) => {
      logger.info(`[UI_REFRESH] 收到后台 AI 完成通知 | docId=${docId}`)
      scheduleReloadDocuments()
    }
  }, [scheduleReloadDocuments])

  // ===== 卸载时清除 debounce timer =====
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
    }
  }, [])
  
  // ===== 文档操作方法 =====
  
  const addDocument = useCallback(async (docData) => {
    try {
      const newDoc = await storageService.addDocument(docData)
      dispatch({ type: ACTIONS.ADD_DOCUMENT, payload: newDoc })
      syncService.markDirty()
      // 唤醒后台 AI 分析服务（若处于待机）
      backgroundAnalysisService.wakeUp()
      logger.info(`文档已添加: "${newDoc.title}"`, { id: newDoc.id, category: newDoc.category, docNumber: newDoc.docNumber })
      showNotification('success', `文档 "${newDoc.title}" 已添加`)
      return newDoc
    } catch (error) {
      logger.error('添加文档失败:', error)
      showNotification('error', '添加文档失败: ' + error.message)
      return null
    }
  }, [])
  
  const updateDocument = useCallback(async (id, updates) => {
    try {
      const updated = await storageService.updateDocument(id, updates)
      if (updated) {
        dispatch({ type: ACTIONS.UPDATE_DOCUMENT, payload: updated })
        syncService.markDirty()
        showNotification('success', '文档已更新')
      }
      return updated
    } catch (error) {
      logger.error('更新文档失败:', error)
      showNotification('error', '更新文档失败: ' + error.message)
      return null
    }
  }, [])
  
  const deleteDocument = useCallback(async (id) => {
    try {
      const doc = state.documents.find(d => d.id === id)
      const success = await storageService.deleteDocument(id)
      if (success) {
        dispatch({ type: ACTIONS.DELETE_DOCUMENT, payload: id })
        syncService.markDirty()
        logger.info(`文档已删除: "${doc?.title || id}"`, { id })
        showNotification('success', '文档已删除')
      }
      return success
    } catch (error) {
      logger.error('删除文档失败:', error)
      showNotification('error', '删除文档失败')
      return false
    }
  }, [state.documents])
  
  const deleteDocuments = useCallback(async (ids) => {
    try {
      const count = await storageService.deleteDocuments(ids)
      if (count > 0) {
        dispatch({ type: ACTIONS.DELETE_DOCUMENTS, payload: ids })
        syncService.markDirty()
        logger.info(`批量删除文档`, { count, ids })
        showNotification('success', `已删除 ${count} 个文档`)
      }
      return count
    } catch (error) {
      logger.error('批量删除失败:', error)
      showNotification('error', '批量删除失败')
      return 0
    }
  }, [])
  
  const toggleStar = useCallback(async (id) => {
    try {
      const updated = await storageService.toggleStar(id)
      if (updated) {
        dispatch({ type: ACTIONS.TOGGLE_STAR, payload: id })
        syncService.markDirty()
      }
      return updated
    } catch (error) {
      logger.error('切换星标失败:', error)
      return null
    }
  }, [])
  
  // ===== 分类操作方法 =====
  
  const addCategory = useCallback(async (categoryData) => {
    try {
      const newCategory = await storageService.addCategory(categoryData)
      dispatch({ type: ACTIONS.ADD_CATEGORY, payload: newCategory })
      syncService.markDirty()
      showNotification('success', `分类 "${newCategory.name}" 已添加`)
      return newCategory
    } catch (error) {
      logger.error('添加分类失败:', error)
      showNotification('error', '添加分类失败')
      return null
    }
  }, [])
  
  const updateCategory = useCallback(async (id, updates) => {
    try {
      const updated = await storageService.updateCategory(id, updates)
      if (updated) {
        dispatch({ type: ACTIONS.UPDATE_CATEGORY, payload: updated })
        syncService.markDirty()
        showNotification('success', '分类已更新')
      }
      return updated
    } catch (error) {
      logger.error('更新分类失败:', error)
      showNotification('error', '更新分类失败')
      return null
    }
  }, [])
  
  const deleteCategory = useCallback(async (id) => {
    try {
      const success = await storageService.deleteCategory(id)
      if (success) {
        dispatch({ type: ACTIONS.DELETE_CATEGORY, payload: id })
        syncService.markDirty()
        showNotification('success', '分类已删除')
      }
      return success
    } catch (error) {
      logger.error('删除分类失败:', error)
      showNotification('error', '删除分类失败')
      return false
    }
  }, [])
  
  // ===== 设置方法 =====
  
  const updateSettings = useCallback(async (settings) => {
    try {
      const success = await storageService.updateSettings(settings)
      if (success) {
        dispatch({ type: ACTIONS.UPDATE_SETTINGS, payload: settings })
        showNotification('success', '设置已保存')
      }
      return success
    } catch (error) {
      logger.error('保存设置失败:', error)
      showNotification('error', '保存设置失败')
      return false
    }
  }, [])
  
  const updateNumberingRules = useCallback(async (rules) => {
    try {
      const success = await storageService.updateNumberingRules(rules)
      if (success) {
        dispatch({ type: ACTIONS.SET_NUMBERING_RULES, payload: rules })
        showNotification('success', '编号规则已更新')
      }
      return success
    } catch (error) {
      logger.error('更新编号规则失败:', error)
      showNotification('error', '更新编号规则失败')
      return false
    }
  }, [])
  
  // ===== 数据管理 =====
  
  const exportData = useCallback(async () => {
    try {
      return await storageService.exportAllData()
    } catch (error) {
      logger.error('导出数据失败:', error)
      return null
    }
  }, [])
  
  const importData = useCallback(async (data) => {
    try {
      const result = await storageService.importData(data)
      if (result.success) {
        await loadData()
        // 唤醒后台 AI 分析服务（若处于待机）
        backgroundAnalysisService.wakeUp()
        showNotification('success', result.message)
      } else {
        showNotification('error', result.message)
      }
      return result
    } catch (error) {
      const message = '导入失败: ' + error.message
      showNotification('error', message)
      return { success: false, message }
    }
  }, [loadData])
  
  const clearAllData = useCallback(async () => {
    try {
      await storageService.clearAllData()
      dispatch({ type: ACTIONS.CLEAR_ALL })
      logger.warn('所有数据已清除!')
      showNotification('success', '所有数据已清除')
    } catch (error) {
      logger.error('清除数据失败:', error)
      showNotification('error', '清除数据失败')
    }
  }, [])
  
  // ===== UI 方法 =====
  
  const showNotification = useCallback((type, message, duration = 3000) => {
    dispatch({ type: ACTIONS.SET_NOTIFICATION, payload: { type, message } })
    setTimeout(() => {
      dispatch({ type: ACTIONS.CLEAR_NOTIFICATION })
    }, duration)
  }, [])
  
  const setSearch = useCallback((query) => {
    dispatch({ type: ACTIONS.SET_SEARCH, payload: query })
  }, [])
  
  const setFilters = useCallback((filters) => {
    dispatch({ type: ACTIONS.SET_FILTERS, payload: filters })
  }, [])
  
  const setSort = useCallback((sort) => {
    dispatch({ type: ACTIONS.SET_SORT, payload: sort })
  }, [])
  
  const setPage = useCallback((page) => {
    dispatch({ type: ACTIONS.SET_PAGE, payload: page })
  }, [])
  
  const setSelectedIds = useCallback((ids) => {
    dispatch({ type: ACTIONS.SET_SELECTED_IDS, payload: ids })
  }, [])
  
  const toggleSidebar = useCallback(() => {
    dispatch({ type: ACTIONS.TOGGLE_SIDEBAR })
  }, [])
  
  const toggleLogViewer = useCallback(() => {
    dispatch({ type: ACTIONS.TOGGLE_LOG_VIEWER })
  }, [])
  
  // ===== 计算属性 =====
  
  const filteredDocuments = filterDocuments(state.documents, {
    search: state.searchQuery,
    category: state.filters.category,
    type: state.filters.type,
    sort: state.sort,
    tags: state.filters.tags
  })
  
  const paginatedResult = paginateDocuments(filteredDocuments, state.page, state.pageSize)
  
  const statistics = calculateStatistics(state.documents)
  
  const starredDocuments = state.documents.filter(doc => doc.starred)
  
  // 构建 context 值
  const contextValue = {
    // 状态
    ...state,
    
    // 计算属性
    filteredDocuments,
    paginatedDocuments: paginatedResult.documents,
    pagination: paginatedResult.pagination,
    statistics,
    starredDocuments,
    
    // 文档操作
    addDocument,
    updateDocument,
    deleteDocument,
    deleteDocuments,
    toggleStar,
    
    // 分类操作
    addCategory,
    updateCategory,
    deleteCategory,
    
    // 设置操作
    updateSettings,
    updateNumberingRules,
    
    // 数据管理
    exportData,
    importData,
    clearAllData,
    loadData,
    reloadDocuments,
    scheduleReloadDocuments,
    reloadCountRef,
    
    // UI 操作
    showNotification,
    setSearch,
    setFilters,
    setSort,
    setPage,
    setSelectedIds,
    toggleSidebar,
    toggleLogViewer
  }
  
  return (
    <AppContext.Provider value={contextValue}>
      {children}
    </AppContext.Provider>
  )
}

// 自定义 Hook
export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

export default AppContext
