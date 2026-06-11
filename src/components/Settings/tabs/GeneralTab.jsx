/**
 * 通用设置 Tab
 */
import React, { useState, useEffect } from 'react'
import logger from '../../../services/logger'

export default function GeneralTab({ settings, updateSettings }) {
  const [autoStartEnabled, setAutoStartEnabled] = useState(false)
  const [autoStartLoading, setAutoStartLoading] = useState(false)

  useEffect(() => {
    logger.info('[AutoStart] 环境检测:', {
      hasElectronAPI: !!window.electronAPI,
      hasGetAutoStart: !!(window.electronAPI && window.electronAPI.getAutoStart)
    })
    if (window.electronAPI && window.electronAPI.getAutoStart) {
      window.electronAPI.getAutoStart().then(res => {
        logger.info('[AutoStart] 获取状态成功:', res)
        setAutoStartEnabled(!!res.enabled)
      }).catch(err => {
        logger.error('[AutoStart] 获取状态失败:', err)
      })
    } else {
      logger.warn('[AutoStart] window.electronAPI 不可用，当前为非 Electron 环境或 preload 未加载')
    }
  }, [])

  const handleToggleAutoStart = async () => {
    const hasAPI = !!(window.electronAPI && window.electronAPI.setAutoStart)
    logger.info('[AutoStart] click, electronAPI:', !!window.electronAPI, 'setAutoStart:', hasAPI)
    if (!hasAPI) {
      alert('开机自启动功能仅在桌面应用模式下可用')
      return
    }
    setAutoStartLoading(true)
    try {
      const newState = !autoStartEnabled
      logger.info('[AutoStart] 准备切换:', { current: autoStartEnabled, new: newState })
      const result = await window.electronAPI.setAutoStart(newState)
      logger.info('[AutoStart] 切换结果:', result)
      if (result.success) {
        setAutoStartEnabled(result.enabled)
      } else {
        alert('开机自启设置失败，请检查系统权限或杀毒软件拦截')
      }
    } catch (err) {
      logger.error('[AutoStart] 切换异常:', err)
      alert(`开机自启设置失败：${err.message || '未知错误'}`)
    } finally {
      setAutoStartLoading(false)
    }
  }

  return (
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
  )
}
