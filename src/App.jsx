/**
 * 知识库管理系统 - 应用入口
 */

import React, { useEffect, useState } from 'react'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import logger from './services/logger'
import LogViewer from './components/LogViewer/LogViewer'
import { AppProvider, useApp } from './services/AppContext'
import MainLayout from './components/Layout/MainLayout'
import Dashboard from './components/Dashboard/Dashboard'
import DocumentList from './components/DocumentList/DocumentList'
import DocumentDetail from './components/DocumentDetail/DocumentDetail'
import UploadPage from './components/Upload/UploadPage'
import CategoryPage from './components/Category/CategoryPage'
import StatisticsPage from './components/Statistics/StatisticsPage'
import SettingsPage from './components/Settings/SettingsPage'
import QuickSearchModal from './components/QuickSearch/QuickSearchModal'
import DevPanel from './components/DevPanel/DevPanel'

/**
 * 内部应用组件（在 AppProvider 内部，可使用 useApp）
 */
function AppInner() {
  const { toggleLogViewer } = useApp()
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [devPanelOpen, setDevPanelOpen] = useState(false)

  // 全局快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Shift+K 快速搜索
      if (e.ctrlKey && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        setQuickSearchOpen(prev => !prev)
        return
      }
      // Ctrl+Shift+L 打开日志
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault()
        toggleLogViewer()
      }
      // Ctrl+Shift+D 打开 AI 调试面板
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault()
        setDevPanelOpen(prev => !prev)
        return
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleLogViewer])

  return (
    <>
      <MainLayout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/documents" element={<DocumentList />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/categories" element={<CategoryPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </MainLayout>
      <QuickSearchModal isOpen={quickSearchOpen} onClose={() => setQuickSearchOpen(false)} />
      <DevPanel isOpen={devPanelOpen} onClose={() => setDevPanelOpen(false)} />
    </>
  )
}

function App() {
  // 记录 App 启动（在 Provider 外部，只执行一次）
  useEffect(() => {
    logger.info('App 组件已挂载')
    logger.info(`路由模式: HashRouter (兼容 Electron file:// 协议)`)
    logger.info(`Electron API: ${typeof window.electronAPI !== 'undefined' ? '可用' : '不可用'}`)
  }, [])

  return (
    <Router>
      <AppProvider>
        <AppInner />
        <LogViewerConsumer />
      </AppProvider>
    </Router>
  )
}

/**
 * 日志查看器消费者（在 AppProvider 内部访问 context）
 */
function LogViewerConsumer() {
  const { logViewerOpen, toggleLogViewer } = useApp()
  return <LogViewer isOpen={logViewerOpen} onClose={() => logViewerOpen && toggleLogViewer()} />
}

export default App
