/**
 * IPC Handlers 模块（v1.7.x 拆分）
 * 注册所有渲染进程 <-> 主进程的 IPC 通信
 *
 * 依赖注入：调用方需在调用 registerIpcHandlers() 之前注入所需的引用 / 路径
 * 函数体内通过 deps 取值（getter 函数形式），避免循环引用
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const { execFile } = require('child_process')
const { app, ipcMain, dialog, shell } = require('electron')

/**
 * 注册所有 IPC handlers
 * @param {object} deps
 * @param {Function} deps.getStorageDirs - 返回 { storageDir, uploadsDir, configDir }
 * @param {Function} deps.getSyncFile - 返回 SYNC_FILE 路径
 * @param {Function} deps.getLogFile - 返回 LOG_FILE 路径
 * @param {Function} deps.getMainWindow - 返回 mainWindow（可能为 null）
 * @param {Function} deps.getAnalyzer - 返回 { ready, pid, process }
 * @param {Function} deps.getAnalyzerControl - 返回 { suspend, resume, analyze }
 * @param {object}   deps.storageIpcClient
 * @param {object}   deps.watcher - watcher 模块
 * @param {Function} deps.writeLogToFile
 * @param {Function} deps.createStrmFile
 */
function registerIpcHandlers(deps) {
  const _getStorageDirs = deps.getStorageDirs
  const _getSyncFile = deps.getSyncFile
  const _getLogFile = deps.getLogFile
  const _getMainWindow = deps.getMainWindow
  const _getAnalyzer = deps.getAnalyzer
  const _getAnalyzerControl = deps.getAnalyzerControl
  const _storageIpcClient = deps.storageIpcClient
  const _watcher = deps.watcher
  const _writeLogToFile = deps.writeLogToFile
  const _createStrmFile = deps.createStrmFile

  // ===== 工具函数 =====
  function getDirSize(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) return 0
      let total = 0
      const files = fs.readdirSync(dirPath)
      for (const f of files) {
        const fp = path.join(dirPath, f)
        const stat = fs.statSync(fp)
        if (stat.isFile()) total += stat.size
      }
      return total
    } catch (e) { return 0 }
  }

  function readStrmFile(strmFilePath) {
    try {
      if (!fs.existsSync(strmFilePath)) {
        return { success: false, error: '引用文件不存在' }
      }
      const originalPath = fs.readFileSync(strmFilePath, 'utf-8').trim()
      if (!originalPath) {
        return { success: false, error: '引用文件内容为空' }
      }
      return { success: true, originalPath }
    } catch (e) {
      return { success: false, error: e.message }
    }
  }

  function resolveStrmPath(filePath) {
    if (filePath && filePath.toLowerCase().endsWith('.strm')) {
      const result = readStrmFile(filePath)
      if (result.success && result.originalPath) {
        return result.originalPath
      }
    }
    return filePath
  }

  function isPathAllowed(filePath) {
    const { storageDir } = _getStorageDirs()
    const resolved = path.resolve(filePath)
    if (resolved.startsWith(path.resolve(storageDir))) return true
    for (const watchedPath of _watcher.getWatchedPaths()) {
      if (resolved.startsWith(path.resolve(watchedPath))) return true
    }
    return false
  }

  // ===== 基础 IPC =====
  ipcMain.handle('get-storage-info', () => {
    const { storageDir, uploadsDir, configDir } = _getStorageDirs()
    return {
      storageDir,
      uploadsDir,
      configDir,
      totalSize: getDirSize(uploadsDir)
    }
  })

  ipcMain.handle('open-folder', (_, folderPath) => {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: '文件夹不存在' }
    }
    shell.openPath(folderPath)
  })

  ipcMain.handle('open-file', (_, filePath) => {
    const resolvedPath = resolveStrmPath(filePath)
    const dangerousExts = ['.exe', '.bat', '.cmd', '.ps1', '.msi', '.com', '.scr', '.vbs', '.js', '.wsf']
    const ext = path.extname(resolvedPath).toLowerCase()
    if (dangerousExts.includes(ext)) {
      return { success: false, error: '安全限制：不允许打开可执行文件' }
    }
    if (fs.existsSync(resolvedPath)) {
      shell.openPath(resolvedPath)
      return { success: true, filePath: resolvedPath }
    }
    return { success: false, error: '文件不存在' }
  })

  ipcMain.handle('locate-file', (_, filePath) => {
    const resolvedPath = resolveStrmPath(filePath)
    if (!isPathAllowed(resolvedPath)) {
      return { success: false, error: '无权访问该路径' }
    }
    if (fs.existsSync(resolvedPath)) {
      shell.showItemInFolder(resolvedPath)
      return { success: true, filePath: resolvedPath }
    }
    return { success: false, error: '文件不存在' }
  })

  // ===== Strm 引用文件 IPC =====
  ipcMain.handle('save-strm-file', (_, { strmFileName, originalFilePath }) => {
    return _createStrmFile(originalFilePath, strmFileName)
  })

  ipcMain.handle('read-strm-file', (_, strmFilePath) => {
    if (!isPathAllowed(strmFilePath)) {
      return { success: false, error: '无权访问该路径' }
    }
    return readStrmFile(strmFilePath)
  })

  ipcMain.handle('delete-strm-file', (_, strmFilePath) => {
    try {
      if (!isPathAllowed(strmFilePath)) {
        return { success: false, error: '无权访问该路径' }
      }
      if (fs.existsSync(strmFilePath)) {
        fs.unlinkSync(strmFilePath)
        return { success: true }
      }
      return { success: false, error: '引用文件不存在' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ===== 文件对话框 / 上传 =====
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  ipcMain.handle('save-upload-file', async (_, { fileName, content, isBase64 }) => {
    try {
      const { uploadsDir } = _getStorageDirs()
      const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_')
      const filePath = path.join(uploadsDir, safeFileName)
      if (isBase64) {
        fs.writeFileSync(filePath, Buffer.from(content, 'base64'))
      } else {
        fs.writeFileSync(filePath, content || '', 'utf-8')
      }
      return { success: true, filePath, fileName: safeFileName }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ===== 文件夹监控 IPC =====
  ipcMain.handle('watcher-start', async (_, data) => {
    try {
      const paths = Array.isArray(data) ? data : (data && data.paths ? data.paths : (data ? [data] : []))
      if (paths.length === 0) {
        return { success: false, error: '请提供要监控的文件夹路径' }
      }
      for (const p of paths) {
        if (p && !fs.existsSync(p)) {
          return { success: false, error: `路径不存在: ${p}` }
        }
      }
      await _watcher.startAllWatchers(paths)
      return { success: true, status: _watcher.getCombinedWatcherStatus() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-stop', async () => {
    await _watcher.stopAllWatchers()
    return { success: true, status: _watcher.getCombinedWatcherStatus() }
  })

  ipcMain.handle('watcher-add', async (_, folderPath) => {
    try {
      if (!folderPath || !fs.existsSync(folderPath)) {
        return { success: false, error: '路径不存在' }
      }
      const ok = await _watcher.startFileWatcher(folderPath)
      if (ok) {
        const savedState = _watcher.loadWatcherState()
        const paths = [...new Set([...(savedState.paths || []), folderPath])]
        _watcher.saveWatcherState({ paths, autoStart: true })
      }
      return { success: ok, status: _watcher.getCombinedWatcherStatus() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-remove', async (_, folderPath) => {
    try {
      await _watcher.stopFileWatcher(folderPath)
      const savedState = _watcher.loadWatcherState()
      const paths = (savedState.paths || []).filter(p => p !== folderPath)
      _watcher.saveWatcherState({ paths, autoStart: paths.length > 0 })
      return { success: true, status: _watcher.getCombinedWatcherStatus() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-status', () => _watcher.getCombinedWatcherStatus())

  ipcMain.handle('watcher-files', () => {
    try {
      const allPaths = _watcher.getWatchedPaths()
      if (allPaths.length === 0) {
        return { success: false, files: [], error: '未设置监控目录' }
      }
      let allFiles = []
      for (const folderPath of allPaths) {
        if (!fs.existsSync(folderPath)) continue
        try {
          const files = fs.readdirSync(folderPath)
            .filter(f => fs.statSync(path.join(folderPath, f)).isFile())
            .map(f => ({
              name: f,
              folderPath,
              size: fs.statSync(path.join(folderPath, f)).size,
              modifiedAt: fs.statSync(path.join(folderPath, f)).mtime
            }))
          allFiles = allFiles.concat(files)
        } catch (e) { /* ignore */ }
      }
      allFiles.sort((a, b) => b.modifiedAt - a.modifiedAt)
      allFiles = allFiles.slice(0, 50)
      return { success: true, files: allFiles, total: allFiles.length }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-pending-files', () => {
    const pending = _watcher.getPendingStrmFiles()
    return { success: true, files: pending }
  })

  ipcMain.handle('watcher-mark-processed', (_, strmFileName) => {
    return _watcher.markStrmProcessed(strmFileName)
  })

  // ===== 读取文件（带权限） =====
  ipcMain.handle('read-raw-file', (_, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }
      if (!isPathAllowed(filePath)) {
        return { success: false, error: '无权访问该路径' }
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        return { success: false, error: '路径不是文件' }
      }
      const buffer = fs.readFileSync(filePath)
      const base64 = buffer.toString('base64')
      const ext = path.extname(filePath).toLowerCase()
      return {
        success: true,
        content: base64,
        fileName: path.basename(filePath),
        fileSize: stat.size,
        mimeType: ext === '.pdf' ? 'application/pdf' :
                 ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
                 ext === '.doc' ? 'application/msword' :
                 ext === '.xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' :
                 ext === '.xls' ? 'application/vnd.ms-excel' :
                 ext.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i) ? 'image/' + ext.replace('.', '') :
                 'application/octet-stream'
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ===== 开机自启动 IPC =====
  ipcMain.handle('get-auto-start', () => {
    if (!app.isPackaged && process.platform === 'win32') {
      try {
        const regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
        const { execSync } = require('child_process')
        const result = execSync(
          `powershell -Command "(Get-ItemProperty -Path '${regPath}' -Name 'KnowledgeBaseApp' -ErrorAction SilentlyContinue).KnowledgeBaseApp"`,
          { encoding: 'utf8', timeout: 5000 }
        ).trim()
        const enabled = result.length > 0
        console.log(`[开机自启] dev模式 Registry读取: enabled=${enabled}`)
        return { enabled, silentStart: true, devMode: true }
      } catch {
        return { enabled: false, silentStart: true, devMode: true }
      }
    }
    const settings = app.getLoginItemSettings()
    console.log(`[开机自启] 读取状态: openAtLogin=${settings.openAtLogin}, execPath=${process.execPath}`)
    return { enabled: settings.openAtLogin, silentStart: true }
  })

  ipcMain.handle('set-auto-start', async (_, enabled) => {
    const exePath = process.execPath
    const isPackaged = app.isPackaged
    console.log(`[开机自启] 设置请求: enabled=${enabled}, exePath=${exePath}, isPackaged=${isPackaged}`)

    try {
      const loginArgs = isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: exePath,
        args: loginArgs
      })

      if (process.platform === 'win32') {
        const regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
        const appName = 'KnowledgeBaseApp'

        const psSpecialChars = /[;|&`$(){}[\]<>!"\n\r]/
        if (psSpecialChars.test(exePath) || psSpecialChars.test(app.getAppPath())) {
          console.warn('[开机自启] 路径包含特殊字符，跳过 Registry 写入')
          const settings = app.getLoginItemSettings()
          return { success: true, enabled: settings.openAtLogin, requested: enabled }
        }

        await new Promise((resolve) => {
          if (enabled) {
            const data = isPackaged
              ? `"${exePath}" --hidden`
              : `"${exePath}" "${app.getAppPath()}" --hidden`
            const escapedData = data.replace(/'/g, "''")
            const ps = `New-ItemProperty -Path '${regPath}' -Name '${appName}' -Value '${escapedData}' -PropertyType String -Force`
            execFile('powershell', ['-Command', ps], { encoding: 'utf8' }, (err) => {
              if (err) console.error('[开机自启] Registry 写入失败:', err.message)
              else console.log('[开机自启] Registry 写入成功')
              resolve()
            })
          } else {
            const ps = `Remove-ItemProperty -Path '${regPath}' -Name '${appName}' -ErrorAction SilentlyContinue`
            execFile('powershell', ['-Command', ps], { encoding: 'utf8' }, (err) => {
              if (err) console.warn('[开机自启] Registry 删除:', err.message)
              else console.log('[开机自启] Registry 删除成功')
              resolve()
            })
          }
        })
      }

      if (!isPackaged && process.platform === 'win32') {
        console.log(`[开机自启] dev模式: 跳过 getLoginItemSettings，返回请求值 enabled=${enabled}`)
        return { success: true, enabled: enabled, requested: enabled, devMode: true }
      }
      const settings = app.getLoginItemSettings()
      console.log(`[开机自启] 验证: openAtLogin=${settings.openAtLogin}, 请求=${enabled}`)
      return { success: true, enabled: settings.openAtLogin, requested: enabled }
    } catch (err) {
      console.error('[开机自启] 设置失败:', err)
      return { success: false, enabled: false, error: err.message }
    }
  })

  // ===== 跨模式数据同步 =====
  ipcMain.handle('sync-write', async (_, data) => {
    try {
      fs.writeFileSync(_getSyncFile(), JSON.stringify(data, null, 2), 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('sync-read', () => {
    try {
      const file = _getSyncFile()
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, 'utf-8')
        const data = JSON.parse(content)
        return { success: true, data }
      }
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('sync-timestamp', () => {
    try {
      const file = _getSyncFile()
      if (fs.existsSync(file)) {
        const stat = fs.statSync(file)
        return { success: true, timestamp: stat.mtime.toISOString() }
      }
      return { success: true, timestamp: null }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ===== 渲染进程日志转发到 app.log =====
  ipcMain.on('renderer-log', (_, entry) => {
    if (!entry) return
    const prefix = `[Renderer]`
    const dataStr = entry.data ? ` | ${entry.data}` : ''
    _writeLogToFile(entry.level || 'INFO', `${prefix} ${entry.message}${dataStr}`)
  })

  // ===== 调试接口 IPC =====
  ipcMain.handle('debug-get-status', () => {
    try {
      const { storageDir, uploadsDir } = _getStorageDirs()
      const analyzer = _getAnalyzer()
      return {
        success: true,
        data: {
          electron: {
            pid: process.pid,
            version: app.getVersion(),
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            uptime: Math.round(process.uptime())
          },
          analyzer: {
            ready: analyzer.ready,
            pid: analyzer.pid
          },
          watcher: _watcher.getCombinedWatcherStatus(),
          storage: {
            storageDir,
            uploadsDir,
            totalSize: getDirSize(uploadsDir)
          },
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        }
      }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('debug-get-logs', (_, lines) => {
    try {
      const count = Math.min(parseInt(lines) || 100, 1000)
      const logFile = _getLogFile()
      let logs = []
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf-8')
        const allLines = content.split('\n').filter(l => l.trim())
        logs = allLines.slice(-count)
      }
      return { success: true, data: { logs, count: logs.length, totalLines: logs.length } }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('debug-suspend', () => {
    try {
      const analyzer = _getAnalyzer()
      if (analyzer.ready) {
        _getAnalyzerControl().suspend()
        return { success: true, message: '分析子进程已挂起' }
      }
      return { success: false, message: '分析子进程未运行' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('debug-resume', () => {
    try {
      const analyzer = _getAnalyzer()
      if (analyzer.ready) {
        _getAnalyzerControl().resume()
        return { success: true, message: '分析子进程已恢复' }
      }
      return { success: false, message: '分析子进程未运行' }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('debug-manual-analyze', async (_, docId) => {
    try {
      const analyzer = _getAnalyzer()
      if (!analyzer.ready) {
        return { success: false, error: '分析子进程未就绪' }
      }
      if (!docId || typeof docId !== 'string') {
        return { success: false, error: 'docId 必填且为字符串' }
      }
      let doc = null
      const mainWindow = _getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        doc = await _storageIpcClient.getDocument(docId)
      }
      if (!doc) {
        return { success: false, error: `文档不存在: ${docId}` }
      }
      if (!doc.filePath) {
        return { success: false, error: `文档无 filePath 字段: ${docId}` }
      }
      if (!fs.existsSync(doc.filePath)) {
        return { success: false, error: `文件不存在: ${doc.filePath}` }
      }
      _getAnalyzerControl().analyze({
        id: docId,
        filePath: doc.filePath,
        fileName: doc.fileName || doc.title,
        fileType: doc.fileType,
        title: doc.title
      })
      return { success: true, message: `已触发分析: ${docId} → ${doc.filePath}` }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('debug-health-check', async () => {
    const analyzer = _getAnalyzer()
    const watchedPaths = _watcher.getWatchedPaths()
    const checks = {
      electron: { ok: true, info: '运行中' },
      analyzer: { ok: analyzer.ready, info: analyzer.ready ? '就绪' : '未就绪' },
      watcher: { ok: watchedPaths.length > 0, info: `${watchedPaths.length} 个监控` },
      ollama: { ok: false, info: '未检测' }
    }
    try {
      const result = await new Promise((resolve) => {
        const req = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, (res) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => resolve({ ok: res.statusCode === 200, data }))
        })
        req.on('error', () => resolve({ ok: false, error: '连接失败' }))
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: '超时' }) })
      })
      checks.ollama = { ok: result.ok, info: result.ok ? '运行中' : (result.error || '不可用') }
    } catch (e) {
      checks.ollama = { ok: false, info: e.message }
    }
    const allOk = Object.values(checks).every(c => c.ok)
    return { success: true, data: { healthy: allOk, checks, timestamp: new Date().toISOString() } }
  })
}

module.exports = { registerIpcHandlers }
