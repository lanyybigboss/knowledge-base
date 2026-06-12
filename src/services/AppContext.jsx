/**
 * 知识库管理系统 - 全局状态上下文（v1.7.x 精简版）
 *
 * v1.7.x 拆分后的精简 AppContext：
 * - 状态逻辑：./appReducer.js（ACTIONS + initialState + reducer）
 * - 业务操作：./useAppActions.js（buildActions + useAppActions）
 * - 计算属性：./useAppComputed.js（filteredDocuments / pagination / statistics）
 * - Strm 处理：./useAppActions.js（useStrmFileProcessor）
 *
 * 本文件只保留：Context 创建 + Provider 编排 + useApp hook
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, useMemo } from 'react'
import storageService from './storageService'
import logger from './logger'
import searchService from './searchService'
import syncService from './syncService'
import backgroundAnalysisService from './backgroundAnalysisService'
import { isOllamaAvailable, hasApiKey } from './aiService'
import { ACTIONS, initialState, appReducer } from './appReducer'
import { useAppActions, useStrmFileProcessor, useAutoProcess } from './useAppActions'
import { useAppComputed } from './useAppComputed'

// 创建上下文
const AppContext = createContext(null)

/**
 * Provider 组件
 * 编排 state + actions + computed，并组合为 contextValue
 */
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  // ===== 通知 =====
  const showNotification = useCallback((type, message, duration = 3000) => {
    dispatch({ type: ACTIONS.SET_NOTIFICATION, payload: { type, message } })
    setTimeout(() => {
      dispatch({ type: ACTIONS.CLEAR_NOTIFICATION })
    }, duration)
  }, [])

  // ===== Actions（业务操作） =====
  const actions = useAppActions(dispatch, showNotification)

  // ===== Computed（计算属性） =====
  const computed = useAppComputed(state)

  // ===== Strm 文件处理 =====
  const processStrmFile = useStrmFileProcessor(dispatch)

  // ===== 启动/停止自动刮削轮询 =====
  const autoProcess = useAutoProcess(processStrmFile)
  useEffect(() => {
    autoProcess.start()
    return () => autoProcess.stop()
  }, [autoProcess])

  // ===== 防抖搜索索引构建 =====
  const searchIndexTimerRef = useRef(null)
  const debouncedBuildSearchIndex = useCallback((docs) => {
    if (searchIndexTimerRef.current) {
      clearTimeout(searchIndexTimerRef.current)
    }
    searchIndexTimerRef.current = setTimeout(() => {
      searchService.buildIndex(docs)
      searchIndexTimerRef.current = null
    }, 500) // 500ms 防抖
  }, [])

  // ===== 初始化加载数据 =====
  useEffect(() => {
    let mounted = true
    logger.info('AppProvider 已挂载，正在初始化存储并加载数据...')

    const initialize = async () => {
      try {
        dispatch({ type: ACTIONS.SET_LOADING, payload: true })

        // 初始化 IndexedDB（首次使用会从 localStorage 迁移数据）
        await storageService.init()

        if (!mounted) return

        // 使用元数据（不含 content）来减少内存占用
        const [metadata, categories, settings, numberingRules] = await Promise.all([
          storageService.getDocumentMetadata(200, 0), // 只加载前 200 条的元数据
          storageService.getCategories(),
          storageService.getSettings(),
          storageService.getNumberingRules()
        ])

        dispatch({ type: ACTIONS.SET_DOCUMENTS, payload: metadata })
        dispatch({ type: ACTIONS.SET_CATEGORIES, payload: categories })
        dispatch({ type: ACTIONS.SET_SETTINGS, payload: settings })
        dispatch({ type: ACTIONS.SET_NUMBERING_RULES, payload: numberingRules })

        // 构建搜索索引（使用元数据）
        searchService.buildIndex(metadata)

        // 启动后台 AI 分析服务（扫描未分析文档）
        // 只要 Ollama 或 DeepSeek 任一可用就启动
        const ollamaOk = await isOllamaAvailable()
        if (ollamaOk || hasApiKey()) {
          backgroundAnalysisService.start()
          logger.info(`[AppContext] 后台 AI 分析服务已启动（Ollama: ${ollamaOk ? '可用' : '不可用'}, DeepSeek: ${hasApiKey() ? '已配置' : '未配置'}）`)
        } else {
          logger.info('[AppContext] 无可用 AI 服务（Ollama 不可用，DeepSeek 未配置），跳过后台 AI 分析')
        }

        logger.info(`数据加载完成: ${metadata.length} 个文档, ${categories.length} 个分类`)

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

  // ===== 轻量文档重载 =====
  const reloadCountRef = useRef(0)
  const reloadDocuments = useCallback(async () => {
    try {
      const docs = await storageService.getDocumentMetadata(200, 0)
      logger.info(`[UI_REFRESH] reloadDocuments 完成 | documents.length=${docs.length}`)
      dispatch({ type: ACTIONS.SET_DOCUMENTS, payload: docs })
      debouncedBuildSearchIndex(docs)
    } catch (error) {
      logger.error('[UI_REFRESH] reloadDocuments 失败:', error)
    }
  }, [debouncedBuildSearchIndex])

  // ===== 防抖 reload（300ms 内多次触发合并为 1 次） =====
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

  // ===== 数据重载（reload all） =====
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

  // ===== 包装 importData（带 loadData + wakeUp） =====
  const importDataWithReload = useCallback(async (data) => {
    const result = await actions.importData(data)
    if (result.success) {
      await loadData()
      backgroundAnalysisService.wakeUp()
    }
    return result
  }, [actions, loadData])

  // ===== 构建 context 值 =====
  const contextValue = useMemo(() => ({
    // 状态
    ...state,

    // 计算属性
    ...computed,

    // 文档操作
    addDocument: actions.addDocument,
    updateDocument: actions.updateDocument,
    deleteDocument: actions.deleteDocument,
    deleteDocuments: actions.deleteDocuments,
    toggleStar: actions.toggleStar,

    // 分类操作
    addCategory: actions.addCategory,
    updateCategory: actions.updateCategory,
    deleteCategory: actions.deleteCategory,

    // 设置操作
    updateSettings: actions.updateSettings,
    updateNumberingRules: actions.updateNumberingRules,

    // 数据管理
    exportData: actions.exportData,
    importData: importDataWithReload,
    clearAllData: actions.clearAllData,
    loadData,
    reloadDocuments,
    scheduleReloadDocuments,
    reloadCountRef,

    // Strm 处理
    processStrmFile,

    // UI 操作
    showNotification: actions.showNotification,
    setSearch: actions.setSearch,
    setFilters: actions.setFilters,
    setSort: actions.setSort,
    setPage: actions.setPage,
    setSelectedIds: actions.setSelectedIds,
    toggleSidebar: actions.toggleSidebar,
    toggleLogViewer: actions.toggleLogViewer
  }), [
    state,
    computed,
    actions,
    loadData, reloadDocuments, scheduleReloadDocuments,
    importDataWithReload, processStrmFile
  ])

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
