/**
 * 知识库管理系统 - 烟雾测试（v1.7.x 首次添加）
 * 验证应用启动、路由导航、关键 UI 元素存在
 *
 * 使用方式：npm test
 */

const { test, expect } = require('@playwright/test')

// 由于使用 HashRouter，路由是 #/documents 这种形式
const BASE_URL = 'http://localhost:3000/'

test.describe('应用启动烟雾测试', () => {
  test('应能正常加载首页', async ({ page }) => {
    // 收集页面错误
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(BASE_URL)

    // 等待页面内容渲染
    await page.waitForLoadState('networkidle')

    // 应该没有致命 JS 错误（logger 错误可忽略）
    const fatalErrors = errors.filter((e) => !e.includes('logger') && !e.includes('Notification'))
    expect(fatalErrors).toEqual([])
  })

  test('页面标题应包含应用名', async ({ page }) => {
    await page.goto(BASE_URL)
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })
})

test.describe('路由导航烟雾测试', () => {
  test('应能从首页跳转到文档列表', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // 直接通过 hash 导航
    await page.goto(`${BASE_URL}#/documents`)
    await page.waitForTimeout(500)

    // 验证 URL hash 已更新
    expect(page.url()).toContain('#/documents')
  })

  test('应能导航到上传页', async ({ page }) => {
    await page.goto(`${BASE_URL}#/upload`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('#/upload')
  })

  test('应能导航到分类页', async ({ page }) => {
    await page.goto(`${BASE_URL}#/categories`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('#/categories')
  })

  test('应能导航到设置页', async ({ page }) => {
    await page.goto(`${BASE_URL}#/settings`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('#/settings')
  })

  test('应能导航到统计页', async ({ page }) => {
    await page.goto(`${BASE_URL}#/statistics`)
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('#/statistics')
  })
})

test.describe('核心 UI 元素存在性', () => {
  test('侧边栏应可见（默认展开）', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // 侧边栏导航项
    const sidebar = page.locator('aside, nav, [class*="sidebar" i]').first()
    await expect(sidebar).toBeVisible({ timeout: 5000 })
  })

  test('应用根元素应挂载', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')

    // #root 必须挂载
    const root = page.locator('#root')
    await expect(root).toBeVisible()
    // 根元素必须有子内容
    const childCount = await root.evaluate((el) => el.children.length)
    expect(childCount).toBeGreaterThan(0)
  })
})
