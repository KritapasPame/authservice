import { test, expect, mock } from 'bun:test'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, roles, userRoles } from '../src/db/schema'
import { env } from '../src/config/env'
import type { Grant } from '@platform/contracts'

// mock zitadel client — process-global mock.module; must mock every export of the module
// (createZitadelOrg, createZitadelUser, listLoginEvents) or other test files sharing this
// process that import the same module will break (SyntaxError: export not found).
let zCounter = 0
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => 'org_mock_e2e_' + Date.now()),
  createZitadelUser: mock(async () => `user_mock_e2e_${Date.now()}_${++zCounter}`),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { createApp } = await import('../src/http/app')
const { seedSystemRoles } = await import('../src/modules/role/seed')
const { resolveClaims } = await import('../src/claims/resolver')
const { enabledModuleKeys } = await import('../src/modules/module/service')

const TEST_SIGNING_KEY = 'e2e-zitadel-signing-key'
env.ZITADEL_ACTIONS_SIGNING_KEY = TEST_SIGNING_KEY

function sign(raw: string, key: string, t: number = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${mac}`
}

type TenantClaims = { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant> }

test('e2e: composed app — tenant/company/role/user provisioning, DB→claims resolution, JWT-shaped authz, internal endpoints, admin overview', async () => {
  const app = createApp()
  const call = (method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) =>
    app.handle(new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }))

  // a. seed system roles/modules/permissions (idempotent)
  await seedSystemRoles()

  const suffix = 'e2e-' + Date.now()
  const superAuth = bearer({ sub: 'super-' + suffix, 'urn:platform:role': 'superadmin' })

  // b. superadmin creates tenant (mocked zitadel org id) → core module auto-enabled
  const tenantRes = await call('POST', '/tenants', { headers: { authorization: superAuth }, body: { name: 'E2E Co', slug: 'e2e-tenant-' + suffix } })
  expect(tenantRes.status).toBe(200)
  const tenant = await tenantRes.json() as { id: number; zitadelOrgId: string }
  const tenantId = tenant.id
  expect(await enabledModuleKeys(tenantId)).toEqual(['core'])

  // c. enable hr + esign
  expect((await call('PUT', `/modules/tenants/${tenantId}/hr`, { headers: { authorization: superAuth }, body: { enabled: true } })).status).toBe(200)
  expect((await call('PUT', `/modules/tenants/${tenantId}/esign`, { headers: { authorization: superAuth }, body: { enabled: true } })).status).toBe(200)
  expect((await enabledModuleKeys(tenantId)).sort()).toEqual(['core', 'esign', 'hr'])

  // d. two companies under the tenant
  const companyARes = await call('POST', '/companies', { headers: { authorization: superAuth }, body: { tenantId, name: 'Company A' } })
  const companyBRes = await call('POST', '/companies', { headers: { authorization: superAuth }, body: { tenantId, name: 'Company B' } })
  expect(companyARes.status).toBe(200)
  expect(companyBRes.status).toBe(200)
  const companyA = (await companyARes.json() as { id: number }).id
  const companyB = (await companyBRes.json() as { id: number }).id

  // e. custom hr_staff role scoped to the tenant + permissions
  const roleRes = await call('POST', '/roles', { headers: { authorization: superAuth }, body: { tenantId, name: 'HR Staff', slug: 'hr_staff-' + suffix } })
  expect(roleRes.status).toBe(200)
  const hrStaffRole = await roleRes.json() as { id: number }
  const permRes = await call('POST', `/roles/${hrStaffRole.id}/permissions`, { headers: { authorization: superAuth }, body: { permissionKeys: ['employee.read', 'employee.write'] } })
  expect(permRes.status).toBe(200)

  // f. invite user1 into both companies. POST /users/invite only attaches roles tenant-wide
  // (userRoles.companyId: null) — it cannot express the Somchai per-company shape (company_admin
  // scoped to A, hr_staff scoped to B). Simplest honest path: invite with roleSlugs: [] to create
  // the user + zitadel identity + user_companies rows via the real endpoint, then attach the two
  // company-scoped roles with a direct user_roles insert (mirrors what a future "assign role at
  // company X" endpoint would do — that endpoint doesn't exist yet in V1).
  const inviteRes = await call('POST', '/users/invite', {
    headers: { authorization: superAuth },
    body: { tenantId, email: 'user1-' + suffix + '@example.com', companyIds: [companyA, companyB], roleSlugs: [] },
  })
  expect(inviteRes.status).toBe(200)
  const user1 = await inviteRes.json() as { id: number; zitadelUserId: string }

  const [companyAdminRole] = await db.select().from(roles).where(eq(roles.slug, 'company_admin'))
  await db.insert(userRoles).values([
    { userId: user1.id, roleId: companyAdminRole!.id, companyId: companyA },
    { userId: user1.id, roleId: hrStaffRole.id, companyId: companyB },
  ])

  // g. resolveClaims(user1) — real DB read, assert per-company grant shape
  const claims = await resolveClaims(user1.zitadelUserId) as TenantClaims
  expect(claims.tenantId).toBe(tenantId)
  expect(claims.companies.sort()).toEqual([companyA, companyB].sort())
  expect(claims.modules.sort()).toEqual(['core', 'esign', 'hr'])
  expect(claims.grants[String(companyA)]).toEqual({ roles: ['company_admin'], permissions: ['*'] })
  expect(claims.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('*')

  // h. build a bearer token whose claims ARE the resolved claims, mapped to urn:platform:* keys —
  // this is exactly what the Zitadel Actions target (j, below) would append to a real access token.
  // Closes the loop: DB state → resolveClaims → JWT-shaped claims → route authz.
  const resolvedAuth = bearer({
    sub: user1.zitadelUserId,
    'urn:platform:tenantId': claims.tenantId,
    'urn:platform:companies': claims.companies,
    'urn:platform:modules': claims.modules,
    'urn:platform:grants': claims.grants,
  })
  const ownTenantRes = await call('POST', '/companies', { headers: { authorization: resolvedAuth }, body: { tenantId, name: 'Own Tenant Extra Co' } })
  expect(ownTenantRes.status).toBe(200)

  const otherTenantRes = await call('POST', '/tenants', { headers: { authorization: superAuth }, body: { name: 'Other Tenant', slug: 'other-tenant-' + suffix } })
  const otherTenant = await otherTenantRes.json() as { id: number }
  const crossTenantRes = await call('POST', '/companies', { headers: { authorization: resolvedAuth }, body: { tenantId: otherTenant.id, name: 'Should Not Create' } })
  expect(crossTenantRes.status).toBe(403)

  // i. /internal/claims through the mounted app
  const claimsOkRes = await call('POST', '/internal/claims', { headers: { 'x-claims-secret': env.CLAIMS_SHARED_SECRET }, body: { zitadelUserId: user1.zitadelUserId } })
  expect(claimsOkRes.status).toBe(200)
  expect(((await claimsOkRes.json()) as TenantClaims).tenantId).toBe(tenantId)

  const claimsBadRes = await call('POST', '/internal/claims', { headers: { 'x-claims-secret': 'wrong-secret' }, body: { zitadelUserId: user1.zitadelUserId } })
  expect(claimsBadRes.status).toBe(401)

  // j. /internal/zitadel/token-claims (HMAC-signed) through the mounted app
  const zPayload = JSON.stringify({ user: { id: user1.zitadelUserId } })
  const zRes = await app.handle(new Request('http://localhost/internal/zitadel/token-claims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ZITADEL-Signature': sign(zPayload, TEST_SIGNING_KEY) },
    body: zPayload,
  }))
  expect(zRes.status).toBe(200)
  const zBody = await zRes.json() as { append_claims: { key: string; value: unknown }[] }
  expect(zBody.append_claims.map(c => c.key)).toEqual([
    'urn:platform:tenantId', 'urn:platform:companies', 'urn:platform:modules', 'urn:platform:grants',
  ])

  // k. /admin/overview through the mounted app — seeded tenant appears with correct counts
  const overviewRes = await call('GET', '/admin/overview', { headers: { authorization: superAuth } })
  expect(overviewRes.status).toBe(200)
  const overview = await overviewRes.json() as { tenantId: number; userCount: number; companyCount: number; enabledModules: string[] }[]
  const row = overview.find(r => r.tenantId === tenantId)!
  expect(row).toBeDefined()
  expect(row.userCount).toBe(1)
  expect(row.companyCount).toBe(3) // Company A, Company B, Own Tenant Extra Co (step h)
  expect(row.enabledModules.sort()).toEqual(['core', 'esign', 'hr'])

  // sanity: tenant row really persisted under the composed app, not some other instance
  const [persisted] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  expect(persisted?.slug).toBe('e2e-tenant-' + suffix)
})
