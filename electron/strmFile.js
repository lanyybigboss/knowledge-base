/**
 * Strm 引用文件辅助模块
 * .strm 文件是一个纯文本文件，内容为原始文件的绝对路径
 */

const path = require('path')
const fs = require('fs')

/**
 * 创建 .strm 引用文件
 * @param {string} originalFilePath - 原始文件的绝对路径
 * @param {string} strmFileName - .strm 文件名（不含路径）
 * @param {string} uploadsDir - uploads 目录路径
 * @returns {{ success: boolean, filePath?: string, error?: string }}
 */
function createStrmFile(originalFilePath, strmFileName, uploadsDir) {
  try {
    const safeName = strmFileName.replace(/[<>:"/\\|?*]/g, '_')
    const finalName = safeName.endsWith('.strm') ? safeName : safeName + '.strm'
    const strmFilePath = path.join(uploadsDir, finalName)
    fs.writeFileSync(strmFilePath, originalFilePath, 'utf-8')
    console.log(`[Strm] 创建引用文件: ${strmFilePath} → ${originalFilePath}`)
    return { success: true, filePath: strmFilePath }
  } catch (e) {
    console.error('[Strm] 创建引用文件失败:', e)
    return { success: false, error: e.message }
  }
}

/**
 * 读取 .strm 文件，获取原始文件路径
 */
function readStrmFile(strmFilePath) {
  try {
    if (!fs.existsSync(strmFilePath)) {
      return { success: false, error: '引用文件不存在' }
    }
    const originalPath = fs.readFileSync(strmFilePath, 'utf-8').trim()
    if (!originalPath) {
      return { success: false, error: '引用文件内容为空' }
    }
    return { success: true, originalPath }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

/**
 * 如果文件路径指向 .strm 文件，解析出原始路径；否则直接返回原路径
 */
function resolveStrmPath(filePath) {
  if (filePath && filePath.toLowerCase().endsWith('.strm')) {
    const result = readStrmFile(filePath)
    if (result.success && result.originalPath) {
      return result.originalPath
    }
  }
  return filePath
}

module.exports = { createStrmFile, readStrmFile, resolveStrmPath }
