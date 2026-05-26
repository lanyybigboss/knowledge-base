/**
 * Electron 主进程 - 知识库管理系统桌面应用入口
 * v2.0 - 修复空白页问题
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { exec, spawn } = require('child_process')

// ===== 存储目录配置 =====
const STORAGE_DIR = process.env.KB_STORAGE_DIR
  ? path.resolve(process.env.KB_STORAGE_DIR)
  : path.join(app.getPath('exe'), '..', 'data')

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true })
}

const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads')
const CONFIG_DIR = path.join(STORAGE_DIR, 'config')

;[UPLOADS_DIR, CONFIG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
})

const WATCHER_STATE_FILE = path.join(CONFIG_DIR, 'watcher-state.json')

console.log(`[知识库] 数据存储目录: ${STORAGE_DIR}`)
process.env.KB_STORAGE_DIR = STORAGE_DIR
process.env.KB_UPLOADS_DIR = UPLOADS_DIR

// ===== 瓦特（watcher）状态管理（多文件夹支持） =====
let watcherMap = {}        // { [folderPath]: chokidar instance }
let watcherStatusMap = {}  // { [folderPath]: { running, fileCount, lastEvent } }
let pendingStrmFiles = []  // 待处理的 Strm 文件队列（全局共享）

function loadWatcherState() {
  try {
    if (fs.existsSync(WATCHER_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(WATCHER_STATE_FILE, 'utf-8'))
    }
  } catch (e) { /* ignore */ }
  return { paths: [], autoStart: false }
}

function saveWatcherState(state) {
  try {
    fs.writeFileSync(WATCHER_STATE_FILE, JSON.stringify(state, null, 2))
  } catch (e) { /* ignore */ }
}

/**
 * 获取合并后的监控状态
 */
function getCombinedWatcherStatus() {
  const paths = Object.keys(watcherMap)
  const allPaths = [...new Set([...paths, ...Object.keys(watcherStatusMap)])]
  let totalFiles = 0
  const lastEvents = []
  for (const p of allPaths) {
    const s = watcherStatusMap[p]
    if (s) {
      totalFiles += s.fileCount || 0
      if (s.lastEvent) lastEvents.push(`${path.basename(p)}: ${s.lastEvent}`)
    }
  }
  return {
    running: paths.length > 0,
    paths: allPaths,
    pathsInfo: allPaths.map(p => ({
      path: p,
      ...(watcherStatusMap[p] || { running: false, fileCount: 0, lastEvent: '' })
    })),
    fileCount: totalFiles,
    lastEvent: lastEvents.join('; ') || (paths.length > 0 ? '监控运行中' : '已停止')
  }
}

/**
 * 启动监控单个文件夹
 */
async function startFileWatcher(folderPath) {
  if (watcherMap[folderPath]) return true
  if (!folderPath || !fs.existsSync(folderPath)) {
    watcherStatusMap[folderPath] = { running: false, fileCount: 0, lastEvent: '路径不存在' }
    return false
  }
  try {
    const chokidar = await import('chokidar')
    let initialCount = 0
    try {
      initialCount = fs.readdirSync(folderPath).filter(f => {
        return fs.statSync(path.join(folderPath, f)).isFile()
      }).length
    } catch (e) { /* ignore */ }
    const instance = chokidar.default.watch(folderPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
    })
    watcherMap[folderPath] = instance
    watcherStatusMap[folderPath] = { running: true, fileCount: initialCount, lastEvent: '监控已启动' }

    instance.on('add', async (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) {
        status.lastEvent = `新增: ${fileName}`
        status.fileCount++
      }
      // 自动创建 .strm 引用
      let strmFilePath = ''
      try {
        const strmResult = createStrmFile(filePath, fileName)
        if (strmResult.success) {
          strmFilePath = strmResult.filePath
          console.log(`[文件夹监控] 已自动创建引用: ${fileName} → ${strmResult.filePath}`)
        }
      } catch (e) {
        console.error(`[文件夹监控] 创建引用失败 ${fileName}:`, e.message)
      }
      // 加入待处理队列
      if (strmFilePath) {
        const strmFileName = path.basename(strmFilePath)
        pendingStrmFiles.push({
          strmFileName, strmFilePath,
          originalFilePath: filePath,
          detectedAt: new Date().toISOString()
        })
        console.log(`[Strm 待处理] ${strmFileName} 已加入待处理队列`)
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watcher-event', {
          type: 'add', filePath, fileName,
          folderPath, ...getCombinedWatcherStatus()
        })
      }
    })

    instance.on('unlink', async (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) {
        status.lastEvent = `删除: ${fileName}`
        status.fileCount = Math.max(0, (status.fileCount || 0) - 1)
      }
      // 删除对应的 .strm 引用
      try {
        const strmPath = path.join(UPLOADS_DIR, fileName.endsWith('.strm') ? fileName : fileName + '.strm')
        if (fs.existsSync(strmPath)) { fs.unlinkSync(strmPath) }
      } catch (e) { /* ignore */ }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watcher-event', {
          type: 'remove', filePath, fileName,
          folderPath, ...getCombinedWatcherStatus()
        })
      }
    })

    instance.on('change', (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) status.lastEvent = `修改: ${fileName}`
      // 更新 .strm 引用
      try {
        const strmPath = path.join(UPLOADS_DIR, (fileName.endsWith('.strm') ? fileName : fileName + '.strm'))
        if (fs.existsSync(strmPath)) { fs.writeFileSync(strmPath, filePath, 'utf-8') }
      } catch (e) { /* ignore */ }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watcher-event', {
          type: 'change', filePath, fileName,
          folderPath, ...getCombinedWatcherStatus()
        })
      }
    })

    console.log(`[文件夹监控] 已启动监控: ${folderPath}`)
    return true
  } catch (error) {
    console.error('[文件夹监控] 启动失败:', error)
    watcherStatusMap[folderPath] = { running: false, fileCount: 0, lastEvent: `启动失败: ${error.message}` }
    return false
  }
}

/**
 * 停止监控单个文件夹
 */
async function stopFileWatcher(folderPath) {
  if (watcherMap[folderPath]) {
    await watcherMap[folderPath].close()
    delete watcherMap[folderPath]
  }
  watcherStatusMap[folderPath] = { running: false, fileCount: 0, lastEvent: '已停止' }
  console.log(`[文件夹监控] 已停止: ${folderPath}`)
}

/**
 * 批量启动多个文件夹监控
 */
async function startAllWatchers(paths) {
  for (const p of Object.keys(watcherMap)) {
    await stopFileWatcher(p)
  }
  for (const p of paths) {
    if (p && p.trim()) {
      await startFileWatcher(p.trim())
    }
  }
  saveWatcherState({ paths: paths.filter(p => p && p.trim()), autoStart: true })
}

/**
 * 停止所有监控
 */
async function stopAllWatchers() {
  for (const p of Object.keys(watcherMap)) {
    await stopFileWatcher(p)
  }
  saveWatcherState({ paths: [], autoStart: false })
}

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

// ===== Strm 引用文件辅助函数 =====
/**
 * 创建一个 .strm 引用文件
 * .strm 文件是一个纯文本文件，内容为原始文件的绝对路径
 * @param {string} originalFilePath - 原始文件的绝对路径
 * @param {string} strmFileName - .strm 文件名（不含路径）
 * @returns {{ success: boolean, filePath: string, error?: string }}
 */
function createStrmFile(originalFilePath, strmFileName) {
  try {
    // 确保文件名以 .strm 结尾
    const safeName = strmFileName.replace(/[<>:"/\\|?*]/g, '_')
    const finalName = safeName.endsWith('.strm') ? safeName : safeName + '.strm'
    const strmFilePath = path.join(UPLOADS_DIR, finalName)
    // 写入原始文件路径到 .strm 文件
    fs.writeFileSync(strmFilePath, originalFilePath, 'utf-8')
    console.log(`[Strm] 创建引用文件: ${strmFilePath} → ${originalFilePath}`)
    return { success: true, filePath: strmFilePath }
  } catch (e) {
    console.error('[Strm] 创建引用文件失败:', e)
    return { success: false, error: e.message }
  }
}

/**
 * 读取 .strm 文件，获取原始文件路径
 * @param {string} strmFilePath - .strm 文件的路径
 * @returns {{ success: boolean, originalPath?: string, error?: string }}
 */
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

/**
 * 如果文件路径指向 .strm 文件，解析出原始路径；否则直接返回原路径
 * @param {string} filePath
 * @returns {string} 解析后的实际文件路径
 */
function resolveStrmPath(filePath) {
  if (filePath && filePath.toLowerCase().endsWith('.strm')) {
    const result = readStrmFile(filePath)
    if (result.success && result.originalPath) {
      return result.originalPath
    }
  }
  return filePath
}

// ===== IPC 处理 =====
ipcMain.handle('get-storage-info', () => ({
  storageDir: STORAGE_DIR,
  uploadsDir: UPLOADS_DIR,
  configDir: CONFIG_DIR,
  totalSize: getDirSize(UPLOADS_DIR)
}))

ipcMain.handle('open-folder', (_, folderPath) => {
  shell.openPath(folderPath)
})

ipcMain.handle('open-file', (_, filePath) => {
  // 自动解析 .strm 引用文件
  const resolvedPath = resolveStrmPath(filePath)
  if (fs.existsSync(resolvedPath)) {
    shell.openPath(resolvedPath)
    return { success: true, filePath: resolvedPath }
  }
  return { success: false, error: '文件不存在' }
})

ipcMain.handle('locate-file', (_, filePath) => {
  // 自动解析 .strm 引用文件
  const resolvedPath = resolveStrmPath(filePath)
  if (fs.existsSync(resolvedPath)) {
    shell.showItemInFolder(resolvedPath)
    return { success: true, filePath: resolvedPath }
  }
  return { success: false, error: '文件不存在' }
})

// ===== Strm 引用文件 IPC =====
ipcMain.handle('save-strm-file', (_, { strmFileName, originalFilePath }) => {
  return createStrmFile(originalFilePath, strmFileName)
})

ipcMain.handle('read-strm-file', (_, strmFilePath) => {
  return readStrmFile(strmFilePath)
})

ipcMain.handle('delete-strm-file', (_, strmFilePath) => {
  try {
    if (fs.existsSync(strmFilePath)) {
      fs.unlinkSync(strmFilePath)
      return { success: true }
    }
    return { success: false, error: '引用文件不存在' }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('save-upload-file', async (_, { fileName, content, isBase64 }) => {
  try {
    const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_')
    const filePath = path.join(UPLOADS_DIR, safeFileName)
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

// ===== 文件夹监控 IPC（多文件夹支持） =====
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
    await startAllWatchers(paths)
    return { success: true, status: getCombinedWatcherStatus() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('watcher-stop', async () => {
  await stopAllWatchers()
  return { success: true, status: getCombinedWatcherStatus() }
})

ipcMain.handle('watcher-add', async (_, folderPath) => {
  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      return { success: false, error: '路径不存在' }
    }
    const ok = await startFileWatcher(folderPath)
    if (ok) {
      const savedState = loadWatcherState()
      const paths = [...new Set([...(savedState.paths || []), folderPath])]
      saveWatcherState({ paths, autoStart: true })
    }
    return { success: ok, status: getCombinedWatcherStatus() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('watcher-remove', async (_, folderPath) => {
  try {
    await stopFileWatcher(folderPath)
    const savedState = loadWatcherState()
    const paths = (savedState.paths || []).filter(p => p !== folderPath)
    saveWatcherState({ paths, autoStart: paths.length > 0 })
    return { success: true, status: getCombinedWatcherStatus() }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('watcher-status', () => getCombinedWatcherStatus())

ipcMain.handle('watcher-files', () => {
  try {
    const allPaths = Object.keys(watcherMap)
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
  const pending = pendingStrmFiles.filter(p => !p.processed)
  return { success: true, files: pending }
})

ipcMain.handle('watcher-mark-processed', (_, strmFileName) => {
  const item = pendingStrmFiles.find(p => p.strmFileName === strmFileName && !p.processed)
  if (item) {
    item.processed = true
    item.processedAt = new Date().toISOString()
    return { success: true }
  }
  return { success: false, error: '未找到待处理项' }
})

ipcMain.handle('read-raw-file', (_, filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: '文件不存在' }
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
  const settings = app.getLoginItemSettings()
  console.log(`[开机自启] 读取状态: openAtLogin=${settings.openAtLogin}, execPath=${process.execPath}`)
  return { enabled: settings.openAtLogin, silentStart: true }
})

ipcMain.handle('set-auto-start', (_, enabled) => {
  const exePath = app.getPath('exe')  // 使用 app.getPath('exe') 确保获取正确的 exe 路径
  console.log(`[开机自启] 设置请求: enabled=${enabled}, exePath=${exePath}`)
  try {
    // 1. Electron 原生 API（显式传入 path，避免 ASAR 打包后路径丢失）
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: exePath,
      args: ['--hidden']  // 开机启动时带 --hidden 参数，静默启动到托盘
    })

    // 2. Windows Registry 兜底（写入 HKCU\Software\Microsoft\Windows\CurrentVersion\Run）
    let registryPromise = Promise.resolve()
    if (process.platform === 'win32') {
      const registryKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
      const appName = '知识库管理系统'
      registryPromise = new Promise((resolve) => {
        if (enabled) {
          exec(`reg add "${registryKey}" /v "${appName}" /t REG_SZ /d "\\"${exePath}\\" --hidden" /f`, (err) => {
            if (err) console.error('[开机自启] Registry 写入失败:', err.message)
            else console.log('[开机自启] Registry 写入成功')
            resolve()
          })
        } else {
          exec(`reg delete "${registryKey}" /v "${appName}" /f`, (err) => {
            if (err) console.warn('[开机自启] Registry 删除失败（可能不存在）:', err.message)
            else console.log('[开机自启] Registry 删除成功')
            resolve()
          })
        }
      })
    }

    // 3. 等待 register 写入完成后验证状态
    registryPromise.then(() => {
      const settings = app.getLoginItemSettings()
      const actualEnabled = settings.openAtLogin
      console.log(`[开机自启] 设置完成: openAtLogin=${actualEnabled}, 请求值=${enabled}, 匹配=${actualEnabled === enabled}`)
    })

    // 立即返回（registry 写入异步进行不影响返回值）
    return { success: true, enabled: true }  // 直接返回请求值，信任 API 调用
  } catch (err) {
    console.error(`[开机自启] 设置失败:`, err.message)
    return { success: false, enabled: false, error: err.message }
  }
})

// ===== 跨模式数据同步 =====

const SYNC_FILE = path.join(CONFIG_DIR, 'documents-sync.json')

ipcMain.handle('sync-write', async (_, data) => {
  try {
    fs.writeFileSync(SYNC_FILE, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('sync-read', () => {
  try {
    if (fs.existsSync(SYNC_FILE)) {
      const content = fs.readFileSync(SYNC_FILE, 'utf-8')
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
    if (fs.existsSync(SYNC_FILE)) {
      const stat = fs.statSync(SYNC_FILE)
      return { success: true, timestamp: stat.mtime.toISOString() }
    }
    return { success: true, timestamp: null }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ===== 开机静默启动配置 =====
// 检测是否通过开机自启动（带 --hidden 参数）
const isHiddenStart = process.argv.includes('--hidden')

// ===== Electron 窗口 =====
let mainWindow = null
let tray = null
let forceQuit = false

/**
 * 创建系统托盘图标（使用 programmatic icon）
 */
function createTray() {
  if (tray) return

  // 通过原生 API 生成一个橙色圆形的托盘图标
  const icon = createTrayIcon(32)

  tray = new Tray(icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('知识库管理系统')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        forceQuit = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  // 单击托盘图标恢复窗口（Windows）
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  console.log('[托盘] 系统托盘已创建')
}

/**
 * 生成一个橙色圆形的托盘图标 NativeImage
 */
function createTrayIcon(size) {
  try {
    const canvas = Buffer.alloc(size * size * 4) // RGBA
    // 填充橙色 (#F97316) 圆形
    const cx = size / 2, cy = size / 2, r = size / 2 - 2
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const i = (y * size + x) * 4
        if (dist <= r) {
          canvas[i] = 249     // R
          canvas[i + 1] = 115 // G
          canvas[i + 2] = 22  // B
          canvas[i + 3] = 255 // A
        } else {
          canvas[i] = 0
          canvas[i + 1] = 0
          canvas[i + 2] = 0
          canvas[i + 3] = 0
        }
      }
    }
    return nativeImage.createFromBuffer(canvas, { width: size, height: size })
  } catch (e) {
    console.warn('[托盘] 图标生成失败，使用空图标:', e.message)
    return nativeImage.createEmpty()
  }
}

function createWindow() {
  // 移除默认菜单栏（File/Edit 等无用菜单）
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: '知识库管理系统',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    show: false,
    backgroundColor: '#0f172a'  // 匹配深色主题背景色
  })

  // 开发模式加载 Vite dev server，生产模式加载打包文件
  const isDev = process.argv.includes('--dev')
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // 静默启动时不显示窗口，直接最小化到托盘
  if (isHiddenStart) {
    console.log('[应用] 静默启动模式，窗口将在后台运行')
    // 不调用 show()，窗口保持隐藏
  } else {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })
  }

  // 点击关闭按钮时最小化到托盘，而非直接退出
  mainWindow.on('close', (event) => {
    if (!forceQuit) {
      event.preventDefault()
      mainWindow.hide()
      // 给用户托盘气泡提示
      if (tray) {
        tray.displayBalloon({
          title: '知识库管理系统',
          content: '应用已最小化到系统托盘，双击托盘图标可恢复'
        })
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ===== 应用生命周期 =====
app.whenReady().then(() => {
  createWindow()
  createTray()

  // 初始化开机自启动设置（保持上次的用户选择）
  const loginSettings = app.getLoginItemSettings()
  console.log(`[开机自启] 当前状态: openAtLogin=${loginSettings.openAtLogin} | execPath=${process.execPath}`)

  // 自动启动文件夹监控（多文件夹）
  const savedState = loadWatcherState()
  const autoStartPaths = savedState.paths || (savedState.path ? [savedState.path] : [])
  if (autoStartPaths.length > 0 && savedState.autoStart) {
    setTimeout(async () => {
      for (const p of autoStartPaths) {
        if (p && fs.existsSync(p)) {
          await startFileWatcher(p)
          console.log(`[自动启动] 已监控: ${p}`)
        }
      }
    }, 3000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (mainWindow) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
})

// 确保真正退出时设置标志并清理
app.on('before-quit', async () => {
  forceQuit = true
  await stopAllWatchers()
  // 销毁托盘图标
  if (tray) {
    tray.destroy()
    tray = null
  }
  console.log('[应用] 正在退出...')
})

app.on('window-all-closed', () => {
  // macOS 不退出，其他平台通过托盘控制退出
  if (process.platform !== 'darwin' && !tray) {
    app.quit()
  }
})
