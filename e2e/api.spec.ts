import { test, expect } from '@playwright/test'
import { login } from './helpers'

test.describe('API endpoints', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('GET /api/tasks returns tasks', async ({ page }) => {
    const response = await page.request.get('/api/tasks')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('GET /api/dashboard returns dashboard data', async ({ page }) => {
    const response = await page.request.get('/api/dashboard')
    expect(response.status()).toBe(200)
  })

  test('GET /api/notifications returns notifications', async ({ page }) => {
    const response = await page.request.get('/api/notifications')
    expect(response.status()).toBe(200)
  })

  test('unauthenticated request returns 401', async ({ request }) => {
    const response = await request.get('/api/tasks')
    expect(response.status()).toBe(401)
  })
})
