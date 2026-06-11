/**
 * 分类管理页面
 */

import React, { useState } from 'react'
import { useApp } from '../../services/AppContext'
import { PRESET_CATEGORIES } from '../../utils/constants'
import Modal from '../Common/Modal'
import './CategoryPage.css'

const COLOR_OPTIONS = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899',
  '#6b7280', '#ef4444', '#14b8a6', '#f97316', '#6366f1'
]

const ICON_OPTIONS = ['📁', '📂', '📚', '📖', '📘', '📗', '📕', '🗂️', '📋', '📌']

export default function CategoryPage() {
  const { categories, documents, addCategory, updateCategory, deleteCategory } = useApp()
  const [showModal, setShowModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [form, setForm] = useState({ name: '', icon: '📁', color: '#3b82f6', description: '' })

  const allCategories = [...PRESET_CATEGORIES, ...categories]

  const getDocumentCount = (catId) => {
    return documents.filter(doc => doc.category === catId).length
  }

  const getDocumentSize = (catId) => {
    return documents
      .filter(doc => doc.category === catId)
      .reduce((sum, doc) => sum + (doc.fileSize || 0), 0)
  }

  const formatSize = (bytes) => {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`
  }

  const openAddModal = () => {
    setEditingCategory(null)
    setForm({ name: '', icon: '📁', color: '#3b82f6', description: '' })
    setShowModal(true)
  }

  const openEditModal = (cat) => {
    setEditingCategory(cat)
    setForm({
      name: cat.name,
      icon: cat.icon || '📁',
      color: cat.color || '#3b82f6',
      description: cat.description || ''
    })
    setShowModal(true)
  }

  const handleSave = () => {
    if (!form.name.trim()) return

    if (editingCategory) {
      updateCategory(editingCategory.id, form)
    } else {
      addCategory(form)
    }
    setShowModal(false)
  }

  const handleDelete = (cat) => {
    if (getDocumentCount(cat.id) > 0) {
      if (!confirm(`分类 "${cat.name}" 下有 ${getDocumentCount(cat.id)} 个文档，确定要删除吗？`)) {
        return
      }
    }
    deleteCategory(cat.id)
  }

  return (
    <div className="category-page">
      <div className="category-page-header">
        <div>
          <h1 className="category-page-title">分类管理</h1>
          <p className="category-page-subtitle">
            共 {allCategories.length} 个分类 · 预设分类不可删除
          </p>
        </div>
        <button className="btn btn-primary" onClick={openAddModal}>
          ➕ 添加分类
        </button>
      </div>

      <div className="category-grid">
        {allCategories.map(cat => {
          const docCount = getDocumentCount(cat.id)
          const isPreset = PRESET_CATEGORIES.some(p => p.id === cat.id)
          return (
            <div key={cat.id} className="category-card">
              <div className="category-card-header" style={{ borderLeftColor: cat.color }}>
                <span className="category-card-icon">{cat.icon || '📁'}</span>
                <div className="category-card-info">
                  <span className="category-card-name">{cat.name}</span>
                  {cat.description && (
                    <span className="category-card-desc">{cat.description}</span>
                  )}
                </div>
              </div>
              <div className="category-card-stats">
                <div className="category-card-stat">
                  <span className="category-card-stat-value">{docCount}</span>
                  <span className="category-card-stat-label">文档</span>
                </div>
                <div className="category-card-stat">
                  <span className="category-card-stat-value">{formatSize(getDocumentSize(cat.id))}</span>
                  <span className="category-card-stat-label">容量</span>
                </div>
              </div>
              {!isPreset && (
                <div className="category-card-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => openEditModal(cat)}
                  >
                    ✏️ 编辑
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--error)' }}
                    onClick={() => handleDelete(cat)}
                  >
                    🗑️ 删除
                  </button>
                </div>
              )}
              {isPreset && (
                <div className="category-card-actions">
                  <span className="badge badge-primary">预设分类</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 添加/编辑分类弹窗 */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCategory ? '编辑分类' : '添加分类'}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              {editingCategory ? '保存' : '添加'}
            </button>
          </>
        }
      >
        <div className="category-form">
          <div className="input-group">
            <label>分类名称</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="输入分类名称"
            />
          </div>

          <div className="input-group">
            <label>图标</label>
            <div className="category-icon-picker">
              {ICON_OPTIONS.map(icon => (
                <button
                  key={icon}
                  className={`category-icon-option ${form.icon === icon ? 'category-icon-option--active' : ''}`}
                  onClick={() => setForm({ ...form, icon })}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <div className="input-group">
            <label>颜色</label>
            <div className="category-color-picker">
              {COLOR_OPTIONS.map(color => (
                <button
                  key={color}
                  className={`category-color-option ${form.color === color ? 'category-color-option--active' : ''}`}
                  style={{ backgroundColor: color }}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
            </div>
          </div>

          <div className="input-group">
            <label>描述（可选）</label>
            <input
              type="text"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="分类描述"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
