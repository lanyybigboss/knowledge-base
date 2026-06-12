/**
 * Watcher 模块（v1.7.x 拆分）
 * 文件夹监控（chokidar） + Strm 待处理队列管理
 *
 * 依赖注入：调用方需在启动前 init({ ... }) 注入所需的引用 / 路径
 * 状态由模块内部维护（watcherMap / watcherStatusMap / pendingStrmFiles）
 */

const path = require('path')
const fs = require('fs')

let _deps = null
let watcherMap = {}        // { [folderPath]: chokidar instance }
let watcherStatusMap = {}  // { [folderPath]: { running, fileCount, lastEvent, isObsidianVault } }
let pendingStrmFiles = []  // 待处理的 Strm 文件队列（全局共享）
let pendingStrmCleanupTimer = null

/**
 * 初始化依赖
 * @param {object} deps
 * @param {Function} deps.getUploadsDir - 返回 UPLOADS_DIR 路径
 * @param {Function} deps.getWatcherStateFile - 返回 WATCHER_STATE_FILE 路径
 * @param {Function} deps.getMainWindow - 返回 mainWindow（可能为 null）
 * @param {Function} deps.createStrmFile - 同步创建 strm 文件
 */
function init(deps) {
  _deps = deps
}

function _sendToRenderer(channel, payload) {
  const mainWindow = _deps.getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

/**
 * 定期清理 pendingStrmFiles，防止内存泄漏
 */
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
    console.log('[应用] pendingStrmFiles 清理定时器已停止')
  }
}

function loadWatcherState() {
  try {
    const file = _deps.getWatcherStateFile()
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    }
  } catch (e) { /* ignore */ }
  return { paths: [], autoStart: false }
}

function saveWatcherState(state) {
  try {
    fs.writeFileSync(_deps.getWatcherStateFile(), JSON.stringify(state, null, 2))
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
    // 自动检测 Obsidian vault（存在 .obsidian 子目录）
    const isObsidianVault = fs.existsSync(path.join(folderPath, '.obsidian'))
    watcherStatusMap[folderPath] = { running: true, fileCount: initialCount, lastEvent: '监控已启动', isObsidianVault }

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
        _sendToRenderer('watcher-event', { type: 'add', filePath, fileName, folderPath, isObsidianNote: true, ...getCombinedWatcherStatus() })
        return
      }

      // 自动创建 .strm 引用
      let strmFilePath = ''
      try {
        const strmResult = _deps.createStrmFile(filePath, fileName)
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
      _sendToRenderer('watcher-event', {
        type: 'add', filePath, fileName,
        folderPath, ...getCombinedWatcherStatus()
      })
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
        const UPLOADS_DIR = _deps.getUploadsDir()
        const strmPath = path.join(UPLOADS_DIR, fileName.endsWith('.strm') ? fileName : fileName + '.strm')
        if (fs.existsSync(strmPath)) { fs.unlinkSync(strmPath) }
      } catch (e) { /* ignore */ }
      _sendToRenderer('watcher-event', {
        type: 'remove', filePath, fileName,
        folderPath, ...getCombinedWatcherStatus()
      })
    })

    instance.on('change', (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) status.lastEvent = `修改: ${fileName}`
      // 更新 .strm 引用
      try {
        const UPLOADS_DIR = _deps.getUploadsDir()
        const strmPath = path.join(UPLOADS_DIR, (fileName.endsWith('.strm') ? fileName : fileName + '.strm'))
        if (fs.existsSync(strmPath)) { fs.writeFileSync(strmPath, filePath, 'utf-8') }
      } catch (e) { /* ignore */ }
      _sendToRenderer('watcher-event', {
        type: 'change', filePath, fileName,
        folderPath, ...getCombinedWatcherStatus()
      })
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

/**
 * 获取待处理 Strm 文件（未处理）
 */
function getPendingStrmFiles() {
  return pendingStrmFiles.filter(p => !p.processed)
}

/**
 * 标记 Strm 文件为已处理
 */
function markStrmProcessed(strmFileName) {
  const item = pendingStrmFiles.find(p => p.strmFileName === strmFileName && !p.processed)
  if (item) {
    item.processed = true
    item.processedAt = new Date().toISOString()
    return { success: true }
  }
  return { success: false, error: '未找到待处理项' }
}

/**
 * 清空待处理队列（应用退出时）
 */
function clearPendingStrmFiles() {
  pendingStrmFiles = []
}

/**
 * 获取当前正在监控的所有文件夹路径（用于 IPC isPathAllowed 安全检查）
 */
function getWatchedPaths() {
  return Object.keys(watcherMap)
}

module.exports = {
  init,
  startPendingStrmCleanup,
  stopPendingStrmCleanup,
  loadWatcherState,
  saveWatcherState,
  getCombinedWatcherStatus,
  getWatchedPaths,
  startFileWatcher,
  stopFileWatcher,
  startAllWatchers,
  stopAllWatchers,
  getPendingStrmFiles,
  markStrmProcessed,
  clearPendingStrmFiles
}
