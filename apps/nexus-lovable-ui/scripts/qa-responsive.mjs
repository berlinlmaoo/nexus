import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.QA_BASE_URL || 'http://127.0.0.1:4178';
const OUT = path.resolve(process.cwd(), 'dogfood-output/nexus-responsive-qa');
const SHOTS = path.join(OUT, 'screenshots');
await fs.mkdir(SHOTS, { recursive: true });

const user = { id: 'u-berlin', name: 'Berlin QA', email: 'berlin.qa@nexus.local', avatar: null, role: 'OWNER' };
const taskA = { id: 'task-1', title: 'Lock launch checklist and owners', description: 'Make sure the mission can ship without missing dependencies.', status: 'TODO', priority: 'HIGH', dueDate: '2026-06-02T10:00:00.000Z', tags: ['launch','ops'], taskListId: 'lane-todo', assignees: [{ user }], _count: { comments: 2, subtasks: 1 } };
const taskB = { id: 'task-2', title: 'Review creative direction deck', description: 'Align Naren review notes with execution checklist.', status: 'IN_PROGRESS', priority: 'MEDIUM', dueDate: '2026-06-05T10:00:00.000Z', tags: ['creative'], taskListId: 'lane-progress', assignees: [{ user: { id: 'u-naren', name: 'Naren', email: 'naren@nexus.local' } }], _count: { comments: 1, subtasks: 0 } };
const taskC = { id: 'task-3', title: 'Archive shipped recap', description: 'Done item to validate hide-slayed filters.', status: 'DONE', priority: 'LOW', dueDate: '2026-05-28T10:00:00.000Z', tags: ['recap'], taskListId: 'lane-done', assignees: [{ user }], _count: { comments: 0, subtasks: 0 } };
const project = {
  id: 'proj-1', name: 'Jagain Launch Ops', description: 'Full QA sample project with lanes, docs, sprint, and task actions.', color: '#4eb301', icon: '🚀', status: 'ACTIVE', workspaceId: 'ws-1', totalTasks: 3, completedTasks: 1, progress: 33,
  _count: { members: 2, taskLists: 3, tasks: 3 },
  members: [{ userId: user.id, user }, { userId: 'u-naren', user: { id: 'u-naren', name: 'Naren', email: 'naren@nexus.local' } }],
  taskLists: [
    { id: 'lane-todo', name: 'To Do', position: 0, tasks: [taskA] },
    { id: 'lane-progress', name: 'In Progress', position: 1, tasks: [taskB] },
    { id: 'lane-done', name: 'Done', position: 2, tasks: [taskC] },
  ]
};
const projects = [project, { ...project, id: 'proj-2', name: 'Nightlife Ops', description: 'Second project for filtering and list view.', color: '#7b4dff', icon: '🌙', status: 'PLANNING', totalTasks: 2, completedTasks: 0, progress: 0, taskLists: [] }];
const docs = [{ id: 'doc-1', title: 'Launch SOP', contentText: 'QA doc body', updatedAt: '2026-05-30T12:00:00Z', author: user, project: { id: project.id, name: project.name, color: project.color } }];
const notifications = [{ id: 'notif-1', title: 'Review requested', message: 'Naren mentioned you on the launch deck.', type: 'mention', read: false, createdAt: '2026-05-30T12:00:00Z' }];
const sprints = [{ id: 'sprint-1', name: 'Launch Week 01', status: 'PLANNING', startDate: '2026-05-30T00:00:00Z', endDate: '2026-06-12T00:00:00Z', projectId: project.id, tasks: [{ id: 'st-1', task: taskA }] }];

function json(body, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
async function mockApi(page) {
  await page.route('**/*fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('**/*fonts.gstatic.com/**', route => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const pathname = url.pathname;
    if (pathname === '/api/user/profile') return route.fulfill(json({ user }));
    if (pathname === '/api/dashboard') return route.fulfill(json({
      stats: { totalTasks: 3, inProgressTasks: 1, overdueTasks: 0, completedThisWeek: 1 },
      tasks: [taskA, taskB, taskC],
      projects: projects.map(p => ({ id: p.id, name: p.name, color: p.color, totalTasks: p.totalTasks, completedTasks: p.completedTasks, progress: p.progress })),
      goals: [{ id: 'goal-1', title: 'Ship NEXUS Revamp', status: 'ON_TRACK', progress: 72, owner: 'Berlin' }],
      sprints: [{ id: 'sprint-1', name: 'Launch Week 01', project: project.name, projectColor: project.color, totalTasks: 2, completedTasks: 1, progress: 50 }],
      activity: [{ id: 'act-1', action: 'updated', details: 'QA fixture loaded', createdAt: '2026-05-30T12:00:00Z', project: { name: project.name }, task: { title: taskA.title } }]
    }));
    if (pathname === '/api/projects' && method === 'GET') return route.fulfill(json(projects));
    if (pathname === '/api/projects' && method === 'POST') return route.fulfill(json({ ...project, id: 'proj-new', name: 'Created QA Mission' }, 201));
    if (pathname === `/api/projects/${project.id}` || pathname === '/api/projects/proj-1') return route.fulfill(json(project));
    if (pathname.startsWith('/api/projects/')) return route.fulfill(json(project));
    if (pathname === '/api/tasks' && method === 'GET') return route.fulfill(json([taskA, taskB, taskC]));
    if (pathname === '/api/tasks' && method === 'POST') return route.fulfill(json({ ...taskA, id: 'task-new', title: 'Created QA task' }, 201));
    if (pathname.startsWith('/api/tasks/') && method === 'PATCH') return route.fulfill(json({ ...taskA, status: 'DONE' }));
    if (pathname === '/api/goals' && method === 'GET') return route.fulfill(json({ goals: [{ id: 'goal-1', title: 'Ship NEXUS Revamp', description: 'Make it usable everywhere.', status: 'ON_TRACK', progress: 72, dueDate: '2026-06-30T00:00:00Z', owner: user }] }));
    if (pathname === '/api/goals' && method === 'POST') return route.fulfill(json({ goal: { id: 'goal-new', title: 'Created QA Goal', status: 'ON_TRACK', progress: 0 } }, 201));
    if (pathname === '/api/docs' && method === 'GET') return route.fulfill(json({ docs }));
    if (pathname === '/api/docs' && method === 'POST') return route.fulfill(json({ doc: { ...docs[0], id: 'doc-new', title: 'Created QA Doc' } }, 201));
    if (pathname.startsWith('/api/docs/') && method === 'PATCH') return route.fulfill(json({ doc: docs[0] }));
    if (pathname.startsWith('/api/docs/') && method === 'DELETE') return route.fulfill(json({ success: true }));
    if (pathname === '/api/notifications' && method === 'GET') return route.fulfill(json({ notifications, unreadCount: 1 }));
    if (pathname === '/api/notifications' && method === 'PATCH') return route.fulfill(json({ success: true }));
    if (pathname === '/api/notifications' && method === 'DELETE') return route.fulfill(json({ success: true, deleted: 1 }));
    if (pathname === '/api/attendance/today') return route.fulfill(json({ attendanceDateKey: '2026-05-30', activeOfficeCount: 7, canManageAttendance: true, dayOffUsedThisMonth: 1, workspace: { id: 'ws-1', name: 'PATS HQ' }, today: null }));
    if (pathname === '/api/attendance/history') return route.fulfill(json({ rows: [{ id: 'att-1', attendanceDate: '2026-05-29', status: 'PRESENT', checkInAt: '2026-05-29T02:00:00Z', checkOutAt: '2026-05-29T10:00:00Z', workedMinutes: 480, user }] }));
    if (pathname === '/api/attendance/check-in' || pathname === '/api/attendance/check-out') return route.fulfill(json({ record: { id: 'att-new', status: 'PRESENT', checkInAt: new Date().toISOString() } }));
    if (pathname === '/api/sprints' && method === 'GET') return route.fulfill(json({ sprints }));
    if (pathname === '/api/sprints' && method === 'POST') return route.fulfill(json({ sprint: { ...sprints[0], id: 'sprint-new', name: 'Created QA Sprint', tasks: [] } }, 201));
    if (pathname === '/api/sprints' && method === 'PATCH') return route.fulfill(json({ sprint: { ...sprints[0], status: 'ACTIVE' } }));
    if (pathname === '/api/auth/direct-login') return route.fulfill(json({ ok: true, redirectTo: '/dashboard' }));
    return route.fulfill(json({ ok: true, rows: [], data: [] }));
  });
}

const routes = ['/dashboard','/projects','/projects/proj-1','/my-tasks','/goals','/docs','/inbox','/attendance','/reports','/forms','/teams','/settings','/portfolios','/master-calendar','/admin'];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];
const issues = [];
const results = [];
function addIssue(severity, category, route, viewport, title, detail, screenshot) { issues.push({ severity, category, route, viewport, title, detail, screenshot }); }
async function auditPage(page, route, viewport) {
  const errors = [];
  page.on('console', msg => { if (['error'].includes(msg.type())) errors.push(`console:${msg.text()}`); });
  page.on('pageerror', err => errors.push(`pageerror:${err.message}`));
  const res = await page.goto(`${BASE}${route}`, { waitUntil: 'commit', timeout: 12000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(900);
  const shotName = `${viewport.name}-${route.replace(/\W+/g,'-').replace(/^-|-$/g,'') || 'root'}.png`;
  const shot = path.join(SHOTS, shotName);
  await page.screenshot({ path: shot, fullPage: true });
  const metrics = await page.evaluate(() => {
    const bodyText = document.body.innerText || '';
    const buttons = [...document.querySelectorAll('button')].map((b) => ({ text: (b.innerText || b.getAttribute('aria-label') || b.title || '').trim(), disabled: b.disabled, hasHandler: !!b.onclick || b.getAttribute('type') === 'submit' || b.closest('form') !== null }));
    const links = [...document.querySelectorAll('a')].map(a => ({ text: (a.innerText || '').trim(), href: a.href }));
    return {
      title: document.title,
      text: bodyText.slice(0, 1000),
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      buttons,
      links,
      empty: bodyText.trim().length < 20,
    };
  });
  const overflow = Math.max(metrics.scrollWidth, metrics.bodyScrollWidth) - metrics.width;
  if (!res || res.status() >= 400) addIssue('High','Routing',route,viewport.name,`Route returned ${res?.status() ?? 'no response'}`, 'Route should load successfully under mocked authenticated QA.', shot);
  if (errors.length) addIssue('High','Console',route,viewport.name,'Console/page errors after load', errors.join('\n'), shot);
  if (overflow > 6) addIssue('Medium','Responsive',route,viewport.name,`Horizontal overflow ${overflow}px`, `document width=${metrics.width}, scrollWidth=${metrics.scrollWidth}, bodyScrollWidth=${metrics.bodyScrollWidth}`, shot);
  if (metrics.empty) addIssue('High','Rendering',route,viewport.name,'Page appears empty', metrics.text, shot);
  results.push({ route, viewport: viewport.name, status: res?.status(), overflow, buttons: metrics.buttons.length, screenshot: shot });
}

async function runInteractions(page) {
  const out = [];
  async function ready() {
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  async function selectFirstRealOption(locator) {
    const values = await locator.locator('option').evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
    if (values[0]) await locator.selectOption(values[0]);
  }
  async function step(name, fn) {
    const before = page.url();
    const errs = [];
    const onConsole = msg => { if (msg.type() === 'error') errs.push(msg.text()); };
    page.on('console', onConsole);
    try { await fn(); await page.waitForTimeout(250); out.push({ name, ok: !errs.length, urlBefore: before, urlAfter: page.url(), errors: errs }); }
    catch (e) { out.push({ name, ok: false, urlBefore: before, urlAfter: page.url(), errors: [String(e.message || e)] }); }
    finally { page.off('console', onConsole); }
  }
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await step('login fake credentials redirects dashboard', async () => {
    await page.goto(`${BASE}/login?callbackUrl=/dashboard`, { waitUntil: 'commit' });
    await ready();
    await page.getByPlaceholder('commander@nexus.app').fill('qa@nexus.local');
    await page.getByPlaceholder('••••••••').fill('not-a-secret');
    await page.getByRole('button', { name: /Enter Mission Control/i }).click();
  });

  await step('projects search/list/new mission/create', async () => {
    await page.goto(`${BASE}/projects`, { waitUntil: 'commit' });
    await ready();
    await page.getByPlaceholder(/Search missions/i).fill('Nightlife');
    await page.getByLabel('List view').click();
    await page.getByRole('button', { name: /New mission/i }).click();
    await page.getByPlaceholder(/Jagain Launch Ops/i).fill('QA Created Mission');
    await page.getByRole('button', { name: /Create mission/i }).click();
  });

  await step('my tasks create and toggle done', async () => {
    await page.goto(`${BASE}/my-tasks`, { waitUntil: 'commit' });
    await ready();
    await page.getByRole('button', { name: /New quest/i }).click();
    await page.getByPlaceholder(/Finalize booth deck/i).fill('QA New Quest');
    await selectFirstRealOption(page.locator('select').first());
    await page.waitForTimeout(400);
    await selectFirstRealOption(page.locator('select').nth(1));
    await page.getByRole('button', { name: /Create real NEXUS task/i }).click();
  });

  await step('project board tabs task create sprint/docs', async () => {
    await page.goto(`${BASE}/projects/proj-1`, { waitUntil: 'commit' });
    await ready();
    await page.getByRole('button', { name: /Spawn card/i }).first().click();
    await page.getByPlaceholder(/Task title/i).fill('QA Board Card');
    await page.getByRole('button', { name: /Create real board card/i }).click();
    await page.getByRole('button', { name: /Sprints/i }).click();
    await page.getByPlaceholder(/Sprint name/i).fill('QA Sprint');
    await page.getByRole('button', { name: /Create sprint/i }).click();
    await page.getByRole('button', { name: /Pages/i }).click();
    await page.getByRole('button', { name: /Add page/i }).click();
  });

  await step('docs create', async () => {
    await page.goto(`${BASE}/docs`, { waitUntil: 'commit' });
    await ready();
    await page.getByRole('button', { name: /New doc/i }).click();
    await page.getByPlaceholder(/Doc title/i).fill('QA Doc');
    await page.locator('select').first().selectOption('proj-1');
    await page.getByRole('button', { name: /Create real doc/i }).click();
  });

  await step('goals create', async () => {
    await page.goto(`${BASE}/goals`, { waitUntil: 'commit' });
    await ready();
    await page.getByRole('button', { name: /New goal/i }).click();
    await page.getByPlaceholder(/Goal title/i).fill('QA Goal');
    await page.locator('select').first().selectOption('ws-1');
    await page.getByRole('button', { name: /Create real goal/i }).click();
  });

  await step('inbox mark read/archive', async () => {
    await page.goto(`${BASE}/inbox`, { waitUntil: 'commit' });
    await ready();
    await page.getByRole('button', { name: /Mark all read/i }).click();
    const read = page.getByRole('button', { name: /^Read$/i }).first();
    if (await read.count()) await read.click();
  });

  return out;
}

const browser = await chromium.launch({ headless: true });
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  await mockApi(page);
  for (const route of routes) await auditPage(page, route, vp);
  await page.close();
}
const interactivePage = await browser.newPage();
const interactionResults = await runInteractions(interactivePage);
await interactivePage.close();
await browser.close();
for (const r of interactionResults) {
  if (!r.ok) addIssue('High','Functional','interaction','desktop',`Interaction failed: ${r.name}`, r.errors.join('\n'), null);
}

const report = `# NEXUS Responsive + Functional QA Report\n\nGenerated: ${new Date().toISOString()}\nTarget: ${BASE}\nMode: authenticated frontend QA with mocked NEXUS API fixtures + real preview server.\n\n## Summary\n- Routes tested: ${routes.length}\n- Viewports: ${viewports.map(v => `${v.name} ${v.width}x${v.height}`).join(', ')}\n- Page checks run: ${results.length}\n- Interaction flows run: ${interactionResults.length}\n- Issues found: ${issues.length}\n\n## Interaction Results\n${interactionResults.map(r => `- ${r.ok ? 'PASS' : 'FAIL'} — ${r.name}${r.errors.length ? ` — ${r.errors.join('; ')}` : ''}`).join('\n')}\n\n## Issues\n${issues.length ? issues.map((i, idx) => `### ${idx+1}. [${i.severity}] [${i.category}] ${i.title}\n- Route: ${i.route}\n- Viewport: ${i.viewport}\n- Detail: ${i.detail}\n- Screenshot: ${i.screenshot || 'n/a'}`).join('\n\n') : 'No issues detected in automated pass.'}\n\n## Route Matrix\n${results.map(r => `- ${r.viewport} ${r.route}: HTTP ${r.status}, overflow ${r.overflow}px, buttons ${r.buttons}, screenshot ${r.screenshot}`).join('\n')}\n`;
await fs.writeFile(path.join(OUT, 'report.md'), report);
await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify({ results, interactionResults, issues }, null, 2));
console.log(JSON.stringify({ out: OUT, issues: issues.length, interactions: interactionResults, issueTitles: issues.map(i => i.title) }, null, 2));
