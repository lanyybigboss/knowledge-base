/**
 * 待办事项页面
 * 展示 AI 从文档中提取的行动项，支持过滤、标记完成、跳转来源文档
 */
import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import { isMatchForCurrentUser } from '../../services/roleMatchingService'
import './TodoPage.css'

const STATUS_LABELS = {
  pending: { text: '待处理', icon: '⏳', color: 'var(--warning)' },
  done: { text: '已完成', icon: '✅', color: 'var(--success)' },
  dismissed: { text: '已忽略', icon: '➖', color: 'var(--text-tertiary)' }
}

export default function TodoPage() {
  const { todos, documents, userProfile, updateTodo, deleteTodo } = useApp()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('pending') // pending | all | matched | done
  const [docTitles, setDocTitles] = useState({})

  // 构建 documentId → title 映射
  useEffect(() => {
    const map = {}
    for (const doc of documents) {
      map[doc.id] = doc.smartTitle || doc.title || doc.fileName || '未知文档'
    }
    setDocTitles(map)
  }, [documents])

  // 过滤待办
  const filteredTodos = useMemo(() => {
    let result = todos
    if (filter === 'pending') {
      result = result.filter(t => t.status === 'pending')
    } else if (filter === 'done') {
      result = result.filter(t => t.status === 'done' || t.status === 'dismissed')
    } else if (filter === 'matched') {
      result = result.filter(t => t.status === 'pending' && isMatchForCurrentUser(t, userProfile))
    }
    return result
  }, [todos, filter, userProfile])

  // 统计
  const stats = useMemo(() => {
    const pending = todos.filter(t => t.status === 'pending')
    const matched = pending.filter(t => isMatchForCurrentUser(t, userProfile))
    return {
      total: todos.length,
      pending: pending.length,
      matched: matched.length,
      done: todos.filter(t => t.status === 'done' || t.status === 'dismissed').length
    }
  }, [todos, userProfile])

  const handleMarkDone = async (id) => {
    await updateTodo(id, { status: 'done' })
  }

  const handleDismiss = async (id) => {
    await updateTodo(id, { status: 'dismissed' })
  }

  const handleRestore = async (id) => {
    await updateTodo(id, { status: 'pending' })
  }

  const handleDelete = async (id) => {
    await deleteTodo(id)
  }

  const handleViewDoc = (documentId) => {
    if (documentId) {
      navigate(`/documents/${documentId}`)
    }
  }

  const formatDueDate = (dateStr) => {
    if (!dateStr) return null
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const isOverdue = d < now && d.toDateString() !== now.toDateString()
      const label = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
      return { label, isOverdue }
    } catch {
      return { label: dateStr, isOverdue: false }
    }
  }

  return (
    <div className="todo-page">
      <div className="todo-page-header">
        <h1 className="todo-page-title">待办事项</h1>
        <p className="todo-page-subtitle">
          AI 从文档中自动提取的行动项，按你的身份智能匹配
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="todo-stats">
        <div className="todo-stat-card">
          <div className="todo-stat-number">{stats.pending}</div>
          <div className="todo-stat-label">待处理</div>
        </div>
        <div className="todo-stat-card todo-stat-card--highlight">
          <div className="todo-stat-number">{stats.matched}</div>
          <div className="todo-stat-label">与我相关</div>
        </div>
        <div className="todo-stat-card">
          <div className="todo-stat-number">{stats.done}</div>
          <div className="todo-stat-label">已完成</div>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="todo-filters">
        {[
          { key: 'pending', label: `待处理 (${stats.pending})` },
          { key: 'matched', label: `与我相关 (${stats.matched})` },
          { key: 'done', label: `已完成 (${stats.done})` },
          { key: 'all', label: `全部 (${stats.total})` }
        ].map(f => (
          <button
            key={f.key}
            className={`todo-filter-btn ${filter === f.key ? 'todo-filter-btn--active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 待办列表 */}
      <div className="todo-list">
        {filteredTodos.length === 0 ? (
          <div className="todo-empty">
            <div className="todo-empty-icon">📋</div>
            <div className="todo-empty-text">
              {filter === 'matched' ? '暂无与你相关的待办' : '暂无待办事项'}
            </div>
            <div className="todo-empty-hint">
              待办由 AI 分析文档时自动生成，需先配置个人身份
            </div>
          </div>
        ) : (
          filteredTodos.map(todo => {
            const isMatched = isMatchForCurrentUser(todo, userProfile)
            const status = STATUS_LABELS[todo.status] || STATUS_LABELS.pending
            const due = formatDueDate(todo.dueDate)
            const docTitle = docTitles[todo.documentId] || ''

            return (
              <div
                key={todo.id}
                className={`todo-item ${isMatched ? 'todo-item--matched' : ''} ${todo.status !== 'pending' ? 'todo-item--done' : ''}`}
              >
                <div className="todo-item-main">
                  <div className="todo-item-header">
                    <span className="todo-item-icon">{status.icon}</span>
                    <span className="todo-item-title">{todo.title}</span>
                    {isMatched && <span className="todo-badge todo-badge--match">与我相关</span>}
                  </div>
                  <div className="todo-item-meta">
                    {todo.targetRole && (
                      <span className="todo-tag">🎯 {todo.targetRole}</span>
                    )}
                    {todo.targetPerson && (
                      <span className="todo-tag">👤 {todo.targetPerson}</span>
                    )}
                    {due && (
                      <span className={`todo-tag ${due.isOverdue ? 'todo-tag--overdue' : ''}`}>
                        📅 {due.label}{due.isOverdue ? ' (已过期)' : ''}
                      </span>
                    )}
                    {docTitle && (
                      <span
                        className="todo-tag todo-tag--link"
                        onClick={() => handleViewDoc(todo.documentId)}
                        title="查看来源文档"
                      >
                        📄 {docTitle}
                      </span>
                    )}
                  </div>
                </div>
                <div className="todo-item-actions">
                  {todo.status === 'pending' ? (
                    <>
                      <button
                        className="todo-action-btn todo-action-btn--done"
                        onClick={() => handleMarkDone(todo.id)}
                        title="标记完成"
                      >
                        ✅
                      </button>
                      <button
                        className="todo-action-btn todo-action-btn--dismiss"
                        onClick={() => handleDismiss(todo.id)}
                        title="忽略"
                      >
                        ➖
                      </button>
                    </>
                  ) : (
                    <button
                      className="todo-action-btn todo-action-btn--restore"
                      onClick={() => handleRestore(todo.id)}
                      title="恢复为待处理"
                    >
                      ↩️
                    </button>
                  )}
                  <button
                    className="todo-action-btn todo-action-btn--delete"
                    onClick={() => handleDelete(todo.id)}
                    title="删除"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
