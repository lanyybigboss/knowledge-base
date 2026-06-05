/**
 * Electron 主进程 - 知识库管理系统桌面应用入口
 * v2.1 - 版本互斥：多实例启动时只保留最高版本
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { execFile, spawn, fork } = require('child_process')
const http = require('http')

// ===== 版本互斥系统 =====
// 确保同一时间只有一个版本运行：开机多个版本同时启动时，只保留最高版本
const VERSION_LOCK_FILE = path.join(app.getPath('userData'), 'version-lock.json')
const HEARTBEAT_INTERVAL = 10000   // 心跳间隔 10 秒
const STALE_TIMEOUT = 30000        // 锁文件超过 30 秒无心跳视为过期

let versionLockTimer = null
let shouldExitByVersion = false

/**
 * 解析语义化版本号为可比较的数组 [major, minor, patch]
 * @param {string} ver - 版本号字符串，如 "1.2.3"
 * @returns {number[]}
 */
function parseVersion(ver) {
  if (!ver || typeof ver !== 'string') return [0, 0, 0]
  const parts = ver.split('.').map(n => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

/**
 * 比较两个版本号
 * @returns {number} 正数=ver1更高，0=相同，负数=ver2更高
 */
function compareVersions(ver1, ver2) {
  const a = parseVersion(ver1)
  const b = parseVersion(ver2)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * 读取版本锁文件
 * @returns {object|null}
 */
function readVersionLock() {
  try {
    if (fs.existsSync(VERSION_LOCK_FILE)) {
      return JSON.parse(fs.readFileSync(VERSION_LOCK_FILE, 'utf-8'))
    }
  } catch (e) { /* 文件损坏或被锁定，视为无锁 */ }
  return null
}

/**
 * 写入版本锁文件
 */
function writeVersionLock(data) {
  try {
    fs.writeFileSync(VERSION_LOCK_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[版本互斥] 写入锁文件失败:', e.message)
  }
}

/**
 * 执行版本互斥检查
 * 返回 true 表示当前实例应该退出（存在更高版本）
 * @returns {boolean}
 */
function performVersionCheck() {
  const currentVersion = app.getVersion()
  const currentPath = process.execPath
  const currentPid = process.pid
  const now = Date.now()

  const lock = readVersionLock()

  if (!lock) {
    // 无锁，写入自己的锁信息
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now
    })
    return false
  }

  // 检查锁是否过期（持有者可能已崩溃）
  const isStale = (now - lock.timestamp) > STALE_TIMEOUT
  const pidExists = isProcessAlive(lock.pid)

  if (isStale || !pidExists) {
    // 锁已过期或持有进程已死，接管锁
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now
    })
    return false
  }

  // 锁有效，比较版本
  const cmp = compareVersions(currentVersion, lock.version)
  if (cmp > 0) {
    // 当前版本更高，接管锁（低版本实例会在心跳检测中自行退出）
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now
    })
    return false
  } else if (cmp === 0) {
    // 版本相同，不允许重复运行
    return true
  } else {
    // 当前版本更低，退出
    return true
  }
}

/**
 * 启动版本锁心跳定时器
 * 持有锁的实例定期更新时间戳；如果发现自己被更高版本取代，自行退出
 */
function startVersionHeartbeat() {
  const currentVersion = app.getVersion()
  versionLockTimer = setInterval(() => {
    const lock = readVersionLock()
    if (lock && lock.version !== currentVersion) {
      // 被更高版本取代，自行退出
      console.log(`[版本互斥] 检测到更高版本 ${lock.version}，当前 ${currentVersion} 即将退出`)
      app.quit()
      return
    }
    // 更新心跳时间戳
    if (lock) {
      lock.timestamp = Date.now()
      writeVersionLock(lock)
    }
  }, HEARTBEAT_INTERVAL)
}

/**
 * 停止心跳
 */
function stopVersionHeartbeat() {
  if (versionLockTimer) {
    clearInterval(versionLockTimer)
    versionLockTimer = null
  }
}

/**
 * 清理版本锁文件（仅当自己是锁持有者时）
 */
function cleanupVersionLock() {
  const lock = readVersionLock()
  if (lock && lock.pid === process.pid) {
    try {
      fs.unlinkSync(VERSION_LOCK_FILE)
    } catch (e) { /* ignore */ }
  }
}

/**
 * 检查进程是否存活（Windows 专用）
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0) // signal 0 不发送信号，只检测存在性
    return true
  } catch (e) {
    return false
  }
}

// ===== Ollama 自动启动 =====
function startOllamaIfNotRunning() {
  function spawnOllama() {
    try {
      const child = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })
      child.unref()
      child.on('error', (err) => {
        console.log(`[Ollama] 启动失败（可能未安装）: ${err.message}`)
      })
      console.log('[Ollama] 已启动 ollama serve（detached）')
    } catch (err) {
      console.log(`[Ollama] 启动失败（可能未安装）: ${err.message}`)
    }
  }

  const checkReq = http.get('http://localhost:11434/api/tags', { timeout: 3000 }, (res) => {
    res.on('data', () => {})
    res.on('end', () => {
      console.log('[Ollama] 已检测到 Ollama 服务正在运行，跳过启动')
    })
  })
  checkReq.on('error', () => {
    spawnOllama()
  })
  checkReq.on('timeout', () => {
    checkReq.destroy()
    spawnOllama()
  })
}

// ===== 存储目录配置 =====
let STORAGE_DIR
let UPLOADS_DIR
let CONFIG_DIR
let WATCHER_STATE_FILE
let SYNC_FILE

function initStorageDirectories() {
  const isDev = process.argv.includes('--dev')
  STORAGE_DIR = process.env.KB_STORAGE_DIR
    ? path.resolve(process.env.KB_STORAGE_DIR)
    : isDev
      ? path.resolve(__dirname, '..', 'data')
      : path.join(app.getPath('userData'), 'data')

  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
  }

  UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads')
  CONFIG_DIR = path.join(STORAGE_DIR, 'config')

  ;[UPLOADS_DIR, CONFIG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  WATCHER_STATE_FILE = path.join(CONFIG_DIR, 'watcher-state.json')
  SYNC_FILE = path.join(CONFIG_DIR, 'documents-sync.json')

  console.log(`[知识库] 数据存储目录: ${STORAGE_DIR}`)
  process.env.KB_STORAGE_DIR = STORAGE_DIR
  process.env.KB_UPLOADS_DIR = UPLOADS_DIR
}

// ===== 瓦特（watcher）状态管理（多文件夹支持） =====
let watcherMap = {}        // { [folderPath]: chokidar instance }
let watcherStatusMap = {}  // { [folderPath]: { running, fileCount, lastEvent } }
let pendingStrmFiles = []  // 待处理的 Strm 文件队列（全局共享）

// 定期清理 pendingStrmFiles，防止内存泄漏
let pendingStrmCleanupTimer = null
function startPendingStrmCleanup() {
  if (pendingStrmCleanupTimer) return
  pendingStrmCleanupTimer = setInterval(() => {
    const oldLength = pendingStrmFiles.length
    // 只保留最近 100 条记录
    if (pendingStrmFiles.length > 100) {
      pendingStrmFiles = pendingStrmFiles.slice(-100)
    }
    // 清理超过 1 小时的已处理项
    const oneHourAgo = Date.now() - 3600000
    const before = pendingStrmFiles.length
    pendingStrmFiles = pendingStrmFiles.filter(f => 
      !f.processed || new Date(f.processedAt).getTime() > oneHourAgo
    )
    const after = pendingStrmFiles.length
    if (before !== after || oldLength > 100) {
      console.log(`[内存清理] pendingStrmFiles: ${oldLength} → ${pendingStrmFiles.length} (已清理 ${before - after} 条)`)
    }
  }, 60000) // 每分钟清理一次
}

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
      ignored: /(^|[/\\])\../,
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
      // Obsidian vault 中的 .md 笔记直接入队（不需要 .strm 引用）
      const isObsidianVault = watcherStatusMap[folderPath]?.isObsidianVault
      if (isObsidianVault && fileName.toLowerCase().endsWith('.md')) {
        pendingStrmFiles.push({
          strmFileName: fileName,
          strmFilePath: filePath,
          originalFilePath: filePath,
          isObsidianNote: true,
          detectedAt: new Date().toISOString()
        })
        console.log(`[Obsidian] 笔记已入队: ${fileName}`)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('watcher-event', { type: 'add', filePath, fileName, folderPath, isObsidianNote: true, ...getCombinedWatcherStatus() })
        }
        return  // 跳过 .strm 创建
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
  // 完全清理 watcherStatusMap，避免内存泄漏
  delete watcherStatusMap[folderPath]
  console.log(`[文件夹监控] 已停止并清理: ${folderPath}`)
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
function registerIpcHandlers() {
ipcMain.handle('get-storage-info', () => ({
  storageDir: STORAGE_DIR,
  uploadsDir: UPLOADS_DIR,
  configDir: CONFIG_DIR,
  totalSize: getDirSize(UPLOADS_DIR)
}))

ipcMain.handle('open-folder', (_, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { success: false, error: '文件夹不存在' }
  }
  shell.openPath(folderPath)
})

ipcMain.handle('open-file', (_, filePath) => {
  // 自动解析 .strm 引用文件
  const resolvedPath = resolveStrmPath(filePath)
  // 安全检查：禁止打开可执行文件类型
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
  // 自动解析 .strm 引用文件
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
  return createStrmFile(originalFilePath, strmFileName)
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

// 路径安全检查：只允许读取存储目录和监控目录下的文件
function isPathAllowed(filePath) {
  const resolved = path.resolve(filePath)
  if (resolved.startsWith(path.resolve(STORAGE_DIR))) return true
  for (const watchedPath of Object.keys(watcherMap)) {
    if (resolved.startsWith(path.resolve(watchedPath))) return true
  }
  return false
}

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
  // dev 模式下 getLoginItemSettings 不可靠，直接读 Registry
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
    // 1. Electron 原生 API（恢复 path 参数，dev 模式下必须）
    const loginArgs = isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: exePath,
      args: loginArgs
    })

    // 2. Windows Registry 兜底 — 用 PowerShell 避免 exec 编码问题
    if (process.platform === 'win32') {
      const regPath = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
      const appName = 'KnowledgeBaseApp'

      // 路径安全校验：拒绝包含 PowerShell 特殊字符的路径
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
          // PowerShell 单引号内转义
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

    // 3. 验证实际状态（dev 模式下读 Registry，因 getLoginItemSettings 不可靠）
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
} // end registerIpcHandlers

// ===== 后台分析子进程管理 =====
let analyzerProcess = null
let analyzerReady = false

function startAnalyzer() {
  const analyzerPath = path.join(__dirname, 'analyzer.js')
  if (!fs.existsSync(analyzerPath)) {
    console.warn('[Analyzer] analyzer.js 不存在，跳过子进程启动')
    return
  }

  analyzerProcess = fork(analyzerPath, [], { silent: false })

  analyzerProcess.on('message', (msg) => {
    if (!msg || !msg.type) return

    switch (msg.type) {
      case 'ready':
        analyzerReady = true
        console.log('[Analyzer] 子进程就绪')
        break
      case 'progress':
        // 转发进度到渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('analyzer-progress', msg)
        }
        break
      case 'result':
        // 转发结果到渲染进程
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('analyzer-result', msg)
        }
        break
      case 'error':
        console.error('[Analyzer] 错误:', msg.error)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('analyzer-error', msg)
        }
        break
    }
  })

  analyzerProcess.on('exit', (code) => {
    console.warn(`[Analyzer] 子进程退出 (code=${code})，3 秒后重启...`)
    analyzerReady = false
    analyzerProcess = null
    setTimeout(startAnalyzer, 3000)
  })

  analyzerProcess.on('error', (err) => {
    console.error('[Analyzer] 子进程错误:', err.message)
  })
}

function stopAnalyzer() {
  if (analyzerProcess) {
    analyzerProcess.send({ type: 'exit' })
    setTimeout(() => {
      if (analyzerProcess) {
        analyzerProcess.kill()
        analyzerProcess = null
      }
    }, 2000)
  }
}

// 子进程分析 IPC（渲染进程调用）
ipcMain.handle('analyzer-analyze', (_, data) => {
  if (!analyzerProcess || !analyzerReady) {
    return { success: false, error: '分析子进程未就绪' }
  }
  analyzerProcess.send({ type: 'analyze', ...data })
  return { success: true }
})

ipcMain.handle('analyzer-status', () => ({
  ready: analyzerReady,
  pid: analyzerProcess?.pid || null
}))

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

  const isDev = process.argv.includes('--dev')

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
      webSecurity: !isDev
    },
    show: false,
    backgroundColor: '#0f172a'  // 匹配深色主题背景色
  })

  // 开发模式加载 Vite dev server，生产模式加载打包文件
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

// ===== 版本互斥：在应用启动前检查 =====
// 必须在 app.whenReady() 之前执行，确保低版本尽快退出
const _versionSelfCheckPassed = (() => {
  const currentVersion = app.getVersion()
  const currentPath = process.execPath
  console.log(`[版本互斥] 启动检查 - 版本: ${currentVersion}, 路径: ${currentPath}`)

  if (performVersionCheck()) {
    console.log(`[版本互斥] 存在更高版本或相同版本实例，当前实例将退出`)
    shouldExitByVersion = true
    // 静默退出，不弹窗
    app.quit()
    return false
  }

  console.log(`[版本互斥] 当前实例版本最高 (${currentVersion})，继续启动`)
  startVersionHeartbeat()
  return true
})()

// ===== 应用生命周期 =====
app.whenReady().then(() => {
  // 版本互斥检查未通过则不启动
  if (shouldExitByVersion || !_versionSelfCheckPassed) return

  initStorageDirectories()
  registerIpcHandlers()
  createWindow()
  createTray()
  
  // 启动 pendingStrmFiles 清理定时器（防止内存泄漏）
  startPendingStrmCleanup()
  console.log('[应用] pendingStrmFiles 清理定时器已启动')

  // 启动后台分析子进程
  startAnalyzer()

  // 自动启动 Ollama（如未运行）
  startOllamaIfNotRunning()

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

  // 停止版本心跳并清理锁文件
  stopVersionHeartbeat()
  cleanupVersionLock()

  await stopAllWatchers()
  
  // 清理 pendingStrmFiles 定时器
  if (pendingStrmCleanupTimer) {
    clearInterval(pendingStrmCleanupTimer)
    pendingStrmCleanupTimer = null
    console.log('[应用] pendingStrmFiles 清理定时器已停止')
  }
  
  // 清空 pendingStrmFiles 数组
  pendingStrmFiles = []

  // 停止分析子进程
  stopAnalyzer()

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
