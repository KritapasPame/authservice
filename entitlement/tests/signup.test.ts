import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../src/db/client'
import { packages, packagePermissions, permissions, tenants, companies, users, userCompanies } from '../src/db/schema'

// mock zitadel client กัน side-effect ตอน import chain — mock ทุก export (กติกาเดียวกับ user-roles.test.ts)
// org/user id ต้อง unique ต่อ call — zitadelOrgId / zitadelUserId มี unique constraint
let orgCounter = 0
let userCounter = 0
let lastCreateUserArgs: unknown[] = []
let nextCreateUserError: Error | null = null   // ตั้งค่าให้ createZitadelUser ครั้งถัดไปพัง (จำลอง Zitadel error)
let deletedOrgIds: string[] = []
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => `org_mock_signup_${Date.now()}_${++orgCounter}`),
  createZitadelUser: mock(async (...a: unknown[]) => {
    if (nextCreateUserError) { const e = nextCreateUserError; nextCreateUserError = null; throw e }
    lastCreateUserArgs = a; return `user_mock_signup_${Date.now()}_${++userCounter}`
  }),
  deleteZitadelOrg: mock(async (orgId: string) => { deletedOrgIds.push(orgId) }),
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

test('POST /signup/personal ส่ง password → createZitadelUser ได้รับ password (สร้าง user พร้อมรหัส atomic)', async () => {
  const pkg = await makeSelfSignupPackage(['esign.document.read'])
  const res = await post({ email: `signup-pw-${Date.now()}@example.com`, packageSlug: pkg.slug, password: 'Secret-123!' })
  expect(res.status).toBe(200)
  expect(lastCreateUserArgs[2]).toBe('Secret-123!')
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

test('email ซ้ำใน Zitadel (แต่ไม่มีใน DB เรา) → 409 emailTaken + rollback tenant/company/org ไม่ทิ้งขยะ', async () => {
  const pkg = await makeSelfSignupPackage([])
  const email = `signup-zdup-${Date.now()}@example.com`
  nextCreateUserError = new Error('zitadel /v2/users/human 409 {"message":"User already exists (COMMAND-k2unb)"}')

  const res = await post({ email, packageSlug: pkg.slug })
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ emailTaken: email })

  // ไม่มี tenant กำพร้า (สร้างด้วย name = email) และ org ที่สร้างไปแล้วถูกลบ
  const orphan = await db.select().from(tenants).where(eq(tenants.name, email))
  expect(orphan.length).toBe(0)
  expect(deletedOrgIds.length).toBeGreaterThan(0)
})

test('password ไม่ผ่าน policy ของ Zitadel → 400 weakPassword + rollback', async () => {
  const pkg = await makeSelfSignupPackage([])
  const email = `signup-weakpw-${Date.now()}@example.com`
  nextCreateUserError = new Error('zitadel /v2/users/human 400 {"code":3,"message":"Password must contain upper case (COMMA-VoaRj)"}')

  const res = await post({ email, packageSlug: pkg.slug, password: 'aaaabbbb' })
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ weakPassword: true })

  const orphan = await db.select().from(tenants).where(eq(tenants.name, email))
  expect(orphan.length).toBe(0)
})

test('Zitadel พังด้วย error อื่น → error เดิมหลุดออกไป (ไม่ swallow) + rollback เหมือนกัน', async () => {
  const pkg = await makeSelfSignupPackage([])
  const email = `signup-zerr-${Date.now()}@example.com`
  deletedOrgIds = []
  nextCreateUserError = new Error('zitadel /v2/users/human 500 internal')

  const res = await post({ email, packageSlug: pkg.slug })
  expect(res.status).toBeGreaterThanOrEqual(500)

  const orphan = await db.select().from(tenants).where(eq(tenants.name, email))
  expect(orphan.length).toBe(0)
  expect(deletedOrgIds.length).toBe(1)
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
