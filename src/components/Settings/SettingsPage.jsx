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

  const [activeTab, setActiveTab] = useState('general')
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
    if (!window.electronAPI || !window.electronAPI.setAutoStart) {
      console.warn('[AutoStart] 环境检查失败:', { hasElectronAPI: !!window.electronAPI, hasSetAutoStart: !!(window.electronAPI && window.electronAPI.setAutoStart) })
      alert('开机自启动功能仅在桌面应用模式下可用')
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
      } else {
        alert('开机自启设置失败，请检查系统权限或杀毒软件拦截')
      }
    } catch (err) {
      console.error('[AutoStart] 切换异常:', err)
      alert(`开机自启设置失败：${err.message || '未知错误'}`)
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
    } catch {
      setOllamaStatus({ checking: false, available: false, model: '' })
    }
    setOllamaTesting(false)
  }

  const handleSaveApiKey = () => {
    setAiSaving(true)
    setAiSaveMsg('')
    try {
      const trimmedKey = aiApiKey.trim()
      if (trimmedKey && trimmedKey.length < 20) {
        setAiSaveMsg('API Key 似乎不完整（DeepSeek Key 通常以 sk- 开头且至少20个字符），请检查后重试')
        setAiSaving(false)
        return
      }
      saveApiKey(trimmedKey)
      setAiSaveMsg(trimmedKey ? 'DeepSeek API Key 已保存' : 'API Key 已清空')
      setAiApiKey(trimmedKey)
    } catch (e) {
      setAiSaveMsg('保存失败：' + (e.message || '未知错误'))
    }
    setAiSaving(false)
  }

  const handleTestDeepSeek = async () => {
    const key = aiApiKey.trim()
    if (!key || key.length < 20) {
      setDeepseekTestResult('请先输入有效的 API Key（至少 20 个字符，通常以 sk- 开头）')
      return
    }
    setDeepseekTesting(true)
    setDeepseekTestResult('')
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok) {
        setDeepseekTestResult('连接成功！DeepSeek API 工作正常')
      } else {
        const errData = await response.json().catch(() => ({}))
        setDeepseekTestResult(`连接失败：${errData.error?.message || `HTTP ${response.status}`}`)
      }
    } catch (e) {
      setDeepseekTestResult(`测试失败：${e.message || '网络错误'}`)
    }
    setDeepseekTesting(false)
  }

  const tabs = [
    { id: 'general', label: '通用设置' },
    { id: 'ai', label: 'AI 设置' },
    { id: 'numbering', label: '编号规则' },
    { id: 'folder', label: '文件夹监控' },
    { id: 'data', label: '数据管理' }
  ]

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h1 className="settings-page-title">系统设置</h1>
        <p className="settings-page-subtitle">管理知识库的配置和数据</p>
      </div>

      {/* 标签页 */}
      <div className="settings-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`settings-tab ${activeTab === tab.id ? 'settings-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
        {/* 通用设置 */}
        {activeTab === 'general' && (
          <div className="settings-section">
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                应用设置
              </h3>
              <div className="settings-form">
                <div className="input-group">
                  <label>每页显示文档数</label>
                  <select
                    value={settings.pageSize || 20}
                    onChange={e => updateSettings({ pageSize: Number(e.target.value) })}
                  >
                    <option value={10}>10 条/页</option>
                    <option value={20}>20 条/页</option>
                    <option value={50}>50 条/页</option>
                    <option value={100}>100 条/页</option>
                  </select>
                </div>

                <div className="input-group">
                  <label>默认排序方式</label>
                  <select
                    value={settings.defaultSort || 'createdAt-desc'}
                    onChange={e => updateSettings({ defaultSort: e.target.value })}
                  >
                    <option value="createdAt-desc">最新创建</option>
                    <option value="createdAt-asc">最早创建</option>
                    <option value="title-asc">标题 A-Z</option>
                    <option value="title-desc">标题 Z-A</option>
                    <option value="fileSize-desc">文件最大</option>
                    <option value="fileSize-asc">文件最小</option>
                  </select>
                </div>

                <div className="input-group">
                  <label>
                    开机自动启动
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
                      （桌面应用模式，启动后静默驻留系统托盘）
                    </span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      className={`btn ${autoStartEnabled ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={handleToggleAutoStart}
                      disabled={autoStartLoading}
                      style={{ minWidth: '100px' }}
                    >
                      {autoStartLoading ? '⏳ 处理中...' : (autoStartEnabled ? '🟢 已启用' : '⚪ 已禁用')}
                    </button>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {autoStartEnabled ? '系统启动时将自动运行并驻留托盘' : '点击启用开机自动启动'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI 设置 */}
        {activeTab === 'ai' && (
          <div className="settings-section">
            {/* DeepSeek API Key */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                DeepSeek API 配置
              </h3>
              <p className="settings-description">
                DeepSeek 作为云端 AI 后备方案，当本地 Ollama 不可用时自动降级调用。请前往
                <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--primary)', margin: '0 4px' }}>
                  DeepSeek 开放平台
                </a>
                获取 API Key。
              </p>

              <div className="settings-form" style={{ maxWidth: '100%' }}>
                <div className="input-group">
                  <label>API Key</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={aiApiKey}
                      onChange={e => {
                        setAiApiKey(e.target.value)
                        setAiSaveMsg('')
                      }}
                      placeholder="输入 DeepSeek API Key（sk-...）"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => setShowApiKey(!showApiKey)}
                      style={{ padding: '0 12px', fontSize: '0.8125rem' }}
                      title={showApiKey ? '隐藏 Key' : '显示 Key'}
                    >
                      {showApiKey ? '🙈' : '👁️'}
                    </button>
                  </div>
                  {aiApiKey.trim() && aiApiKey.trim().length < 20 && (
                    <p style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '4px' }}>
                      ⚠️ Key 过短（{aiApiKey.trim().length} 字符），有效 Key 通常至少 20 个字符
                    </p>
                  )}
                </div>

                <div className="settings-actions">
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveApiKey}
                    disabled={aiSaving}
                  >
                    {aiSaving ? '⏳ 保存中...' : '💾 保存 Key'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={handleTestDeepSeek}
                    disabled={deepseekTesting}
                  >
                    {deepseekTesting ? '⏳ 测试中...' : '🔗 测试连接'}
                  </button>
                </div>

                {aiSaveMsg && (
                  <p style={{
                    fontSize: '0.8125rem',
                    color: aiSaveMsg.includes('失败') || aiSaveMsg.includes('不完整') ? 'var(--error)' : 'var(--success)',
                    marginTop: '8px'
                  }}>
                    {aiSaveMsg}
                  </p>
                )}
                {deepseekTestResult && (
                  <p style={{
                    fontSize: '0.8125rem',
                    color: deepseekTestResult.includes('成功') ? '#059669' : 'var(--error)',
                    marginTop: '8px'
                  }}>
                    {deepseekTestResult}
                  </p>
                )}
              </div>
            </div>

            {/* Ollama 本地模型状态 */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                本地 Ollama 模型
              </h3>
              <p className="settings-description">
                Ollama 本地大模型优先调用，免费且无网络依赖。如果 Ollama 服务未安装或模型未下载，将自动降级到 DeepSeek API。
              </p>

              <div className="settings-form" style={{ maxWidth: '100%' }}>
                <div className="ai-ollama-status-bar">
                  <span style={{ fontSize: '1.5rem' }}>
                    {ollamaStatus.checking ? '⏳' : (ollamaStatus.available ? '🟢' : '🔴')}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      {ollamaStatus.checking
                        ? '正在检测 Ollama 服务...'
                        : (ollamaStatus.available
                          ? `Ollama 服务正常（模型：${ollamaStatus.model}）`
                          : 'Ollama 服务不可用')
                      }
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {ollamaStatus.checking
                        ? '正在连接 http://localhost:11434 ...'
                        : (ollamaStatus.available
                          ? 'AI 分析时将优先使用本地 Ollama 模型'
                          : '请确保 Ollama 已安装并运行，且已拉取对应模型')
                      }
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={checkOllamaStatus}
                    disabled={ollamaTesting}
                    style={{ padding: '4px 12px', fontSize: '0.8125rem' }}
                  >
                    {ollamaTesting ? '⏳' : '🔄 重新检测'}
                  </button>
                </div>
              </div>
            </div>

            {/* AI 降级策略说明 */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                AI 分析降级策略
              </h3>
              <p className="settings-description">
                文档 AI 分析采用多层降级策略，确保最大可用性：
              </p>
              <div className="ai-strategy-list">
                <div className="ai-strategy-item">
                  <span className="ai-strategy-num">1</span>
                  <div>
                    <strong>优先：Ollama 本地模型</strong>
                    <p>免费、无网络依赖、隐私安全。优先调用本地 qwen2.5:7b 模型。</p>
                  </div>
                </div>
                <div className="ai-strategy-item">
                  <span className="ai-strategy-num">2</span>
                  <div>
                    <strong>备选：DeepSeek API</strong>
                    <p>当 Ollama 不可用时自动降级到云端 DeepSeek API，需要配置有效 API Key。</p>
                  </div>
                </div>
                <div className="ai-strategy-item">
                  <span className="ai-strategy-num">3</span>
                  <div>
                    <strong>兜底：自动分类</strong>
                    <p>当所有 AI 服务均失败时，文档仍可正常添加，归入"其他"分类，支持手动编辑。</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 编号规则 */}
        {activeTab === 'numbering' && (
          <div className="settings-section">
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                文档编号规则
              </h3>
              <p className="settings-description">
                配置自动生成的文档编号格式。预览：{numberForm.prefix}{numberForm.separator}
                {new Date().toISOString().slice(0, 10).replace(/-/g, '')}{numberForm.separator}
                {'1'.padStart(numberForm.digitCount, '0')}
              </p>

              <div className="settings-form">
                <div className="input-group">
                  <label>前缀</label>
                  <input
                    type="text"
                    value={numberForm.prefix}
                    onChange={e => setNumberForm({ ...numberForm, prefix: e.target.value })}
                    placeholder="例如: DOC, KB, KB-2024"
                  />
                </div>

                <div className="input-group">
                  <label>日期格式</label>
                  <select
                    value={numberForm.dateFormat}
                    onChange={e => setNumberForm({ ...numberForm, dateFormat: e.target.value })}
                  >
                    <option value="YYYYMMDD">YYYYMMDD (20260520)</option>
                    <option value="YYYYMM">YYYYMM (202605)</option>
                    <option value="YYYY">YYYY (2026)</option>
                    <option value="none">无日期</option>
                  </select>
                </div>

                <div className="input-group">
                  <label>分隔符</label>
                  <select
                    value={numberForm.separator}
                    onChange={e => setNumberForm({ ...numberForm, separator: e.target.value })}
                  >
                    <option value="-">- (连字符)</option>
                    <option value="_">_ (下划线)</option>
                    <option value="/">/ (斜杠)</option>
                    <option value="">无分隔符</option>
                  </select>
                </div>

                <div className="input-group">
                  <label>序号位数</label>
                  <select
                    value={numberForm.digitCount}
                    onChange={e => setNumberForm({ ...numberForm, digitCount: Number(e.target.value) })}
                  >
                    <option value={3}>3 位 (001)</option>
                    <option value={4}>4 位 (0001)</option>
                    <option value={5}>5 位 (00001)</option>
                    <option value={6}>6 位 (000001)</option>
                  </select>
                </div>

                <button className="btn btn-primary" onClick={handleSaveNumbering}>
                  💾 保存编号规则
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 文件夹监控（多文件夹） */}
        {activeTab === 'folder' && (
          <div className="settings-section">
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                👁️ 文件夹监控
              </h3>
              <p className="settings-description">
                监控指定文件夹，当有新文件添加时自动导入到知识库。支持同时监控多个文件夹，每个文件夹独立监控。
              </p>

              {/* 状态指示器 */}
              <div className="watcher-status-bar" style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                background: watcherStatus.running ? '#05966910' : '#6b728010',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                border: `1px solid ${watcherStatus.running ? '#05966930' : '#6b728030'}`
              }}>
                <span style={{ fontSize: '1.5rem' }}>{watcherStatus.running ? '🟢' : '🔴'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {watcherStatus.running ? '监控运行中' : '监控未启动'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                    {watcherStatus.running
                      ? `监控文件夹数: ${(watcherStatus.pathsInfo || []).length} · 总文件数: ${watcherStatus.fileCount} · ${watcherStatus.lastEvent}`
                      : watcherStatus.lastEvent || '添加文件夹后点击"启动监控"'}
                  </div>
                </div>
              </div>

              {/* 已监控的文件夹列表 */}
              {watcherPaths.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', marginBottom: '8px', fontWeight: 500, fontSize: '0.875rem' }}>
                    已配置的监控文件夹：
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {watcherPaths.map((p, i) => {
                      const info = (watcherStatus.pathsInfo || []).find(pi => pi.path === p)
                      const isRunning = watcherStatus.running && info?.running
                      return (
                        <div key={i} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 12px',
                          background: isRunning ? '#05966908' : '#6b728008',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${isRunning ? '#05966920' : '#6b728020'}`
                        }}>
                          <span>{isRunning ? '🟢' : '🔴'}</span>
                          <span style={{
                            flex: 1,
                            fontSize: '0.8125rem',
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}>
                            {p}
                          </span>
                          {info && (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                              {info.fileCount || 0} 个文件
                            </span>
                          )}
                          <button
                            className="btn btn-ghost"
                            onClick={() => handleRemoveFolder(p)}
                            style={{ padding: '2px 8px', fontSize: '0.75rem', color: 'var(--error)' }}
                            title="移除此文件夹"
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 添加新文件夹路径 */}
              <div className="input-group">
                <label>添加监控文件夹</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={watcherNewPath}
                    onChange={e => setWatcherNewPath(e.target.value)}
                    placeholder="例如: E:\Documents\知识库"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost" onClick={handleSelectFolder}>
                    📂 浏览
                  </button>
                  <button className="btn btn-secondary" onClick={handleAddFolder}>
                    ➕ 添加
                  </button>
                </div>
              </div>

              {/* 控制按钮 */}
              <div className="settings-actions" style={{ gap: '8px', marginTop: '16px' }}>
                {!watcherStatus.running ? (
                  <button
                    className="btn btn-primary"
                    onClick={handleStartWatcher}
                    disabled={watcherStarting || watcherPaths.length === 0}
                  >
                    {watcherStarting ? '⏳ 启动中...' : '▶️ 启动监控（全部）'}
                  </button>
                ) : (
                  <button className="btn btn-danger" onClick={handleStopWatcher}>
                    ⏹️ 停止全部监控
                  </button>
                )}
                <button className="btn btn-ghost" onClick={loadWatcherStatus}>
                  🔄 刷新状态
                </button>
              </div>
            </div>

            {/* 监控文件列表 */}
            {watcherStatus.running && watcherFiles.length > 0 && (
              <div className="card">
                <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
                  📄 各目录最新文件（共50个）
                </h3>
                <div className="watcher-file-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {watcherFiles.map((f, i) => (
                    <div key={i} className="watcher-file-item" style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 0',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '0.8125rem'
                    }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>📄</span>
                      <span style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem' }}>
                          [{f.folderPath ? f.folderPath.split('\\').pop() || f.folderPath.split('/').pop() : '?'}]
                        </span>{' '}
                        {f.name}
                      </span>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                        {(f.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 数据管理 */}
        {activeTab === 'data' && (
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
        )}
      </div>

      {/* 导入弹窗 */}
      <Modal
        isOpen={showImportModal}
        onClose={() => { setShowImportModal(false); setImportFile(null); setImportError('') }}
        title="导入数据"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => { setShowImportModal(false); setImportFile(null) }}>
              取消
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={!importFile}>
              导入
            </button>
          </>
        }
      >
        <div className="settings-import-form">
          <div className="input-group">
            <label>选择 JSON 备份文件</label>
            <input type="file" accept=".json" onChange={handleImportFile} />
          </div>
          {importError && (
            <p className="settings-import-error">{importError}</p>
          )}
          {importFile && (
            <p className="settings-import-file">已选择: {importFile.name}</p>
          )}
        </div>
      </Modal>

      {/* 清除确认弹窗 */}
      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="确认清除所有数据"
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setShowClearModal(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={handleClearAll}>
              确认清除
            </button>
          </>
        }
      >
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>此操作将永久删除以下所有数据：</p>
          <ul style={{ marginTop: '12px', paddingLeft: '20px', listStyle: 'disc' }}>
            <li>{documents.length} 个文档</li>
            <li>{categories.length} 个自定义分类</li>
            <li>所有系统设置和编号规则</li>
          </ul>
          <p style={{ marginTop: '12px', color: 'var(--error)' }}>
            此操作不可撤销！建议先导出备份。
          </p>
        </div>
      </Modal>
    </div>
  )
}
