import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { eq } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, companies, roles, users, userCompanies, userRoles } from '../src/db/schema'

// mock zitadel client — ไม่ยิง network จริง (mock.module เป็น process-global — ต้อง mock ทั้ง createZitadelOrg และ
// createZitadelUser ไม่งั้น tenant.test.ts ที่ import ไฟล์เดียวกันจะพัง)
// zitadelUserId ต้อง unique ต่อ call — users.zitadelUserId มี unique constraint และ test นี้ invite หลายคน
let zitadelUserCounter = 0
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => `user_mock_${Date.now()}_${++zitadelUserCounter}`),
}))

const { userRouter } = await import('../src/modules/user/route')

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

const post = (headers: Record<string, string>, body: unknown) =>
  new Elysia().use(userRouter).handle(new Request('http://localhost/users/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

test('superadmin invites user → user row + user_companies + user_roles created', async () => {
  const tenantId = await makeTenant('invite-sa-' + Date.now())
  const [company] = await db.insert(companies).values({ tenantId, name: 'Co A' }).returning()
  const [role] = await db.insert(roles).values({ tenantId, name: 'Custom Role', slug: 'invite-role-' + Date.now() }).returning()

  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const res = await post({ authorization: auth }, { tenantId, email: 'new-user@example.com', companyIds: [company.id], roleSlugs: [role.slug] })
  expect(res.status).toBe(200)
  const body = await res.json() as { id: number; email: string; zitadelUserId: string }
  expect(body.email).toBe('new-user@example.com')
  expect(body.zitadelUserId).toStartWith('user_mock_')

  const [userRow] = await db.select().from(users).where(eq(users.id, body.id))
  expect(userRow).toBeDefined()

  const ucRows = await db.select().from(userCompanies).where(eq(userCompanies.userId, body.id))
  expect(ucRows.map(r => r.companyId)).toEqual([company.id])

  const urRows = await db.select().from(userRoles).where(eq(userRoles.userId, body.id))
  expect(urRows.length).toBe(1)
  expect(urRows[0].roleId).toBe(role.id)
  expect(urRows[0].companyId).toBeNull()
})

test('roleSlugs matching another tenant role slug do NOT attach', async () => {
  const tenantId = await makeTenant('invite-own-' + Date.now())
  const otherTenantId = await makeTenant('invite-other-' + Date.now())
  const sharedSlug = 'shared-slug-' + Date.now()
  const [decoyRole] = await db.insert(roles).values({ tenantId: otherTenantId, name: 'Decoy', slug: sharedSlug }).returning()

  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const res = await post({ authorization: auth }, { tenantId, email: 'decoy-test@example.com', companyIds: [], roleSlugs: [sharedSlug] })
  expect(res.status).toBe(200)
  const body = await res.json() as { id: number }

  const urRows = await db.select().from(userRoles).where(eq(userRoles.userId, body.id))
  expect(urRows.length).toBe(0)
  // sanity: decoy role really exists in the other tenant, just not attached to this user
  const [decoyCheck] = await db.select().from(roles).where(eq(roles.id, decoyRole.id))
  expect(decoyCheck.tenantId).toBe(otherTenantId)
})

test('tenant user with tenant.user.manage grant invites into own tenant → 200', async () => {
  const tenantId = await makeTenant('invite-grant-' + Date.now())
  const auth = bearer({
    sub: 'z2', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['tenant.user.manage'] } },
  })
  const res = await post({ authorization: auth }, { tenantId, email: 'grant-invite@example.com', companyIds: [], roleSlugs: [] })
  expect(res.status).toBe(200)
})

test('tenant user invites into a different tenant → 403', async () => {
  const tenantId = await makeTenant('invite-victim-' + Date.now())
  const otherTenantId = await makeTenant('invite-attacker-' + Date.now())
  const auth = bearer({
    sub: 'z3', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': otherTenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['tenant.user.manage'] } },
  })
  const res = await post({ authorization: auth }, { tenantId, email: 'should-not-invite@example.com', companyIds: [], roleSlugs: [] })
  expect(res.status).toBe(403)
})

test('POST /users/invite with no token → 401', async () => {
  const res = await post({}, { tenantId: 1, email: 'nope@example.com', companyIds: [], roleSlugs: [] })
  expect(res.status).toBe(401)
})

test('tenant admin invites with a companyId belonging to another tenant → 400, no user row created', async () => {
  const tenantId = await makeTenant('invite-crosstenant-own-' + Date.now())
  const otherTenantId = await makeTenant('invite-crosstenant-other-' + Date.now())
  const [otherCompany] = await db.insert(companies).values({ tenantId: otherTenantId, name: 'Victim Co' }).returning()

  const auth = bearer({
    sub: 'z4', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['tenant.user.manage'] } },
  })
  const email = 'cross-tenant-victim@example.com'
  const res = await post({ authorization: auth }, { tenantId, email, companyIds: [otherCompany.id], roleSlugs: [] })
  expect(res.status).toBe(400)
  const body = await res.json() as { invalidCompanies: number[] }
  expect(body.invalidCompanies).toEqual([otherCompany.id])

  const rows = await db.select().from(users).where(eq(users.email, email))
  expect(rows.length).toBe(0)
})

test('duplicate companyIds in payload → single user_companies row', async () => {
  const tenantId = await makeTenant('invite-dedupe-' + Date.now())
  const [company] = await db.insert(companies).values({ tenantId, name: 'Dedupe Co' }).returning()

  const auth = bearer({ sub: 'z5', 'urn:platform:role': 'superadmin' })
  const res = await post({ authorization: auth }, { tenantId, email: 'dedupe-invite@example.com', companyIds: [company.id, company.id], roleSlugs: [] })
  expect(res.status).toBe(200)
  const body = await res.json() as { id: number }

  const ucRows = await db.select().from(userCompanies).where(eq(userCompanies.userId, body.id))
  expect(ucRows.length).toBe(1)
  expect(ucRows[0].companyId).toBe(company.id)
})
