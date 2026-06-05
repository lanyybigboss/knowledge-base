/**
 * 快速启动脚本
 * 用法: node electron/launcher.js
 */
const { spawn } = require('child_process')
const path = require('path')

const exePath = path.join(__dirname, '..', 'release', 'win-unpacked', '知识库管理系统.exe')
console.log(`启动: ${exePath}`)
spawn(exePath, [], { stdio: 'inherit' })
