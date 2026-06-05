/**
 * Ollama 自动启动模块
 * 检测 Ollama 服务是否运行，未运行时自动 spawn
 */

const { spawn } = require('child_process')
const http = require('http')

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

module.exports = { startOllamaIfNotRunning }
