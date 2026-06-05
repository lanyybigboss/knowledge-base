/**
 * IPC 处理器模块
 * 注册所有渲染进程 ↔ 主进程的 IPC 通信处理
 */

const { ipcMain, dialog, shell, app } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const storage = require('./storage')
const { createStrmFile, readStrmFile, resolveStrmPath } = require('./strmFile')
const watcher = require('./watcher')
const analyzer = require('./analyzerManager')

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

function registerIpcHandlers(mainWindow) {
  const uploadsDir = storage.getUploadsDir()

  // ===== 存储信息 =====
  ipcMain.handle('get-storage-info', () => ({
    storageDir: storage.getStorageDir(),
    uploadsDir,
    configDir: storage.getConfigDir(),
    totalSize: getDirSize(uploadsDir)
  }))

  // ===== 文件操作 =====
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
    if (!watcher.isPathAllowed(resolvedPath, storage.getStorageDir())) {
      return { success: false, error: '无权访问该路径' }
    }
    if (fs.existsSync(resolvedPath)) {
      shell.showItemInFolder(resolvedPath)
      return { success: true, filePath: resolvedPath }
    }
    return { success: false, error: '文件不存在' }
  })

  // ===== Strm 引用文件 =====
  ipcMain.handle('save-strm-file', (_, { strmFileName, originalFilePath }) => {
    return createStrmFile(originalFilePath, strmFileName, uploadsDir)
  })

  ipcMain.handle('read-strm-file', (_, strmFilePath) => {
    if (!watcher.isPathAllowed(strmFilePath, storage.getStorageDir())) {
      return { success: false, error: '无权访问该路径' }
    }
    return readStrmFile(strmFilePath)
  })

  ipcMain.handle('delete-strm-file', (_, strmFilePath) => {
    try {
      if (!watcher.isPathAllowed(strmFilePath, storage.getStorageDir())) {
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

  // ===== 对话框 =====
  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    }
    return null
  })

  // ===== 文件上传 =====
  ipcMain.handle('save-upload-file', async (_, { fileName, content, isBase64 }) => {
    try {
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

  // ===== 文件夹监控 =====
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
      await watcher.startAllWatchers(paths, mainWindow)
      return { success: true, status: watcher.getCombinedWatcherStatus() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-stop', async () => {
    await watcher.stopAllWatchers()
    return { success: true, status: watcher.getCombinedWatcherStatus() }
  })

  ipcMain.handle('watcher-add', async (_, folderPath) => {
    try {
      if (!folderPath || !fs.existsSync(folderPath)) {
        return { success: false, error: '路径不存在' }
      }
      const ok = await watcher.startFileWatcher(folderPath, mainWindow)
      if (ok) {
        const savedState = watcher.loadWatcherState()
        const paths = [...new Set([...(savedState.paths || []), folderPath])]
        watcher.saveWatcherState({ paths, autoStart: true })
      }
      return { success: ok, status: watcher.getCombinedWatcherStatus() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-remove', async (_, folderPath) => {
    try {
      await watcher.stopFileWatcher(folderPath)
      const savedState = watcher.loadWatcherState()
      const paths = (savedState.paths || []).filter(p => p !== folderPath)
      watcher.saveWatcherState({ paths, autoStart: paths.length > 0 })
      return { success: true, status: watcher.getCombinedWatcherStatus() }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('watcher-status', () => watcher.getCombinedWatcherStatus())

  ipcMain.handle('watcher-files', () => {
    try {
      // 通过 getCombinedWatcherStatus 获取当前监控路径
      const status = watcher.getCombinedWatcherStatus()
      const allPaths2 = status.paths || []
      if (allPaths2.length === 0) {
        return { success: false, files: [], error: '未设置监控目录' }
      }
      let allFiles = []
      for (const folderPath of allPaths2) {
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
    const pending = watcher.getPendingStrmFiles().filter(p => !p.processed)
    return { success: true, files: pending }
  })

  ipcMain.handle('watcher-mark-processed', (_, strmFileName) => {
    const pending = watcher.getPendingStrmFiles()
    const item = pending.find(p => p.strmFileName === strmFileName && !p.processed)
    if (item) {
      item.processed = true
      item.processedAt = new Date().toISOString()
      return { success: true }
    }
    return { success: false, error: '未找到待处理项' }
  })

  // ===== 文件读取 =====
  ipcMain.handle('read-raw-file', (_, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在' }
      }
      if (!watcher.isPathAllowed(filePath, storage.getStorageDir())) {
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

  // ===== 开机自启动 =====
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
  const syncFile = storage.getSyncFile()

  ipcMain.handle('sync-write', async (_, data) => {
    try {
      fs.writeFileSync(syncFile, JSON.stringify(data, null, 2), 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('sync-read', () => {
    try {
      if (fs.existsSync(syncFile)) {
        const content = fs.readFileSync(syncFile, 'utf-8')
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
      if (fs.existsSync(syncFile)) {
        const stat = fs.statSync(syncFile)
        return { success: true, timestamp: stat.mtime.toISOString() }
      }
      return { success: true, timestamp: null }
    } catch (e) {
      return { success: false, error: e.message }
    }
  })

  // ===== 分析子进程 =====
  ipcMain.handle('analyzer-analyze', (_, data) => {
    if (!analyzer.isAnalyzerReady()) {
      return { success: false, error: '分析子进程未就绪' }
    }
    analyzer.sendToAnalyzer({ type: 'analyze', ...data })
    return { success: true }
  })

  ipcMain.handle('analyzer-status', () => ({
    ready: analyzer.isAnalyzerReady(),
    pid: null
  }))
}

module.exports = { registerIpcHandlers }
