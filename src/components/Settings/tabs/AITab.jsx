/**
 * AI 设置 Tab
 */
import React, { useState, useEffect } from 'react'
import { saveApiKey, isOllamaAvailable, saveMimoApiKey } from '../../../services/aiService'
import storageService from '../../../services/storageService'
import logger from '../../../services/logger'

export default function AITab() {
  const [aiApiKey, setAiApiKey] = useState(() => {
    return localStorage.getItem('deepseek_api_key') || ''
  })
  const [mimoKey, setMimoKey] = useState(() => {
    return localStorage.getItem('mimo_api_key') || ''
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [showMimoKey, setShowMimoKey] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSaveMsg, setAiSaveMsg] = useState('')
  const [mimoSaving, setMimoSaving] = useState(false)
  const [mimoSaveMsg, setMimoSaveMsg] = useState('')
  const [ollamaStatus, setOllamaStatus] = useState({ checking: true, available: false, model: '' })
  const [ollamaTesting, setOllamaTesting] = useState(false)
  const [deepseekTesting, setDeepseekTesting] = useState(false)
  const [deepseekTestResult, setDeepseekTestResult] = useState('')
  const [mimoTesting, setMimoTesting] = useState(false)
  const [mimoTestResult, setMimoTestResult] = useState('')

  // AI 分析管理
  const [failedCount, setFailedCount] = useState(0)
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  const checkOllamaStatus = async () => {
    setOllamaTesting(true)
    setOllamaStatus(prev => ({ ...prev, checking: true }))
    try {
      const available = await isOllamaAvailable()
      setOllamaStatus({ checking: false, available, model: 'qwen3:8b' })
    } catch {
      setOllamaStatus({ checking: false, available: false, model: '' })
    }
    setOllamaTesting(false)
  }

  // 初始化时检测 Ollama 状态
  useEffect(() => {
    checkOllamaStatus()
  }, [])

  // AI 分析管理：检查失败文档数量
  useEffect(() => {
    const checkFailedCount = async () => {
      try {
        const allDocs = await storageService.getDocuments()
        const failedDocs = allDocs.filter(doc =>
          !doc.aiAnalyzed &&
          (doc._aiRetryCount >= 3 || doc._aiRetryCount === 99)
        )
        setFailedCount(failedDocs.length)
      } catch (err) {
        logger.error('[Settings] 检查失败文档数量失败:', err)
      }
    }
    checkFailedCount()
  }, [resetMsg])

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

  const handleSaveMimoKey = () => {
    setMimoSaving(true)
    setMimoSaveMsg('')
    try {
      const trimmedKey = mimoKey.trim()
      if (trimmedKey && trimmedKey.length < 10) {
        setMimoSaveMsg('MiMo API Key 似乎不完整，请检查后重试')
        setMimoSaving(false)
        return
      }
      saveMimoApiKey(trimmedKey)
      setMimoSaveMsg(trimmedKey ? 'MiMo Token Plan Key 已保存' : 'MiMo API Key 已清空')
      setMimoKey(trimmedKey)
    } catch (e) {
      setMimoSaveMsg('保存失败：' + (e.message || '未知错误'))
    }
    setMimoSaving(false)
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

  const handleTestMimo = async () => {
    const key = mimoKey.trim()
    if (!key || key.length < 10) {
      setMimoTestResult('请先输入有效的 MiMo API Key')
      return
    }
    setMimoTesting(true)
    setMimoTestResult('')
    try {
      const response = await fetch('https://token-plan-cn.xiaomimimo.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: 'mimo-v2-flash',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (response.ok) {
        setMimoTestResult('连接成功！MiMo Token Plan 工作正常')
      } else {
        const errData = await response.json().catch(() => ({}))
        setMimoTestResult(`连接失败：${errData.error?.message || errData.message || `HTTP ${response.status}`}`)
      }
    } catch (e) {
      setMimoTestResult(`测试失败：${e.message || '网络错误'}`)
    }
    setMimoTesting(false)
  }

  // AI 分析管理：重置所有失败文档
  const handleResetAllFailed = async () => {
    if (!window.confirm(`确定要重置 ${failedCount} 个失败文档的 AI 分析状态吗？\n\n重置后，这些文档将在下次扫描时重新尝试 AI 分析。`)) {
      return
    }

    setResetting(true)
    setResetMsg('')
    try {
      const count = await storageService.resetAllFailedAiAnalysis()
      setResetMsg(`✅ 已重置 ${count} 个文档的 AI 分析状态，将在下次扫描时重新分析`)
      // 触发后台扫描
      if (window.electronAPI && window.electronAPI.triggerScan) {
        window.electronAPI.triggerScan()
      }
    } catch (err) {
      logger.error('[Settings] 重置失败文档失败:', err)
      setResetMsg(`❌ 重置失败：${err.message || '未知错误'}`)
    }
    setResetting(false)
  }

  return (
    <div className="settings-section">
      {/* MiMo Token Plan API Key */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          🌟 MiMo Token Plan
        </h3>
        <p className="settings-description">
          小米 MiMo 大模型 Token Plan 订阅，兼容 OpenAI 格式。Ollama 不可用时自动降级调用。
          请前往
          <a href="https://platform.xiaomimimo.com" target="_blank" rel="noopener noreferrer"
             style={{ color: 'var(--primary)', margin: '0 4px' }}>
            MiMo 开放平台
          </a>
          获取 API Key。
        </p>

        <div className="settings-form" style={{ maxWidth: '100%' }}>
          <div className="input-group">
            <label>API Key</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type={showMimoKey ? 'text' : 'password'}
                value={mimoKey}
                onChange={e => {
                  setMimoKey(e.target.value)
                  setMimoSaveMsg('')
                }}
                placeholder="输入 MiMo Token Plan API Key"
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-ghost"
                onClick={() => setShowMimoKey(!showMimoKey)}
                style={{ padding: '0 12px', fontSize: '0.8125rem' }}
                title={showMimoKey ? '隐藏 Key' : '显示 Key'}
              >
                {showMimoKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div className="settings-actions">
            <button
              className="btn btn-primary"
              onClick={handleSaveMimoKey}
              disabled={mimoSaving}
            >
              {mimoSaving ? '⏳ 保存中...' : '💾 保存 Key'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleTestMimo}
              disabled={mimoTesting}
            >
              {mimoTesting ? '⏳ 测试中...' : '🔗 测试连接'}
            </button>
          </div>

          {mimoSaveMsg && (
            <p style={{
              fontSize: '0.8125rem',
              color: mimoSaveMsg.includes('失败') || mimoSaveMsg.includes('不完整') ? 'var(--error)' : 'var(--success)',
              marginTop: '8px'
            }}>
              {mimoSaveMsg}
            </p>
          )}
          {mimoTestResult && (
            <p style={{
              fontSize: '0.8125rem',
              color: mimoTestResult.includes('成功') ? '#059669' : 'var(--error)',
              marginTop: '8px'
            }}>
              {mimoTestResult}
            </p>
          )}
        </div>
      </div>

      {/* DeepSeek API Key */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          DeepSeek API 配置
        </h3>
        <p className="settings-description">
          DeepSeek 作为云端 AI 后备方案。请前往
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
          Ollama 本地大模型优先调用，免费且无网络依赖。
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
        <div className="ai-strategy-list">
          <div className="ai-strategy-item">
            <span className="ai-strategy-num">1</span>
            <div>
              <strong>优先：Ollama 本地模型</strong>
              <p>免费、无网络依赖、隐私安全。</p>
            </div>
          </div>
          <div className="ai-strategy-item">
            <span className="ai-strategy-num">2</span>
            <div>
              <strong>备选：MiMo Token Plan</strong>
              <p>小米 MiMo 大模型订阅，兼容 OpenAI 格式，性价比高。</p>
            </div>
          </div>
          <div className="ai-strategy-item">
            <span className="ai-strategy-num">3</span>
            <div>
              <strong>备选：DeepSeek API</strong>
              <p>云端 DeepSeek API，需要配置有效 API Key。</p>
            </div>
          </div>
          <div className="ai-strategy-item">
            <span className="ai-strategy-num">4</span>
            <div>
              <strong>兜底：自动分类</strong>
              <p>所有 AI 服务均失败时，文档归入&quot;其他&quot;分类，支持手动编辑。</p>
            </div>
          </div>
        </div>
      </div>

      {/* AI 分析管理 */}
      <div className="card">
        <h3 className="card-title" style={{ marginBottom: 'var(--space-lg)' }}>
          AI 分析管理
        </h3>
        <p className="settings-description">
          管理 AI 分析失败的文档。重置后，这些文档将在下次扫描时重新尝试 AI 分析。
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: 'var(--space-lg)' }}>
          <button
            className="btn btn-warning"
            onClick={handleResetAllFailed}
            disabled={resetting || failedCount === 0}
            style={{ minWidth: '140px' }}
          >
            {resetting ? '⏳ 重置中...' : `🔄 重试所有失败文档 (${failedCount})`}
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
            {failedCount === 0 ? '当前没有失败文档' : `将重置 ${failedCount} 个失败文档的 AI 分析状态`}
          </span>
        </div>

        {resetMsg && (
          <p style={{
            fontSize: '0.8125rem',
            color: resetMsg.includes('✅') ? '#059669' : 'var(--error)',
            marginTop: '8px'
          }}>
            {resetMsg}
          </p>
        )}
      </div>
    </div>
  )
}
