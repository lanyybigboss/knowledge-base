/**
 * useAppActions - 业务操作 hooks
 * 文档/分类/设置/数据管理的全部 action 方法
 */

import { useCallback } from 'react'
import storageService from './storageService'
import logger from './logger'
import syncService from './syncService'
import backgroundAnalysisService from './backgroundAnalysisService'
import { ACTIONS } from './appReducer'

export function useAppActions(dispatch, showNotification) {
  // ===== 文档操作 =====

  const addDocument = useCallback(async (docData) => {
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
  }, [dispatch, showNotification])

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
  }, [dispatch, showNotification])

  const deleteDocument = useCallback(async (id) => {
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
  }, [dispatch, showNotification])

  const deleteDocuments = useCallback(async (ids) => {
    try {
      const count = await storageService.deleteDocuments(ids)
      if (count > 0) {
        dispatch({ type: ACTIONS.DELETE_DOCUMENTS, payload: ids })
        syncService.markDirty()
        logger.info('批量删除文档', { count, ids })
        showNotification('success', `已删除 ${count} 个文档`)
      }
      return count
    } catch (error) {
      logger.error('批量删除失败:', error)
      showNotification('error', '批量删除失败')
      return 0
    }
  }, [dispatch, showNotification])

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
  }, [dispatch])

  // ===== 分类操作 =====

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
  }, [dispatch, showNotification])

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
  }, [dispatch, showNotification])

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
  }, [dispatch, showNotification])

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
  }, [dispatch, showNotification])

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
  }, [dispatch, showNotification])

  // ===== 数据管理 =====

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
      return { documents, categories, settings, numberingRules }
    } catch (error) {
      logger.error('重新加载数据失败:', error)
      return null
    }
  }, [dispatch])

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
  }, [loadData, showNotification])

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
  }, [dispatch, showNotification])

  // ===== UI 操作 =====

  const setSearch = useCallback((query) => {
    dispatch({ type: ACTIONS.SET_SEARCH, payload: query })
  }, [dispatch])

  const setFilters = useCallback((filters) => {
    dispatch({ type: ACTIONS.SET_FILTERS, payload: filters })
  }, [dispatch])

  const setSort = useCallback((sort) => {
    dispatch({ type: ACTIONS.SET_SORT, payload: sort })
  }, [dispatch])

  const setPage = useCallback((page) => {
    dispatch({ type: ACTIONS.SET_PAGE, payload: page })
  }, [dispatch])

  const setSelectedIds = useCallback((ids) => {
    dispatch({ type: ACTIONS.SET_SELECTED_IDS, payload: ids })
  }, [dispatch])

  const toggleSidebar = useCallback(() => {
    dispatch({ type: ACTIONS.TOGGLE_SIDEBAR })
  }, [dispatch])

  const toggleLogViewer = useCallback(() => {
    dispatch({ type: ACTIONS.TOGGLE_LOG_VIEWER })
  }, [dispatch])

  return {
    addDocument, updateDocument, deleteDocument, deleteDocuments, toggleStar,
    addCategory, updateCategory, deleteCategory,
    updateSettings, updateNumberingRules,
    loadData, exportData, importData, clearAllData,
    setSearch, setFilters, setSort, setPage, setSelectedIds,
    toggleSidebar, toggleLogViewer
  }
}
