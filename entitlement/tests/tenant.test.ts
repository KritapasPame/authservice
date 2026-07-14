import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'

// mock jose ทั้งโมดูล — คุมค่า payload ที่ jwtVerify คืนได้ต่อ test โดยไม่ยิง JWKS จริง
let payload: Record<string, any> | null = null
mock.module('jose', () => ({
  createRemoteJWKSet: () => () => {},
  jwtVerify: mock(async () => {
    if (!payload) throw new Error('no token')
    return { payload }
  }),
}))

// mock zitadel client — ไม่ยิง network จริง ทดสอบ createTenant กับ DB จริง
const orgId = 'org_mock_' + Date.now()
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => orgId),
  createZitadelUser: mock(async () => 'user_mock'),
}))

const { tenantRouter } = await import('../src/modules/tenant/route')

const post = (headers: Record<string, string>, body: unknown) =>
  new Elysia().use(tenantRouter).handle(new Request('http://localhost/tenants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

test('POST /tenants as superadmin creates zitadel org + tenant row', async () => {
  payload = { sub: 'z1', 'urn:platform:role': 'superadmin' }
  const res = await post({ authorization: 'Bearer x' }, { name: 'Acme', slug: 'acme-' + Date.now() })
  expect(res.status).toBe(200)
  const row = await res.json() as { id: number; zitadelOrgId: string }
  expect(row.id).toBeGreaterThan(0)
  expect(row.zitadelOrgId).toBe(orgId)
})

test('POST /tenants as non-superadmin → 403', async () => {
  payload = { sub: 'z2', 'urn:platform:role': 'tenant_admin' }
  const res = await post({ authorization: 'Bearer x' }, { name: 'Nope', slug: 'nope-' + Date.now() })
  expect(res.status).toBe(403)
})

test('POST /tenants with no token → 401', async () => {
  payload = null
  const res = await post({}, { name: 'Nope', slug: 'nope2-' + Date.now() })
  expect(res.status).toBe(401)
})
