/**
 * 后台分析子进程管理模块
 */

const { fork } = require('child_process')
const path = require('path')
const fs = require('fs')

let analyzerProcess = null
let analyzerReady = false

function startAnalyzer(mainWindow) {
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
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('analyzer-progress', msg)
        }
        break
      case 'result':
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
    setTimeout(() => startAnalyzer(mainWindow), 3000)
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

function isAnalyzerReady() {
  return analyzerReady
}

function sendToAnalyzer(data) {
  if (analyzerProcess && analyzerReady) {
    analyzerProcess.send(data)
    return true
  }
  return false
}

module.exports = {
  startAnalyzer,
  stopAnalyzer,
  isAnalyzerReady,
  sendToAnalyzer
}
