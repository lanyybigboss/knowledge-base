/**
 * 快速搜索模态框
 * 类似 Alfred/Everything 风格的全局搜索
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import searchService from '../../services/searchService'
import logger from '../../services/logger'
import './QuickSearchModal.css'

/** 防抖延迟 */
const DEBOUNCE_MS = 150

export default function QuickSearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)
  const navigate = useNavigate()
  const { documents } = useApp()

  // 组件打开时聚焦输入框并重置状态
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setResults([])
      setSelectedIndex(0)
      setLoading(false)
      // 确保搜索索引是最新的
      searchService.buildIndex(documents)
      // 延迟聚焦（等待动画完成）
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [isOpen, documents])

  // 防抖搜索
  const handleQueryChange = useCallback((e) => {
    const value = e.target.value
    setQuery(value)
    setSelectedIndex(0)

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    if (!value || value.trim().length === 0) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)

    debounceRef.current = setTimeout(() => {
      try {
        const searchResults = searchService.search(value, 10)
        setResults(searchResults)
      } catch (err) {
        logger.error('[QuickSearch] 搜索异常:', err.message)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
  }, [])

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  // 键盘导航
  const handleKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'Escape':
        e.preventDefault()
        onClose()
        break
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, results.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (results.length > 0 && results[selectedIndex]) {
          handleSelect(results[selectedIndex])
        }
        break
      default:
        break
    }
  }, [results, selectedIndex, onClose])

  // 选择结果项
  const handleSelect = useCallback((result) => {
    if (!result || !result.item) return
    onClose()
    logger.info(`[QuickSearch] 导航到文档: "${result.item.title || result.item.fileName}"`)
    navigate(`/documents/${result.item.id}`)
  }, [navigate, onClose])

  // 高亮匹配文本
  const highlightMatch = useCallback((text, query) => {
    if (!text || !query) return text || ''
    const str = String(text)
    const idx = str.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) return str
    return (
      <>
        {str.substring(0, idx)}
        <mark className="qs-highlight">{str.substring(idx, idx + query.length)}</mark>
        {str.substring(idx + query.length)}
      </>
    )
  }, [])

  // 获取结果项的显示文本
  const getDisplayTitle = useCallback((item) => {
    return item.smartTitle || item.title || item.fileName || '未命名文档'
  }, [])

  // 获取结果项的副标题
  const getDisplaySubtitle = useCallback((item) => {
    return item.summary || item.fileName || ''
  }, [])

  if (!isOpen) return null

  return (
    <div className="qs-overlay" onClick={onClose}>
      <div className="qs-modal" onClick={(e) => e.stopPropagation()}>
        {/* 搜索输入区 */}
        <div className="qs-input-wrapper">
          <svg className="qs-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="qs-input"
            placeholder="搜索文档标题、摘要、关键词..."
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="qs-shortcut-hint">
            <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>
          </div>
        </div>

        {/* 搜索结果列表 */}
        <div className="qs-results">
          {loading ? (
            <div className="qs-loading">
              <div className="qs-spinner" />
              <span>搜索中...</span>
            </div>
          ) : query && results.length === 0 ? (
            <div className="qs-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="qs-empty-icon">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
                <path d="M8 11h6" />
              </svg>
              <p>未找到匹配的文档</p>
            </div>
          ) : results.length > 0 ? (
            <ul className="qs-result-list">
              {results.map((result, index) => (
                <li
                  key={result.item.id}
                  className={`qs-result-item ${index === selectedIndex ? 'qs-result-selected' : ''}`}
                  onClick={() => handleSelect(result)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="qs-result-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="qs-result-content">
                    <div className="qs-result-title">
                      {highlightMatch(getDisplayTitle(result.item), query)}
                    </div>
                    <div className="qs-result-subtitle">
                      {highlightMatch(getDisplaySubtitle(result.item), query)}
                    </div>
                  </div>
                  <div className="qs-result-score">
                    {result.score < 0.3 ? (
                      <span className="qs-score-badge qs-score-high">高匹配</span>
                    ) : result.score < 0.5 ? (
                      <span className="qs-score-badge qs-score-mid">中匹配</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="qs-hint">
              <div className="qs-hint-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 19-7-7 7-7" />
                  <path d="M19 12H5" />
                </svg>
              </div>
              <p>输入关键词开始搜索文档</p>
              <p className="qs-hint-sub">支持模糊搜索，可搜索标题、摘要、关键词</p>
            </div>
          )}
        </div>

        {/* 底部信息 */}
        <div className="qs-footer">
          <div className="qs-footer-hints">
            <span><kbd>↑↓</kbd> 导航</span>
            <span><kbd>Enter</kbd> 打开</span>
            <span><kbd>Esc</kbd> 关闭</span>
          </div>
          <div className="qs-footer-count">
            {searchService.isReady() ? `${searchService.getDocumentCount()} 个文档已索引` : '索引未就绪'}
          </div>
        </div>
      </div>
    </div>
  )
}
