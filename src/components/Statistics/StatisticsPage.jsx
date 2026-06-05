/**
 * 统计分析页面
 */

import React from 'react'
import { useApp } from '../../services/AppContext'
import { formatFileSize, formatDate, getFileTypeInfo } from '../../utils/helpers'
import { PRESET_CATEGORIES } from '../../utils/constants'
import './StatisticsPage.css'

export default function StatisticsPage() {
  const { statistics, documents } = useApp()
  const { totalDocs, totalSize, categoryDistribution, typeDistribution, recentDocuments } = statistics

  const getCategoryName = (catId) => {
    const preset = PRESET_CATEGORIES.find(c => c.id === catId)
    return preset ? preset.name : catId
  }

  const getCategoryColor = (catId) => {
    const preset = PRESET_CATEGORIES.find(c => c.id === catId)
    return preset ? preset.color : '#6b7280'
  }

  const getCategoryIcon = (catId) => {
    const preset = PRESET_CATEGORIES.find(c => c.id === catId)
    return preset ? preset.icon : '📁'
  }

  // 按数量排序的分类
  const sortedCategories = Object.entries(categoryDistribution)
    .sort(([, a], [, b]) => b - a)

  // 按数量排序的文件类型
  const sortedTypes = Object.entries(typeDistribution)
    .sort(([, a], [, b]) => b - a)

  const maxCategoryCount = Math.max(...Object.values(categoryDistribution), 1)
  const maxTypeCount = Math.max(...Object.values(typeDistribution), 1)

  // 计算总关键词数
  const totalKeywords = documents.reduce((sum, doc) => sum + (doc.keywords?.length || 0), 0)

  // 计算平均文档大小
  const avgSize = totalDocs > 0 ? totalSize / totalDocs : 0

  // 计算星标文档数
  const starredCount = documents.filter(doc => doc.starred).length

  return (
    <div className="statistics-page">
      <div className="statistics-header">
        <h1 className="statistics-title">统计分析</h1>
        <p className="statistics-subtitle">知识库数据深度分析</p>
      </div>

      {/* 概览卡片 */}
      <div className="statistics-overview">
        <div className="statistics-overview-card">
          <span className="statistics-overview-icon" style={{ background: 'var(--primary-light)' }}>
            📄
          </span>
          <div className="statistics-overview-info">
            <span className="statistics-overview-value">{totalDocs}</span>
            <span className="statistics-overview-label">文档总数</span>
          </div>
        </div>
        <div className="statistics-overview-card">
          <span className="statistics-overview-icon" style={{ background: 'var(--success-bg)' }}>
            💾
          </span>
          <div className="statistics-overview-info">
            <span className="statistics-overview-value">{formatFileSize(totalSize)}</span>
            <span className="statistics-overview-label">总容量</span>
          </div>
        </div>
        <div className="statistics-overview-card">
          <span className="statistics-overview-icon" style={{ background: 'var(--warning-bg)' }}>
            📏
          </span>
          <div className="statistics-overview-info">
            <span className="statistics-overview-value">{formatFileSize(avgSize)}</span>
            <span className="statistics-overview-label">平均大小</span>
          </div>
        </div>
        <div className="statistics-overview-card">
          <span className="statistics-overview-icon" style={{ background: 'var(--info-bg)' }}>
            ⭐
          </span>
          <div className="statistics-overview-info">
            <span className="statistics-overview-value">{starredCount}</span>
            <span className="statistics-overview-label">星标文档</span>
          </div>
        </div>
        <div className="statistics-overview-card">
          <span className="statistics-overview-icon" style={{ background: 'var(--success-bg)' }}>
            🏷️
          </span>
          <div className="statistics-overview-info">
            <span className="statistics-overview-value">{totalKeywords}</span>
            <span className="statistics-overview-label">关键词总数</span>
          </div>
        </div>
        <div className="statistics-overview-card">
          <span className="statistics-overview-icon" style={{ background: 'var(--primary-light)' }}>
            📂
          </span>
          <div className="statistics-overview-info">
            <span className="statistics-overview-value">{Object.keys(categoryDistribution).length}</span>
            <span className="statistics-overview-label">分类数</span>
          </div>
        </div>
      </div>

      <div className="statistics-grid">
        {/* 分类分布 */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">📂 分类分布</h3>
          </div>
          <div className="statistics-chart">
            {sortedCategories.length > 0 ? sortedCategories.map(([catId, count]) => (
              <div key={catId} className="statistics-bar-item">
                <div className="statistics-bar-header">
                  <span className="statistics-bar-icon">{getCategoryIcon(catId)}</span>
                  <span className="statistics-bar-label">{getCategoryName(catId)}</span>
                  <span className="statistics-bar-value">{count}</span>
                  <span className="statistics-bar-percent">
                    ({totalDocs > 0 ? ((count / totalDocs) * 100).toFixed(1) : 0}%)
                  </span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${(count / maxCategoryCount) * 100}%`,
                      background: getCategoryColor(catId)
                    }}
                  />
                </div>
              </div>
            )) : (
              <div className="empty-state">
                <div className="empty-state-icon">📂</div>
                <div className="empty-state-title">暂无数据</div>
              </div>
            )}
          </div>
        </div>

        {/* 文件类型分布 */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">📁 文件类型分布</h3>
          </div>
          <div className="statistics-chart">
            {sortedTypes.length > 0 ? sortedTypes.map(([ext, count]) => {
              const typeInfo = getFileTypeInfo(`file.${ext}`)
              return (
                <div key={ext} className="statistics-bar-item">
                  <div className="statistics-bar-header">
                    <span className="statistics-bar-icon">{typeInfo.icon}</span>
                    <span className="statistics-bar-label">{typeInfo.label}</span>
                    <span className="statistics-bar-value">{count}</span>
                    <span className="statistics-bar-percent">
                      ({totalDocs > 0 ? ((count / totalDocs) * 100).toFixed(1) : 0}%)
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${(count / maxTypeCount) * 100}%`,
                        background: 'var(--primary)'
                      }}
                    />
                  </div>
                </div>
              )
            }) : (
              <div className="empty-state">
                <div className="empty-state-icon">📁</div>
                <div className="empty-state-title">暂无数据</div>
              </div>
            )}
          </div>
        </div>

        {/* 文档时间线 */}
        <div className="card statistics-timeline-card">
          <div className="card-header">
            <h3 className="card-title">📅 最近文档</h3>
          </div>
          <div className="statistics-timeline">
            {recentDocuments.length > 0 ? recentDocuments.slice(0, 10).map((doc) => {
              const typeInfo = getFileTypeInfo(doc.fileName || doc.title)
              return (
                <div key={doc.id} className="statistics-timeline-item">
                  <div className="statistics-timeline-dot" />
                  <div className="statistics-timeline-content">
                    <span className="statistics-timeline-title">{doc.title}</span>
                    <span className="statistics-timeline-meta">
                      {typeInfo.icon} {typeInfo.label} · {formatFileSize(doc.fileSize)} · {formatDate(doc.createdAt)}
                    </span>
                  </div>
                </div>
              )
            }) : (
              <div className="empty-state">
                <div className="empty-state-icon">📅</div>
                <div className="empty-state-title">暂无文档</div>
              </div>
            )}
          </div>
        </div>

        {/* 数据摘要 */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">📊 数据摘要</h3>
          </div>
          <div className="statistics-summary">
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">文档总数</span>
              <span className="statistics-summary-value">{totalDocs}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">总容量</span>
              <span className="statistics-summary-value">{formatFileSize(totalSize)}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">平均文档大小</span>
              <span className="statistics-summary-value">{formatFileSize(avgSize)}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">分类数量</span>
              <span className="statistics-summary-value">{Object.keys(categoryDistribution).length}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">文件类型数</span>
              <span className="statistics-summary-value">{Object.keys(typeDistribution).length}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">星标文档</span>
              <span className="statistics-summary-value">{starredCount}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">关键词总数</span>
              <span className="statistics-summary-value">{totalKeywords}</span>
            </div>
            <div className="statistics-summary-item">
              <span className="statistics-summary-label">最近更新</span>
              <span className="statistics-summary-value">
                {documents.length > 0 ? formatDate(documents[0].updatedAt) : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
