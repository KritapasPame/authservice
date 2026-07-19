import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../src/db/client'
import { packages, packagePermissions, permissions, tenants, companies, users, userCompanies } from '../src/db/schema'

// mock zitadel client กัน side-effect ตอน import chain — mock ทุก export (กติกาเดียวกับ user-roles.test.ts)
// org/user id ต้อง unique ต่อ call — zitadelOrgId / zitadelUserId มี unique constraint
let orgCounter = 0
let userCounter = 0
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => `org_mock_signup_${Date.now()}_${++orgCounter}`),
  createZitadelUser: mock(async () => `user_mock_signup_${Date.now()}_${++userCounter}`),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { signupRouter } = await import('../src/modules/signup/route')
const { resolveClaims } = await import('../src/claims/resolver')

const app = new Elysia().use(signupRouter)
const post = (body: unknown) =>
  app.handle(new Request('http://localhost/signup/personal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))

let seq = 0
// แพ็ค self-signup พร้อม permissionKeys จริงจาก seed (esign.document.read/sign)
async function makeSelfSignupPackage(keys: string[]) {
  const slug = `signup-pkg-${Date.now()}-${++seq}`
  const [pkg] = await db.insert(packages).values({
    name: 'Personal Pkg', slug, seatLimit: 1, companyLimit: 1, adminLimit: 1, selfSignup: true,
  }).returning()
  const permRows = await db.select().from(permissions).where(inArray(permissions.key, keys))
  if (permRows.length) await db.insert(packagePermissions).values(permRows.map(p => ({ packageId: pkg.id, permissionId: p.id })))
  return pkg
}

test('POST /signup/personal สำเร็จ → tenant type personal, membership admin, resolveClaims ได้ grants admin + keys ของแพ็ค + package slug', async () => {
  const pkg = await makeSelfSignupPackage(['esign.document.read', 'esign.document.sign'])
  const email = `signup-ok-${Date.now()}@example.com`

  const res = await post({ email, packageSlug: pkg.slug })
  expect(res.status).toBe(200)
  const { tenantId, userId } = await res.json() as { tenantId: number; userId: number }
  expect(tenantId).toBeGreaterThan(0)
  expect(userId).toBeGreaterThan(0)

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  expect(tenant.type).toBe('personal')
  expect(tenant.packageId).toBe(pkg.id)

  const [user] = await db.select().from(users).where(eq(users.id, userId))
  expect(user.email).toBe(email)

  const [membership] = await db.select().from(userCompanies).where(eq(userCompanies.userId, userId))
  expect(membership.isAdmin).toBe(true)
  const [co] = await db.select().from(companies).where(eq(companies.id, membership.companyId))
  expect(co.tenantId).toBe(tenantId)

  const claims = await resolveClaims(user.zitadelUserId) as { grants: Record<string, { roles: string[]; permissions: string[] }>; package?: string }
  expect(claims.package).toBe(pkg.slug)
  const grant = claims.grants[String(co.id)]
  expect(grant.roles).toEqual(['admin'])
  expect(grant.permissions).toEqual(expect.arrayContaining(['esign.document.read', 'esign.document.sign', 'tenant.user.manage']))
})

test('POST /signup/personal ด้วย packageSlug ที่ selfSignup=false → 400 invalidPackage', async () => {
  const slug = `signup-noself-${Date.now()}`
  await db.insert(packages).values({ name: 'No Self', slug, seatLimit: 1, companyLimit: 1, adminLimit: 1, selfSignup: false })
  const res = await post({ email: `signup-bad-${Date.now()}@example.com`, packageSlug: slug })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ invalidPackage: slug })
})

test('POST /signup/personal ด้วย packageSlug ที่ไม่มีจริง → 400 invalidPackage', async () => {
  const res = await post({ email: `signup-none-${Date.now()}@example.com`, packageSlug: 'no-such-package-slug' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ invalidPackage: 'no-such-package-slug' })
})

test('POST /signup/personal อีเมลซ้ำ → 409 emailTaken', async () => {
  const pkg = await makeSelfSignupPackage([])
  const email = `signup-dup-${Date.now()}@example.com`

  const first = await post({ email, packageSlug: pkg.slug })
  expect(first.status).toBe(200)

  const second = await post({ email, packageSlug: pkg.slug })
  expect(second.status).toBe(409)
  expect(await second.json()).toEqual({ emailTaken: email })
})
