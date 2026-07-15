import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, users, modules, tenantModules } from '../src/db/schema'
import { env } from '../src/config/env'

// mock zitadel client — /admin/logins ต้อง passthrough ผ่าน listLoginEvents() เท่านั้น ไม่ยิง network จริง
// mock.module เป็น process-global — ต้อง mock ทุก export ของโมดูล ไม่งั้น tenant.test.ts/user.test.ts ที่ import
// ไฟล์เดียวกันในโปรเซสเดียวกันจะพัง
const mockEvents = { events: [{ type: 'user.token.added', userId: 'z-mock', creationDate: '2026-07-14T00:00:00Z' }] }
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => 'user_mock'),
  listLoginEvents: mock(async () => mockEvents),
}))

const { adminRouter } = await import('../src/modules/admin/route')

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

async function makeCompany(tenantId: number, name: string) {
  const [row] = await db.insert(companies).values({ tenantId, name }).returning()
  return row.id
}

async function makeUser(tenantId: number, zitadelUserId: string) {
  await db.insert(users).values({ zitadelUserId, tenantId, email: zitadelUserId + '@example.com' })
}

const get = (path: string, headers: Record<string, string>) =>
  new Elysia().use(adminRouter).handle(new Request(`http://localhost${path}`, { headers }))

const superAuth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
const tenantAdminAuth = bearer({ sub: 'z2', 'urn:platform:role': 'tenant_admin' })

test('GET /admin/overview returns correct counts + enabled modules for seeded tenants', async () => {
  const suffix = 'admin-ov-' + Date.now()
  const t1 = await makeTenant('t1-' + suffix)
  const t2 = await makeTenant('t2-' + suffix)

  await makeCompany(t1, 'Co A')
  await makeCompany(t1, 'Co B')
  await makeCompany(t2, 'Co C')

  await makeUser(t1, 'zu1-' + suffix)
  await makeUser(t1, 'zu2-' + suffix)
  await makeUser(t1, 'zu3-' + suffix)
  await makeUser(t2, 'zu4-' + suffix)

  const [mod] = await db.insert(modules).values({ key: 'mod-' + suffix, name: 'Mod ' + suffix }).returning()
  await db.insert(tenantModules).values({ tenantId: t1, moduleId: mod.id, enabled: true })

  const res = await get('/admin/overview', { authorization: superAuth })
  expect(res.status).toBe(200)
  const body = await res.json() as { tenantId: number; name: string; userCount: number; companyCount: number; enabledModules: string[] }[]

  const row1 = body.find(r => r.tenantId === t1)!
  const row2 = body.find(r => r.tenantId === t2)!
  expect(row1.userCount).toBe(3)
  expect(row1.companyCount).toBe(2)
  expect(row1.enabledModules).toContain('mod-' + suffix)
  expect(row2.userCount).toBe(1)
  expect(row2.companyCount).toBe(1)
  expect(row2.enabledModules).not.toContain('mod-' + suffix)
})

test('GET /admin/overview row key-set is exactly the five allowed keys — no business data leaks (PDPA boundary)', async () => {
  const suffix = 'admin-keys-' + Date.now()
  await makeTenant('t-' + suffix)

  const res = await get('/admin/overview', { authorization: superAuth })
  expect(res.status).toBe(200)
  const body = await res.json() as Record<string, unknown>[]
  expect(body.length).toBeGreaterThan(0)
  for (const row of body) {
    expect(Object.keys(row).sort()).toEqual(['companyCount', 'enabledModules', 'name', 'tenantId', 'userCount'])
  }
})

test('GET /admin/overview as non-superadmin → 403', async () => {
  const res = await get('/admin/overview', { authorization: tenantAdminAuth })
  expect(res.status).toBe(403)
})

test('GET /admin/overview with no token → 401', async () => {
  const res = await get('/admin/overview', {})
  expect(res.status).toBe(401)
})

test('GET /admin/logins with no zitadel mgmt config → 501', async () => {
  const originalUrl = env.ZITADEL_MGMT_URL
  const originalToken = env.ZITADEL_MGMT_TOKEN
  env.ZITADEL_MGMT_URL = ''
  env.ZITADEL_MGMT_TOKEN = ''
  try {
    const res = await get('/admin/logins', { authorization: superAuth })
    expect(res.status).toBe(501)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('zitadel mgmt not configured')
  } finally {
    env.ZITADEL_MGMT_URL = originalUrl
    env.ZITADEL_MGMT_TOKEN = originalToken
  }
})

test('GET /admin/logins with zitadel mgmt configured → passthrough events from listLoginEvents()', async () => {
  const originalUrl = env.ZITADEL_MGMT_URL
  const originalToken = env.ZITADEL_MGMT_TOKEN
  env.ZITADEL_MGMT_URL = 'http://zitadel.test'
  env.ZITADEL_MGMT_TOKEN = 'test-pat'
  try {
    const res = await get('/admin/logins', { authorization: superAuth })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(mockEvents)
  } finally {
    env.ZITADEL_MGMT_URL = originalUrl
    env.ZITADEL_MGMT_TOKEN = originalToken
  }
})

test('GET /admin/logins as non-superadmin → 403', async () => {
  const res = await get('/admin/logins', { authorization: tenantAdminAuth })
  expect(res.status).toBe(403)
})

test('GET /admin/logins with no token → 401', async () => {
  const res = await get('/admin/logins', {})
  expect(res.status).toBe(401)
})
