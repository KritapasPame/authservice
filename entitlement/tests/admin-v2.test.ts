import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies, packages } from '../src/db/schema'
import { env } from '../src/config/env'

// mock zitadel client — ทุก export ต้อง mock (process-global, ดู comment เดียวกันใน admin.test.ts)
// events มี resourceOwner (org id) เพื่อทดสอบ /admin/logins?tenantId= filter ฝั่งเรา
const TARGET_ORG = 'org-target-' + Date.now()
const OTHER_ORG = 'org-other-' + Date.now()
const mockEvents = {
  events: [
    { type: 'user.token.added', userId: 'zu-target', resourceOwner: TARGET_ORG, creationDate: '2026-07-14T00:00:00Z' },
    { type: 'user.token.added', userId: 'zu-other', resourceOwner: OTHER_ORG, creationDate: '2026-07-14T00:00:00Z' },
  ],
}
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => 'user_mock'),
  deleteZitadelOrg: mock(async () => {}),
  listLoginEvents: mock(async () => mockEvents),
}))

const { adminRouter } = await import('../src/modules/admin/route')

const get = (path: string, headers: Record<string, string>) =>
  new Elysia().use(adminRouter).handle(new Request(`http://localhost${path}`, { headers }))

const superAuth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
const tenantAdminAuth = bearer({ sub: 'z2', 'urn:platform:role': 'tenant_admin' })

let seq = 0
async function makeTenant(zitadelOrgId?: string) {
  const slug = 'admin-v2-t-' + Date.now() + '-' + (++seq)
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: zitadelOrgId ?? 'org_' + slug }).returning()
  return row
}

async function makeCompany(tenantId: number, name: string, status = 'active') {
  const [row] = await db.insert(companies).values({ tenantId, name, status }).returning()
  return row
}

async function makeUser(tenantId: number) {
  const zid = 'zu-' + Date.now() + '-' + (++seq)
  const [row] = await db.insert(users).values({ zitadelUserId: zid, tenantId, email: zid + '@example.com' }).returning()
  return row
}

async function makePackage() {
  const slug = 'admin-v2-pkg-' + Date.now() + '-' + (++seq)
  const [row] = await db.insert(packages).values({ name: 'Pkg ' + slug, slug, seatLimit: 5, companyLimit: 3, adminLimit: 2 }).returning()
  return row
}

test('GET /admin/overview shows package slug + seatLimit for tenant with a package bound', async () => {
  const pkg = await makePackage()
  const tenant = await makeTenant()
  await db.update(tenants).set({ packageId: pkg.id }).where(eq(tenants.id, tenant.id))

  const res = await get('/admin/overview', { authorization: superAuth })
  expect(res.status).toBe(200)
  const body = await res.json() as { tenants: { id: number; package: string | null; seatLimit: number | null }[] }
  const row = body.tenants.find(t => t.id === tenant.id)!
  expect(row.package).toBe(pkg.slug)
  expect(row.seatLimit).toBe(5)
})

test('GET /admin/tenants/:id returns usage + per-company breakdown matching seeded data', async () => {
  const pkg = await makePackage()
  const tenant = await makeTenant()
  await db.update(tenants).set({ packageId: pkg.id }).where(eq(tenants.id, tenant.id))

  const coActive = await makeCompany(tenant.id, 'Co Active', 'active')
  const coDisabled = await makeCompany(tenant.id, 'Co Disabled', 'disabled')

  const u1 = await makeUser(tenant.id)
  const u2 = await makeUser(tenant.id)
  const u3 = await makeUser(tenant.id)
  await db.insert(userCompanies).values([
    { userId: u1.id, companyId: coActive.id, isAdmin: true },
    { userId: u2.id, companyId: coActive.id, isAdmin: false },
    { userId: u3.id, companyId: coDisabled.id, isAdmin: true },
  ])

  const res = await get(`/admin/tenants/${tenant.id}`, { authorization: superAuth })
  expect(res.status).toBe(200)
  const body = await res.json() as {
    tenant: { id: number }
    package: { slug: string }
    usage: { seats: number; companies: number; admins: number }
    companies: { id: number; name: string; status: string; users: number; admins: number }[]
  }

  expect(body.tenant.id).toBe(tenant.id)
  expect(body.package.slug).toBe(pkg.slug)
  expect(body.usage.seats).toBe(3)          // active users ทั้งหมดใน tenant
  expect(body.usage.companies).toBe(1)      // company active เท่านั้น
  expect(body.usage.admins).toBe(2)         // isAdmin=true ทั้ง 2 membership (ทั้ง 2 company)

  const rowActive = body.companies.find(c => c.id === coActive.id)!
  expect(rowActive.users).toBe(2)
  expect(rowActive.admins).toBe(1)
  const rowDisabled = body.companies.find(c => c.id === coDisabled.id)!
  expect(rowDisabled.status).toBe('disabled')
  expect(rowDisabled.users).toBe(1)
  expect(rowDisabled.admins).toBe(1)
})

test('GET /admin/tenants/:id ที่ไม่มีจริง → 404', async () => {
  const res = await get('/admin/tenants/999999999', { authorization: superAuth })
  expect(res.status).toBe(404)
})

test('GET /admin/tenants/:id ไม่ใช่ superadmin → 403', async () => {
  const tenant = await makeTenant()
  const res = await get(`/admin/tenants/${tenant.id}`, { authorization: tenantAdminAuth })
  expect(res.status).toBe(403)
})

test('GET /admin/logins?tenantId= กรอง events ด้วย zitadelOrgId ของ tenant นั้น', async () => {
  const originalUrl = env.ZITADEL_MGMT_URL
  const originalToken = env.ZITADEL_MGMT_TOKEN
  env.ZITADEL_MGMT_URL = 'http://zitadel.test'
  env.ZITADEL_MGMT_TOKEN = 'test-pat'
  try {
    const tenant = await makeTenant(TARGET_ORG)
    const res = await get(`/admin/logins?tenantId=${tenant.id}`, { authorization: superAuth })
    expect(res.status).toBe(200)
    const body = await res.json() as { events: { userId: string; resourceOwner: string }[] }
    expect(body.events.length).toBe(1)
    expect(body.events[0].userId).toBe('zu-target')
  } finally {
    env.ZITADEL_MGMT_URL = originalUrl
    env.ZITADEL_MGMT_TOKEN = originalToken
  }
})

test('GET /admin/logins ไม่มี tenantId → ไม่กรอง (คืนทุก event)', async () => {
  const originalUrl = env.ZITADEL_MGMT_URL
  const originalToken = env.ZITADEL_MGMT_TOKEN
  env.ZITADEL_MGMT_URL = 'http://zitadel.test'
  env.ZITADEL_MGMT_TOKEN = 'test-pat'
  try {
    const res = await get('/admin/logins', { authorization: superAuth })
    expect(res.status).toBe(200)
    const body = await res.json() as { events: { userId: string }[] }
    expect(body.events.length).toBe(2)
  } finally {
    env.ZITADEL_MGMT_URL = originalUrl
    env.ZITADEL_MGMT_TOKEN = originalToken
  }
})

test('GET /admin/logins?tenantId= ที่ไม่มีจริง → 404', async () => {
  const originalUrl = env.ZITADEL_MGMT_URL
  const originalToken = env.ZITADEL_MGMT_TOKEN
  env.ZITADEL_MGMT_URL = 'http://zitadel.test'
  env.ZITADEL_MGMT_TOKEN = 'test-pat'
  try {
    const res = await get('/admin/logins?tenantId=999999999', { authorization: superAuth })
    expect(res.status).toBe(404)
  } finally {
    env.ZITADEL_MGMT_URL = originalUrl
    env.ZITADEL_MGMT_TOKEN = originalToken
  }
})
