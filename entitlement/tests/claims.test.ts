import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies, userPermissions, permissions, modules, tenantModules, platformAdmins, packages, packagePermissions } from '../src/db/schema'
import { env } from '../src/config/env'
import type { PlatformClaims, Grant } from '@platform/contracts'

const { seedBase } = await import('../src/db/seed')
const { resolveClaims } = await import('../src/claims/resolver')
const { claimsRouter } = await import('../src/claims/route')

// PlatformClaims is a union — narrow to the "provisioned tenant user" shape for test assertions
type TenantClaims = { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant> }

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

async function makeCompany(tenantId: number, name: string) {
  const [row] = await db.insert(companies).values({ tenantId, name }).returning()
  return row.id
}

async function makeUser(tenantId: number, zitadelUserId: string, status: 'active' | 'disabled' = 'active') {
  const [row] = await db.insert(users).values({ zitadelUserId, tenantId, email: zitadelUserId + '@example.com', status }).returning()
  return row.id
}

async function enableModule(tenantId: number, key: string, enabled = true) {
  const [mod] = await db.select().from(modules).where(eq(modules.key, key))
  await db.insert(tenantModules).values({ tenantId, moduleId: mod.id, enabled })
    .onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleId], set: { enabled } })
}

// V2 helper: tenant + esign module enabled + provisioned active user — ฐานร่วมของเคส V2
async function mkTenantUser() {
  const suffix = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  const tenantId = await makeTenant('mtu-' + suffix)
  await enableModule(tenantId, 'esign')
  const userId = await makeUser(tenantId, 'mtu-user-' + suffix)
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  const [mod] = await db.select().from(modules).where(eq(modules.key, 'esign'))
  return { tenant: tenant!, user: user!, moduleId: mod!.id }
}

async function permByKey(key: string) {
  const [row] = await db.select().from(permissions).where(eq(permissions.key, key))
  return row!
}

const post = (headers: Record<string, string>, body: unknown) =>
  new Elysia().use(claimsRouter).handle(new Request('http://localhost/internal/claims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

test('V2: company admin scoped to company A gets all allowed keys, userPermissions scoped to company B stays limited', async () => {
  await seedBase()
  const tenantId = await makeTenant('somchai-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const companyB = await makeCompany(tenantId, 'Company B')
  await enableModule(tenantId, 'hr')
  await enableModule(tenantId, 'esign')

  const userId = await makeUser(tenantId, 'somchai-' + Date.now())
  await db.insert(userCompanies).values([
    { userId, companyId: companyA, isAdmin: true },
    { userId, companyId: companyB },
  ])
  const empRead = await permByKey('employee.read')
  const empWrite = await permByKey('employee.write')
  await db.insert(userPermissions).values([
    { userId, companyId: companyB, permissionId: empRead.id },
    { userId, companyId: companyB, permissionId: empWrite.id },
  ])

  const claims = await resolveClaims((await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId) as TenantClaims

  expect(claims.tenantId).toBe(tenantId)
  expect(claims.companies.sort()).toEqual([companyA, companyB].sort())
  expect(claims.modules).toContain('hr')
  expect(claims.modules).toContain('esign')

  expect(claims.grants[String(companyA)]!.roles).toEqual(['admin'])
  expect(claims.grants[String(companyA)]!.permissions).not.toContain('*')
  expect(claims.grants[String(companyA)]!.permissions).toContain('employee.read')
  expect(claims.grants[String(companyA)]!.permissions).toContain('esign.document.sign')
  expect(claims.grants[String(companyA)]!.permissions).toContain('tenant.user.manage')

  expect(claims.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('*')
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('esign.document.sign')

  // cross-company leak check: company B (non-admin) ต้องไม่ได้ role admin หรือ management keys ของ company A
  expect(claims.grants[String(companyB)]!.roles).toEqual([])
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('tenant.user.manage')
})

test('module filter: disabling hr for the tenant removes hr keys from every grant, management keys ยังอยู่ (bypass filter)', async () => {
  await seedBase()
  const tenantId = await makeTenant('modfilter-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const companyB = await makeCompany(tenantId, 'Company B')
  await enableModule(tenantId, 'hr', true)
  await enableModule(tenantId, 'esign', true)

  const userId = await makeUser(tenantId, 'modfilter-' + Date.now())
  await db.insert(userCompanies).values([
    { userId, companyId: companyA, isAdmin: true },
    { userId, companyId: companyB },
  ])
  const empRead = await permByKey('employee.read')
  const empWrite = await permByKey('employee.write')
  await db.insert(userPermissions).values([
    { userId, companyId: companyB, permissionId: empRead.id },
    { userId, companyId: companyB, permissionId: empWrite.id },
  ])

  // sanity: with hr enabled, the permissions show up
  const zid = (await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId
  const before = await resolveClaims(zid) as TenantClaims
  expect(before.grants[String(companyA)]!.permissions).toContain('employee.read')
  expect(before.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])

  // now disable hr for the tenant
  await enableModule(tenantId, 'hr', false)
  const after = await resolveClaims(zid) as TenantClaims
  expect(after.modules).not.toContain('hr')
  expect(after.grants[String(companyB)]!.permissions).toEqual([])
  expect(after.grants[String(companyA)]!.permissions).not.toContain('employee.read')
  expect(after.grants[String(companyA)]!.permissions).not.toContain('*')
  expect(after.grants[String(companyA)]!.permissions).toContain('tenant.user.manage') // management keys ไม่ผ่าน filter โมดูล
})

test('userPermissions granted per-company ใช้ได้อิสระต่อกันในแต่ละบริษัทที่ user เป็นสมาชิก', async () => {
  await seedBase()
  const tenantId = await makeTenant('tenantwide-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const companyB = await makeCompany(tenantId, 'Company B')
  await enableModule(tenantId, 'hr')

  const userId = await makeUser(tenantId, 'tenantwide-' + Date.now())
  await db.insert(userCompanies).values([{ userId, companyId: companyA }, { userId, companyId: companyB }])

  const empRead = await permByKey('employee.read')
  const empWrite = await permByKey('employee.write')
  await db.insert(userPermissions).values([
    { userId, companyId: companyA, permissionId: empRead.id }, { userId, companyId: companyA, permissionId: empWrite.id },
    { userId, companyId: companyB, permissionId: empRead.id }, { userId, companyId: companyB, permissionId: empWrite.id },
  ])

  const zid = (await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId
  const claims = await resolveClaims(zid) as TenantClaims

  expect(claims.grants[String(companyA)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
  expect(claims.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
})

test('V2: group admin ได้ทุกบริษัทใน tenant รวมที่ไม่เป็นสมาชิก, ไม่มี * ,มี management keys', async () => {
  const { tenant, user } = await mkTenantUser()
  const [a] = await db.insert(companies).values({ tenantId: tenant.id, name: 'A' }).returning()
  const [b] = await db.insert(companies).values({ tenantId: tenant.id, name: 'B' }).returning()
  await db.update(users).set({ isGroupAdmin: true }).where(eq(users.id, user.id))
  const c = await resolveClaims(user.zitadelUserId) as any
  expect(Object.keys(c.grants).sort()).toEqual([String(a.id), String(b.id)].sort())
  expect(c.grants[String(a.id)].roles).toEqual(['groupcompanyadmin'])
  expect(c.grants[String(a.id)].permissions).not.toContain('*')
  expect(c.grants[String(a.id)].permissions).toContain('tenant.user.manage')
})

test('V2: user ธรรมดาได้ตามติ๊ก ∩ แพ็ค — เปลี่ยนแพ็คแล้ว key หายทันที', async () => {
  const { tenant, user } = await mkTenantUser()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id })
  const sign = (await db.select().from(permissions).where(eq(permissions.key, 'esign.document.sign')))[0]
  const send = (await db.select().from(permissions).where(eq(permissions.key, 'esign.document.send')))[0]
  await db.insert(userPermissions).values([{ userId: user.id, companyId: co.id, permissionId: sign.id }, { userId: user.id, companyId: co.id, permissionId: send.id }])
  // ไม่มีแพ็ค → ได้ทั้งคู่ (จำกัดด้วยโมดูลอย่างเดียว)
  expect((await resolveClaims(user.zitadelUserId) as any).grants[String(co.id)].permissions.sort()).toEqual(['esign.document.send', 'esign.document.sign'])
  // แพ็คที่มีแค่ sign → send หาย
  const [pkg] = await db.insert(packages).values({ name: 'B', slug: 'b-' + Date.now(), seatLimit: 20, companyLimit: 1, adminLimit: 1 }).returning()
  await db.insert(packagePermissions).values({ packageId: pkg.id, permissionId: sign.id })
  await db.update(tenants).set({ packageId: pkg.id }).where(eq(tenants.id, tenant.id))
  const c = await resolveClaims(user.zitadelUserId) as any
  expect(c.grants[String(co.id)].permissions).toEqual(['esign.document.sign'])
  expect(c.package).toBe(pkg.slug)
})

test('V2: company admin ได้ allowed ทั้งชุดเฉพาะบริษัทตัวเอง', async () => {
  const { tenant, user } = await mkTenantUser()
  const [co] = await db.insert(companies).values({ tenantId: tenant.id, name: 'C' }).returning()
  const [other] = await db.insert(companies).values({ tenantId: tenant.id, name: 'D' }).returning()
  await db.insert(userCompanies).values({ userId: user.id, companyId: co.id, isAdmin: true })
  const c = await resolveClaims(user.zitadelUserId) as any
  expect(c.grants[String(co.id)].roles).toEqual(['admin'])
  expect(c.grants[String(co.id)].permissions).toContain('esign.document.sign')
  expect(c.grants[String(other.id)]).toBeUndefined()
})

test('superadmin (platform_admins row) → exactly {role: superadmin}', async () => {
  const zid = 'superadmin-' + Date.now()
  await db.insert(platformAdmins).values({ zitadelUserId: zid })
  const claims = await resolveClaims(zid)
  expect(claims).toEqual({ role: 'superadmin' })
})

test('unknown zitadelUserId → {}', async () => {
  const claims = await resolveClaims('does-not-exist-' + Date.now())
  expect(claims).toEqual({})
})

test('user with status disabled → {}', async () => {
  const tenantId = await makeTenant('disabled-' + Date.now())
  const zid = 'disabled-user-' + Date.now()
  await makeUser(tenantId, zid, 'disabled')
  const claims = await resolveClaims(zid)
  expect(claims).toEqual({})
})

test('POST /internal/claims without x-claims-secret header → 401', async () => {
  const res = await post({}, { zitadelUserId: 'whoever' })
  expect(res.status).toBe(401)
})

test('POST /internal/claims with wrong secret → 401', async () => {
  const res = await post({ 'x-claims-secret': 'totally-wrong' }, { zitadelUserId: 'whoever' })
  expect(res.status).toBe(401)
})

test('POST /internal/claims with correct secret → 200 with claims JSON', async () => {
  const zid = 'endpoint-' + Date.now()
  await db.insert(platformAdmins).values({ zitadelUserId: zid })
  const res = await post({ 'x-claims-secret': env.CLAIMS_SHARED_SECRET }, { zitadelUserId: zid })
  expect(res.status).toBe(200)
  const body = await res.json() as PlatformClaims
  expect(body).toEqual({ role: 'superadmin' })
})
