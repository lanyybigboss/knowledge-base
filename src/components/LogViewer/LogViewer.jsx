/**
 * 日志查看器组件 - 用于调试和问题排查
 * 按 Ctrl+Shift+L 打开/关闭，或通过设置页面访问
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import logger from '../../services/logger'
import './LogViewer.css'

const LEVEL_FILTERS = [
  { key: 'all', label: '全部', icon: '📋' },
  { key: 'ERROR', label: '错误', icon: '🔴' },
  { key: 'WARN', label: '警告', icon: '🟡' },
  { key: 'INFO', label: '信息', icon: '🔵' },
  { key: 'DEBUG', label: '调试', icon: '⚪' }
]

export default function LogViewer({ isOpen, onClose }) {
  const [logs, setLogs] = useState([])
  const [filter, setFilter] = useState('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [searchText, setSearchText] = useState('')
  const listRef = useRef(null)
  const prevLogsLength = useRef(0)

  // 加载日志 + 实时订阅
  useEffect(() => {
    setLogs(logger.getAll())

    const unsubscribe = logger.subscribe((entry) => {
      setLogs(prev => {
        if (entry.type === 'clear') return []
        return [...prev, entry]
      })
    })

    return unsubscribe
  }, [])

  // 自动滚动到底部
  const scrollTimerRef = useRef(null)
  useEffect(() => {
    if (autoScroll && listRef.current && logs.length > prevLogsLength.current) {
      scrollTimerRef.current = setTimeout(() => {
        if (listRef.current) {
          listRef.current.scrollTop = listRef.current.scrollHeight
        }
      }, 50)
    }
    prevLogsLength.current = logs.length
    return () => { if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current) }
  }, [logs.length, autoScroll])

  // 过滤日志
  const filteredLogs = logs.filter(log => {
    if (filter !== 'all' && log.level !== filter) return false
    if (searchText && !log.message.toLowerCase().includes(searchText.toLowerCase()) &&
        !(log.data && log.data.toLowerCase().includes(searchText.toLowerCase()))) {
      return false
    }
    return true
  })

  // 导出日志
  const handleExport = useCallback(() => {
    const text = logger.exportToText()
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `知识库日志_${new Date().toISOString().slice(0, 19).replace(/[:]/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
    logger.info('日志已导出')
  }, [])

  // 清空日志
  const handleClear = useCallback(() => {
    if (window.confirm('确定要清空所有日志吗？')) {
      logger.clear()
      logger.info('日志已清空')
    }
  }, [])

  // 复制日志
  const handleCopy = useCallback(() => {
    const text = filteredLogs.map(log =>
      `[${log.time}] [${log.level}] ${log.message}${log.data ? '\n  Data: ' + log.data : ''}`
    ).join('\n')

    navigator.clipboard.writeText(text).then(() => {
      logger.info('日志已复制到剪贴板')
    }).catch(() => {
      // 降级方案
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    })
  }, [filteredLogs])

  // 统计
  const stats = {
    all: logs.length,
    ERROR: logs.filter(l => l.level === 'ERROR').length,
    WARN: logs.filter(l => l.level === 'WARN').length,
    INFO: logs.filter(l => l.level === 'INFO').length,
    DEBUG: logs.filter(l => l.level === 'DEBUG').length
  }

  if (!isOpen) return null

  return (
    <div className="log-viewer-overlay" onClick={onClose}>
      <div className="log-viewer" onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="log-viewer-header">
          <div className="log-viewer-title">
            <span className="log-viewer-icon">📋</span>
            <span>日志调试器</span>
            <span className="log-viewer-count">({logs.length} 条)</span>
          </div>
          <div className="log-viewer-actions">
            <button className="log-btn" onClick={handleCopy} title="复制日志">
              📑 复制
            </button>
            <button className="log-btn" onClick={handleExport} title="导出日志文件">
              💾 导出
            </button>
            <button className="log-btn log-btn-danger" onClick={handleClear} title="清空日志">
              🗑️ 清空
            </button>
            <button className="log-btn log-btn-close" onClick={onClose} title="关闭 (Ctrl+Shift+L)">
              ✕
            </button>
          </div>
        </div>

        {/* 过滤栏 */}
        <div className="log-viewer-filters">
          <div className="log-filter-tabs">
            {LEVEL_FILTERS.map(f => (
              <button
                key={f.key}
                className={`log-filter-tab ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.icon} {f.label}
                {stats[f.key] > 0 && (
                  <span className={`log-badge ${f.key === 'ERROR' && stats.ERROR > 0 ? 'badge-error' : ''}`}>
                    {stats[f.key]}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="log-search-box">
            <input
              type="text"
              placeholder="🔍 搜索日志..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="log-search-input"
            />
            <label className="log-auto-scroll">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
              />
              自动滚动
            </label>
          </div>
        </div>

        {/* 日志列表 */}
        <div className="log-viewer-list" ref={listRef}>
          {filteredLogs.length === 0 ? (
            <div className="log-empty">
              {searchText ? '没有匹配的日志' : '暂无日志记录'}
            </div>
          ) : (
            filteredLogs.map(log => (
              <div key={log.id} className={`log-entry log-level-${log.level.toLowerCase()}`}>
                <div className="log-entry-header">
                  <span className="log-time">{log.time}</span>
                  <span className="log-level" style={{ color: log.levelColor }}>
                    [{log.level}]
                  </span>
                  <span className="log-message">{log.message}</span>
                </div>
                {log.data && (
                  <pre className="log-data">{log.data}</pre>
                )}
              </div>
            ))
          )}
        </div>

        {/* 底部状态栏 */}
        <div className="log-viewer-footer">
          <span>显示 {filteredLogs.length} / {logs.length} 条</span>
          <span className="log-shortcut">快捷键: Ctrl+Shift+L 打开/关闭</span>
        </div>
      </div>
    </div>
  )
}
