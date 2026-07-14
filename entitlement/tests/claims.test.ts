import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies, userRoles, roles, rolePermissions, permissions, modules, tenantModules, platformAdmins } from '../src/db/schema'
import { env } from '../src/config/env'
import type { PlatformClaims, Grant } from '@platform/contracts'

const { seedSystemRoles } = await import('../src/modules/role/seed')
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

// custom tenant role with the given permission keys (not grantAll) — mirrors an "hr_staff" style role
async function makeCustomRole(tenantId: number, slug: string, permissionKeys: string[]) {
  const [role] = await db.insert(roles).values({ tenantId, name: slug, slug, grantAll: false }).returning()
  for (const key of permissionKeys) {
    const [p] = await db.select().from(permissions).where(eq(permissions.key, key))
    await db.insert(rolePermissions).values({ roleId: role.id, permissionId: p.id })
  }
  return role.id
}

async function getSystemRoleId(slug: string) {
  const [row] = await db.select().from(roles).where(eq(roles.slug, slug))
  return row.id
}

const post = (headers: Record<string, string>, body: unknown) =>
  new Elysia().use(claimsRouter).handle(new Request('http://localhost/internal/claims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

test('Somchai scenario: grantAll role scoped to company A, custom hr role scoped to company B', async () => {
  await seedSystemRoles()
  const tenantId = await makeTenant('somchai-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const companyB = await makeCompany(tenantId, 'Company B')
  await enableModule(tenantId, 'hr')
  await enableModule(tenantId, 'esign')

  const userId = await makeUser(tenantId, 'somchai-' + Date.now())
  await db.insert(userCompanies).values([{ userId, companyId: companyA }, { userId, companyId: companyB }])

  const companyAdminId = await getSystemRoleId('company_admin')
  const hrStaffId = await makeCustomRole(tenantId, 'hr_staff-' + Date.now(), ['employee.read', 'employee.write'])
  await db.insert(userRoles).values([
    { userId, roleId: companyAdminId, companyId: companyA },
    { userId, roleId: hrStaffId, companyId: companyB },
  ])

  const claims = await resolveClaims((await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId) as TenantClaims

  expect(claims.tenantId).toBe(tenantId)
  expect(claims.companies.sort()).toEqual([companyA, companyB].sort())
  expect(claims.modules).toContain('hr')
  expect(claims.modules).toContain('esign')

  expect(claims.grants[String(companyA)]!.roles).toEqual(['company_admin'])
  expect(claims.grants[String(companyA)]!.permissions).toEqual(['*'])

  expect(claims.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('*')
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('esign.document.sign')

  // cross-company leak check: company A must not pick up the hr_staff role slug, company B must not get '*'
  expect(claims.grants[String(companyA)]!.roles).not.toContain('hr_staff')
  expect(claims.grants[String(companyB)]!.roles).toEqual(expect.arrayContaining([expect.stringContaining('hr_staff')]))
})

test('module filter: disabling hr for the tenant removes hr permissions from grants, grantAll still yields * elsewhere', async () => {
  await seedSystemRoles()
  const tenantId = await makeTenant('modfilter-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const companyB = await makeCompany(tenantId, 'Company B')
  await enableModule(tenantId, 'hr', true)

  const userId = await makeUser(tenantId, 'modfilter-' + Date.now())
  await db.insert(userCompanies).values([{ userId, companyId: companyA }, { userId, companyId: companyB }])

  const companyAdminId = await getSystemRoleId('company_admin')
  const hrStaffId = await makeCustomRole(tenantId, 'hr_staff-' + Date.now(), ['employee.read', 'employee.write'])
  await db.insert(userRoles).values([
    { userId, roleId: companyAdminId, companyId: companyA },
    { userId, roleId: hrStaffId, companyId: companyB },
  ])

  // sanity: with hr enabled, the permissions show up
  const zid = (await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId
  const before = await resolveClaims(zid) as TenantClaims
  expect(before.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])

  // now disable hr for the tenant
  await enableModule(tenantId, 'hr', false)
  const after = await resolveClaims(zid) as TenantClaims
  expect(after.modules).not.toContain('hr')
  expect(after.grants[String(companyB)]!.permissions).toEqual([])
  expect(after.grants[String(companyA)]!.permissions).toEqual(['*']) // grantAll bypasses module filter (documented in src/http/auth.ts)
})

test('tenant-wide role (companyId null) applies to every company the user belongs to', async () => {
  await seedSystemRoles()
  const tenantId = await makeTenant('tenantwide-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const companyB = await makeCompany(tenantId, 'Company B')
  await enableModule(tenantId, 'hr')

  const userId = await makeUser(tenantId, 'tenantwide-' + Date.now())
  await db.insert(userCompanies).values([{ userId, companyId: companyA }, { userId, companyId: companyB }])

  const hrStaffId = await makeCustomRole(tenantId, 'hr_staff-' + Date.now(), ['employee.read', 'employee.write'])
  await db.insert(userRoles).values([{ userId, roleId: hrStaffId, companyId: null }])

  const zid = (await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId
  const claims = await resolveClaims(zid) as TenantClaims

  expect(claims.grants[String(companyA)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
  expect(claims.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
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
