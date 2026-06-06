/**
 * 版本互斥系统
 * 确保同一时间只有一个版本运行：开机多个版本同时启动时，只保留最高版本
 */

const { app } = require('electron')
const path = require('path')
const fs = require('fs')

let _versionLockFilePath = null
function getVersionLockFile() {
  if (!_versionLockFilePath) {
    _versionLockFilePath = path.join(app.getPath('userData'), 'version-lock.json')
  }
  return _versionLockFilePath
}
const HEARTBEAT_INTERVAL = 10000   // 心跳间隔 10 秒
const STALE_TIMEOUT = 30000        // 锁文件超过 30 秒无心跳视为过期

let versionLockTimer = null

/**
 * 解析语义化版本号为可比较的数组 [major, minor, patch]
 */
function parseVersion(ver) {
  if (!ver || typeof ver !== 'string') return [0, 0, 0]
  const parts = ver.split('.').map(n => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

/**
 * 比较两个版本号
 * @returns {number} 正数=ver1更高，0=相同，负数=ver2更高
 */
function compareVersions(ver1, ver2) {
  const a = parseVersion(ver1)
  const b = parseVersion(ver2)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/**
 * 读取版本锁文件
 */
function readVersionLock() {
  try {
    if (fs.existsSync(getVersionLockFile())) {
      return JSON.parse(fs.readFileSync(getVersionLockFile(), 'utf-8'))
    }
  } catch (e) { /* 文件损坏或被锁定，视为无锁 */ }
  return null
}

/**
 * 写入版本锁文件
 */
function writeVersionLock(data) {
  try {
    fs.writeFileSync(getVersionLockFile(), JSON.stringify(data, null, 2), 'utf-8')
  } catch (e) {
    console.error('[版本互斥] 写入锁文件失败:', e.message)
  }
}

/**
 * 检查进程是否存活
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return false
  }
}

/**
 * 执行版本互斥检查
 * 返回 true 表示当前实例应该退出（存在更高版本）
 */
function performVersionCheck() {
  const currentVersion = app.getVersion()
  const currentPath = process.execPath
  const currentPid = process.pid
  const now = Date.now()

  const lock = readVersionLock()

  if (!lock) {
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now
    })
    return false
  }

  const isStale = (now - lock.timestamp) > STALE_TIMEOUT
  const pidExists = isProcessAlive(lock.pid)

  if (isStale || !pidExists) {
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now
    })
    return false
  }

  const cmp = compareVersions(currentVersion, lock.version)
  if (cmp > 0) {
    writeVersionLock({
      version: currentVersion,
      path: currentPath,
      pid: currentPid,
      timestamp: now
    })
    return false
  } else if (cmp === 0) {
    return true
  } else {
    return true
  }
}

/**
 * 启动版本锁心跳定时器
 */
function startVersionHeartbeat() {
  const currentVersion = app.getVersion()
  versionLockTimer = setInterval(() => {
    const lock = readVersionLock()
    if (lock && lock.version !== currentVersion) {
      console.log(`[版本互斥] 检测到更高版本 ${lock.version}，当前 ${currentVersion} 即将退出`)
      app.quit()
      return
    }
    if (lock) {
      lock.timestamp = Date.now()
      writeVersionLock(lock)
    }
  }, HEARTBEAT_INTERVAL)
}

/**
 * 停止心跳
 */
function stopVersionHeartbeat() {
  if (versionLockTimer) {
    clearInterval(versionLockTimer)
    versionLockTimer = null
  }
}

/**
 * 清理版本锁文件（仅当自己是锁持有者时）
 */
function cleanupVersionLock() {
  const lock = readVersionLock()
  if (lock && lock.pid === process.pid) {
    try {
      fs.unlinkSync(getVersionLockFile())
    } catch (e) { /* ignore */ }
  }
}

module.exports = {
  performVersionCheck,
  startVersionHeartbeat,
  stopVersionHeartbeat,
  cleanupVersionLock,
  compareVersions
}
