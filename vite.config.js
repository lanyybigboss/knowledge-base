import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { exec, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'

// Windows 系统路径
const WINDIR = process.env.SystemRoot || 'C:\\Windows'
const EXPLORER = path.join(WINDIR, 'explorer.exe')
const CMD = process.env.comspec || path.join(WINDIR, 'System32', 'cmd.exe')

// ===== 存储目录配置 =====
// 可通过环境变量 KB_STORAGE_DIR 指定存储目录，默认为项目下的 data 目录
// 例如: $env:KB_STORAGE_DIR="D:\MyKnowledgeData"
const STORAGE_DIR = process.env.KB_STORAGE_DIR 
  ? path.resolve(process.env.KB_STORAGE_DIR)
  : path.resolve(process.cwd(), 'data')

// 确保存储目录存在
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true })
}

console.log(`[知识库] 数据存储目录: ${STORAGE_DIR}`)
console.log(`[知识库] 如需更改，请设置环境变量 KB_STORAGE_DIR`)

// 子目录
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads')
const CONFIG_DIR = path.join(STORAGE_DIR, 'config')

// 确保子目录存在
;[UPLOADS_DIR, CONFIG_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
})

const WATCHER_STATE_FILE = path.join(CONFIG_DIR, 'watcher-state.json')

// ===== Strm 引用文件辅助函数 =====
/** 创建 .strm 引用文件 */
function createStrmFile(originalFilePath, strmFileName) {
  try {
    const safeName = strmFileName.replace(/[<>:"/\\|?*]/g, '_')
    const finalName = safeName.endsWith('.strm') ? safeName : safeName + '.strm'
    const strmFilePath = path.join(UPLOADS_DIR, finalName)
    fs.writeFileSync(strmFilePath, originalFilePath, 'utf-8')
    console.log(`[Strm] 创建引用文件: ${strmFilePath} →${originalFilePath}`)
    return { success: true, filePath: strmFilePath }
  } catch (e) {
    console.error('[Strm] 创建引用文件失败:', e)
    return { success: false, error: e.message }
  }
}

/** 读取 .strm 文件，获取原始文件路径*/
function readStrmContent(strmFilePath) {
  try {
    if (!fs.existsSync(strmFilePath)) return { success: false, error: '引用文件不存在'}
    const originalPath = fs.readFileSync(strmFilePath, 'utf-8').trim()
    if (!originalPath) return { success: false, error: '引用文件内容为空' }
    return { success: true, originalPath }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/** 解析 strm 文件路径为实际文件路径*/
function resolveStrmPath(filePath) {
  if (filePath && filePath.toLowerCase().endsWith('.strm')) {
    const result = readStrmContent(filePath)
    if (result.success && result.originalPath) return result.originalPath
  }
  return filePath
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
  } catch (e) {
    return 0
  }
}

// ===== 文件夹监控服务（多文件夹支持）=====
let watcherMap = {}        // { [folderPath]: chokidar instance }
let watcherStatusMap = {}  // { [folderPath]: { running, fileCount, lastEvent } }

// 待处理的 Strm 文件队列（全局共享，所有监控文件夹新增文件统一入队）
let pendingStrmFiles = []

// 加载保存的监控状态
function loadWatcherState() {
  try {
    if (fs.existsSync(WATCHER_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(WATCHER_STATE_FILE, 'utf-8'))
      return data
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
 * 启动监控单个文件夹（内部函数）
 */
async function startFileWatcher(folderPath) {
  // 已存在则跳过
  if (watcherMap[folderPath]) return true

  if (!folderPath || !fs.existsSync(folderPath)) {
    watcherStatusMap[folderPath] = { running: false, fileCount: 0, lastEvent: '路径不存在'}
    return false
  }

  try {
    const chokidar = await import('chokidar')

    // 统计初始文件数
    let initialCount = 0
    try {
      initialCount = fs.readdirSync(folderPath).filter(f => {
        const fp = path.join(folderPath, f)
        return fs.statSync(fp).isFile()
      }).length
    } catch (e) { initialCount = 0 }

    const instance = chokidar.default.watch(folderPath, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true,
      ignoreInitial: true,
      depth: 0, // 仅监听顶层
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    })

    watcherMap[folderPath] = instance
    watcherStatusMap[folderPath] = {
      running: true,
      fileCount: initialCount,
      lastEvent: '监控已启动'
    }

    instance.on('add', async (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) {
        status.lastEvent = `新增: ${fileName}`
        status.fileCount++
      }
      console.log(`[文件夹监控] 新增文件: ${fileName} (来自: ${folderPath})`)

      // 自动为新增文件创建.strm 引用文件
      let strmFilePath = ''
      try {
        const strmResult = createStrmFile(filePath, fileName)
        if (strmResult.success) {
          strmFilePath = strmResult.filePath
          console.log(`[文件夹监控] 已自动创建引用 ${fileName}`)
        }
      } catch (e) {
        console.error(`[文件夹监控] 创建引用失败 ${fileName}:`, e.message)
      }

      // 加入待处理队列，等待前端入库 + AI 刮削
      if (strmFilePath) {
        const strmFileName = path.basename(strmFilePath)
        pendingStrmFiles.push({
          strmFileName,
          strmFilePath,
          originalFilePath: filePath,
          detectedAt: new Date().toISOString()
        })
        console.log(`[Strm 待处理] ${strmFileName} 已加入待处理队列`)
      }
    })

    instance.on('change', (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) status.lastEvent = `修改: ${fileName}`
      console.log(`[文件夹监控] 文件变更: ${fileName} (来自: ${folderPath})`)
      // 更新 .strm 引用文件内容
      try {
        const strmFileName = fileName.endsWith('.strm') ? fileName : fileName + '.strm'
        const strmPath = path.join(UPLOADS_DIR, strmFileName)
        if (fs.existsSync(strmPath)) {
          fs.writeFileSync(strmPath, filePath, 'utf-8')
          console.log(`[文件夹监控] 已更新引用 ${strmFileName}`)
        }
      } catch (e) {
        console.error(`[文件夹监控] 更新引用失败 ${fileName}:`, e.message)
      }
    })

    instance.on('unlink', (filePath) => {
      const fileName = path.basename(filePath)
      const status = watcherStatusMap[folderPath]
      if (status) {
        status.lastEvent = `删除: ${fileName}`
        status.fileCount = Math.max(0, (status.fileCount || 0) - 1)
      }
      console.log(`[文件夹监控] 文件删除: ${fileName} (来自: ${folderPath})`)
      // 删除对应的.strm 引用文件
      try {
        const strmPath = path.join(UPLOADS_DIR, fileName.endsWith('.strm') ? fileName : fileName + '.strm')
        if (fs.existsSync(strmPath)) {
          fs.unlinkSync(strmPath)
          console.log(`[文件夹监控] 已删除引用 ${strmPath}`)
        }
      } catch (e) {
        console.error(`[文件夹监控] 删除引用失败 ${fileName}:`, e.message)
      }
    })

    instance.on('error', (error) => {
      console.error(`[文件夹监控] 错误 (${folderPath}):`, error)
      const status = watcherStatusMap[folderPath]
      if (status) status.lastEvent = `错误: ${error.message}`
    })

    console.log(`[文件夹监控] 已启动监控 ${folderPath}`)
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
  watcherStatusMap[folderPath] = { running: false, fileCount: 0, lastEvent: '已停止'}
  console.log(`[文件夹监控] 已停止 ${folderPath}`)
}

/**
 * 批量启动多个文件夹监控
 */
async function startAllWatchers(paths) {
  // 先停止所有现有监控
  for (const p of Object.keys(watcherMap)) {
    await stopFileWatcher(p)
  }
  // 逐个启动
  const results = []
  for (const p of paths) {
    if (p && p.trim()) {
      const ok = await startFileWatcher(p.trim())
      results.push({ path: p.trim(), success: ok })
    }
  }
  saveWatcherState({ paths: paths.filter(p => p && p.trim()), autoStart: true })
  return results
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

// 本地文件操作插件
function localFilePlugin() {
  return {
    name: 'local-file-plugin',
    configureServer(server) {
      // uploadsDir 使用全局 STORAGE_DIR 配置
      // 已在外层创建: UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads')

      // 保存 watcher state
      const savedState = loadWatcherState()
      let addDocRef = null

      // 允许前端设置 addDocument 回调
      server.middlewares.use('/api/watcher/set-callback', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        res.end(JSON.stringify({ success: true }))
      })

      // 启动文件夹监控（支持多文件夹 paths 数组）
      server.middlewares.use('/api/watcher/start', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const data = JSON.parse(body)
            let folderPaths = data.paths || (data.path ? [data.path] : null)
            if (!folderPaths || folderPaths.length === 0) {
              res.end(JSON.stringify({ success: false, error: '请提供至少一个文件夹路径' }))
              return
            }
            // 验证所有路径
            for (const p of folderPaths) {
              if (!p || !fs.existsSync(p)) {
                res.end(JSON.stringify({ success: false, error: `路径不存在 ${p}` }))
                return
              }
            }
            await startAllWatchers(folderPaths)
            const status = getCombinedWatcherStatus()
            res.end(JSON.stringify({ success: true, status }))
          } catch (e) {
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 停止文件夹监控（停止所有）
      server.middlewares.use('/api/watcher/stop', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        await stopAllWatchers()
        const status = getCombinedWatcherStatus()
        res.end(JSON.stringify({ success: true, status }))
      })

      // 添加单个监控文件夹
      server.middlewares.use('/api/watcher/add', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const { path: folderPath } = JSON.parse(body)
            if (!folderPath || !fs.existsSync(folderPath)) {
              res.end(JSON.stringify({ success: false, error: '路径不存在'}))
              return
            }
            const ok = await startFileWatcher(folderPath)
            const currentPaths = Object.keys(watcherMap)
            saveWatcherState({ paths: currentPaths, autoStart: currentPaths.length > 0 })
            const status = getCombinedWatcherStatus()
            res.end(JSON.stringify({ success: ok, status }))
          } catch (e) {
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 移除单个监控文件夹
      server.middlewares.use('/api/watcher/remove', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', async () => {
          try {
            const { path: folderPath } = JSON.parse(body)
            await stopFileWatcher(folderPath)
            const currentPaths = Object.keys(watcherMap)
            saveWatcherState({ paths: currentPaths, autoStart: currentPaths.length > 0 })
            const status = getCombinedWatcherStatus()
            res.end(JSON.stringify({ success: true, status }))
          } catch (e) {
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 获取监控状态（合并所有文件夹）
      server.middlewares.use('/api/watcher/status', (req, res) => {
        res.end(JSON.stringify(getCombinedWatcherStatus()))
      })

      // 列出监控目录文件（从所有监控文件夹收集）
      server.middlewares.use('/api/watcher/files', (req, res) => {
        try {
          const allPaths = Object.keys(watcherMap)
          if (allPaths.length === 0) {
            res.end(JSON.stringify({ success: false, files: [], error: '未设置监控目录'}))
            return
          }
          let allFiles = []
          for (const fp of allPaths) {
            if (!fs.existsSync(fp)) continue
            try {
              const files = fs.readdirSync(fp)
                .filter(f => {
                  const full = path.join(fp, f)
                  return fs.statSync(full).isFile()
                })
                .map(f => ({
                  name: f,
                  folder: fp,
                  size: fs.statSync(path.join(fp, f)).size,
                  modifiedAt: fs.statSync(path.join(fp, f)).mtime
                }))
              allFiles = allFiles.concat(files)
            } catch (e) { /* ignore */ }
          }
          allFiles.sort((a, b) => b.modifiedAt - a.modifiedAt)
          allFiles = allFiles.slice(0, 50)
          const total = Object.values(watcherStatusMap).reduce((sum, s) => sum + (s.fileCount || 0), 0)
          res.end(JSON.stringify({ success: true, files: allFiles, total }))
        } catch (e) {
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })

      // 获取待处理的 Strm 文件列表（供前端入库 + AI 刮削）
      server.middlewares.use('/api/watcher/pending-files', (req, res) => {
        try {
          const pending = pendingStrmFiles.filter(p => !p.processed)
          res.end(JSON.stringify({ success: true, files: pending }))
        } catch (e) {
          res.end(JSON.stringify({ success: false, error: e.message, files: [] }))
        }
      })

      // 标记 Strm 文件已处理完成
      server.middlewares.use('/api/watcher/mark-processed', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { strmFileName } = JSON.parse(body)
            const item = pendingStrmFiles.find(p => p.strmFileName === strmFileName && !p.processed)
            if (item) {
              item.processed = true
              item.processedAt = new Date().toISOString()
              res.end(JSON.stringify({ success: true }))
            } else {
              res.end(JSON.stringify({ success: false, error: '未找到待处理项'}))
            }
          } catch (e) {
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 读取原始文件内容（按路径读取任意文件，返回base64，供前端做文字提取+ AI 分析）
      server.middlewares.use('/api/read-raw-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { filePath } = JSON.parse(body)
            if (!filePath || !fs.existsSync(filePath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ success: false, error: '文件不存在'}))
              return
            }
            const stat = fs.statSync(filePath)
            if (!stat.isFile()) {
              res.statusCode = 400
              res.end(JSON.stringify({ success: false, error: '路径不是文件' }))
              return
            }
            const buffer = fs.readFileSync(filePath)
            const base64 = buffer.toString('base64')
            const ext = path.extname(filePath).toLowerCase()
            res.end(JSON.stringify({
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
            }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 获取存储目录信息
      server.middlewares.use('/api/storage-info', (req, res) => {
        res.end(JSON.stringify({
          storageDir: STORAGE_DIR,
          uploadsDir: UPLOADS_DIR,
          configDir: CONFIG_DIR,
          totalSize: getDirSize(UPLOADS_DIR)
        }))
      })

      // 自动启动监控（兼容旧版单路径和新版多路径）
      const autoStartPaths = savedState.paths || (savedState.path ? [savedState.path] : [])
      if (autoStartPaths.length > 0 && savedState.autoStart) {
        setTimeout(() => {
          for (const p of autoStartPaths) {
            if (p && fs.existsSync(p)) {
              startFileWatcher(p)
            }
          }
        }, 1000)
      }
      // ==================== Strm 引用文件 API ====================

      // 创建 .strm 引用文件
      server.middlewares.use('/api/save-strm-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { strmFileName, originalFilePath } = JSON.parse(body)
            const result = createStrmFile(originalFilePath, strmFileName)
            res.end(JSON.stringify(result))
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 读取 .strm 引用文件内容（获取原始路径）
      server.middlewares.use('/api/read-strm-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { strmFilePath } = JSON.parse(body)
            const result = readStrmContent(strmFilePath)
            res.end(JSON.stringify(result))
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 删除 .strm 引用文件
      server.middlewares.use('/api/delete-strm-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { strmFilePath } = JSON.parse(body)
            if (fs.existsSync(strmFilePath)) {
              fs.unlinkSync(strmFilePath)
              res.end(JSON.stringify({ success: true }))
            } else {
              res.end(JSON.stringify({ success: false, error: '引用文件不存在'}))
            }
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 上传保存文件到本地（支持二进制文件- base64编码）
      server.middlewares.use('/api/upload-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { fileName, content, isBase64 } = JSON.parse(body)
            // 清理文件名中的非法字符
            const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '_')
            const filePath = path.resolve(UPLOADS_DIR, safeFileName)
            
            if (isBase64) {
              // 保存二进制文件（件base64 解码）
              const buffer = Buffer.from(content, 'base64')
              fs.writeFileSync(filePath, buffer)
            } else {
              // 保存文本文件
              fs.writeFileSync(filePath, content || '', 'utf-8')
            }
            
            console.log(`[文件已保存] ${filePath} (${isBase64 ? '二进制' : '文本'})`)
            
            res.end(JSON.stringify({ 
              success: true, 
              filePath: filePath,
              fileName: safeFileName
            }))
          } catch (e) {
            console.error('保存文件失败:', e)
            res.statusCode = 500
            res.end(JSON.stringify({ error: '保存文件失败: ' + e.message }))
          }
        })
      })

      // 打开文件 - 使用系统默认程序（自动解析.strm 引用）
      server.middlewares.use('/api/open-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { filePath } = JSON.parse(body)
            // 自动解析 .strm 引用文件
            const resolvedPath = resolveStrmPath(filePath)
            
            if (!fs.existsSync(resolvedPath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: '文件不存在 ' + filePath }))
              return
            }
            
            // Windows: 使用 start 命令打开文件
            // start 和explorer.exe 即使成功也可能返回非零退出码，故不检查错误
            exec(`start "" "${resolvedPath}"`, { shell: CMD }, () => {
              res.end(JSON.stringify({ success: true, filePath: resolvedPath }))
            })
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '参数错误: ' + e.message }))
          }
        })
      })

      // 定位文件位置 - 在文件管理器中显示（自动解析 .strm 引用）
      server.middlewares.use('/api/locate-file', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { filePath } = JSON.parse(body)
            // 自动解析 .strm 引用文件
            const resolvedPath = resolveStrmPath(filePath)
            
            if (!fs.existsSync(resolvedPath)) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: '文件不存在 ' + filePath }))
              return
            }
            
            // Windows: 使用 explorer /select 选中文件
            // explorer.exe 即使成功也可能返回退出码 1，故不检查错误
            exec(`"${EXPLORER}" /select,"${resolvedPath}"`, { shell: CMD }, () => {
              res.end(JSON.stringify({ success: true, filePath: resolvedPath }))
            })
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '参数错误: ' + e.message }))
          }
        })
      })

      // ==================== 跨模式数据同步 API ====================

      const SYNC_FILE = path.join(CONFIG_DIR, 'documents-sync.json')

      // 写入同步数据
      server.middlewares.use('/api/sync/write', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            fs.writeFileSync(SYNC_FILE, JSON.stringify(data, null, 2), 'utf-8')
            res.end(JSON.stringify({ success: true }))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: e.message }))
          }
        })
      })

      // 读取同步数据
      server.middlewares.use('/api/sync/read', (req, res) => {
        try {
          if (fs.existsSync(SYNC_FILE)) {
            const content = fs.readFileSync(SYNC_FILE, 'utf-8')
            const data = JSON.parse(content)
            res.end(JSON.stringify({ success: true, data }))
          } else {
            res.end(JSON.stringify({ success: true, data: null }))
          }
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })

      // 获取同步文件时间戳
      server.middlewares.use('/api/sync/timestamp', (req, res) => {
        try {
          if (fs.existsSync(SYNC_FILE)) {
            const stat = fs.statSync(SYNC_FILE)
            res.end(JSON.stringify({ success: true, timestamp: stat.mtime.toISOString() }))
          } else {
            res.end(JSON.stringify({ success: true, timestamp: null }))
          }
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: e.message }))
        }
      })

      // 开机自启动（Web 模式不支持，返回降级）
      server.middlewares.use('/api/auto-start/status', (req, res) => {
        res.end(JSON.stringify({ enabled: false, silentStart: false, webMode: true }))
      })
      server.middlewares.use('/api/auto-start/set', (req, res) => {
        res.end(JSON.stringify({ success: false, error: 'Web 模式不支持开机自启动，请使用桌面应用' }))
      })
    }
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), localFilePlugin()],
  server: {
    port: 3000,
    open: false   // Electron 模式下由 Electron 加载，不需要开浏览器
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})



