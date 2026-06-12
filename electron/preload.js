/**
 * Electron 预加载脚本
 * 安全地暴露 IPC 接口给渲染进程
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 存储信息
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),

  // 文件操作
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  locateFile: (filePath) => ipcRenderer.invoke('locate-file', filePath),

  // 选择文件夹
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // 保存上传文件
  saveUploadFile: (data) => ipcRenderer.invoke('save-upload-file', data),

  // ===== Strm 引用文件操作 =====
  /** 创建 .strm 引用文件（内容为原始文件路径） */
  saveStrmFile: (data) => ipcRenderer.invoke('save-strm-file', data),
  /** 读取 .strm 引用文件，获取原始文件路径 */
  readStrmFile: (strmFilePath) => ipcRenderer.invoke('read-strm-file', strmFilePath),
  /** 删除 .strm 引用文件 */
  deleteStrmFile: (strmFilePath) => ipcRenderer.invoke('delete-strm-file', strmFilePath),

  // 文件夹监控（多文件夹）
  watcherStart: (data) => ipcRenderer.invoke('watcher-start', data),
  watcherStop: () => ipcRenderer.invoke('watcher-stop'),
  watcherStatus: () => ipcRenderer.invoke('watcher-status'),
  watcherFiles: () => ipcRenderer.invoke('watcher-files'),
  /** 添加单个监控文件夹 */
  watcherAdd: (folderPath) => ipcRenderer.invoke('watcher-add', folderPath),
  /** 移除单个监控文件夹 */
  watcherRemove: (folderPath) => ipcRenderer.invoke('watcher-remove', folderPath),

  // 待处理的 Strm 文件列表
  getPendingStrmFiles: () => ipcRenderer.invoke('watcher-pending-files'),
  // 标记 Strm 文件已处理
  markStrmProcessed: (strmFileName) => ipcRenderer.invoke('watcher-mark-processed', strmFileName),
  // 读取原始文件内容（base64）
  readOriginalFile: (filePath) => ipcRenderer.invoke('read-raw-file', filePath),

  // 监听监控事件
  onWatcherEvent: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('watcher-event', handler)
    return () => ipcRenderer.removeListener('watcher-event', handler)
  },

  // ===== 跨模式数据同步 =====
  syncWrite: (data) => ipcRenderer.invoke('sync-write', data),
  syncRead: () => ipcRenderer.invoke('sync-read'),
  syncTimestamp: () => ipcRenderer.invoke('sync-timestamp'),

  // ===== 开机自启动 =====
  getAutoStart: () => ipcRenderer.invoke('get-auto-start'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-auto-start', enabled),

  // ===== 后台分析子进程 =====
  analyzerAnalyze: (data) => ipcRenderer.invoke('analyzer-analyze', data),
  analyzerStatus: () => ipcRenderer.invoke('analyzer-status'),
  onAnalyzerProgress: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('analyzer-progress', handler)
    return () => ipcRenderer.removeListener('analyzer-progress', handler)
  },
  onAnalyzerResult: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('analyzer-result', handler)
    return () => ipcRenderer.removeListener('analyzer-result', handler)
  },
  onAnalyzerError: (callback) => {
    const handler = (_, data) => callback(data)
    ipcRenderer.on('analyzer-error', handler)
    return () => ipcRenderer.removeListener('analyzer-error', handler)
  },

  // ===== 调试接口（供 Trae 等外部工具调用）=====
  debugGetStatus: () => ipcRenderer.invoke('debug-get-status'),
  debugGetLogs: (lines) => ipcRenderer.invoke('debug-get-logs', lines),
  debugSuspend: () => ipcRenderer.invoke('debug-suspend'),
  debugResume: () => ipcRenderer.invoke('debug-resume'),
  debugManualAnalyze: (docId) => ipcRenderer.invoke('debug-manual-analyze', docId),
  debugHealthCheck: () => ipcRenderer.invoke('debug-health-check'),

  // ===== v1.7.0 解耦：Storage IPC Bridge =====
  // 让主进程通过 webContents.send 主动调用渲染进程的 storage 服务
  // 渲染进程通过 ipcBridge.on 监听 + ipcBridge.send 回执
  // （替代主进程中的 executeJavaScript 字符串注入）
  ipcBridge: {
    on: (channel, callback) => {
      const handler = (_, payload) => callback(payload)
      ipcRenderer.on(channel, handler)
      return () => ipcRenderer.removeListener(channel, handler)
    },
    send: (channel, data) => ipcRenderer.send(channel, data)
  }
})
