/**
 * 文件夹监控模块（多文件夹支持）
 * 基于 chokidar 实现文件增删改监听，支持 Obsidian vault 检测
 */

const path = require('path')
const fs = require('fs')
const { createStrmFile } = require('./strmFile')
const { getUploadsDir, getWatcherStateFile } = require('./storage')

let watcherMap = {}        // { [folderPath]: chokidar instance }
let watcherStatusMap = {}  // { [folderPath]: { running, fileCount, lastEvent } }
let pendingStrmFiles = []  // 待处理的 Strm 文件队列（全局共享）

// 定期清理 pendingStrmFiles，防止内存泄漏
let pendingStrmCleanupTimer = null
function startPendingStrmCleanup() {
  if (pendingStrmCleanupTimer) return
  pendingStrmCleanupTimer = setInterval(() => {
    const oldLength = pendingStrmFiles.length
    if (pendingStrmFiles.length > 100) {
      pendingStrmFiles = pendingStrmFiles.slice(-100)
    }
    const oneHourAgo = Date.now() - 3600000
    const before = pendingStrmFiles.length
    pendingStrmFiles = pendingStrmFiles.filter(f =>
      !f.processed || new Date(f.processedAt).getTime() > oneHourAgo
    )
    const after = pendingStrmFiles.length
    if (before !== after || oldLength > 100) {
      console.log(`[内存清理] pendingStrmFiles: ${oldLength} → ${pendingStrmFiles.length} (已清理 ${before - after} 条)`)
    }
  }, 60000)
}

function stopPendingStrmCleanup() {
  if (pendingStrmCleanupTimer) {
    clearInterval(pendingStrmCleanupTimer)
    pendingStrmCleanupTimer = null
  }
}

function loadWatcherState() {
  try {
    const WATCHER_STATE_FILE = getWatcherStateFile()
    if (fs.existsSync(WATCHER_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(WATCHER_STATE_FILE, 'utf-8'))
    }
  } catch (e) { /* ignore */ }
  return { paths: [], autoStart: false }
}

function saveWatcherState(state) {
  try {
    const WATCHER_STATE_FILE = getWatcherStateFile()
    fs.writeFileSync(WATCHER_STATE_FILE, JSON.stringify(state, null, 2))
  } catch (e) { /* ignore */ }
}

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
 * 路径安全检查：只允许读取存储目录和监控目录下的文件
 */
function isPathAllowed(filePath, storageDir) {
  const resolved = path.resolve(filePath)
  if (resolved.startsWith(path.resolve(storageDir))) return true
  for (const watchedPath of Object.keys(watcherMap)) {
    if (resolved.startsWith(path.resolve(watchedPath))) return true
  }
  return false
}

/**
 * 获取监控目录列表（供 IPC 路径校验使用）
 */
function getWatchedPaths() {
  return Object.keys(watcherMap)
}

async function startFileWatcher(folderPath, mainWindow) {
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
    const isObsidianVault = fs.existsSync(path.join(folderPath, '.obsidian'))
    watcherStatusMap[folderPath] = { running: true, fileCount: initialCount, lastEvent: '监控已启动', isObsidianVault }

    const uploadsDir = getUploadsDir()

    instance.on('add', async (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) {
        status.lastEvent = `新增: ${fileName}`
        status.fileCount++
      }
      // Obsidian vault 中的 .md 笔记直接入队
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
          mainWindow.webContents.send('watcher-event', {
            type: 'add', filePath, fileName, folderPath,
            isObsidianNote: true, ...getCombinedWatcherStatus()
          })
        }
        return
      }

      // 自动创建 .strm 引用
      let strmFilePath = ''
      try {
        const strmResult = createStrmFile(filePath, fileName, uploadsDir)
        if (strmResult.success) {
          strmFilePath = strmResult.filePath
          console.log(`[文件夹监控] 已自动创建引用: ${fileName} → ${strmResult.filePath}`)
        }
      } catch (e) {
        console.error(`[文件夹监控] 创建引用失败 ${fileName}:`, e.message)
      }
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
          type: 'add', filePath, fileName, folderPath,
          ...getCombinedWatcherStatus()
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
      try {
        const strmPath = path.join(uploadsDir, fileName.endsWith('.strm') ? fileName : fileName + '.strm')
        if (fs.existsSync(strmPath)) { fs.unlinkSync(strmPath) }
      } catch (e) { /* ignore */ }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watcher-event', {
          type: 'remove', filePath, fileName, folderPath,
          ...getCombinedWatcherStatus()
        })
      }
    })

    instance.on('change', (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) status.lastEvent = `修改: ${fileName}`
      try {
        const strmPath = path.join(uploadsDir, (fileName.endsWith('.strm') ? fileName : fileName + '.strm'))
        if (fs.existsSync(strmPath)) { fs.writeFileSync(strmPath, filePath, 'utf-8') }
      } catch (e) { /* ignore */ }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watcher-event', {
          type: 'change', filePath, fileName, folderPath,
          ...getCombinedWatcherStatus()
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

async function stopFileWatcher(folderPath) {
  if (watcherMap[folderPath]) {
    await watcherMap[folderPath].close()
    delete watcherMap[folderPath]
  }
  delete watcherStatusMap[folderPath]
  console.log(`[文件夹监控] 已停止并清理: ${folderPath}`)
}

async function startAllWatchers(paths, mainWindow) {
  for (const p of Object.keys(watcherMap)) {
    await stopFileWatcher(p)
  }
  for (const p of paths) {
    if (p && p.trim()) {
      await startFileWatcher(p.trim(), mainWindow)
    }
  }
  saveWatcherState({ paths: paths.filter(p => p && p.trim()), autoStart: true })
}

async function stopAllWatchers() {
  for (const p of Object.keys(watcherMap)) {
    await stopFileWatcher(p)
  }
  saveWatcherState({ paths: [], autoStart: false })
}

function getPendingStrmFiles() {
  return pendingStrmFiles
}

function clearPendingStrmFiles() {
  pendingStrmFiles = []
}

module.exports = {
  startFileWatcher,
  stopFileWatcher,
  startAllWatchers,
  stopAllWatchers,
  getCombinedWatcherStatus,
  loadWatcherState,
  saveWatcherState,
  isPathAllowed,
  getWatchedPaths,
  getPendingStrmFiles,
  clearPendingStrmFiles,
  startPendingStrmCleanup,
  stopPendingStrmCleanup
}
