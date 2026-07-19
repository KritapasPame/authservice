import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { eq, inArray } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies, userPermissions, permissions, presets, presetPermissions, packages } from '../src/db/schema'

// mock zitadel client — ไม่ยิง network จริง (mock.module เป็น process-global — ต้อง mock ทุก export
// กันไฟล์อื่นที่ import chain เดียวกันในโปรเซสเดียวกันพัง, กติกาเดียวกับ user.test.ts / permissions.test.ts)
let zitadelUserCounter = 0
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => `user_mock_invitev2_${Date.now()}_${++zitadelUserCounter}`),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { userRouter } = await import('../src/modules/user/route')
const { setTenantPackage } = await import('../src/modules/package/service')

const app = new Elysia().use(userRouter)
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.handle(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

const superadmin = bearer({ sub: 'z-sa-inv2', 'urn:platform:role': 'superadmin' })
const invite = (body: unknown) => req('POST', '/users/invite', { authorization: superadmin }, body)

let seq = 0
async function makeTenant() {
  const slug = `invv2-${Date.now()}-${++seq}`
  const [tenant] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return tenant
}
async function makeCompany(tenantId: number, name = 'Co') {
  const [c] = await db.insert(companies).values({ tenantId, name }).returning()
  return c
}
async function makeActiveUser(tenantId: number) {
  const slug = `invv2-u-${Date.now()}-${++seq}`
  const [u] = await db.insert(users).values({ zitadelUserId: 'zu_' + slug, tenantId, email: slug + '@example.com' }).returning()
  return u
}
async function makePackage(over: Partial<{ seatLimit: number; companyLimit: number; adminLimit: number; allowGroupAdmin: boolean }> = {}) {
  const slug = `invv2-pkg-${Date.now()}-${++seq}`
  const [p] = await db.insert(packages).values({ name: 'P-' + slug, slug, seatLimit: 100, companyLimit: 100, adminLimit: 100, ...over }).returning()
  return p
}
async function makePreset(tenantId: number | null, keys: string[]) {
  return makePresetWithSlug(tenantId, `invv2-preset-${Date.now()}-${++seq}`, keys)
}
async function makePresetWithSlug(tenantId: number | null, slug: string, keys: string[]) {
  const [p] = await db.insert(presets).values({ tenantId, name: 'Staff-' + slug, slug }).returning()
  if (keys.length) {
    const rows = await db.select().from(permissions).where(inArray(permissions.key, keys))
    await db.insert(presetPermissions).values(rows.map(r => ({ presetId: p.id, permissionId: r.id })))
  }
  return p
}

test('invite ด้วย presetSlug → user_permissions ครบทุก company, position = ชื่อ preset', async () => {
  const tenant = await makeTenant()
  const co1 = await makeCompany(tenant.id, 'Co1')
  const co2 = await makeCompany(tenant.id, 'Co2')
  const preset = await makePreset(tenant.id, ['esign.document.read', 'esign.document.sign'])

  const res = await invite({ tenantId: tenant.id, email: `preset-${Date.now()}@example.com`, companyIds: [co1.id, co2.id], presetSlug: preset.slug })
  expect(res.status).toBe(200)
  const body = await res.json() as { id: number }

  const ucRows = await db.select().from(userCompanies).where(eq(userCompanies.userId, body.id))
  expect(ucRows.length).toBe(2)
  expect(ucRows.every(r => r.position === preset.name)).toBe(true)

  const upRows = await db.select({ key: permissions.key, companyId: userPermissions.companyId }).from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, body.id))
  expect(upRows.filter(r => r.companyId === co1.id).map(r => r.key).sort()).toEqual(['esign.document.read', 'esign.document.sign'])
  expect(upRows.filter(r => r.companyId === co2.id).map(r => r.key).sort()).toEqual(['esign.document.read', 'esign.document.sign'])
})

test('invite ด้วย permissionKeys ตรง ชนะ preset ถ้าส่งมาทั้งคู่ (preset เป็นแค่ template + position)', async () => {
  const tenant = await makeTenant()
  const co = await makeCompany(tenant.id)
  const preset = await makePreset(tenant.id, ['esign.document.read'])

  const res = await invite({ tenantId: tenant.id, email: `direct-${Date.now()}@example.com`, companyIds: [co.id], presetSlug: preset.slug, permissionKeys: ['esign.document.sign'] })
  expect(res.status).toBe(200)
  const body = await res.json() as { id: number }

  const upRows = await db.select({ key: permissions.key }).from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(eq(userPermissions.userId, body.id))
  expect(upRows.map(r => r.key)).toEqual(['esign.document.sign'])   // ไม่ใช่ esign.document.read จาก preset

  const [uc] = await db.select().from(userCompanies).where(eq(userCompanies.userId, body.id))
  expect(uc.position).toBe(preset.name)   // preset ยังกำหนด position แม้ permissionKeys ชนะเรื่องสิทธิ์
})

test('seat เต็ม → 403 { quota: "seat" }', async () => {
  const tenant = await makeTenant()
  const pkg = await makePackage({ seatLimit: 1 })
  await setTenantPackage(tenant.id, pkg.slug)
  await makeActiveUser(tenant.id)   // ใช้ seat ไปแล้ว 1 = เต็ม

  const res = await invite({ tenantId: tenant.id, email: `seatfull-${Date.now()}@example.com`, companyIds: [] })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ quota: 'seat', limit: 1 })
})

test('admin เต็ม → PATCH /:id/admin 403 { quota: "admin" }', async () => {
  const tenant = await makeTenant()
  const pkg = await makePackage({ adminLimit: 1 })
  await setTenantPackage(tenant.id, pkg.slug)
  const co = await makeCompany(tenant.id)
  const existingAdmin = await makeActiveUser(tenant.id)
  await db.insert(userCompanies).values({ userId: existingAdmin.id, companyId: co.id, isAdmin: true })   // ใช้ admin quota ไปแล้ว 1 = เต็ม

  const target = await makeActiveUser(tenant.id)
  await db.insert(userCompanies).values({ userId: target.id, companyId: co.id })

  const res = await req('PATCH', `/users/${target.id}/admin`, { authorization: superadmin }, { companyId: co.id, admin: true })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ quota: 'admin', limit: 1 })

  const [row] = await db.select().from(userCompanies).where(eq(userCompanies.userId, target.id))
  expect(row.isAdmin).toBe(false)   // ไม่ถูกอัปเดต
})

test('allowGroupAdmin=false → PATCH groupAdmin:true 403 { quota: "groupAdmin", limit: 0 }', async () => {
  const tenant = await makeTenant()
  const pkg = await makePackage({ allowGroupAdmin: false })
  await setTenantPackage(tenant.id, pkg.slug)
  const target = await makeActiveUser(tenant.id)

  const res = await req('PATCH', `/users/${target.id}/admin`, { authorization: superadmin }, { groupAdmin: true })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ quota: 'groupAdmin', limit: 0 })

  const [row] = await db.select().from(users).where(eq(users.id, target.id))
  expect(row.isGroupAdmin).toBe(false)   // ไม่ถูกอัปเดต
})

test('presetSlug มั่ว → 404, ไม่สร้าง user', async () => {
  const tenant = await makeTenant()
  const email = `nopreset-${Date.now()}@example.com`
  const res = await invite({ tenantId: tenant.id, email, companyIds: [], presetSlug: 'no-such-preset-' + Date.now() })
  expect(res.status).toBe(404)
  const rows = await db.select().from(users).where(eq(users.email, email))
  expect(rows.length).toBe(0)
})

// SECURITY: preset lookup ต้อง scope เฉพาะ system ∪ tenant ตัวเอง — decoy preset slug เดียวกันที่ tenant อื่น
// ต้องไม่มีผลต่อ invite ของ victim tenant (ถ้า victim ไม่มี preset slug นี้เอง/system ก็ไม่มี → 404 เหมือนไม่มี preset เลย)
test('preset slug ชนกับ tenant อื่น (decoy) → ไม่ attach ข้าม tenant, victim ไม่มี preset นี้เอง → 404, ไม่สร้าง user', async () => {
  const victim = await makeTenant()
  const attacker = await makeTenant()
  const sharedSlug = `decoy-preset-${Date.now()}`
  await makePresetWithSlug(attacker.id, sharedSlug, ['esign.document.sign'])   // preset ของ tenant อื่น slug เดียวกัน

  const email = `decoy-victim-${Date.now()}@example.com`
  const res = await invite({ tenantId: victim.id, email, companyIds: [], presetSlug: sharedSlug })
  expect(res.status).toBe(404)
  const rows = await db.select().from(users).where(eq(users.email, email))
  expect(rows.length).toBe(0)
})

// SECURITY: permissionKeys ตรงหรือมาจาก preset ห้ามมี management key (tenant.*) หลุดเข้า user_permissions
// ทางเดียวที่ได้สิทธิ์ tenant.* คือ isGroupAdmin ผ่าน PATCH /:id/admin — เหมือน invariant ของ setPermissions
test('invite permissionKeys มี tenant.* (management key) → 403 { forbiddenKeys }, ไม่สร้าง user', async () => {
  const tenant = await makeTenant()
  const email = `forbidden-${Date.now()}@example.com`
  const res = await invite({ tenantId: tenant.id, email, companyIds: [], permissionKeys: ['tenant.user.manage'] })
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ forbiddenKeys: ['tenant.user.manage'] })
  const rows = await db.select().from(users).where(eq(users.email, email))
  expect(rows.length).toBe(0)
})
