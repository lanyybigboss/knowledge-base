/**
 * useAppActions 模块（v1.7.x 拆分）
 * 业务操作 hooks：文档 / 分类 / 设置 / 数据管理 / UI 操作
 * 工厂模式：createAppActions(dispatch, showNotification) 返回所有 action 方法
 */

import { useCallback, useMemo, useRef } from 'react'
import storageService from './storageService'
import logger from './logger'
import syncService from './syncService'
import backgroundAnalysisService from './backgroundAnalysisService'
import watcherService from './folderWatcherService'
import { analyzeDocument } from './aiService'
import { processStrmFile as processStrmFileCore } from './strmFileProcessor'
import { ACTIONS } from './appReducer'

/**
 * 创建所有 action 方法（供 AppContext 调用）
 * @param {Function} dispatch - useReducer 的 dispatch
 * @param {Function} showNotification - 通知回调
 * @returns {object} actions - 包含所有操作方法的命名空间对象
 */
function buildActions(dispatch, showNotification) {
  return {
    // ===== UI 通知 =====
    showNotification,

    // ===== 文档操作 =====
    addDocument: async (docData) => {
      try {
        const newDoc = await storageService.addDocument(docData)
        dispatch({ type: ACTIONS.ADD_DOCUMENT, payload: newDoc })
        syncService.markDirty()
        backgroundAnalysisService.wakeUp()
        logger.info(`文档已添加: "${newDoc.title}"`, { id: newDoc.id, category: newDoc.category, docNumber: newDoc.docNumber })
        showNotification('success', `文档 "${newDoc.title}" 已添加`)
        return newDoc
      } catch (error) {
        logger.error('添加文档失败:', error)
        showNotification('error', '添加文档失败: ' + error.message)
        return null
      }
    },

    updateDocument: async (id, updates) => {
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
    },

    deleteDocument: async (id) => {
      try {
        const doc = await storageService.getDocument(id)
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
    },

    deleteDocuments: async (ids) => {
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
    },

    toggleStar: async (id) => {
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
    },

    // ===== 分类操作 =====
    addCategory: async (categoryData) => {
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
    },

    updateCategory: async (id, updates) => {
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
    },

    deleteCategory: async (id) => {
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
    },

    // ===== 设置操作 =====
    updateSettings: async (settings) => {
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
    },

    updateNumberingRules: async (rules) => {
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
    },

    // ===== 数据管理 =====
    exportData: async () => {
      try {
        return await storageService.exportAllData()
      } catch (error) {
        logger.error('导出数据失败:', error)
        return null
      }
    },

    importData: async (data) => {
      try {
        const result = await storageService.importData(data)
        if (result.success) {
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
    },

    clearAllData: async () => {
      try {
        await storageService.clearAllData()
        dispatch({ type: ACTIONS.CLEAR_ALL })
        logger.warn('所有数据已清除!')
        showNotification('success', '所有数据已清除')
      } catch (error) {
        logger.error('清除数据失败:', error)
        showNotification('error', '清除数据失败')
      }
    },

    // ===== UI 状态切换 =====
    setSearch: (query) => dispatch({ type: ACTIONS.SET_SEARCH, payload: query }),
    setFilters: (filters) => dispatch({ type: ACTIONS.SET_FILTERS, payload: filters }),
    setSort: (sort) => dispatch({ type: ACTIONS.SET_SORT, payload: sort }),
    setPage: (page) => dispatch({ type: ACTIONS.SET_PAGE, payload: page }),
    setSelectedIds: (ids) => dispatch({ type: ACTIONS.SET_SELECTED_IDS, payload: ids }),
    toggleSidebar: () => dispatch({ type: ACTIONS.TOGGLE_SIDEBAR }),
    toggleLogViewer: () => dispatch({ type: ACTIONS.TOGGLE_LOG_VIEWER })
  }
}

/**
 * App Actions Hook（v1.7.x 拆分）
 * 返回所有 action 方法的稳定引用（useMemo + buildActions 内部已有 closure）
 */
export function useAppActions(dispatch, showNotification) {
  return useMemo(
    () => buildActions(dispatch, showNotification),
    [dispatch, showNotification]
  )
}

/**
 * Strm 文件处理包装（保留原 processStrmFile 行为）
 */
export function useStrmFileProcessor(dispatch) {
  return useCallback(
    async (strmFileName, originalFilePath, strmFilePath, isObsidianNote = false) => {
      return processStrmFileCore(strmFileName, originalFilePath, strmFilePath || '', isObsidianNote, {
        dispatch,
        storageService,
        analyzeDocument,
        logger,
        ADD_DOCUMENT_ACTION: ACTIONS.ADD_DOCUMENT
      })
    },
    [dispatch]
  )
}

/**
 * 自动刮削轮询（启动 / 停止）
 * @returns {{ stop: Function }} 停止函数
 */
export function useAutoProcess(processor) {
  const stopRef = useRef(null)
  const start = useCallback(() => {
    if (stopRef.current) return stopRef.current
    stopRef.current = watcherService.startAutoProcessing(processor, 8000)
    logger.info('[Strm 刮削] 自动处理轮询已启动 (间隔 8 秒)')
    return stopRef.current
  }, [processor])
  const stop = useCallback(() => {
    if (stopRef.current) {
      stopRef.current()
      stopRef.current = null
      logger.info('[Strm 刮削] 自动处理轮询已停止')
    }
  }, [])
  return { start, stop }
}
