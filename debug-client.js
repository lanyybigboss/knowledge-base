#!/usr/bin/env node
/**
 * Trae 调试客户端
 * 通过 HTTP Bridge 与运行中的应用通信
 *
 * 用法:
 *   node debug-client.js status
 *   node debug-client.js logs 200
 *   node debug-client.js health
 *   node debug-client.js suspend
 *   node debug-client.js resume
 *   node debug-client.js analyze <docId>
 *   node debug-client.js pending
 */

const http = require('http')

const HOST = '127.0.0.1'
const PORT = 7777

const args = process.argv.slice(2)
const command = args[0]

/**
 * HTTP 请求封装
 */
function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    }
    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) })
        } catch (e) {
          resolve({ status: res.statusCode, data: data })
        }
      })
    })
    req.on('error', (e) => reject(e))
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时（10秒）')) })
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

const COMMANDS = {
  'status':   { method: 'GET',  path: '/debug/status' },
  'logs':     { method: 'GET',  path: `/debug/logs?lines=${parseInt(args[1]) || 100}` },
  'health':   { method: 'GET',  path: '/debug/health' },
  'pending':  { method: 'GET',  path: '/debug/docs/pending' },
  'suspend':  { method: 'POST', path: '/debug/suspend' },
  'resume':   { method: 'POST', path: '/debug/resume' },
  'analyze':  { method: 'POST', path: '/debug/analyze', body: { docId: args[1] } },
  'chat':     { method: 'POST', path: '/debug/ai/chat', body: { prompt: args[1] } }
}

if (!command || !COMMANDS[command]) {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          知识库管理系统 - 调试客户端                  ║
╚══════════════════════════════════════════════════════╝

用法:
  status              获取系统状态
  logs [N]            获取最近 N 条日志（默认 100）
  health              健康检查
  pending             获取待分析文档列表
  suspend             挂起分析子进程
  resume              恢复分析子进程
  analyze <docId>     手动触发分析
  chat <prompt>       测试 AI 连接

示例:
  node debug-client.js status
  node debug-client.js logs 200
  node debug-client.js health
  node debug-client.js analyze doc-123
`)
  process.exit(command ? 1 : 0)
}

const cmd = COMMANDS[command]
console.log(`\n[调试客户端] ${command} → ${cmd.method} ${cmd.path}\n`)

request(cmd.method, cmd.path, cmd.body)
  .then((result) => {
    console.log(`HTTP ${result.status}:`)
    console.log(JSON.stringify(result.data, null, 2))
    if (result.status !== 200) process.exit(1)
  })
  .catch((e) => {
    console.error(`[错误] ${e.message}`)
    console.log('\n[提示] 请确保知识库管理系统正在运行，且 HTTP Bridge 已启动')
    console.log(`[提示] 默认地址: http://${HOST}:${PORT}`)
    process.exit(1)
  })
