/**
 * 文档管理页面
 */

import React, { useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import { formatFileSize, formatDate, getFileTypeInfo, getCategoryName, getCategoryColor } from '../../utils/helpers'
import { PRESET_CATEGORIES, SORT_OPTIONS, PAGE_SIZE_OPTIONS } from '../../utils/constants'
import Modal from '../Common/Modal'
import { Star, Eye, Trash2, Upload, RefreshCw } from 'lucide-react'
import './DocumentList.css'

export default function DocumentList() {
  const {
    paginatedDocuments,
    pagination,
    filters,
    sort,
    pageSize,
    selectedIds,
    categories,
    setFilters,
    setSort,
    setPage,
    setPageSize,
    setSelectedIds,
    deleteDocuments,
    toggleStar,
    searchQuery,
    loadData,
    showNotification
  } = useApp()
  
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectAll, setSelectAll] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 从 URL 参数初始化分类过滤
  React.useEffect(() => {
    const categoryParam = searchParams.get('category')
    if (categoryParam) {
      setFilters({ category: categoryParam })
    }
  }, [searchParams, setFilters])

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedIds([])
    } else {
      setSelectedIds(paginatedDocuments.map(doc => doc.id))
    }
    setSelectAll(!selectAll)
  }, [selectAll, paginatedDocuments, setSelectedIds])

  const handleSelectDoc = useCallback((id) => {
    const newSelected = selectedIds.includes(id)
      ? selectedIds.filter(sid => sid !== id)
      : [...selectedIds, id]
    setSelectedIds(newSelected)
    setSelectAll(newSelected.length === paginatedDocuments.length)
  }, [selectedIds, paginatedDocuments, setSelectedIds])

  const handleBatchDelete = useCallback(() => {
    setShowDeleteModal(true)
  }, [])

  const confirmBatchDelete = useCallback(async () => {
    await deleteDocuments(selectedIds)
    setShowDeleteModal(false)
    setSelectAll(false)
  }, [selectedIds, deleteDocuments, setSelectAll])

  // 获取所有分类（预设 + 自定义）- 使用 useMemo 缓存
  const allCategories = useMemo(() => [
    { id: 'all', name: '全部分类' },
    ...PRESET_CATEGORIES.map(c => ({ id: c.id, name: c.name })),
    ...categories
      .filter(c => !PRESET_CATEGORIES.some(p => p.id === c.id))
      .map(c => ({ id: c.id, name: c.name }))
  ], [categories])

  // 获取所有文件类型 - 使用 useMemo 缓存
  const allTypes = useMemo(() => [
    { id: 'all', name: '全部类型' },
    { id: 'pdf', name: 'PDF' },
    { id: 'doc', name: 'Word' },
    { id: 'docx', name: 'Word' },
    { id: 'xls', name: 'Excel' },
    { id: 'xlsx', name: 'Excel' },
    { id: 'txt', name: '文本' },
    { id: 'md', name: 'Markdown' },
    { id: 'csv', name: 'CSV' },
    { id: 'json', name: 'JSON' }
  ], [])

  return (
    <div className="document-list">
      <div className="document-list-header">
        <div>
          <h1 className="document-list-title">文档管理</h1>
          <p className="document-list-subtitle">
            共 {pagination.total} 个文档
            {searchQuery && <span> · 搜索: &quot;{searchQuery}&quot;</span>}
          </p>
        </div>
        <div className="document-list-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              setIsRefreshing(true)
              try {
                await loadData()
                showNotification('success', '文档列表已刷新')
              } catch (e) {
                showNotification('error', '刷新失败: ' + e.message)
              } finally {
                setIsRefreshing(false)
              }
            }}
            disabled={isRefreshing}
            title="从数据库重新加载文档列表，同步后台 AI 分析结果"
          >
            {isRefreshing ? '⏳ 刷新中...' : <><RefreshCw size={14} /> 刷新</>}
          </button>
          {selectedIds.length > 0 && (
            <button className="btn btn-danger btn-sm" onClick={handleBatchDelete}>
              <Trash2 size={14} /> 删除 {selectedIds.length} 个
            </button>
          )}
          <button className="btn btn-primary" onClick={() => navigate('/upload')}>
            <Upload size={14} /> 上传文档
          </button>
        </div>
      </div>

      {/* 过滤栏 */}
      <div className="document-list-filters">
        <div className="document-list-filter-group">
          <select
            value={filters.category}
            onChange={(e) => setFilters({ category: e.target.value })}
            className="document-list-filter-select"
          >
            {allCategories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>

          <select
            value={filters.type}
            onChange={(e) => setFilters({ type: e.target.value })}
            className="document-list-filter-select"
          >
            {allTypes.map(type => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="document-list-filter-select"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="document-list-filter-group">
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="document-list-filter-select"
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>每页 {size} 条</option>
            ))}
          </select>
        </div>
      </div>

      {/* 文档列表 */}
      <div className="document-list-table">
        <div className="document-list-table-header">
          <div className="document-list-col-check">
            <input
              type="checkbox"
              checked={selectAll}
              onChange={handleSelectAll}
            />
          </div>
          <div className="document-list-col-info">文档信息</div>
          <div className="document-list-col-category">分类</div>
          <div className="document-list-col-size">大小</div>
          <div className="document-list-col-date">创建时间</div>
          <div className="document-list-col-actions">操作</div>
        </div>

        {paginatedDocuments.length > 0 ? (
          <div className="document-list-table-body stagger-children">
            {paginatedDocuments.map(doc => {
              const typeInfo = getFileTypeInfo(doc.fileName || doc.title)
              return (
                <div
                  key={doc.id}
                  className={`document-list-row ${selectedIds.includes(doc.id) ? 'document-list-row--selected' : ''}`}
                >
                  <div className="document-list-col-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(doc.id)}
                      onChange={() => handleSelectDoc(doc.id)}
                    />
                  </div>
                  <div
                    className="document-list-col-info"
                    onClick={() => navigate(`/documents/${doc.id}`)}
                  >
                    <span className="document-list-file-icon">{typeInfo.icon}</span>
                    <div className="document-list-file-info">
                      <span className="document-list-file-title">{doc.title}</span>
                      <span className="document-list-file-meta">
                        {doc.docNumber && <span className="badge badge-primary">{doc.docNumber}</span>}
                        {doc.fileName && <span>{doc.fileName}</span>}
                      </span>
                      {/* 摘要预览 */}
                      {doc.summary && (
                        <span className="document-list-file-meta" style={{ marginTop: '2px', fontSize: '0.75rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                          {doc.summary}
                        </span>
                      )}
                      {/* AI 标签和标记 */}
                      {Array.isArray(doc.tags) && doc.tags.length > 0 && (
                        <span className="document-list-file-tags">
                          {doc.tags.slice(0, 2).map((tag, i) => (
                            <span
                              key={i}
                              className="tag tag-clickable"
                              style={{ fontSize: '0.6875rem' }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setFilters({ tags: [tag] })
                              }}
                            >{tag}</span>
                          ))}
                          {doc.tags.length > 2 && (
                            <span className="tag-more" onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/documents/${doc.id}`)
                            }}>+{doc.tags.length - 2}</span>
                          )}
                        </span>
                      )}
                      {doc.aiAnalyzed && (
                        <span className="document-list-file-tags" style={{ marginTop: Array.isArray(doc.tags) && doc.tags.length > 0 ? '0' : '2px' }}>
                          <span className="badge badge-primary" style={{ fontSize: '0.625rem' }}>AI</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="document-list-col-category">
                    <span
                      className="document-list-category-badge"
                      style={{
                        background: `${getCategoryColor(doc.category)}20`,
                        color: getCategoryColor(doc.category)
                      }}
                    >
                      {getCategoryName(doc.category)}
                    </span>
                  </div>
                  <div className="document-list-col-size">
                    {formatFileSize(doc.fileSize)}
                  </div>
                  <div className="document-list-col-date">
                    {formatDate(doc.createdAt, 'YYYY-MM-DD')}
                  </div>
                  <div className="document-list-col-actions">
                    <button
                      className={`btn btn-icon btn-ghost ${doc.starred ? 'starred' : ''}`}
                      onClick={() => toggleStar(doc.id)}
                      title={doc.starred ? '取消星标' : '标记星标'}
                    >
                      <Star size={14} fill={doc.starred ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      className="btn btn-icon btn-ghost"
                      onClick={() => navigate(`/documents/${doc.id}`)}
                      title="查看详情"
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '60px 0' }}>
            <div className="empty-state-icon">📄</div>
            <div className="empty-state-title">暂无文档</div>
            <div className="empty-state-description">
              {searchQuery
                ? '没有找到匹配的文档，请尝试其他搜索关键词'
                : '知识库还是空的，上传你的第一个文档吧'}
            </div>
            {!searchQuery && (
              <button
                className="btn btn-primary"
                style={{ marginTop: '16px' }}
                onClick={() => navigate('/upload')}
              >
                <Upload size={14} /> 上传文档
              </button>
            )}
          </div>
        )}
      </div>

      {/* 分页 */}
      {pagination.totalPages > 1 && (
        <div className="document-list-pagination">
          <button
            className="btn btn-ghost btn-sm"
            disabled={!pagination.hasPrev}
            onClick={() => setPage(pagination.page - 1)}
          >
            ← 上一页
          </button>
          <div className="document-list-pagination-info">
            第 {pagination.page} / {pagination.totalPages} 页
            （共 {pagination.total} 条）
          </div>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!pagination.hasNext}
            onClick={() => setPage(pagination.page + 1)}
          >
            下一页 →
          </button>
        </div>
      )}

      {/* 删除确认弹窗 */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="确认删除"
        size="sm"
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setShowDeleteModal(false)}
            >
              取消
            </button>
            <button
              className="btn btn-danger"
              onClick={confirmBatchDelete}
            >
              确认删除 {selectedIds.length} 个文档
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          确定要删除选中的 {selectedIds.length} 个文档吗？此操作不可撤销。
        </p>
      </Modal>
    </div>
  )
}
