/**
 * useAppComputed - 计算属性 hooks
 * 文档过滤/分页/统计/星标等派生状态
 */

import { useMemo } from 'react'
import { filterDocuments, paginateDocuments, calculateStatistics } from '../utils/helpers'

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
