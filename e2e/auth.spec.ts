import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/login/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'invalid@test.com')
    await page.fill('input[type="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')
    await page.waitForURL(/login.*error/)
  })

  test('successful login redirects to dashboard', async ({ page }) => {
    await page.goto('/login')
    await page.fill('input[type="email"]', 'berlin@patsgroup.id')
    await page.fill('input[type="password"]', 'password123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/dashboard/, { timeout: 10000 })
    await expect(page).toHaveURL(/dashboard/)
  })

  test('register page loads', async ({ page }) => {
    await page.goto('/register')
    await expect(page).toHaveURL(/register/)
  })

  test('unauthenticated user redirected to login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/login/, { timeout: 10000 })
  })
})
