/**
 * 存储目录配置模块
 */

const { app } = require('electron')
const path = require('path')
const fs = require('fs')

let STORAGE_DIR
let UPLOADS_DIR
let CONFIG_DIR
let WATCHER_STATE_FILE
let SYNC_FILE

function initStorageDirectories() {
  const isDev = process.argv.includes('--dev')
  STORAGE_DIR = process.env.KB_STORAGE_DIR
    ? path.resolve(process.env.KB_STORAGE_DIR)
    : isDev
      ? path.resolve(__dirname, '..', 'data')
      : path.join(app.getPath('userData'), 'data')

  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true })
  }

  UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads')
  CONFIG_DIR = path.join(STORAGE_DIR, 'config')

  ;[UPLOADS_DIR, CONFIG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  WATCHER_STATE_FILE = path.join(CONFIG_DIR, 'watcher-state.json')
  SYNC_FILE = path.join(CONFIG_DIR, 'documents-sync.json')

  console.log(`[知识库] 数据存储目录: ${STORAGE_DIR}`)
  process.env.KB_STORAGE_DIR = STORAGE_DIR
  process.env.KB_UPLOADS_DIR = UPLOADS_DIR
}

function getStorageDir() { return STORAGE_DIR }
function getUploadsDir() { return UPLOADS_DIR }
function getConfigDir() { return CONFIG_DIR }
function getWatcherStateFile() { return WATCHER_STATE_FILE }
function getSyncFile() { return SYNC_FILE }

module.exports = {
  initStorageDirectories,
  getStorageDir,
  getUploadsDir,
  getConfigDir,
  getWatcherStateFile,
  getSyncFile
}
