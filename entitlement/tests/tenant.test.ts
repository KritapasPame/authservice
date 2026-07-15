import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'

// mock zitadel client — ไม่ยิง network จริง ทดสอบ createTenant กับ DB จริง
// mock.module เป็น process-global — ต้อง mock ทุก export ของโมดูล (รวม listLoginEvents ที่ admin.test.ts ใช้)
// ไม่งั้น admin.test.ts ที่ import โมดูลเดียวกันในโปรเซสเดียวกันจะพัง (SyntaxError: export not found)
const orgId = 'org_mock_' + Date.now()
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async (_name: string) => orgId),
  createZitadelUser: mock(async () => 'user_mock'),
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
