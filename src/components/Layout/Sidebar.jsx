/**
 * 知识库管理系统 - 侧边栏导航
 */

import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import { PRESET_CATEGORIES, FILE_TYPE_MAP } from '../../utils/constants'
import { getFileExtension } from '../../utils/helpers'

const NAV_ITEMS = [
  { path: '/', icon: '📊', label: '仪表盘' },
  { path: '/documents', icon: '📄', label: '文档管理' },
  { path: '/upload', icon: '📤', label: '上传文档' },
  { path: '/categories', icon: '📂', label: '分类管理' },
  { path: '/statistics', icon: '📈', label: '统计分析' },
  { path: '/settings', icon: '⚙️', label: '系统设置' }
]

export default function Sidebar() {
  const { sidebarOpen, documents, categories, setFilters, filters } = useApp()
  const navigate = useNavigate()
  const [showAllTypes, setShowAllTypes] = useState(false)
  const [showAllCats, setShowAllCats] = useState(false)

  // 统计各分类文档数
  const getCategoryCount = (categoryId) => {
    return documents.filter(doc => doc.category === categoryId).length
  }

  // 统计各文件类型文档数
  const getTypeCount = (ext) => {
    return documents.filter(doc => {
      const docExt = getFileExtension(doc.fileName || doc.title)
      return docExt === ext
    }).length
  }

  // 获取实际使用的文件类型
  const getActiveTypes = () => {
    const typeCounts = {}
    documents.forEach(doc => {
      const ext = getFileExtension(doc.fileName || doc.title)
      if (ext) {
        typeCounts[ext] = (typeCounts[ext] || 0) + 1
      }
    })
    return Object.entries(typeCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([ext]) => ext)
  }

  // 点击分类进行筛选
  const handleCategoryClick = (catId) => {
    setFilters({ category: catId === 'all' ? '' : catId, type: filters.type })
    navigate('/documents')
  }

  // 点击文件类型进行筛选
  const handleTypeClick = (ext) => {
    setFilters({ category: filters.category, type: ext })
    navigate('/documents')
  }

  const activeTypes = getActiveTypes()
  const displayedTypes = showAllTypes ? activeTypes : activeTypes.slice(0, 5)
  const allCategories = [...PRESET_CATEGORIES, ...categories]
  const displayedCats = showAllCats ? allCategories : allCategories.slice(0, 6)

  return (
    <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : 'sidebar--closed'}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">📚</span>
          {sidebarOpen && (
            <div className="sidebar-logo-text">
              <span className="sidebar-logo-title">知识库</span>
              <span className="sidebar-logo-subtitle">管理系统</span>
            </div>
          )}
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <span className="sidebar-section-title">
            {sidebarOpen ? '导航菜单' : ''}
          </span>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `sidebar-nav-item ${isActive ? 'sidebar-nav-item--active' : ''}`
              }
              end={item.path === '/'}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              {sidebarOpen && (
                <>
                  <span className="sidebar-nav-label">{item.label}</span>
                  {item.path === '/documents' && documents.length > 0 && (
                    <span className="sidebar-nav-badge">{documents.length}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>

        {sidebarOpen && (
          <>
            {/* 分类筛选 */}
            <div className="sidebar-section">
              <div className="sidebar-section-header">
                <span className="sidebar-section-title">📂 分类筛选</span>
                <button className="sidebar-clear-btn" onClick={() => handleCategoryClick('all')}>
                  全部
                </button>
              </div>
              <div className="sidebar-categories">
                {displayedCats.map(cat => {
                  const count = getCategoryCount(cat.id)
                  if (count === 0) return null
                  const isActive = filters.category === cat.id
                  return (
                    <div
                      key={cat.id}
                      className={`sidebar-category-item ${isActive ? 'sidebar-category-item--active' : ''}`}
                      onClick={() => handleCategoryClick(cat.id)}
                    >
                      <span className="sidebar-category-dot" style={{ backgroundColor: cat.color || '#6b7280' }} />
                      <span className="sidebar-category-name">{cat.name}</span>
                      <span className="sidebar-category-count">{count}</span>
                    </div>
                  )
                })}
                {allCategories.length > 6 && (
                  <button className="sidebar-more-btn" onClick={() => setShowAllCats(!showAllCats)}>
                    {showAllCats ? '收起 ▲' : `更多 (${allCategories.length - 6}) ▼`}
                  </button>
                )}
              </div>
            </div>

            {/* 文件类型筛选 */}
            {activeTypes.length > 0 && (
              <div className="sidebar-section">
                <div className="sidebar-section-header">
                  <span className="sidebar-section-title">📄 文件类型</span>
                  <button className="sidebar-clear-btn" onClick={() => handleTypeClick('all')}>
                    全部
                  </button>
                </div>
                <div className="sidebar-categories">
                  {displayedTypes.map(ext => {
                    const count = getTypeCount(ext)
                    if (count === 0) return null
                    const typeInfo = FILE_TYPE_MAP[ext] || { icon: '📁', label: ext.toUpperCase(), color: '#6b7280' }
                    const isActive = filters.type === ext
                    return (
                      <div
                        key={ext}
                        className={`sidebar-category-item ${isActive ? 'sidebar-category-item--active' : ''}`}
                        onClick={() => handleTypeClick(ext)}
                      >
                        <span className="sidebar-category-dot" style={{ backgroundColor: typeInfo.color }} />
                        <span className="sidebar-category-icon-small">{typeInfo.icon}</span>
                        <span className="sidebar-category-name">{typeInfo.label}</span>
                        <span className="sidebar-category-count">{count}</span>
                      </div>
                    )
                  })}
                  {activeTypes.length > 5 && (
                    <button className="sidebar-more-btn" onClick={() => setShowAllTypes(!showAllTypes)}>
                      {showAllTypes ? '收起 ▲' : `更多 (${activeTypes.length - 5}) ▼`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 文件夹监控状态 */}
            {documents.some(d => d.source === 'watched') && (
              <div className="sidebar-section">
                <div className="sidebar-section-header">
                  <span className="sidebar-section-title">👁️ 监控文件夹</span>
                  <span className="sidebar-status-badge sidebar-status-badge--active">运行中</span>
                </div>
              </div>
            )}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        {sidebarOpen && (
          <div className="sidebar-stats">
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{documents.length}</span>
              <span className="sidebar-stat-label">文档总数</span>
            </div>
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{categories.length + PRESET_CATEGORIES.length}</span>
              <span className="sidebar-stat-label">分类数</span>
            </div>
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{activeTypes.length}</span>
              <span className="sidebar-stat-label">文件类型</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
