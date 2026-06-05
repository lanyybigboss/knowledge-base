/**
 * 仪表盘页面
 */

import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import { formatFileSize, formatDate, getFileTypeInfo, getCategoryName, getCategoryColor, getCategoryIcon } from '../../utils/helpers'
import KnowledgeGraph from '../KnowledgeGraph/KnowledgeGraph'
import { FileText, HardDrive, Folder, Bot, Star } from 'lucide-react'
import './Dashboard.css'

export default function Dashboard() {
  const { statistics, documents, starredDocuments } = useApp()
  const navigate = useNavigate()

  const { totalDocs, totalSize, categoryDistribution, typeDistribution, recentDocuments } = statistics

  // 按文档数量排序的分类
  const sortedCategories = Object.entries(categoryDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)

  // 文件类型统计
  const typeStats = Object.entries(typeDistribution)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  const maxCategoryCount = Math.max(...Object.values(categoryDistribution), 1)

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1 className="dashboard-title">仪表盘</h1>
        <p className="dashboard-subtitle">知识库概览与统计</p>
      </div>

      {/* 统计卡片 */}
      <div className="dashboard-stats-grid stagger-children">
        <div className="dashboard-stat-card" onClick={() => navigate('/documents')}>
          <div className="dashboard-stat-icon" style={{ background: 'var(--primary-light)' }}>
            <FileText size={20} />
          </div>
          <div className="dashboard-stat-info">
            <span className="dashboard-stat-value">{totalDocs}</span>
            <span className="dashboard-stat-label">文档总数</span>
          </div>
        </div>

        <div className="dashboard-stat-card">
          <div className="dashboard-stat-icon" style={{ background: 'var(--success-bg)' }}>
            <HardDrive size={20} />
          </div>
          <div className="dashboard-stat-info">
            <span className="dashboard-stat-value">{formatFileSize(totalSize)}</span>
            <span className="dashboard-stat-label">总容量占用</span>
          </div>
        </div>

        <div className="dashboard-stat-card" onClick={() => navigate('/categories')}>
          <div className="dashboard-stat-icon" style={{ background: 'var(--warning-bg)' }}>
            <Folder size={20} />
          </div>
          <div className="dashboard-stat-info">
            <span className="dashboard-stat-value">{Object.keys(categoryDistribution).length}</span>
            <span className="dashboard-stat-label">分类数量</span>
          </div>
        </div>

        <div className="dashboard-stat-card" onClick={() => navigate('/statistics')}>
          <div className="dashboard-stat-icon" style={{ background: 'var(--info-bg)' }}>
            <Bot size={20} />
          </div>
          <div className="dashboard-stat-info">
            <span className="dashboard-stat-value">
              {documents.length > 0 ? Math.round((documents.filter(d => d.aiAnalyzed).length / documents.length) * 100) + '%' : '-'}
            </span>
            <span className="dashboard-stat-label">AI 分析完成率</span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid stagger-children">
        {/* 知识图谱 */}
        <KnowledgeGraph onNavigate={navigate} />

        {/* 分类分布 */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">分类分布</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/categories')}>
              查看全部 →
            </button>
          </div>
          <div className="dashboard-category-list">
            {sortedCategories.length > 0 ? sortedCategories.map(([catId, count]) => (
              <div key={catId} className="dashboard-category-item">
                <div className="dashboard-category-header">
                  <span className="dashboard-category-icon">{getCategoryIcon(catId)}</span>
                  <span className="dashboard-category-name">{getCategoryName(catId)}</span>
                  <span className="dashboard-category-count">{count}</span>
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
                <div className="empty-state-title">暂无分类数据</div>
                <div className="empty-state-description">上传文档后，分类分布将在此显示</div>
              </div>
            )}
          </div>
        </div>

        {/* 文件类型分布 */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">文件类型</h3>
          </div>
          <div className="dashboard-type-list">
            {typeStats.length > 0 ? typeStats.map(([ext, count]) => {
              const typeInfo = getFileTypeInfo(`file.${ext}`)
              return (
                <div key={ext} className="dashboard-type-item">
                  <span className="dashboard-type-icon">{typeInfo.icon}</span>
                  <span className="dashboard-type-name">{typeInfo.label}</span>
                  <span className="dashboard-type-count">{count}</span>
                </div>
              )
            }) : (
              <div className="empty-state">
                <div className="empty-state-icon">📁</div>
                <div className="empty-state-title">暂无文件</div>
                <div className="empty-state-description">上传文档后，文件类型分布将在此显示</div>
              </div>
            )}
          </div>
        </div>

        {/* 最近文档 */}
        <div className="card dashboard-recent-card">
          <div className="card-header">
            <h3 className="card-title">最近文档</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/documents')}>
              查看全部 →
            </button>
          </div>
          <div className="dashboard-recent-list">
            {recentDocuments.length > 0 ? recentDocuments.map(doc => {
              const typeInfo = getFileTypeInfo(doc.fileName || doc.title)
              return (
                <div
                  key={doc.id}
                  className="dashboard-recent-item"
                  onClick={() => navigate(`/documents/${doc.id}`)}
                >
                  <span className="dashboard-recent-icon">{typeInfo.icon}</span>
                  <div className="dashboard-recent-info">
                    <span className="dashboard-recent-title">{doc.title}</span>
                    <span className="dashboard-recent-meta">
                      {formatDate(doc.createdAt, 'MM-DD HH:mm')}
                      {doc.docNumber && ` · ${doc.docNumber}`}
                    </span>
                  </div>
                  {doc.starred && <span className="dashboard-recent-star">⭐</span>}
                </div>
              )
            }) : (
              <div className="empty-state">
                <div className="empty-state-icon">📄</div>
                <div className="empty-state-title">暂无文档</div>
                <div className="empty-state-description">
                  点击下方按钮上传你的第一个文档
                </div>
                <button
                  className="btn btn-primary"
                  style={{ marginTop: '16px' }}
                  onClick={() => navigate('/upload')}
                >
                  📤 上传文档
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 星标文档 */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title"><Star size={16} /> 星标文档</h3>
          </div>
          <div className="dashboard-starred-list">
            {starredDocuments.length > 0 ? starredDocuments.slice(0, 5).map(doc => {
              const typeInfo = getFileTypeInfo(doc.fileName || doc.title)
              return (
                <div
                  key={doc.id}
                  className="dashboard-starred-item"
                  onClick={() => navigate(`/documents/${doc.id}`)}
                >
                  <span className="dashboard-starred-icon">{typeInfo.icon}</span>
                  <div className="dashboard-starred-info">
                    <span className="dashboard-starred-title">{doc.title}</span>
                    <span className="dashboard-starred-meta">
                      {doc.docNumber && `${doc.docNumber} · `}
                      {formatDate(doc.createdAt, 'MM-DD')}
                    </span>
                  </div>
                </div>
              )
            }) : (
              <div className="empty-state">
                <div className="empty-state-icon">⭐</div>
                <div className="empty-state-title">暂无星标文档</div>
                <div className="empty-state-description">在文档管理中点击星标标记重要文档</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
