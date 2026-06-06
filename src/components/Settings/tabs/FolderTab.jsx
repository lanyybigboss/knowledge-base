/**
 * 文件夹监控 Tab
 */
import React, { useState, useEffect, useRef } from 'react'
import watcherService from '../../../services/folderWatcherService'

export default function FolderTab() {
  const [watcherStatus, setWatcherStatus] = useState({ running: false, paths: [], pathsInfo: [], fileCount: 0, lastEvent: '' })
  const [watcherPaths, setWatcherPaths] = useState(() => {
    try { return JSON.parse(localStorage.getItem('watcher_paths') || '[]') } catch { return [] }
  })
  const [watcherNewPath, setWatcherNewPath] = useState('')
  const [watcherFiles, setWatcherFiles] = useState([])
  const [watcherStarting, setWatcherStarting] = useState(false)
  const stopPollRef = useRef(null)

  const loadWatcherStatus = async () => {
    try {
      const status = await watcherService.getStatus()
      setWatcherStatus(status)
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

  // 选择文件夹路径
  const handleSelectFolder = async () => {
    if (window.electronAPI && window.electronAPI.selectFolder) {
      const folderPath = await window.electronAPI.selectFolder()
      if (folderPath) {
        setWatcherNewPath(folderPath)
      }
      return
    }
    const fullPath = prompt('请输入要监控的文件夹路径（多文件夹就是多次添加）：', watcherNewPath || 'C:\\')
    if (fullPath) {
      setWatcherNewPath(fullPath)
    }
  }

  // 添加一个文件夹到监控列表
  const handleAddFolder = async () => {
    if (!watcherNewPath) {
      alert('请先输入或选择要监控的文件夹路径')
      return
    }
    if (watcherPaths.includes(watcherNewPath)) {
      alert('该文件夹已在监控列表中')
      return
    }
    const newPaths = [...watcherPaths, watcherNewPath]
    setWatcherPaths(newPaths)
    localStorage.setItem('watcher_paths', JSON.stringify(newPaths))
    setWatcherNewPath('')
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
    if (watcherStatus.running) {
      const result = await watcherService.removeFolder(folderPath)
      if (result.success) {
        setWatcherStatus(result.status)
      }
    }
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

  // 定时轮询监控状态
  useEffect(() => {
    loadWatcherStatus()
    stopPollRef.current = watcherService.pollStatus(setWatcherStatus, 2000)
    return () => {
      if (stopPollRef.current) {
        stopPollRef.current()
        stopPollRef.current = null
      }
    }
  }, [])

  return (
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
                  {(f.size != null ? (f.size / 1024).toFixed(1) : '?')} KB
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
