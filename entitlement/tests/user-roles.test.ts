import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { and, eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, roles, users, userCompanies, userRoles } from '../src/db/schema'

// mock zitadel client กัน side-effect ตอน import chain (กติกาเดียวกับ user.test.ts — mock ทุก export)
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => 'user_mock_mng_' + Date.now()),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { userRouter } = await import('../src/modules/user/route')
const { resolveClaims } = await import('../src/claims/resolver')

const app = new Elysia().use(userRouter)
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.handle(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

const superadmin = bearer({ sub: 'z-sa', 'urn:platform:role': 'superadmin' })
// caller ฝั่ง tenant ที่ถือ tenant.user.manage (ใช้ทดสอบ guard ข้าม tenant)
const managerOf = (tenantId: number) => bearer({
  sub: 'z-mgr', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
  'urn:platform:grants': { '1': { roles: [], permissions: ['tenant.user.manage'] } },
})

let seq = 0
async function makeUserInTenant() {
  const slug = `mng-${Date.now()}-${++seq}`
  const [tenant] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  const [user] = await db.insert(users).values({ zitadelUserId: 'zu_' + slug, tenantId: tenant.id, email: slug + '@example.com' }).returning()
  return { tenant, user }
}

test('PATCH /users/:id/status disabled → resolver คืน {} ; กลับ active → สิทธิ์กลับมา', async () => {
  const { user } = await makeUserInTenant()
  const res = await req('PATCH', `/users/${user.id}/status`, { authorization: superadmin }, { status: 'disabled' })
  expect(res.status).toBe(200)
  expect(await resolveClaims(user.zitadelUserId)).toEqual({})

  const res2 = await req('PATCH', `/users/${user.id}/status`, { authorization: superadmin }, { status: 'active' })
  expect(res2.status).toBe(200)
  const claims = await resolveClaims(user.zitadelUserId) as { tenantId: number }
  expect(claims.tenantId).toBe(user.tenantId)
})

test('PATCH status: user ไม่มีจริง → 404 / caller ต่าง tenant → 403 / status นอก union → 422', async () => {
  const { tenant, user } = await makeUserInTenant()
  expect((await req('PATCH', '/users/999999/status', { authorization: superadmin }, { status: 'disabled' })).status).toBe(404)
  expect((await req('PATCH', `/users/${user.id}/status`, { authorization: managerOf(tenant.id + 1) }, { status: 'disabled' })).status).toBe(403)
  expect((await req('PATCH', `/users/${user.id}/status`, { authorization: superadmin }, { status: 'banned' })).status).toBe(422)
})

test('POST /users/:id/companies เพิ่ม membership; ยิงซ้ำ → row เดียว (idempotent)', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Co M' }).returning()
  expect((await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId: co.id })).status).toBe(200)
  expect((await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId: co.id })).status).toBe(200)
  const rows = await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id))
  expect(rows.map(r => r.companyId)).toEqual([co.id])
})

test('POST /users/:id/companies ด้วย company ของ tenant อื่น → 400 invalidCompany', async () => {
  const { user } = await makeUserInTenant()
  const { tenant: otherTenant } = await makeUserInTenant()
  const [alien] = await db.insert(companies).values({ tenantId: otherTenant.id, name: 'Alien Co' }).returning()
  const res = await req('POST', `/users/${user.id}/companies`, { authorization: superadmin }, { companyId: alien.id })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ invalidCompany: alien.id })
  expect((await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id))).length).toBe(0)
})

test('DELETE /users/:id/companies/:companyId ถอน membership + role ที่ scope company นั้น แต่ role tenant-wide อยู่ครบ', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Co D' }).returning()
  const [role] = await db.insert(roles).values({ tenantId: tenant.id, name: 'R', slug: `rm-co-${Date.now()}-${seq}` }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  await db.insert(userRoles).values([
    { userId: user.id, roleId: role.id, companyId: co.id },   // scoped — ต้องหาย
    { userId: user.id, roleId: role.id, companyId: null },    // tenant-wide — ต้องอยู่
  ])
  expect((await req('DELETE', `/users/${user.id}/companies/${co.id}`, { authorization: superadmin })).status).toBe(200)
  expect((await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id))).length).toBe(0)
  const ur = await db.select().from(userRoles).where(eq(userRoles.userId, user.id))
  expect(ur.length).toBe(1)
  expect(ur[0].companyId).toBeNull()
  // idempotent: ลบซ้ำได้
  expect((await req('DELETE', `/users/${user.id}/companies/${co.id}`, { authorization: superadmin })).status).toBe(200)
})
