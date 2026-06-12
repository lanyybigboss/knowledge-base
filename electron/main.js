/**
 * Electron 主进程 - 知识库管理系统桌面应用入口
 * v2.1 - 版本互斥：多实例启动时只保留最高版本
 */

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, fork } = require('child_process')
const http = require('http')
const storageIpcClient = require('./ipc/storageClient')  // v1.7.0 解耦：storage IPC 客户端
const httpBridge = require('./httpBridge')                  // v1.7.x 拆分：HTTP Debug Bridge 模块
const watcher = require('./watcher')                        // v1.7.x 拆分：文件夹监控模块
const { registerIpcHandlers } = require('./ipcHandlers')   // v1.7.x 拆分：IPC Handlers 模块

// ===== 版本互斥系统 =====
// 确保同一时间只有一个版本运行：开机多个版本同时启动时，只保留最高版本
// 三层防御：单实例锁 + 文件锁 + 心跳检测
const VERSION_LOCK_FILE = path.join(app.getPath('userData'), 'version-lock.json')
const HEARTBEAT_INTERVAL = 10000   // 心跳间隔 10 秒
const STALE_TIMEOUT = 30000        // 锁文件超过 30 秒无心跳视为过期

let versionLockTimer = null
let shouldExitByVersion = false

/**
 * 在应用启动最早期请求单实例锁
 * 阻止同一应用启动多次（这是 Electron 官方推荐方案）
 */
function requestSingleInstanceLock() {
  const gotLock = app.requestSingleInstanceLock({
    pid: process.pid,
    version: app.getVersion(),
    path: process.execPath
  })
  if (!gotLock) {
    console.log(`[版本互斥] 已有实例运行，当前实例 PID=${process.pid} 立即退出`)
    shouldExitByVersion = true
    app.quit()
    return false
  }
  // 监听 second-instance 事件
  app.on('second-instance', (event, argv, workingDirectory) => {
    console.log(`[版本互斥] 检测到第二个实例启动尝试，参数: ${argv.join(' ')}`)
    // 第二个实例会被自动终止，这里可以激活已有窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  return true
}

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
      timestamp: now,
      startTime: now
    })
    return false
  }

  // 检查锁是否过期（持有者可能已崩溃）
  const isStale = (now - lock.timestamp) > STALE_TIMEOUT
  const pidExists = lock.pid ? isProcessAlive(lock.pid) : false

  if (isStale || !pidExists) {
    // 锁已过期或持有进程已死，接管锁
    console.log(`[版本互斥] 锁过期或持有进程已死 (isStale=${isStale}, pidExists=${pidExists})，当前实例接管`)
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now,
      startTime: now
    })
    return false
  }

  // 锁有效，比较版本
  const cmp = compareVersions(currentVersion, lock.version)
  if (cmp > 0) {
    // 当前版本更高，接管锁（低版本实例会在心跳检测中自行退出）
    console.log(`[版本互斥] 当前版本 ${currentVersion} 更高，接管锁（低版本 PID=${lock.pid} 将退出）`)
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now,
      startTime: now
    })
    return false
  } else if (cmp === 0) {
    // 版本相同 - 但已有实例在运行（单实例锁应该已经拦截，这是防御性检查）
    console.warn(`[版本互斥] 同版本实例已在运行 (PID=${lock.pid})，当前实例退出`)
    return true
  } else {
    // 当前版本更低，退出
    console.log(`[版本互斥] 当前版本 ${currentVersion} 低于 ${lock.version}，退出`)
    return true
  }
}

/**
 * 启动版本锁心跳定时器
 * 持有锁的实例定期更新时间戳；如果发现自己被更高版本取代或被接管，立即退出
 */
function startVersionHeartbeat() {
  const currentVersion = app.getVersion()
  const currentPid = process.pid
  versionLockTimer = setInterval(() => {
    const lock = readVersionLock()

    // 情况 1: 锁被删除 → 异常状态，强制退出
    if (!lock) {
      console.warn('[版本互斥] 锁文件丢失，当前实例强制退出')
      forceQuit = true
      app.quit()
      return
    }

    // 情况 2: 锁的 PID 变了（被其他实例接管）→ 立即退出
    if (lock.pid !== currentPid) {
      console.warn(`[版本互斥] 检测到锁被 PID=${lock.pid} 接管，当前 PID=${currentPid} 立即退出`)
      forceQuit = true
      app.quit()
      return
    }

    // 情况 3: 版本号变了（被更高版本取代）→ 立即退出
    if (lock.version !== currentVersion) {
      console.warn(`[版本互斥] 检测到更高版本 ${lock.version}，当前 ${currentVersion} 立即退出`)
      forceQuit = true
      app.quit()
      return
    }

    // 正常情况：更新心跳
    lock.timestamp = Date.now()
    writeVersionLock(lock)
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
 * 使用原子重命名而非 unlink，避免权限竞争
 */
function cleanupVersionLock() {
  try {
    const lock = readVersionLock()
    if (lock && lock.pid === process.pid) {
      // 二次确认：自己真的是锁持有者
      const stat = fs.statSync(VERSION_LOCK_FILE)
      // 仅在最近 1 分钟内更新过时才清理（避免误删别人的锁）
      if ((Date.now() - stat.mtimeMs) < 60000) {
        fs.unlinkSync(VERSION_LOCK_FILE)
        console.log(`[版本互斥] 锁文件已清理 (PID=${process.pid})`)
      } else {
        console.warn(`[版本互斥] 锁文件 mtime 过旧 (${Math.round((Date.now() - stat.mtimeMs)/1000)}s)，不清理`)
      }
    } else if (lock) {
      console.log(`[版本互斥] 当前 PID=${process.pid} 不是锁持有者 (持有者 PID=${lock.pid})，不清理`)
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[版本互斥] 清理锁文件失败: ${e.message}`)
    }
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
let LOG_FILE

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
  LOG_FILE = path.join(CONFIG_DIR, 'app.log')

  console.log(`[知识库] 数据存储目录: ${STORAGE_DIR}`)
  process.env.KB_STORAGE_DIR = STORAGE_DIR
  process.env.KB_UPLOADS_DIR = UPLOADS_DIR
}

// ===== 日志文件写入（供调试接口读取）=====
let _logBuffer = []
let _logFlushTimer = null
const LOG_FLUSH_INTERVAL = 3000
const LOG_MAX_SIZE = 1024 * 1024 // 1MB

// 日志级别过滤：仅写入优先级 >= MIN_LOG_LEVEL 的日志
// 通过环境变量 KB_LOG_LEVEL 覆盖（DEBUG/INFO/WARN/ERROR/FATAL），默认 INFO
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 }
const MIN_LOG_LEVEL = (() => {
  const envLevel = (process.env.KB_LOG_LEVEL || '').toUpperCase()
  return envLevel in LOG_LEVELS ? LOG_LEVELS[envLevel] : LOG_LEVELS.INFO
})()

function writeLogToFile(level, ...args) {
  const levelPriority = LOG_LEVELS[(level || '').toUpperCase()] ?? LOG_LEVELS.INFO
  if (levelPriority < MIN_LOG_LEVEL) return  // 低于阈值，跳过
  const timestamp = new Date().toISOString()
  const message = args.map(a => {
    if (typeof a === 'object') {
      try { return JSON.stringify(a) } catch (e) { return String(a) }
    }
    return String(a)
  }).join(' ')
  _logBuffer.push(`[${timestamp}] [${level}] ${message}`)

  // 达到一定数量时立即刷盘
  if (_logBuffer.length >= 10) {
    flushLogToFile()
  } else if (!_logFlushTimer) {
    _logFlushTimer = setTimeout(flushLogToFile, LOG_FLUSH_INTERVAL)
  }
}

function flushLogToFile() {
  if (_logFlushTimer) {
    clearTimeout(_logFlushTimer)
    _logFlushTimer = null
  }
  if (_logBuffer.length === 0 || !LOG_FILE) return
  try {
    const data = _logBuffer.join('\n') + '\n'
    _logBuffer = []
    fs.appendFileSync(LOG_FILE, data, 'utf-8')
    // 限制日志文件大小
    const stat = fs.statSync(LOG_FILE)
    if (stat.size > LOG_MAX_SIZE) {
      // 保留后半部分
      const content = fs.readFileSync(LOG_FILE, 'utf-8')
      const lines = content.split('\n')
      const half = Math.floor(lines.length / 2)
      fs.writeFileSync(LOG_FILE, lines.slice(half).join('\n'), 'utf-8')
    }
  } catch (e) {
    // 写日志失败不应阻塞主流程
  }
}

// 拦截 console 输出到文件
const _originalLog = console.log
const _originalError = console.error
const _originalWarn = console.warn
console.log = (...args) => {
  _originalLog.apply(console, args)
  writeLogToFile('INFO', ...args)
}
console.error = (...args) => {
  _originalError.apply(console, args)
  writeLogToFile('ERROR', ...args)
}
console.warn = (...args) => {
  _originalWarn.apply(console, args)
  writeLogToFile('WARN', ...args)
}

// 应用退出时刷盘
app.on('before-quit', () => flushLogToFile())

// 文件夹监控模块已拆分至 ./watcher.js
// 启动时由 app.whenReady() 中调用 watcher.init() 注入依赖

// IPC Handlers 已拆分至 ./ipcHandlers.js（registerIpcHandlers）
// readStrmFile / resolveStrmPath / isPathAllowed 移至该模块
// getDirSize / createStrmFile 保留在 main.js（被 watcher 和 ipcHandlers 共同依赖）

// ===== 共享工具函数（被多模块共用） =====
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

function createStrmFile(originalFilePath, strmFileName) {
  try {
    const safeName = strmFileName.replace(/[<>:"/\\|?*]/g, '_')
    const finalName = safeName.endsWith('.strm') ? safeName : safeName + '.strm'
    const strmFilePath = path.join(UPLOADS_DIR, finalName)
    fs.writeFileSync(strmFilePath, originalFilePath, 'utf-8')
    console.log(`[Strm] 创建引用文件: ${strmFilePath} → ${originalFilePath}`)
    return { success: true, filePath: strmFilePath }
  } catch (e) {
    console.error('[Strm] 创建引用文件失败:', e)
    return { success: false, error: e.message }
  }
}


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

// HTTP Debug Bridge 模块已拆分至 ./httpBridge.js
// 启动时由 app.whenReady() 中调用 httpBridge.init() + httpBridge.httpBridge.startHttpBridge()

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

  // v1.7.0 解耦：注入 webContents 到 storage IPC 客户端
  storageIpcClient.setWebContents(mainWindow.webContents)

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
// 第一层防御：单实例锁（Electron 官方 API）—— 这是最快最可靠的拦截
const _singleInstanceLockPassed = requestSingleInstanceLock()

const _versionSelfCheckPassed = (() => {
  // 如果单实例锁没拿到（已有实例运行），直接退出
  if (!_singleInstanceLockPassed) {
    console.log(`[版本互斥] 单实例锁未获取，跳过文件锁检查`)
    return false
  }

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
// v1.7.x 拆分：初始化模块依赖（在 app.whenReady 之前注册，依赖在 ready 后被调用）
watcher.init({
  getUploadsDir: () => UPLOADS_DIR,
  getWatcherStateFile: () => WATCHER_STATE_FILE,
  getMainWindow: () => mainWindow,
  createStrmFile  // main.js 内部函数，下方定义
})

httpBridge.init({
  getCombinedWatcherStatus: watcher.getCombinedWatcherStatus,
  getDirSize,
  getStorageDirs: () => ({ storageDir: STORAGE_DIR, uploadsDir: UPLOADS_DIR }),
  getLogFile: () => LOG_FILE,
  getMainWindow: () => mainWindow,
  getAnalyzer: () => ({ ready: analyzerReady, pid: analyzerProcess?.pid || null }),
  storageIpcClient,
  flushLogToFile,
  analyzerControl: {
    suspend: () => analyzerProcess && analyzerReady && analyzerProcess.send({ type: 'suspend' }),
    resume: () => analyzerProcess && analyzerReady && analyzerProcess.send({ type: 'resume' }),
    analyze: (data) => analyzerProcess && analyzerReady && analyzerProcess.send({ type: 'analyze', ...data })
  }
})

// v1.7.x 拆分：注册 IPC Handlers（注入依赖）
registerIpcHandlers({
  getStorageDirs: () => ({ storageDir: STORAGE_DIR, uploadsDir: UPLOADS_DIR, configDir: CONFIG_DIR }),
  getSyncFile: () => SYNC_FILE,
  getLogFile: () => LOG_FILE,
  getMainWindow: () => mainWindow,
  getAnalyzer: () => ({ ready: analyzerReady, pid: analyzerProcess?.pid || null, process: analyzerProcess }),
  getAnalyzerControl: () => ({
    suspend: () => analyzerProcess && analyzerReady && analyzerProcess.send({ type: 'suspend' }),
    resume: () => analyzerProcess && analyzerReady && analyzerProcess.send({ type: 'resume' }),
    analyze: (data) => analyzerProcess && analyzerReady && analyzerProcess.send({ type: 'analyze', ...data })
  }),
  storageIpcClient,
  watcher,
  writeLogToFile,
  createStrmFile
})

app.whenReady().then(() => {
  // 版本互斥检查未通过则不启动
  if (shouldExitByVersion || !_versionSelfCheckPassed) return

  initStorageDirectories()
  registerIpcHandlers()
  createWindow()
  createTray()
  
  // 启动 pendingStrmFiles 清理定时器（防止内存泄漏）
  watcher.startPendingStrmCleanup()
  console.log('[应用] pendingStrmFiles 清理定时器已启动')

  // 启动后台分析子进程
  startAnalyzer()

  // 自动启动 Ollama（如未运行）
  startOllamaIfNotRunning()

  // 启动 HTTP Debug Bridge（供 Trae 等外部工具调用）
  httpBridge.httpBridge.startHttpBridge()

  // 初始化开机自启动设置（保持上次的用户选择）
  const loginSettings = app.getLoginItemSettings()
  console.log(`[开机自启] 当前状态: openAtLogin=${loginSettings.openAtLogin} | execPath=${process.execPath}`)

  // 自动启动文件夹监控（多文件夹）
  const savedState = watcher.watcher.loadWatcherState()
  const autoStartPaths = savedState.paths || (savedState.path ? [savedState.path] : [])
  if (autoStartPaths.length > 0 && savedState.autoStart) {
    setTimeout(async () => {
      for (const p of autoStartPaths) {
        if (p && fs.existsSync(p)) {
          await watcher.watcher.startFileWatcher(p)
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

  // 停止 HTTP Debug Bridge
  httpBridge.stopHttpBridge()

  // 停止版本心跳并清理锁文件
  stopVersionHeartbeat()
  cleanupVersionLock()

  await watcher.stopAllWatchers()
  
  // 清理 pendingStrmFiles 定时器（v1.7.x 拆分至 watcher 模块）
  watcher.stopPendingStrmCleanup()
  // 清空 pendingStrmFiles 数组
  watcher.clearPendingStrmFiles()

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
