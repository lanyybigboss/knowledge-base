/**
 * HTTP Debug Bridge（v1.7.x 拆分）
 * 独立 HTTP 服务（端口 7777），供 Trae 等外部工具调试 Electron 应用
 *
 * 依赖注入：调用方需在启动前 init({ ... }) 注入所需的 getter / 客户端引用 / control
 * 设计为惰性查询（getter 函数）+ control 回调，避免循环依赖 + 状态不一致
 */

const http = require('http')
const fs = require('fs')
const { app } = require('electron')

const HTTP_BRIDGE_PORT = 7777
const HTTP_BRIDGE_HOST = '127.0.0.1'
let _httpBridgeServer = null
let _deps = null

/**
 * 初始化依赖
 * @param {object} deps
 * @param {Function} deps.getCombinedWatcherStatus - watcher 状态查询
 * @param {Function} deps.getDirSize - 目录大小计算
 * @param {Function} deps.getStorageDirs - 返回 { storageDir, uploadsDir }
 * @param {Function} deps.getLogFile - 返回 LOG_FILE 路径
 * @param {Function} deps.getMainWindow - 返回 mainWindow（可能为 null）
 * @param {Function} deps.getAnalyzer - 返回 { ready, pid }
 * @param {object}   deps.storageIpcClient - storage IPC 客户端
 * @param {Function} deps.flushLogToFile - 立即刷盘日志
 * @param {object}   deps.analyzerControl - { suspend(), resume(), analyze(data) }
 */
function init(deps) {
  _deps = deps
}

/**
 * 简易 JSON 响应封装
 */
function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  })
  res.end(JSON.stringify(data, null, 2))
}

/**
 * 读取请求体
 */
function readRequestBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) }
      catch (e) { resolve({}) }
    })
  })
}

/**
 * 启动 HTTP Bridge
 */
function startHttpBridge() {
  if (_httpBridgeServer) return
  if (!_deps) throw new Error('[httpBridge] 必须先 init() 注入依赖')
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const pathname = url.pathname

    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      })
      res.end()
      return
    }

    try {
      // GET /debug/status
      if (pathname === '/debug/status' && req.method === 'GET') {
        const { storageDir, uploadsDir } = _deps.getStorageDirs()
        const analyzer = _deps.getAnalyzer()
        return sendJSON(res, 200, {
          success: true,
          electron: { pid: process.pid, version: app.getVersion(), platform: process.platform, uptime: Math.round(process.uptime()) },
          analyzer: { ready: analyzer.ready, pid: analyzer.pid },
          watcher: _deps.getCombinedWatcherStatus(),
          storage: { storageDir, uploadsDir, totalSize: _deps.getDirSize(uploadsDir) },
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString()
        })
      }

      // GET /debug/logs?lines=100
      if (pathname === '/debug/logs' && req.method === 'GET') {
        const count = Math.min(parseInt(url.searchParams.get('lines')) || 100, 1000)
        _deps.flushLogToFile()
        const LOG_FILE = _deps.getLogFile()
        let logs = []
        if (LOG_FILE && fs.existsSync(LOG_FILE)) {
          const content = fs.readFileSync(LOG_FILE, 'utf-8')
          const allLines = content.split('\n').filter(l => l.trim())
          logs = allLines.slice(-count)
        }
        return sendJSON(res, 200, { success: true, count: logs.length, logs })
      }

      // GET /debug/health
      if (pathname === '/debug/health' && req.method === 'GET') {
        const analyzer = _deps.getAnalyzer()
        const watcher = _deps.getCombinedWatcherStatus()
        const checks = {
          electron: { ok: true, info: '运行中' },
          analyzer: { ok: analyzer.ready, info: analyzer.ready ? '就绪' : '未就绪' },
          watcher: { ok: watcher.paths.length > 0, info: `${watcher.paths.length} 个监控` },
          ollama: { ok: false, info: '未检测' }
        }
        try {
          const result = await new Promise((resolve) => {
            const r = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, (rsp) => {
              let body = ''
              rsp.on('data', (c) => { body += c })
              rsp.on('end', () => resolve({ ok: rsp.statusCode === 200, data: body }))
            })
            r.on('error', () => resolve({ ok: false }))
            r.on('timeout', () => { r.destroy(); resolve({ ok: false }) })
          })
          checks.ollama = { ok: result.ok, info: result.ok ? '运行中' : '不可用' }
        } catch (e) { /* ignore */ }
        return sendJSON(res, 200, { success: true, healthy: Object.values(checks).every(c => c.ok), checks })
      }

      // POST /debug/suspend
      if (pathname === '/debug/suspend' && req.method === 'POST') {
        const analyzer = _deps.getAnalyzer()
        if (analyzer.ready) {
          _deps.analyzerControl.suspend()
          return sendJSON(res, 200, { success: true, message: '分析子进程已挂起' })
        }
        return sendJSON(res, 200, { success: false, message: '分析子进程未运行' })
      }

      // POST /debug/resume
      if (pathname === '/debug/resume' && req.method === 'POST') {
        const analyzer = _deps.getAnalyzer()
        if (analyzer.ready) {
          _deps.analyzerControl.resume()
          return sendJSON(res, 200, { success: true, message: '分析子进程已恢复' })
        }
        return sendJSON(res, 200, { success: false, message: '分析子进程未运行' })
      }

      // POST /debug/analyze
      if (pathname === '/debug/analyze' && req.method === 'POST') {
        const body = await readRequestBody(req)
        const { docId } = body
        if (!docId) return sendJSON(res, 400, { success: false, error: '缺少 docId' })
        const analyzer = _deps.getAnalyzer()
        if (!analyzer.ready) {
          return sendJSON(res, 503, { success: false, error: '分析子进程未就绪' })
        }
        let doc = null
        try {
          const mainWindow = _deps.getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            doc = await _deps.storageIpcClient.getDocument(docId)
          }
        } catch (e) { /* ignore */ }
        if (!doc) return sendJSON(res, 404, { success: false, error: `文档不存在: ${docId}` })
        if (!doc.filePath) return sendJSON(res, 400, { success: false, error: `文档无 filePath: ${docId}` })
        if (!fs.existsSync(doc.filePath)) return sendJSON(res, 404, { success: false, error: `文件不存在: ${doc.filePath}` })
        _deps.analyzerControl.analyze({
          id: docId,
          filePath: doc.filePath,
          fileName: doc.fileName || doc.title,
          fileType: doc.fileType,
          title: doc.title
        })
        return sendJSON(res, 200, { success: true, message: `已触发分析: ${docId} → ${doc.filePath}` })
      }

      // POST /debug/ai/chat - 直接测试 AI
      if (pathname === '/debug/ai/chat' && req.method === 'POST') {
        const body = await readRequestBody(req)
        const { prompt } = body
        if (!prompt) return sendJSON(res, 400, { success: false, error: '缺少 prompt' })
        try {
          const result = await new Promise((resolve) => {
            const r = http.get('http://localhost:11434/api/tags', { timeout: 2000 }, (rsp) => resolve(rsp.statusCode === 200))
            r.on('error', () => resolve(false))
            r.on('timeout', () => { r.destroy(); resolve(false) })
          })
          return sendJSON(res, 200, { success: true, ollamaReachable: result })
        } catch (e) {
          return sendJSON(res, 200, { success: true, ollamaReachable: false, error: e.message })
        }
      }

      // GET /debug/docs/pending - 待分析文档
      if (pathname === '/debug/docs/pending' && req.method === 'GET') {
        try {
          const mainWindow = _deps.getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            const docs = await _deps.storageIpcClient.getDocumentMetadata(100, 0)
            const pending = (docs || [])
              .filter(d => !d.aiAnalyzed)
              .map(d => ({ id: d.id, title: d.title || d.fileName, fileName: d.fileName }))
            return sendJSON(res, 200, { success: true, count: pending.length, docs: pending })
          }
        } catch (e) {
          return sendJSON(res, 200, { success: false, error: e.message })
        }
        return sendJSON(res, 200, { success: false, error: '渲染进程未就绪' })
      }

      // 404
      return sendJSON(res, 404, { success: false, error: 'Not Found', availableEndpoints: [
        'GET  /debug/status',
        'GET  /debug/logs?lines=N',
        'GET  /debug/health',
        'POST /debug/suspend',
        'POST /debug/resume',
        'POST /debug/analyze  {docId}',
        'POST /debug/ai/chat  {prompt}',
        'GET  /debug/docs/pending'
      ]})
    } catch (e) {
      return sendJSON(res, 500, { success: false, error: e.message })
    }
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[DebugBridge] 端口 ${HTTP_BRIDGE_PORT} 被占用，尝试下一个端口`)
      server.listen(HTTP_BRIDGE_PORT + 1, HTTP_BRIDGE_HOST)
    } else {
      console.error('[DebugBridge] 启动失败:', err.message)
    }
  })

  server.listen(HTTP_BRIDGE_PORT, HTTP_BRIDGE_HOST, () => {
    console.log(`[DebugBridge] HTTP 服务已启动: http://${HTTP_BRIDGE_HOST}:${HTTP_BRIDGE_PORT}`)
  })

  _httpBridgeServer = server
}

/**
 * 停止 HTTP Bridge
 */
function stopHttpBridge() {
  if (_httpBridgeServer) {
    _httpBridgeServer.close()
    _httpBridgeServer = null
    console.log('[DebugBridge] HTTP 服务已停止')
  }
}

module.exports = {
  init,
  startHttpBridge,
  stopHttpBridge,
  HTTP_BRIDGE_PORT,
  HTTP_BRIDGE_HOST
}
