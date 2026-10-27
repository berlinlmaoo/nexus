import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

// Owner bug 27 Oct 2026: "Harga" (a Rupiah NUMBER field) in a form-made task went back to the old amount after
// Enter. The row showed the old amount until the save's refetch came back; a click in that window opened the box
// on the old amount and leaving it wrote the old amount back. This checks, in the task popup:
//   - Enter / Tab / click elsewhere save what was typed, in every way people type an amount;
//   - reopening the box while the save is still on its way and leaving it does not write the old amount back;
//   - a plain number field reads the decimal mark of the UI language, and the API keeps a JSON number as it is.
//
// Needs a running NEXUS (PLAYWRIGHT_BASE_URL) and a test account that may create projects:
//   E2E_EMAIL, E2E_PASSWORD, E2E_WORKSPACE_ID. Skipped without them. Everything it creates is deleted.
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const WORKSPACE = process.env.E2E_WORKSPACE_ID
test.skip(!EMAIL || !PASSWORD || !WORKSPACE, 'E2E_EMAIL / E2E_PASSWORD / E2E_WORKSPACE_ID not set')

type Ctx = { cookie: { name: string; value: string }; projectId: string; taskId: string; rpId: string; numId: string }
let ctx: Ctx

async function api(request: APIRequestContext, path: string, init: { method?: string; data?: unknown } = {}) {
  const res = await request.fetch(path, { method: init.method ?? 'GET', data: init.data, headers: { cookie: `${ctx.cookie.name}=${ctx.cookie.value}`, 'x-nexus-client': 'web/1' } })
  return { status: res.status(), json: await res.json().catch(() => null) }
}
async function stored(request: APIRequestContext, fieldId: string) {
  const r = await api(request, `/api/custom-fields?projectId=${ctx.projectId}&taskId=${ctx.taskId}`)
  return (r.json?.fields ?? []).find((f: { id: string }) => f.id === fieldId)?.value as string
}

test.beforeAll(async ({ request, baseURL }) => {
  const login = await request.post('/api/auth/app-login', { data: { email: EMAIL, password: PASSWORD } })
  const b = await login.json()
  expect(login.ok(), 'login').toBe(true)
  ctx = { cookie: { name: b.cookieName, value: b.token }, projectId: '', taskId: '', rpId: '', numId: '' }
  const proj = await api(request, '/api/projects', { method: 'POST', data: { name: `[TEST] e2e number field ${Date.now()}`, workspaceId: WORKSPACE } })
  ctx.projectId = proj.json.id
  const detail = await api(request, `/api/projects/${ctx.projectId}`)
  const listId = (detail.json.project ?? detail.json).taskLists[0].id
  ctx.rpId = (await api(request, '/api/custom-fields', { method: 'POST', data: { projectId: ctx.projectId, name: 'Harga', type: 'NUMBER', options: { format: 'currency-idr' }, saveToLibrary: false } })).json.field.id
  ctx.numId = (await api(request, '/api/custom-fields', { method: 'POST', data: { projectId: ctx.projectId, name: 'Qty', type: 'NUMBER', options: null, saveToLibrary: false } })).json.field.id
  const task = await api(request, '/api/tasks', { method: 'POST', data: { title: '[TEST] e2e number field task', projectId: ctx.projectId, taskListId: listId } })
  ctx.taskId = task.json.task?.id ?? task.json.id
  expect(new URL(baseURL ?? 'http://x').hostname).not.toBe('nexus.znetworks.id') // never production
})

test.afterAll(async ({ request }) => {
  if (ctx?.projectId) await api(request, `/api/projects/${ctx.projectId}`, { method: 'DELETE' })
})

async function openTask(page: Page, lang: 'en' | 'id') {
  const host = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000').hostname
  await page.context().addCookies([{ name: ctx.cookie.name, value: ctx.cookie.value, domain: host, path: '/', secure: true, sameSite: 'Lax' }])
  await page.addInitScript((l) => { try { localStorage.setItem('nexus-appstore-never', '1'); localStorage.setItem('nexus-lang', l) } catch { /* private mode */ } }, lang)
  await page.goto(`/projects/${ctx.projectId}?task=${ctx.taskId}`)
  await expect(page.getByRole('button', { name: 'Harga' })).toBeVisible({ timeout: 20_000 })
}

async function type(page: Page, field: string, text: string, leave: 'Enter' | 'Tab' | 'click') {
  await page.getByRole('button', { name: field }).first().click()
  const box = page.getByRole('textbox', { name: field }).first()
  await box.press('ControlOrMeta+a')
  await box.press('Backspace')
  if (text) await box.pressSequentially(text, { delay: 15 })
  if (leave === 'click') await page.getByText(/^(Due date|Tenggat)$/).first().click() // a label: somewhere else in the popup
  else await box.press(leave)
}

test('Rupiah field saves every way an amount is typed', async ({ page, request }) => {
  await openTask(page, 'en')
  const cases: Array<[string, 'Enter' | 'Tab' | 'click', string]> = [
    ['10500000', 'Enter', '10500000'],
    ['10.500.000', 'Enter', '10500000'],
    ['12750000', 'Tab', '12750000'],
    ['-2500000', 'Enter', '-2500000'],
    ['9000000', 'click', '9000000'],
    ['', 'Enter', ''],
  ]
  for (const [text, leave, want] of cases) {
    await type(page, 'Harga', text, leave)
    await expect.poll(() => stored(request, ctx.rpId), { message: `${text} + ${leave}` }).toBe(want)
  }
})

test('reopening the box while a save is on its way does not write the old amount back', async ({ page, request }) => {
  await api(request, '/api/custom-fields', { method: 'PATCH', data: { id: ctx.rpId, taskId: ctx.taskId, value: '10500000' } })
  // A slow server: the field read after the save takes 1.5 s.
  await page.route(/\/api\/custom-fields\?/, async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue() })
  await openTask(page, 'en')
  await type(page, 'Harga', '11250000', 'Enter')
  await expect(page.getByRole('button', { name: 'Harga' })).toContainText('11.250.000') // the new amount at once
  await page.getByRole('button', { name: 'Harga' }).click()
  await expect(page.getByRole('textbox', { name: 'Harga' })).toHaveValue('11.250.000')
  await page.waitForTimeout(2500)
  await page.getByRole('textbox', { name: 'Harga' }).press('Tab')
  await page.waitForTimeout(2500)
  expect(await stored(request, ctx.rpId)).toBe('11250000')
})

test('a plain number reads the decimal mark of the UI language', async ({ page, request }) => {
  await openTask(page, 'en')
  await type(page, 'Qty', '1.234', 'Enter')
  await expect.poll(() => stored(request, ctx.numId)).toBe('1.234')
  await type(page, 'Qty', '1,500', 'Enter')
  await expect.poll(() => stored(request, ctx.numId)).toBe('1500')
  const id = await page.context().newPage()
  await openTask(id, 'id')
  await type(id, 'Qty', '2,5', 'Enter')
  await expect.poll(() => stored(request, ctx.numId)).toBe('2.5')
})

test('the API keeps a JSON number as it is', async ({ request }) => {
  for (const [value, want] of [[1.234, '1.234'], [10500000, '10500000'], [-3.75, '-3.75']] as const) {
    const r = await api(request, '/api/custom-fields', { method: 'PATCH', data: { id: ctx.numId, taskId: ctx.taskId, value } })
    expect(r.status).toBe(200)
    expect(await stored(request, ctx.numId)).toBe(want)
  }
  // The text the released apps send is still read the Indonesian way.
  await api(request, '/api/custom-fields', { method: 'PATCH', data: { id: ctx.rpId, taskId: ctx.taskId, value: 'Rp 10.500.000' } })
  expect(await stored(request, ctx.rpId)).toBe('10500000')
})
