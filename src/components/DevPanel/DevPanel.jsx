/**
 * AI 调试面板
 * 快捷键: Ctrl+Shift+D
 * 显示队列状态、AI 服务状态、最近日志、reload 次数等调试信息
 */

import React, { useState, useEffect } from 'react'
import { useApp } from '../../services/AppContext'
import logger from '../../services/logger'
import taskQueueService from '../../services/taskQueueService'
import backgroundAnalysisService from '../../services/backgroundAnalysisService'
import { hasApiKey, isOllamaAvailable } from '../../services/aiService'
import './DevPanel.css'

export default function DevPanel({ isOpen, onClose }) {
  const { documents, reloadCountRef, showNotification } = useApp()
  const [status, setStatus] = useState({
    queue: { running: false, queueLength: 0, currentTask: null, registeredHandlers: [] },
    pendingCount: 0,
    ollamaAvailable: null, // null = 检测中
    hasApiKey: false,
    reloadCount: 0,
  })
  const [recentLogs, setRecentLogs] = useState([])

  useEffect(() => {
    if (!isOpen) return

    const refresh = async () => {
      // 队列状态
      const queueStatus = taskQueueService.getStatus()
      // Ollama 可用性
      let ollamaOk = null
      try { ollamaOk = await isOllamaAvailable() } catch(e) { /* ignore */ }
      // 最近日志
      const logs = logger.getRecent(20)

      setStatus({
        queue: queueStatus,
        pendingCount: backgroundAnalysisService._pendingIds?.size || 0,
        ollamaAvailable: ollamaOk,
        hasApiKey: hasApiKey(),
        reloadCount: reloadCountRef.current,
        docCount: documents.length,
      })
      setRecentLogs(logs)
    }
n    refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [isOpen, documents.length]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  return (
    <div className="dev-panel-overlay" onClick={onClose}>
      <div className="dev-panel" onClick={e => e.stopPropagation()}>
        {/* 头部 */}
        <div className="dev-panel-header">
          <span className="dev-panel-title">🔧 AI 调试面板</span>
          <div className="dev-panel-header-actions">
            <button
              className="dev-panel-btn"
              onClick={() => { logger.clear(); logger.info('日志已通过 DevPanel 清空'); showNotification('info', '日志已清空') }}
              title="清空日志"
            >
              🗑️ 清空日志
            </button>
            <button
              className="dev-panel-btn"
              onClick={async () => {
                try {
                  showNotification('info', '触发后台扫描中...')
                  await backgroundAnalysisService.scanNow()
                  showNotification('success', '后台扫描已触发，查看最日志以确认结果')
                } catch (e) {
                  console.error('[DevPanel] 触发扫描异常:', e)
                  showNotification('error', `触发扫描失败: ${e.message || e}`)
                }
              }}
              title="触发后台扫描"
            >
              ▶️ 触发扫描
            </button>
            <button className="dev-panel-btn dev-panel-close" onClick={onClose}>
              ✕
            </button>
          </div>
          <span className="dev-panel-hint">Ctrl+Shift+D 切换</span>
        </div>

        {/* 内容区 */}
        <div className="dev-panel-body">
          {/* 概览 */}
          <div className="dev-panel-section">
            <div className="dev-panel-section-title">📊 概览</div>
            <div className="dev-panel-stats">
              <div className="dev-panel-stat">
                <div className="dev-panel-stat-value">{status.docCount}</div>
                <div className="dev-panel-stat-label">文档总数</div>
              </div>
              <div className="dev-panel-stat">
                <div className="dev-panel-stat-value">{status.reloadCount}</div>
                <div className="dev-panel-stat-label">Reload 次数</div>
              </div>
              <div className="dev-panel-stat">
                <div className="dev-panel-stat-value">{status.queue.queueLength}</div>
                <div className="dev-panel-stat-label">队列中</div>
              </div>
              <div className="dev-panel-stat">
                <div className="dev-panel-stat-value">{status.pendingCount}</div>
                <div className="dev-panel-stat-label">Pending</div>
              </div>
            </div>
          </div>

          {/* AI 服务状态 */}
          <div className="dev-panel-section">
            <div className="dev-panel-section-title">🤖 AI 服务状态</div>
            <div className="dev-panel-status-list">
              <div className="dev-panel-status-item">
                <span className="dev-panel-status-label">Ollama</span>
                <span className={`dev-panel-status-dot ${status.ollamaAvailable === true ? 'green' : status.ollamaAvailable === false ? 'red' : 'gray'}`} />
                <span className="dev-panel-status-text">
                  {status.ollamaAvailable === null ? '检测中...' : status.ollamaAvailable ? '可用' : '不可用'}
                </span>
              </div>
              <div className="dev-panel-status-item">
                <span className="dev-panel-status-label">DeepSeek</span>
                <span className={`dev-panel-status-dot ${status.hasApiKey ? 'green' : 'red'}`} />
                <span className="dev-panel-status-text">
                  {status.hasApiKey ? '已配置 API Key' : '未配置'}
                </span>
              </div>
              <div className="dev-panel-status-item">
                <span className="dev-panel-status-label">当前任务</span>
                <span className="dev-panel-status-text" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {status.queue.currentTask
                    ? `${status.queue.currentTask.type}#${String(status.queue.currentTask.id).substring(0, 20)}`
                    : status.queue.running
                      ? '执行中…'
                      : '空闲'}
                </span>
              </div>
              <div className="dev-panel-status-item">
                <span className="dev-panel-status-label">已注册处理器</span>
                <span className="dev-panel-status-text" style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                  {status.queue.registeredHandlers.join(', ') || '无'}
                </span>
              </div>
              <div className="dev-panel-status-item">
                <span className="dev-panel-status-label">后台扫描</span>
                <span className={`dev-panel-status-dot ${backgroundAnalysisService._running ? 'green' : 'gray'}`} />
                <span className="dev-panel-status-text">
                  {backgroundAnalysisService._running ? '运行中' : '已停止'}
                </span>
              </div>
            </div>
          </div>

          {/* 最近日志 */}
          <div className="dev-panel-section">
            <div className="dev-panel-section-title">📜 最近日志 ({recentLogs.length})</div>
            <div className="dev-panel-logs">
              {recentLogs.map(log => (
                <div key={log.id} className={`dev-panel-log-line dev-panel-log-${log.level.toLowerCase()}`}>
                  <span className="dev-panel-log-time">{log.time}</span>
                  <span className="dev-panel-log-level" style={{ color: log.levelColor }}>
                    [{log.level}]
                  </span>
                  <span className="dev-panel-log-msg">{log.message}</span>
                  {log.data && (
                    <span className="dev-panel-log-data" title={log.data}>
                      {log.data.substring(0, 80)}{log.data.length > 80 ? '…' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
