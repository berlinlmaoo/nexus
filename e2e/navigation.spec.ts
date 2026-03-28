import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('Navigation (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('dashboard loads with sidebar', async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/)
    const sidebar = page.locator('nav, [data-testid="sidebar"], aside').first()
    await expect(sidebar).toBeVisible()
  })

  test('can navigate to projects', async ({ page }) => {
    await page.click('a[href="/projects"]')
    await page.waitForURL(/projects/)
    await expect(page).toHaveURL(/projects/)
  })

  test('can navigate to my tasks', async ({ page }) => {
    await page.click('a[href="/my-tasks"]')
    await page.waitForURL(/my-tasks/)
    await expect(page).toHaveURL(/my-tasks/)
  })

  test('can navigate to settings', async ({ page }) => {
    await page.click('a[href="/settings"]')
    await page.waitForURL(/settings/)
    await expect(page).toHaveURL(/settings/)
  })

  test('can navigate to teams', async ({ page }) => {
    await page.click('a[href="/teams"]')
    await page.waitForURL(/teams/)
    await expect(page).toHaveURL(/teams/)
  })
})
