import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies, userPermissions, permissions, modules, tenantModules, packages, packagePermissions } from '../src/db/schema'

// mock zitadel client กัน side-effect ตอน import chain (กติกาเดียวกับ user-roles.test.ts — mock ทุก export)
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => 'user_mock_perm_' + Date.now()),
  deleteZitadelOrg: mock(async () => {}),
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
// caller ฝั่ง tenant ที่ถือ tenant.user.manage แต่ไม่ใช่ groupcompanyadmin
const managerOf = (tenantId: number) => bearer({
  sub: 'z-mgr', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
  'urn:platform:grants': { '1': { roles: [], permissions: ['tenant.user.manage'] } },
})
// caller เป็น group admin ของ tenant นั้น
const groupAdminOf = (tenantId: number) => bearer({
  sub: 'z-ga', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
  'urn:platform:grants': { '1': { roles: ['groupcompanyadmin'], permissions: ['tenant.user.manage'] } },
})

async function enableModule(tenantId: number, key: string, enabled = true) {
  const [mod] = await db.select().from(modules).where(eq(modules.key, key))
  await db.insert(tenantModules).values({ tenantId, moduleId: mod.id, enabled })
    .onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleId], set: { enabled } })
}

let seq = 0
async function makeUserInTenant() {
  const slug = `perm-${Date.now()}-${++seq}`
  const [tenant] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  await enableModule(tenant.id, 'esign')
  const [user] = await db.insert(users).values({ zitadelUserId: 'zu_' + slug, tenantId: tenant.id, email: slug + '@example.com' }).returning()
  return { tenant, user }
}

test('PUT /users/:id/permissions เขียนแล้ว resolver เห็น; PUT ซ้ำ = replace ไม่ accumulate', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  const put = (keys: string[]) => req('PUT', `/users/${user.id}/permissions`, { authorization: superadmin }, { companyId: co.id, position: 'staff', permissionKeys: keys })
  expect((await put(['esign.document.read', 'esign.document.sign'])).status).toBe(200)
  expect((await resolveClaims(user.zitadelUserId) as any).grants[String(co.id)].permissions.sort()).toEqual(['esign.document.read', 'esign.document.sign'])
  expect((await put(['esign.document.read'])).status).toBe(200)   // replace
  expect((await resolveClaims(user.zitadelUserId) as any).grants[String(co.id)].permissions).toEqual(['esign.document.read'])
})

test('PUT permissions: ไม่เป็นสมาชิก company → 400, key มั่ว → 404 missing, key เกินแพ็ค → 400 overPackage', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  const [alienCo] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Alien' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })

  // ไม่เป็นสมาชิก company → 400
  const notMember = await req('PUT', `/users/${user.id}/permissions`, { authorization: superadmin }, { companyId: alienCo.id, permissionKeys: ['esign.document.read'] })
  expect(notMember.status).toBe(400)
  expect(await notMember.json()).toEqual({ invalidCompany: alienCo.id })

  // key มั่ว → 404 missing
  const missing = await req('PUT', `/users/${user.id}/permissions`, { authorization: superadmin }, { companyId: co.id, permissionKeys: ['no.such.key'] })
  expect(missing.status).toBe(404)
  expect(await missing.json()).toEqual({ missing: ['no.such.key'] })

  // key เกินแพ็ค → 400 overPackage — package มีแค่ sign, ผูก tenant, PUT send
  const signPerm = (await db.select().from(permissions).where(eq(permissions.key, 'esign.document.sign')))[0]
  const [pkg] = await db.insert(packages).values({ name: 'P', slug: 'p-' + Date.now(), seatLimit: 5, companyLimit: 1, adminLimit: 1 }).returning()
  await db.insert(packagePermissions).values({ packageId: pkg.id, permissionId: signPerm.id })
  await db.update(tenants).set({ packageId: pkg.id }).where(eq(tenants.id, tenant.id))
  const over = await req('PUT', `/users/${user.id}/permissions`, { authorization: superadmin }, { companyId: co.id, permissionKeys: ['esign.document.send'] })
  expect(over.status).toBe(400)
  expect(await over.json()).toEqual({ overPackage: ['esign.document.send'] })
})

test('PATCH /users/:id/admin ตั้ง/ถอน company admin + group admin — caller ต้องเป็น groupcompanyadmin/superadmin', async () => {
  const { tenant, user } = await makeUserInTenant()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: superadmin }, { companyId: co.id, admin: true })).status).toBe(200)
  expect((await db.select().from(userCompanies).where(eq(userCompanies.userId, user.id)))[0].isAdmin).toBe(true)
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: superadmin }, { groupAdmin: true })).status).toBe(200)
  expect((await db.select().from(users).where(eq(users.id, user.id)))[0].isGroupAdmin).toBe(true)
  // caller เป็นแค่ manager (ไม่ใช่ group admin) → 403
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: managerOf(tenant.id) }, { groupAdmin: false })).status).toBe(403)
  // caller เป็น groupcompanyadmin จริง → 200
  expect((await req('PATCH', `/users/${user.id}/admin`, { authorization: groupAdminOf(tenant.id) }, { groupAdmin: false })).status).toBe(200)
})

test('GET /users/tenant/:tenantId คืน user + position + isAdmin; caller ต่าง tenant → 403', async () => {
  const { tenant, user: u1 } = await makeUserInTenant()
  const slug2 = `perm-${Date.now()}-${++seq}`
  const [u2] = await db.insert(users).values({ zitadelUserId: 'zu_' + slug2, tenantId: tenant.id, email: slug2 + '@example.com' }).returning()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values([
    { userId: u1.id, companyId: co.id, position: 'staff', isAdmin: false },
    { userId: u2.id, companyId: co.id, position: 'manager', isAdmin: true },
  ])
  const res = await req('GET', `/users/tenant/${tenant.id}`, { authorization: superadmin })
  expect(res.status).toBe(200)
  const list = await res.json() as any[]
  expect(list.length).toBe(2)
  const r1 = list.find(u => u.id === u1.id)
  const r2 = list.find(u => u.id === u2.id)
  expect(r1.email).toBe(u1.email)
  expect(r1.status).toBe('active')
  expect(r1.isGroupAdmin).toBe(false)
  expect(r1.memberships).toEqual([{ companyId: co.id, position: 'staff', isAdmin: false }])
  expect(r2.memberships).toEqual([{ companyId: co.id, position: 'manager', isAdmin: true }])

  // caller ต่าง tenant → 403
  const alien = await req('GET', `/users/tenant/${tenant.id}`, { authorization: managerOf(tenant.id + 9999) })
  expect(alien.status).toBe(403)
})

test('PUT permissions: ยัด management key (tenant.user.manage) เข้า user_permissions → 403 forbiddenKeys เสมอ แม้ tenant ไม่มีแพ็ค (allowedKeys = unrestricted)', async () => {
  const { tenant, user } = await makeUserInTenant()   // ไม่มีแพ็ค → allowedKeys = null = unrestricted ถ้าไม่เช็ค forbidden ก่อน
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  const res = await req('PUT', `/users/${user.id}/permissions`, { authorization: managerOf(tenant.id) },
    { companyId: co.id, permissionKeys: ['tenant.user.manage'] })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ forbiddenKeys: ['tenant.user.manage'] })
  const rows = await db.select().from(userPermissions).where(eq(userPermissions.userId, user.id))
  expect(rows).toEqual([])
})
