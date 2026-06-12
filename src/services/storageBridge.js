/**
 * 渲染进程侧 Storage IPC Bridge
 * 监听主进程请求，调用 storageService 后回执
 *
 * 用法（在 main.jsx 中）：
 *   import { installStorageBridge } from './services/storageBridge'
 *   installStorageBridge()
 *
 * 解耦意义（v1.7.0）：
 *   - 替代 main.js 中 executeJavaScript('window.storageService?...') 的字符串注入
 *   - 通道名集中管理，类型清晰
 *   - 错误统一捕获并 logger 记录
 *   - 单次 install 防止重复注册
 *   - 不直接 import electron，遵循 contextIsolation 安全模型
 *   - 通过 preload 暴露的 window.electronAPI.ipcBridge 通信
 */

import storageService from './storageService'
import logger from './logger'

const RESPONSE_SUFFIX = ':response:'

function makeResponseChannel(channel, requestId) {
  return `${channel}${RESPONSE_SUFFIX}${requestId}`
}

/**
 * 注册一个通道：主进程 → 渲染进程 → 回执
 * @param {Object} ipcBridge  preload 暴露的 {on, send}
 * @param {string} channel
 * @param {Function} handler  接收 ...args，返回 Promise
 */
function listen(ipcBridge, channel, handler) {
  ipcBridge.on(channel, async (payload) => {
    const { requestId, args = [] } = payload || {}
    const responseChannel = makeResponseChannel(channel, requestId)
    try {
      const data = await handler(...args)
      ipcBridge.send(responseChannel, { data })
    } catch (err) {
      logger.error(`[StorageBridge] ${channel} 处理失败:`, err?.message || err)
      ipcBridge.send(responseChannel, { error: err?.message || String(err) })
    }
  })
}

let installed = false

export function installStorageBridge() {
  if (installed) {
    logger.warn('[StorageBridge] 重复调用 installStorageBridge，已跳过')
    return
  }

  // 从 preload 暴露的安全 API 获取通信能力（不直接 import electron）
  const ipcBridge = typeof window !== 'undefined' && window.electronAPI?.ipcBridge
  if (!ipcBridge) {
    logger.error('[StorageBridge] window.electronAPI.ipcBridge 不可用，无法注册')
    return
  }

  installed = true

  // 通道注册表（主进程调用渲染进程 storage 服务）
  listen(ipcBridge, 'storage:get-document', (id) => storageService.getDocument(id))
  listen(ipcBridge, 'storage:get-document-metadata', (limit, offset) =>
    storageService.getDocumentMetadata(limit, offset)
  )

  logger.info('[StorageBridge] IPC 监听器已注册（2 个通道）')
}
