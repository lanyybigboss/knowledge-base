/**
 * 知识库管理系统 - 顶部导航栏
 */

import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../services/AppContext'
import { debounce } from '../../utils/helpers'
import './Layout.css'

export default function Header({ onToggleSidebar }) {
  const { searchQuery, setSearch, documents, toggleLogViewer } = useApp()
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [showSearchResults, setShowSearchResults] = useState(false)
  const searchRef = useRef(null)
  const navigate = useNavigate()

  const debouncedSearch = debounce((value) => {
    setSearch(value)
  }, 300)

  const handleSearchChange = (e) => {
    const value = e.target.value
    setLocalSearch(value)
    debouncedSearch(value)
    setShowSearchResults(value.length > 0)
  }

  const handleSearchFocus = () => {
    if (localSearch.length > 0) {
      setShowSearchResults(true)
    }
  }

  const handleSearchResultClick = (docId) => {
    setShowSearchResults(false)
    navigate(`/documents/${docId}`)
  }

  // 点击外部关闭搜索结果
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearchResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 获取搜索建议
  const getSearchSuggestions = () => {
    if (!localSearch) return []
    const query = localSearch.toLowerCase()
    return documents
      .filter(doc => 
        doc.title.toLowerCase().includes(query) ||
        (doc.docNumber && doc.docNumber.toLowerCase().includes(query))
      )
      .slice(0, 5)
  }

  const suggestions = getSearchSuggestions()

  return (
    <header className="header">
      <div className="header-left">
        <button
          className="header-menu-btn btn btn-icon btn-ghost"
          onClick={onToggleSidebar}
          title="切换侧边栏"
        >
          ☰
        </button>
      </div>

      <div className="header-center" ref={searchRef}>
        <div className="header-search">
          <span className="header-search-icon">🔍</span>
          <input
            type="text"
            className="header-search-input"
            placeholder="搜索文档标题、编号、内容..."
            value={localSearch}
            onChange={handleSearchChange}
            onFocus={handleSearchFocus}
          />
          {localSearch && (
            <button
              className="header-search-clear"
              onClick={() => {
                setLocalSearch('')
                setSearch('')
                setShowSearchResults(false)
              }}
            >
              ✕
            </button>
          )}
        </div>

        {showSearchResults && suggestions.length > 0 && (
          <div className="header-search-results">
            {suggestions.map(doc => (
              <div
                key={doc.id}
                className="header-search-result-item"
                onClick={() => handleSearchResultClick(doc.id)}
              >
                <div className="header-search-result-title">{doc.title}</div>
                <div className="header-search-result-meta">
                  {doc.docNumber && <span>{doc.docNumber}</span>}
                  <span>{doc.category}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="header-right">
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => {
            e.preventDefault()
            toggleLogViewer()
          }}
          title="查看运行日志 (Ctrl+Shift+L)"
        >
          📋 日志
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => navigate('/upload')}
        >
          📤 上传文档
        </button>
      </div>
    </header>
  )
}
