/**
 * 数据管理 Tab
 */
import React from 'react'

export default function DataTab({ documents, categories, exportData, setShowImportModal, setShowClearModal }) {
  const handleExportJSON = async () => {
    const data = await exportData()
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-base-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCSV = async () => {
    const data = await exportData()
    if (!data) return
    const headers = ['标题', '编号', '分类', '文件名', '文件大小', '关键词', '创建时间', '更新时间']
    const rows = data.documents.map(doc => [
      doc.title,
      doc.docNumber || '',
      doc.category || '',
      doc.fileName || '',
      doc.fileSize || 0,
      (doc.keywords || []).join('; '),
      doc.createdAt || '',
      doc.updatedAt || ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n')

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-base-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="settings-section">
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          数据统计
        </h3>
        <div className="settings-stats">
          <div className="settings-stat">
            <span className="settings-stat-value">{documents.length}</span>
            <span className="settings-stat-label">文档总数</span>
          </div>
          <div className="settings-stat">
            <span className="settings-stat-value">{categories.length}</span>
            <span className="settings-stat-label">自定义分类</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          导出数据
        </h3>
        <p className="settings-description">
          导出知识库数据用于备份或分析。JSON 格式包含完整数据，CSV 格式适用于 Excel。
        </p>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={handleExportJSON}>
            💾 导出 JSON
          </button>
          <button className="btn btn-secondary" onClick={handleExportCSV}>
            📊 导出 CSV
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          导入数据
        </h3>
        <p className="settings-description">
          从 JSON 备份文件恢复数据。导入将合并现有数据，不会覆盖已有内容。
        </p>
        <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
          📥 导入数据
        </button>
      </div>

      <div className="card" style={{ borderColor: 'var(--error)' }}>
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)', color: 'var(--error)' }}>
          ⚠️ 危险操作
        </h3>
        <p className="settings-description">
          清除所有数据将永久删除所有文档和设置，此操作不可撤销。
        </p>
        <button className="btn btn-danger" onClick={() => setShowClearModal(true)}>
          🗑️ 清除所有数据
        </button>
      </div>
    </div>
  )
}
