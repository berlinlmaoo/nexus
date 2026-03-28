import { Page } from '@playwright/test'

export async function login(page: Page, email = 'berlin@patsgroup.id', password = 'password123') {
  await page.goto('/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/dashboard/, { timeout: 10000 })
}
