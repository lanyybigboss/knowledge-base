/**
 * Electron 主进程 - 知识库管理系统桌面应用入口
 * v2.2 - 模块化拆分：版本互斥 | Ollama | 存储 | 监控 | Strm | IPC | 分析子进程
 */

const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron')
const path = require('path')

// ===== 引入各模块 =====
const versionLock = require('./versionLock')
const { startOllamaIfNotRunning } = require('./ollamaLauncher')
const storage = require('./storage')
const watcher = require('./watcher')
const { registerIpcHandlers } = require('./ipcHandlers')
const { startAnalyzer, stopAnalyzer } = require('./analyzerManager')

// ===== 开机静默启动 =====
const isHiddenStart = process.argv.includes('--hidden')

// ===== 版本互斥：启动前检查 =====
let shouldExitByVersion = false
let _versionSelfCheckPassed = false

// ===== Electron 窗口 =====
let mainWindow = null
let tray = null
let forceQuit = false

function createTrayIcon(size) {
  try {
    const canvas = Buffer.alloc(size * size * 4)
    const cx = size / 2, cy = size / 2, r = size / 2 - 2
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        const i = (y * size + x) * 4
        if (dist <= r) {
          canvas[i] = 249
          canvas[i + 1] = 115
          canvas[i + 2] = 22
          canvas[i + 3] = 255
        }
      }
    }
    return nativeImage.createFromBuffer(canvas, { width: size, height: size })
  } catch (e) {
    console.warn('[托盘] 图标生成失败，使用空图标:', e.message)
    return nativeImage.createEmpty()
  }
}

function createTray() {
  if (tray) return
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
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
  console.log('[托盘] 系统托盘已创建')
}

function createWindow() {
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
    backgroundColor: '#0f172a'
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (isHiddenStart) {
    console.log('[应用] 静默启动模式，窗口将在后台运行')
  } else {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })
  }

  mainWindow.on('close', (event) => {
    if (!forceQuit) {
      event.preventDefault()
      mainWindow.hide()
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
  // 版本互斥检查（必须在 app.ready 之后执行）
  const currentVersion = app.getVersion()
  const currentPath = process.execPath
  console.log(`[版本互斥] 启动检查 - 版本: ${currentVersion}, 路径: ${currentPath}`)

  if (versionLock.performVersionCheck()) {
    console.log(`[版本互斥] 存在更高版本或相同版本实例，当前实例将退出`)
    shouldExitByVersion = true
    app.quit()
    return
  }

  _versionSelfCheckPassed = true
  console.log(`[版本互斥] 当前实例版本最高 (${currentVersion})，继续启动`)
  versionLock.startVersionHeartbeat()

  storage.initStorageDirectories()
  registerIpcHandlers(mainWindow)
  createWindow()
  createTray()

  watcher.startPendingStrmCleanup()
  console.log('[应用] pendingStrmFiles 清理定时器已启动')

  startAnalyzer(mainWindow)
  startOllamaIfNotRunning()

  // 开机自启状态日志
  const loginSettings = app.getLoginItemSettings()
  console.log(`[开机自启] 当前状态: openAtLogin=${loginSettings.openAtLogin} | execPath=${process.execPath}`)

  // 自动启动文件夹监控
  const savedState = watcher.loadWatcherState()
  const autoStartPaths = savedState.paths || (savedState.path ? [savedState.path] : [])
  if (autoStartPaths.length > 0 && savedState.autoStart) {
    setTimeout(async () => {
      for (const p of autoStartPaths) {
        if (p && require('fs').existsSync(p)) {
          await watcher.startFileWatcher(p, mainWindow)
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

app.on('before-quit', async () => {
  forceQuit = true

  versionLock.stopVersionHeartbeat()
  versionLock.cleanupVersionLock()

  await watcher.stopAllWatchers()
  watcher.stopPendingStrmCleanup()
  watcher.clearPendingStrmFiles()

  stopAnalyzer()

  if (tray) {
    tray.destroy()
    tray = null
  }
  console.log('[应用] 正在退出...')
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) {
    app.quit()
  }
})
