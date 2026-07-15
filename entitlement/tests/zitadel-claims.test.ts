import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies, userRoles, roles, platformAdmins } from '../src/db/schema'
import { env } from '../src/config/env'

const { seedSystemRoles } = await import('../src/modules/role/seed')
const { zitadelClaimsRouter } = await import('../src/claims/zitadel-route')

const TEST_KEY = 'unit-test-zitadel-signing-key'
env.ZITADEL_ACTIONS_SIGNING_KEY = TEST_KEY

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

async function makeCompany(tenantId: number, name: string) {
  const [row] = await db.insert(companies).values({ tenantId, name }).returning()
  return row.id
}

async function makeUser(tenantId: number, zitadelUserId: string) {
  const [row] = await db.insert(users).values({ zitadelUserId, tenantId, email: zitadelUserId + '@example.com', status: 'active' }).returning()
  return row.id
}

async function getSystemRoleId(slug: string) {
  const [row] = await db.select().from(roles).where(eq(roles.slug, slug))
  return row.id
}

// mirrors the ContextInfo shape Zitadel's Actions v2 preaccesstoken target actually sends
// (only `user.id` is read by the adapter; the rest is here for verisimilitude)
function zitadelPayload(zid: string) {
  return {
    function: 'function/preaccesstoken',
    userinfo: { sub: zid },
    user: { id: zid },
    user_metadata: [],
    org: { id: 'org1', name: 'org', primary_domain: 'org.example.com' },
    user_grants: [],
    application: { client_id: 'client1' },
  }
}

function sign(raw: string, key: string, t: number = Math.floor(Date.now() / 1000)) {
  const mac = createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${mac}`
}

async function post(raw: string, signatureHeader?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signatureHeader !== undefined) headers['ZITADEL-Signature'] = signatureHeader
  return new Elysia().use(zitadelClaimsRouter).handle(new Request('http://localhost/internal/zitadel/token-claims', {
    method: 'POST',
    headers,
    body: raw,
  }))
}

test('correctly signed request for a provisioned tenant user → 200 + append_claims with exact keys and round-tripped grants', async () => {
  await seedSystemRoles()
  const tenantId = await makeTenant('zw-tenant-' + Date.now())
  const companyA = await makeCompany(tenantId, 'Company A')
  const userId = await makeUser(tenantId, 'zw-user-' + Date.now())
  await db.insert(userCompanies).values([{ userId, companyId: companyA }])
  const companyAdminId = await getSystemRoleId('company_admin')
  await db.insert(userRoles).values([{ userId, roleId: companyAdminId, companyId: companyA }])
  const zid = (await db.select().from(users).where(eq(users.id, userId)))[0]!.zitadelUserId

  const raw = JSON.stringify(zitadelPayload(zid))
  const res = await post(raw, sign(raw, TEST_KEY))
  expect(res.status).toBe(200)
  const body = await res.json() as { append_claims: { key: string; value: unknown }[] }
  expect(body.append_claims.map(c => c.key)).toEqual([
    'urn:platform:tenantId',
    'urn:platform:companies',
    'urn:platform:modules',
    'urn:platform:grants',
  ])
  const byKey = Object.fromEntries(body.append_claims.map(c => [c.key, c.value]))
  expect(byKey['urn:platform:tenantId']).toBe(tenantId)
  expect(byKey['urn:platform:companies']).toEqual([companyA])
  expect(byKey['urn:platform:grants']).toEqual({
    [String(companyA)]: { roles: ['company_admin'], permissions: ['*'] },
  })
})

test('superadmin user → response appends exactly urn:platform:role', async () => {
  const zid = 'zw-superadmin-' + Date.now()
  await db.insert(platformAdmins).values({ zitadelUserId: zid })

  const raw = JSON.stringify(zitadelPayload(zid))
  const res = await post(raw, sign(raw, TEST_KEY))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({ append_claims: [{ key: 'urn:platform:role', value: 'superadmin' }] })
})

test('unknown/unprovisioned user → 200 + empty response (no append_claims)', async () => {
  const raw = JSON.stringify(zitadelPayload('zw-unknown-' + Date.now()))
  const res = await post(raw, sign(raw, TEST_KEY))
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({})
})

test('missing ZITADEL-Signature header → 401', async () => {
  const raw = JSON.stringify(zitadelPayload('whoever'))
  const res = await post(raw, undefined)
  expect(res.status).toBe(401)
})

test('signature computed with the wrong key → 401', async () => {
  const raw = JSON.stringify(zitadelPayload('whoever'))
  const res = await post(raw, sign(raw, 'not-the-real-key'))
  expect(res.status).toBe(401)
})

test('stale timestamp (older than the 300s tolerance) → 401', async () => {
  const raw = JSON.stringify(zitadelPayload('whoever'))
  const staleT = Math.floor(Date.now() / 1000) - 301
  const res = await post(raw, sign(raw, TEST_KEY, staleT))
  expect(res.status).toBe(401)
})

test('valid HMAC signature over a non-JSON body → 400, no parser error detail leaked', async () => {
  const raw = 'not valid json {{{'
  const res = await post(raw, sign(raw, TEST_KEY))
  expect(res.status).toBe(400)
  const body = await res.json()
  expect(body).toEqual({ error: 'invalid json' })
})

test('signing key unset in env → 401 even with an otherwise well-formed signature', async () => {
  const raw = JSON.stringify(zitadelPayload('whoever'))
  const sig = sign(raw, TEST_KEY)
  const original = env.ZITADEL_ACTIONS_SIGNING_KEY
  env.ZITADEL_ACTIONS_SIGNING_KEY = ''
  try {
    const res = await post(raw, sig)
    expect(res.status).toBe(401)
  } finally {
    env.ZITADEL_ACTIONS_SIGNING_KEY = original
  }
})
