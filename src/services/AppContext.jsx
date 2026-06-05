/**
 * 知识库管理系统 - 全局状态上下文
 * 模块化拆分：reducer → appReducer.js, actions → useAppActions.js, computed → useAppComputed.js
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef, useMemo } from 'react'
import storageService from './storageService'
import logger from './logger'
import watcherService from './folderWatcherService'
import { analyzeDocument, hasApiKey, isOllamaAvailable } from './aiService'
import backgroundAnalysisService from './backgroundAnalysisService'
import searchService from './searchService'
import syncService from './syncService'
import { processStrmFile as processStrmFileCore } from './strmFileProcessor'
import { appReducer, initialState, ACTIONS } from './appReducer'
import { useAppActions } from './useAppActions'
import { useAppComputed } from './useAppComputed'

// 创建上下文
const AppContext = createContext(null)

// Provider 组件
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState)

  // ===== 通知 =====
  const showNotification = useCallback((type, message, duration = 3000) => {
    dispatch({ type: ACTIONS.SET_NOTIFICATION, payload: { type, message } })
    setTimeout(() => {
      dispatch({ type: ACTIONS.CLEAR_NOTIFICATION })
    }, duration)
  }, [])

  // ===== 业务操作 =====
  const actions = useAppActions(dispatch, showNotification)

  // ===== 计算属性 =====
  const computed = useAppComputed(state)

  // ===== 防抖搜索索引构建 =====
  const searchIndexTimerRef = useRef(null)
  const debouncedBuildSearchIndex = useCallback((docs) => {
    if (searchIndexTimerRef.current) {
      clearTimeout(searchIndexTimerRef.current)
    }
    searchIndexTimerRef.current = setTimeout(() => {
      searchService.buildIndex(docs)
      searchIndexTimerRef.current = null
    }, 500)
  }, [])

  // ===== 初始化加载数据 =====
  useEffect(() => {
    let mounted = true
    logger.info('AppProvider 已挂载，正在初始化存储并加载数据...')

    const initialize = async () => {
      try {
        dispatch({ type: ACTIONS.SET_LOADING, payload: true })

        await storageService.init()

        if (!mounted) return

        const [metadata, categories, settings, numberingRules] = await Promise.all([
          storageService.getDocumentMetadata(200, 0),
          storageService.getCategories(),
          storageService.getSettings(),
          storageService.getNumberingRules()
        ])

        dispatch({ type: ACTIONS.SET_DOCUMENTS, payload: metadata })
        dispatch({ type: ACTIONS.SET_CATEGORIES, payload: categories })
        dispatch({ type: ACTIONS.SET_SETTINGS, payload: settings })
        dispatch({ type: ACTIONS.SET_NUMBERING_RULES, payload: numberingRules })

        searchService.buildIndex(metadata)

        const ollamaOk = await isOllamaAvailable()
        if (ollamaOk || hasApiKey()) {
          backgroundAnalysisService.start()
          logger.info(`[AppContext] 后台 AI 分析服务已启动（Ollama: ${ollamaOk ? '可用' : '不可用'}, DeepSeek: ${hasApiKey() ? '已配置' : '未配置'}）`)
        } else {
          logger.info('[AppContext] 无可用 AI 服务，跳过后台 AI 分析')
        }

        logger.info(`数据加载完成: ${metadata.length} 个文档, ${categories.length} 个分类`)

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

  // ===== Strm 文件自动刮削 =====
  const stopAutoProcessRef = useRef(null)

  const processStrmFile = useCallback(async (strmFileName, originalFilePath, strmFilePath, isObsidianNote = false) => {
    return processStrmFileCore(strmFileName, originalFilePath, strmFilePath || '', isObsidianNote, {
      dispatch,
      storageService,
      analyzeDocument,
      logger,
      ADD_DOCUMENT_ACTION: ACTIONS.ADD_DOCUMENT
    })
  }, [])

  useEffect(() => {
    const processor = (strmFileName, originalFilePath, strmFilePath, isObsidianNote) => {
      return processStrmFile(strmFileName, originalFilePath, strmFilePath || '', isObsidianNote)
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

  // ===== debounced reload =====
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

  // ===== 后台 AI 分析完成回调 =====
  useEffect(() => {
    backgroundAnalysisService.onDocumentUpdated = (docId) => {
      logger.info(`[UI_REFRESH] 收到后台 AI 完成通知 | docId=${docId}`)
      scheduleReloadDocuments()
    }
  }, [scheduleReloadDocuments])

  // ===== 卸载清理 =====
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current)
        reloadTimerRef.current = null
      }
    }
  }, [])

  // ===== context 值 =====
  const contextValue = useMemo(() => ({
    ...state,
    ...computed,
    ...actions,
    showNotification,
    reloadDocuments,
    scheduleReloadDocuments,
    reloadCountRef
  }), [
    state, computed, actions,
    showNotification, reloadDocuments, scheduleReloadDocuments
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

// 导出 ACTIONS 供外部使用
export { ACTIONS }

export default AppContext
