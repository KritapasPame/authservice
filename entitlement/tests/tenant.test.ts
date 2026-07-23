import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'

// mock zitadel client — ไม่ยิง network จริง ทดสอบ createTenant กับ DB จริง
// mock.module เป็น process-global — ต้อง mock ทุก export ของโมดูล (รวม listLoginEvents ที่ admin.test.ts ใช้)
// ไม่งั้น admin.test.ts ที่ import โมดูลเดียวกันในโปรเซสเดียวกันจะพัง (SyntaxError: export not found)
const orgId = 'org_mock_' + Date.now()
const createZitadelOrgMock = mock(async (_name: string) => orgId)
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: createZitadelOrgMock,
  createZitadelUser: mock(async () => 'user_mock'),
  deleteZitadelOrg: mock(async () => {}),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { tenantRouter } = await import('../src/modules/tenant/route')

const post = (headers: Record<string, string>, body: unknown) =>
  new Elysia().use(tenantRouter).handle(new Request('http://localhost/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

test('POST /tenants as superadmin creates zitadel org + tenant row', async () => {
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const res = await post({ authorization: auth }, { name: 'Acme', slug: 'acme-' + Date.now() })
  expect(res.status).toBe(200)
  const row = await res.json() as { id: number; zitadelOrgId: string }
  expect(row.id).toBeGreaterThan(0)
  expect(row.zitadelOrgId).toBe(orgId)
})

test('POST /tenants as non-superadmin → 403', async () => {
  const auth = bearer({ sub: 'z2', 'urn:platform:role': 'tenant_admin' })
  const res = await post({ authorization: auth }, { name: 'Nope', slug: 'nope-' + Date.now() })
  expect(res.status).toBe(403)
})

test('POST /tenants with no token → 401', async () => {
  const res = await post({}, { name: 'Nope', slug: 'nope2-' + Date.now() })
  expect(res.status).toBe(401)
})

test('S2: unexpected zitadel client error never leaks upstream text — 500 { error: "internal" }', async () => {
  // mockImplementationOnce — mirrors the real zitadel/client.ts Error shape ("zitadel <path> <status> <body>")
  createZitadelOrgMock.mockImplementationOnce(async () => {
    throw new Error('zitadel /v2/organizations 500 {"secret":"upstream detail that must never reach the client"}')
  })
  const { createApp } = await import('../src/http/app')
  const app = createApp()
  const auth = bearer({ sub: 'z-onerror', 'urn:platform:role': 'superadmin' })
  const res = await app.handle(new Request('http://localhost/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({ name: 'Boom Co', slug: 'boom-' + Date.now() }),
  }))
  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body).toEqual({ error: 'internal' })
  expect(JSON.stringify(body)).not.toContain('upstream detail')
})
