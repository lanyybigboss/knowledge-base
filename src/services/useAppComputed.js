/**
 * useAppComputed 模块（v1.7.x 拆分）
 * 计算属性 hooks：filteredDocuments / paginatedResult / statistics / starredDocuments
 * 纯函数 + useMemo 缓存，避免重复计算
 */

import { useMemo } from 'react'
import { filterDocuments, paginateDocuments, calculateStatistics } from '../utils/helpers'

/**
 * App Computed Hook（v1.7.x 拆分）
 * @param {object} state - AppContext state
 * @returns {object} 包含所有计算属性的命名空间
 */
export function useAppComputed(state) {
  const filteredDocuments = useMemo(() =>
    filterDocuments(state.documents, {
      search: state.searchQuery,
      category: state.filters.category,
      type: state.filters.type,
      sort: state.sort,
      tags: state.filters.tags
    }),
    [state.documents, state.searchQuery, state.filters, state.sort]
  )

  const paginatedResult = useMemo(() =>
    paginateDocuments(filteredDocuments, state.page, state.pageSize),
    [filteredDocuments, state.page, state.pageSize]
  )

  const statistics = useMemo(() =>
    calculateStatistics(state.documents),
    [state.documents]
  )

  const starredDocuments = useMemo(() =>
    Array.isArray(state.documents) ? state.documents.filter(doc => doc.starred) : [],
    [state.documents]
  )

  return {
    filteredDocuments,
    paginatedDocuments: paginatedResult.documents,
    pagination: paginatedResult.pagination,
    statistics,
    starredDocuments
  }
}
