/**
 * 双向 IPC 协议工具
 * 主进程向渲染进程发起 request/response 调用（类似 ipcRenderer.invoke 的反向）
 *
 * 用法：
 *   const result = await invokeRenderer(webContents, 'storage:get-document', docId)
 *
 * 协议：
 *   1. 主进程 webContents.send('storage:get-document', { requestId, args })
 *   2. 渲染进程 ipcRenderer.on('storage:get-document') 监听后处理
 *   3. 渲染进程 ipcRenderer.send('storage:get-document:response:<requestId>', { data } | { error })
 *   4. 主进程 ipcMain.once('storage:get-document:response:<requestId>') 接收并 resolve
 *
 * 设计原则：
 *   - 通道名 + requestId 防冲突
 *   - 5 秒超时保护
 *   - 一次性监听器 + cleanup
 *   - 错误统一捕获
 */

const { ipcMain } = require('electron')

const TIMEOUT_MS = 5000

function generateRequestId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function makeResponseChannel(channel, requestId) {
  return `${channel}:response:${requestId}`
}

/**
 * 主进程调用渲染进程方法
 * @param {Electron.WebContents} webContents
 * @param {string} channel   通道名（如 'storage:get-document'）
 * @param {...any} args      传给渲染进程处理器的参数
 * @returns {Promise<any>}
 */
function invokeRenderer(webContents, channel, ...args) {
  return new Promise((resolve, reject) => {
    if (!webContents || webContents.isDestroyed()) {
      reject(new Error(`[ipc-protocol] webContents 不可用 (channel=${channel})`))
      return
    }

    const requestId = generateRequestId()
    const responseChannel = makeResponseChannel(channel, requestId)

    const cleanup = () => {
      ipcMain.removeAllListeners(responseChannel)
      clearTimeout(timer)
    }

    ipcMain.once(responseChannel, (_, result) => {
      cleanup()
      if (result && result.error) {
        reject(new Error(result.error))
      } else if (result && Object.prototype.hasOwnProperty.call(result, 'data')) {
        resolve(result.data)
      } else {
        resolve(result)
      }
    })

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`[ipc-protocol] ${channel} 超时（${TIMEOUT_MS}ms）`))
    }, TIMEOUT_MS)

    try {
      webContents.send(channel, { requestId, args })
    } catch (err) {
      cleanup()
      reject(err)
    }
  })
}

module.exports = { invokeRenderer, TIMEOUT_MS, makeResponseChannel }
