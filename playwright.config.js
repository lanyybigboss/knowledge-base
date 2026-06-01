// @ts-check
const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['**/*.test.js', '**/e2e/**/*.spec.js'],
  testIgnore: ['**/example.spec.js'],
  /* 串行执行，E2E 启动 Electron 不能并行 */
  fullyParallel: false,
  workers: 1,
  /* 超时设置 */
  timeout: 60000,
  /* 失败重试 */
  retries: 0,
  /* 报告 */
  reporter: 'html',
  use: {
    /* 失败时截图 */
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  /* 自动启动 Vite 开发服务器（仅用于 E2E 测试） */
  webServer: {
    command: 'npx vite --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
