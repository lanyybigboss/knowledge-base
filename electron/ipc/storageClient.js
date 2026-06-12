/**
 * Storage IPC 客户端（主进程侧）
 * 主进程通过 invokeRenderer 调用渲染进程的 storage 服务
 *
 * 解耦意义：
 *   - 替换之前散落在 main.js 中的 executeJavaScript('window.storageService?...') 字符串注入
 *   - 主进程不再依赖渲染进程全局对象
 *   - 渲染进程通过 storageBridge.js 注册监听器，类型安全
 *   - 协议集中管理，便于扩展和测试
 */

const { invokeRenderer } = require('./protocol')

class StorageIpcClient {
  constructor() {
    this.webContents = null
  }

  setWebContents(wc) {
    this.webContents = wc
  }

  async getDocument(id) {
    return invokeRenderer(this.webContents, 'storage:get-document', id)
  }

  async getDocumentMetadata(limit = 100, offset = 0) {
    return invokeRenderer(this.webContents, 'storage:get-document-metadata', limit, offset)
  }
}

// 单例
const storageIpcClient = new StorageIpcClient()

module.exports = storageIpcClient
