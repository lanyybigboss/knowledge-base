/**
 * 系统设置页面
 */

import React, { useState, useEffect, useRef } from 'react'
import { useApp } from '../../services/AppContext'
import watcherService from '../../services/folderWatcherService'
import { saveApiKey, hasApiKey, isOllamaAvailable, invalidateOllamaHealth } from '../../services/aiService'
import Modal from '../Common/Modal'
import './SettingsPage.css'

export default function SettingsPage() {
  const {
    settings,
    numberingRules,
    updateSettings,
    updateNumberingRules,
    exportData,
    importData,
    clearAllData,
    documents,
    categories
  } = useApp()
n  const [activeTab, setActiveTab] = useState('general')
  const [showImportModal, setShowImportModal] = useState(false)
  const [showClearModal, setShowClearModal] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [importError, setImportError] = useState('')

  // 文件夹监控状态（多文件夹）
  const [watcherStatus, setWatcherStatus] = useState({ running: false, paths: [], pathsInfo: [], fileCount: 0, lastEvent: '' })
  const [watcherPaths, setWatcherPaths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('watcher_paths') || '[]') } catch { return [] }
  })
  const [watcherNewPath, setWatcherNewPath] = useState('')
  const [watcherFiles, setWatcherFiles] = useState([])
  const [watcherStarting, setWatcherStarting] = useState(false)
  const stopPollRef = useRef(null)

  // 编号规则表单
  const [numberForm, setNumberForm] = useState({
    prefix: numberingRules.prefix || 'DOC',
    dateFormat: numberingRules.dateFormat || 'YYYYMMDD',
    separator: numberingRules.separator || '-',
    digitCount: numberingRules.digitCount || 4,
    counter: numberingRules.counter || {}
  })

  // 开机自启动状态
  const [autoStartEnabled, setAutoStartEnabled] = useState(false)
  const [autoStartLoading, setAutoStartLoading] = useState(false)
  useEffect(() => {
    // 检查当前开机自启状态（仅 Electron 环境有效）
    console.log('[AutoStart] 环境检测:', {
      hasElectronAPI: !!window.electronAPI,
      hasGetAutoStart: !!(window.electronAPI && window.electronAPI.getAutoStart)
    })
    if (window.electronAPI && window.electronAPI.getAutoStart) {
      window.electronAPI.getAutoStart().then(res => {
        console.log('[AutoStart] 获取状态成功:', res)
        setAutoStartEnabled(!!res.enabled)
      }).catch(err => {
        console.error('[AutoStart] 获取状态失败:', err)
      })
    } else {
      console.warn('[AutoStart] window.electronAPI 不可用，当前为非 Electron 环境或 preload 未加载')
    }
  }, [])

  // 定时轮询监控状态
  useEffect(() => {
    if (activeTab === 'folder') {
      loadWatcherStatus()
      stopPollRef.current = watcherService.pollStatus(setWatcherStatus, 2000)
    } else if (stopPollRef.current) {
      stopPollRef.current()
      stopPollRef.current = null
    }
    return () => {
      if (stopPollRef.current) {
        stopPollRef.current()
        stopPollRef.current = null
      }
    }
  }, [activeTab])

  // 选择文件夹路径（添加到列表）
  const handleSelectFolder = async () => {
    // 尝试使用 Electron 原生选择器
    if (window.electronAPI && window.electronAPI.selectFolder) {
      const folderPath = await window.electronAPI.selectFolder()
      if (folderPath) {
        setWatcherNewPath(folderPath)
      }
      return
    }
    // 降级方案：prompt 输入
    const fullPath = prompt('请输入要监控的文件夹路径（多文件夹就是多次添加）：', watcherNewPath || 'C:\\')
    if (fullPath) {
      setWatcherNewPath(fullPath)
    }
  }

  const loadWatcherStatus = async () => {
    try {
      const status = await watcherService.getStatus()
      setWatcherStatus(status)
      // 同步本地 paths 列表
      if (status.paths && status.paths.length > 0) {
        setWatcherPaths(status.paths)
        localStorage.setItem('watcher_paths', JSON.stringify(status.paths))
      }
      if (status.running) {
        const files = await watcherService.getFiles()
        if (files.success) setWatcherFiles(files.files)
      }
    } catch (e) { /* ignore */ }
  }

  // 添加一个文件夹到监控列表
  const handleAddFolder = async () => {
    if (!watcherNewPath) {
      alert('请先输入或选择要监控的文件夹路径')
      return
    }
    // 检查是否已在列表中
    if (watcherPaths.includes(watcherNewPath)) {
      alert('该文件夹已在监控列表中')
      return
    }
    const newPaths = [...watcherPaths, watcherNewPath]
    setWatcherPaths(newPaths)
    localStorage.setItem('watcher_paths', JSON.stringify(newPaths))
    setWatcherNewPath('')
    // 如果监控已在运行，立即添加
    if (watcherStatus.running) {
      const result = await watcherService.addFolder(watcherNewPath)
      if (result.success) {
        setWatcherStatus(result.status)
      } else {
        alert(`添加失败: ${result.error || '请检查路径是否正确'}`)
      }
    }
  }

  // 从监控列表中移除一个文件夹
  const handleRemoveFolder = async (folderPath) => {
    const newPaths = watcherPaths.filter(p => p !== folderPath)
    setWatcherPaths(newPaths)
    localStorage.setItem('watcher_paths', JSON.stringify(newPaths))
    // 如果监控正在运行，立即移除
    if (watcherStatus.running) {
      const result = await watcherService.removeFolder(folderPath)
      if (result.success) {
        setWatcherStatus(result.status)
      }
    }
    // 如果所有文件夹都已移除，则清空文件列表
    if (newPaths.length === 0) {
      setWatcherFiles([])
    }
  }

  // 批量启动所有已配置的文件夹监控
  const handleStartWatcher = async () => {
    if (watcherPaths.length === 0) {
      alert('请先添加要监控的文件夹路径')
      return
    }
    setWatcherStarting(true)
    try {
      const result = await watcherService.start(watcherPaths)
      if (result.success) {
        setWatcherStatus(result.status)
        const files = await watcherService.getFiles()
        if (files.success) setWatcherFiles(files.files)
      } else {
        alert(`启动失败: ${result.error || '请检查路径是否正确'}`)
      }
    } catch (e) {
      alert(`启动失败: ${e.message}`)
    }
    setWatcherStarting(false)
  }

  // 停止所有文件夹监控
  const handleStopWatcher = async () => {
    try {
      await watcherService.stop()
      setWatcherStatus({ running: false, paths: [], pathsInfo: [], fileCount: 0, lastEvent: '已停止' })
      setWatcherFiles([])
    } catch (e) {
      alert(`停止失败: ${e.message}`)
    }
  }

  const handleSaveNumbering = () => {
    updateNumberingRules(numberForm)
  }

  const handleExportJSON = () => {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-base-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportCSV = () => {
    const data = exportData()
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

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `knowledge-base-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (e) => {
    const file = e.target.files[0]
    if (file) {
      setImportFile(file)
      setImportError('')
    }
  }

  const handleImport = () => {
    if (!importFile) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        importData(data)
        setShowImportModal(false)
        setImportFile(null)
      } catch (err) {
        setImportError('文件格式错误，请选择有效的 JSON 备份文件')
      }
    }
    reader.readAsText(importFile)
  }

  const handleClearAll = () => {
    clearAllData()
    setShowClearModal(false)
  }

  // 切换开机自启
  const handleToggleAutoStart = async () => {
    console.log('[AutoStart] handleToggleAutoStart 被调用')
    if (!window.electronAPI?.setAutoStart) {
      console.warn('[AutoStart] 环境检查失败:', { hasElectronAPI: !!window.electronAPI, hasSetAutoStart: !!(window.electronAPI?.setAutoStart) })
      alert('❌ 开机自启动功能仅在 Electron 桌面应用模式下可用\\n\\n请用以下命令运行：\\nnpm run electron:dev')
      return
    }
    setAutoStartLoading(true)
    try {
      const newState = !autoStartEnabled
      console.log('[AutoStart] 准备切换:', { current: autoStartEnabled, new: newState })
      const result = await window.electronAPI.setAutoStart(newState)
      console.log('[AutoStart] 切换结果:', result)
      if (result.success) {
        setAutoStartEnabled(result.enabled)
        console.log('[AutoStart] 切换成功，新状态:', result.enabled)
      } else {
        console.error('[AutoStart] 设置失败:', result.error)
        alert(`❌ 开机自启设置失败\\n\\n错误原因：${result.error || '请检查系统权限或杀毒软件拦截'}`)
      }
    } catch (err) {
      console.error('[AutoStart] 切换异常:', err)
      alert(`❌ 开机自启设置失败：\\n${err.message || '未知错误'}`)
    } finally {
      setAutoStartLoading(false)
    }
  }

  // ===== AI 设置 =====
  const [aiApiKey, setAiApiKey] = useState(() => {
    return localStorage.getItem('deepseek_api_key') || ''
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaveMsg, setAiSaveMsg] = useState('')
  const [ollamaStatus, setOllamaStatus] = useState({ checking: true, available: false, model: '' })
  const [ollamaTesting, setOllamaTesting] = useState(false)
  const [deepseekTesting, setDeepseekTesting] = useState(false)
  const [deepseekTestResult, setDeepseekTestResult] = useState('')

  // 初始化时检测 Ollama 状态
  useEffect(() => {
    checkOllamaStatus()
  }, [])

  const checkOllamaStatus = async () => {
    setOllamaTesting(true)
    setOllamaStatus(prev => ({ ...prev, checking: true }))
    try {
      const available = await isOllamaAvailable()
      setOllamaStatus({ checking: false, available, model: 'qwen2.5:7b-instruct-q4_K_M' })
    } catch (e) {
      setOllamaStatus({ checking: false, available: false, model: '' })
    } finally {
      setOllamaTesting(false)
    }
  }

  const handleTestOllama = async () => {
    setOllamaTesting(true)
    try {
      const ok = await isOllamaAvailable()
      setOllamaStatus(prev => ({ ...prev, available: ok }))
      if (!ok) showNotification('error', 'Ollama 未响应')
      else showNotification('success', 'Ollama 可用')
    } catch (err) {
      showNotification('error', 'Ollama 检测异常')
    } finally { setOllamaTesting(false) }
  }

  const handleSaveApiKey = async () => {
    setAiSaving(true)
    try {
      saveApiKey(aiApiKey)
      setAiSaveMsg('已保存')
      showNotification('success', 'DeepSeek API Key 已保存')
    } catch (e) {
      setAiSaveMsg('保存失败')
      showNotification('error', '保存 Key 失败')
    } finally { setAiSaving(false) }
  }

  const handleTestDeepSeek = async () => {
    setDeepseekTesting(true)
    setDeepseekTestResult('')
    try {
      const res = await (async function test() {
        try {
          const key = localStorage.getItem('deepseek_api_key')
          if (!key) return { success: false, error: '未配置 API Key' }
          // 简化测试：调用 aiService 的 test 接口（若存在）
          return await (window.aiService?.testDeepSeek ? window.aiService.testDeepSeek() : { success: false, error: 'NotImplemented' })
        } catch (e) { return { success: false, error: e.message } }
      })()
      setDeepseekTestResult(res.success ? '可用' : `不可用: ${res.error || 'unknown'}`)
    } catch (e) {
      setDeepseekTestResult(`检测异常: ${e.message || e}`)
    } finally { setDeepseekTesting(false) }
  }

  // 其余 UI 渲染略…
  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h2 className="settings-page-title">系统设置</h2>
        <div className="settings-page-subtitle">应用级设置与调试项</div>
      </div>
      <div className="settings-tabs">
        <div className={`settings-tab ${activeTab === 'general' ? 'settings-tab--active' : ''}`} onClick={() => setActiveTab('general')}>常规</div>
        <div className={`settings-tab ${activeTab === 'folder' ? 'settings-tab--active' : ''}`} onClick={() => setActiveTab('folder')}>监控</div>
        <div className={`settings-tab ${activeTab === 'ai' ? 'settings-tab--active' : ''}`} onClick={() => setActiveTab('ai')}>AI</div>
        <div className={`settings-tab ${activeTab === 'numbering' ? 'settings-tab--active' : ''}`} onClick={() => setActiveTab('numbering')}>编号</div>
      </div>
      <div className="settings-content">
        {activeTab === 'general' && (
          <div className="settings-section">
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                常规设置
              </h3>
