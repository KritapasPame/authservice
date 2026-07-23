import { test, expect, mock } from 'bun:test'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, userPermissions, presets, permissions } from '../src/db/schema'
import { env } from '../src/config/env'
import type { Grant } from '@platform/contracts'

// mock zitadel client — process-global mock.module; must mock every export of the module
// (createZitadelOrg, createZitadelUser, listLoginEvents) or other test files sharing this
// process that import the same module will break (SyntaxError: export not found).
let zCounter = 0
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => 'org_mock_e2e_' + Date.now()),
  createZitadelUser: mock(async () => `user_mock_e2e_${Date.now()}_${++zCounter}`),
  deleteZitadelOrg: mock(async () => {}),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { createApp } = await import('../src/http/app')
const { seedBase } = await import('../src/db/seed')
const { resolveClaims } = await import('../src/claims/resolver')
const { enabledModuleKeys } = await import('../src/modules/module/service')

const TEST_SIGNING_KEY = 'e2e-zitadel-signing-key'
env.ZITADEL_ACTIONS_SIGNING_KEY = TEST_SIGNING_KEY

function sign(raw: string, key: string, t: number = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${mac}`
}

type TenantClaims = { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant>; package?: string }

// V2 e2e: superadmin provisions tenant + package + module → 2 companies → invite via preset →
// admin flag ที่บริษัทหนึ่ง + PUT permissions ตรงที่อีกบริษัท (เคสสมชาย) → resolver แยกสิทธิ์ต่อบริษัทถูก →
// แก้ preset แล้วสิทธิ์คนที่ invite ไปแล้วไม่เปลี่ยน (copy-on-save) → disable user → claims {}
test('e2e: composed app — tenant/package/module/company provisioning → invite+preset → per-company permissions → copy-on-save → disable', async () => {
  const app = createApp()
  const call = (method: string, path: string, opts: { headers?: Record<string, string>; body?: unknown } = {}) =>
    app.handle(new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }))

  await seedBase()   // modules/permissions idempotent (เผื่อรัน e2e.test.ts เดี่ยวๆ)

  const suffix = 'e2e-' + Date.now()
  const superAuth = bearer({ sub: 'super-' + suffix, 'urn:platform:role': 'superadmin' })

  // a. superadmin creates tenant (mocked zitadel org id) → core module auto-enabled
  const tenantRes = await call('POST', '/tenants', { headers: { authorization: superAuth }, body: { name: 'E2E Co', slug: 'e2e-tenant-' + suffix } })
  expect(tenantRes.status).toBe(200)
  const tenant = await tenantRes.json() as { id: number; zitadelOrgId: string }
  const tenantId = tenant.id
  expect(await enabledModuleKeys(tenantId)).toEqual(['core'])

  // b. create + bind a package (allows hr + esign perms used below)
  const pkgRes = await call('POST', '/admin/packages', {
    headers: { authorization: superAuth },
    body: {
      name: 'E2E Pkg', slug: 'e2e-pkg-' + suffix, seatLimit: 20, companyLimit: 10, adminLimit: 5,
      permissionKeys: ['employee.read', 'employee.write', 'esign.document.sign', 'esign.document.read'],
    },
  })
  expect(pkgRes.status).toBe(200)
  const pkg = await pkgRes.json() as { slug: string }
  expect((await call('PATCH', `/admin/tenants/${tenantId}/package`, { headers: { authorization: superAuth }, body: { packageSlug: pkg.slug } })).status).toBe(200)

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

  // e. tenant preset — template สำหรับ copy-on-save ตอน invite
  const presetRes = await call('POST', '/presets', {
    headers: { authorization: superAuth },
    body: { tenantId, name: 'Staff', slug: 'staff-' + suffix, permissionKeys: ['employee.read'] },
  })
  expect(presetRes.status).toBe(200)
  const preset = await presetRes.json() as { id: number; slug: string; name: string }

  // f. invite user1 (สมชาย) into both companies via the preset → user_permissions = ['employee.read'] ทั้งคู่, position = ชื่อ preset
  const invite1Res = await call('POST', '/users/invite', {
    headers: { authorization: superAuth },
    body: { tenantId, email: 'somchai-' + suffix + '@example.com', companyIds: [companyA, companyB], presetSlug: preset.slug },
  })
  expect(invite1Res.status).toBe(200)
  const user1 = await invite1Res.json() as { id: number; zitadelUserId: string }

  // g. invite user2 into companyA only via the same preset — snapshot ไว้เทียบตอนแก้ preset (copy-on-save)
  const invite2Res = await call('POST', '/users/invite', {
    headers: { authorization: superAuth },
    body: { tenantId, email: 'user2-' + suffix + '@example.com', companyIds: [companyA], presetSlug: preset.slug },
  })
  expect(invite2Res.status).toBe(200)
  const user2 = await invite2Res.json() as { id: number }

  // h. ตั้ง user1 เป็น admin ที่ company A (isAdmin flag — ได้สิทธิ์ทั้งชุดเท่าที่แพ็ค+โมดูลให้ + management keys)
  expect((await call('PATCH', `/users/${user1.id}/admin`, { headers: { authorization: superAuth }, body: { companyId: companyA, admin: true } })).status).toBe(200)

  // i. เคสสมชาย: PUT permissions ตรงที่ company B ให้ต่างจาก A (per-user, per-company) — ทับของเดิมจาก preset
  const putPermRes = await call('PUT', `/users/${user1.id}/permissions`, {
    headers: { authorization: superAuth },
    body: { companyId: companyB, position: 'HR Staff', permissionKeys: ['employee.read', 'employee.write'] },
  })
  expect(putPermRes.status).toBe(200)

  // j. resolveClaims(user1) — grants แยกต่อ company ถูกต้อง
  const claims = await resolveClaims(user1.zitadelUserId) as TenantClaims
  expect(claims.tenantId).toBe(tenantId)
  expect(claims.companies.sort()).toEqual([companyA, companyB].sort())
  expect(claims.modules.sort()).toEqual(['core', 'esign', 'hr'])
  expect(claims.package).toBe(pkg.slug)

  // company A: admin → ได้ทุก key ที่แพ็ค+โมดูลอนุญาต + management keys, ไม่มี '*'
  expect(claims.grants[String(companyA)]!.roles).toEqual(['admin'])
  expect(claims.grants[String(companyA)]!.permissions).not.toContain('*')
  expect(claims.grants[String(companyA)]!.permissions.sort()).toEqual(
    ['employee.read', 'employee.write', 'esign.document.read', 'esign.document.sign', 'tenant.company.manage', 'tenant.user.manage'].sort(),
  )
  // company B: user_permissions ตรงที่ตั้งไว้ ไม่ใช่ admin, ไม่มี management keys
  expect(claims.grants[String(companyB)]!.roles).toEqual([])
  expect(claims.grants[String(companyB)]!.permissions.sort()).toEqual(['employee.read', 'employee.write'])
  expect(claims.grants[String(companyB)]!.permissions).not.toContain('tenant.user.manage')

  // k. JWT-shaped authz round trip: build a bearer token whose claims ARE the resolved claims —
  // this is exactly what the Zitadel Actions target (m, below) would append to a real access token.
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

  // l. แก้ preset (เพิ่ม employee.write) → user2 (invite ไปแล้วก่อนแก้) สิทธิ์เดิมไม่เปลี่ยน — copy-on-save, preset เป็นแค่ template ตอน invite
  const updatePresetRes = await call('PUT', `/presets/${preset.id}`, { headers: { authorization: superAuth }, body: { permissionKeys: ['employee.read', 'employee.write'] } })
  expect(updatePresetRes.status).toBe(200)
  const [presetRow] = await db.select().from(presets).where(eq(presets.id, preset.id))
  expect(presetRow.name).toBe('Staff') // sanity: preset ยังอยู่ ไม่ได้ถูกลบ

  const user2PermKeys = await db.select({ key: permissions.key }).from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, user2.id))
  expect(user2PermKeys.map(r => r.key)).toEqual(['employee.read'])   // ไม่ได้ employee.write ที่เพิ่งเพิ่มเข้า preset

  // m. /internal/claims through the mounted app
  const claimsOkRes = await call('POST', '/internal/claims', { headers: { 'x-claims-secret': env.CLAIMS_SHARED_SECRET }, body: { zitadelUserId: user1.zitadelUserId } })
  expect(claimsOkRes.status).toBe(200)
  expect(((await claimsOkRes.json()) as TenantClaims).tenantId).toBe(tenantId)

  const claimsBadRes = await call('POST', '/internal/claims', { headers: { 'x-claims-secret': 'wrong-secret' }, body: { zitadelUserId: user1.zitadelUserId } })
  expect(claimsBadRes.status).toBe(401)

  // n. /internal/zitadel/token-claims (HMAC-signed) through the mounted app
  const zPayload = JSON.stringify({ user: { id: user1.zitadelUserId } })
  const zRes = await app.handle(new Request('http://localhost/internal/zitadel/token-claims', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'ZITADEL-Signature': sign(zPayload, TEST_SIGNING_KEY) },
    body: zPayload,
  }))
  expect(zRes.status).toBe(200)
  const zBody = await zRes.json() as { append_claims: { key: string; value: unknown }[] }
  expect(zBody.append_claims.map(c => c.key)).toEqual([
    'urn:platform:tenantId', 'urn:platform:companies', 'urn:platform:modules', 'urn:platform:grants', 'urn:platform:package',
  ])

  // o. disable user1 → resolver คืน {} (ทั้งผ่าน resolveClaims ตรงๆ และผ่าน /internal/claims ที่ mount จริง)
  expect((await call('PATCH', `/users/${user1.id}/status`, { headers: { authorization: superAuth }, body: { status: 'disabled' } })).status).toBe(200)
  expect(await resolveClaims(user1.zitadelUserId)).toEqual({})
  const disabledClaimsRes = await call('POST', '/internal/claims', { headers: { 'x-claims-secret': env.CLAIMS_SHARED_SECRET }, body: { zitadelUserId: user1.zitadelUserId } })
  expect(await disabledClaimsRes.json()).toEqual({})

  // sanity: tenant row really persisted under the composed app, not some other instance
  const [persisted] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  expect(persisted?.slug).toBe('e2e-tenant-' + suffix)
})
