import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants } from '../src/db/schema'

const { seedBase } = await import('../src/db/seed')
const { moduleRouter } = await import('../src/modules/module/route')
const { enabledModuleKeys } = await import('../src/modules/module/service')

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

const get = (path: string, headers: Record<string, string>) =>
  new Elysia().use(moduleRouter).handle(new Request(`http://localhost${path}`, { headers }))

const put = (path: string, headers: Record<string, string>, body: unknown) =>
  new Elysia().use(moduleRouter).handle(new Request(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

const superAuth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })

test('superadmin enables module for tenant → enabledModuleKeys contains key', async () => {
  await seedBase()
  const tenantId = await makeTenant('mod-enable-' + Date.now())
  const res = await put(`/modules/tenants/${tenantId}/hr`, { authorization: superAuth }, { enabled: true })
  expect(res.status).toBe(200)
  const keys = await enabledModuleKeys(tenantId)
  expect(keys).toContain('hr')
})

test('superadmin disables an existing module → key disappears from enabledModuleKeys', async () => {
  await seedBase()
  const tenantId = await makeTenant('mod-disable-' + Date.now())
  await put(`/modules/tenants/${tenantId}/esign`, { authorization: superAuth }, { enabled: true })
  let keys = await enabledModuleKeys(tenantId)
  expect(keys).toContain('esign')

  const res = await put(`/modules/tenants/${tenantId}/esign`, { authorization: superAuth }, { enabled: false })
  expect(res.status).toBe(200)
  keys = await enabledModuleKeys(tenantId)
  expect(keys).not.toContain('esign')
})

test('GET /modules as non-superadmin → 403', async () => {
  const auth = bearer({ sub: 'z2', 'urn:platform:role': 'tenant_admin' })
  const res = await get('/modules', { authorization: auth })
  expect(res.status).toBe(403)
})

test('GET /modules with no token → 401', async () => {
  const res = await get('/modules', {})
  expect(res.status).toBe(401)
})

test('PUT /modules/tenants/:tenantId/:key with unknown module key → 404', async () => {
  await seedBase()
  const tenantId = await makeTenant('mod-unknown-' + Date.now())
  const res = await put(`/modules/tenants/${tenantId}/nope`, { authorization: superAuth }, { enabled: true })
  expect(res.status).toBe(404)
})

test('GET /modules as superadmin → 200, lists seeded modules', async () => {
  await seedBase()
  const res = await get('/modules', { authorization: superAuth })
  expect(res.status).toBe(200)
  const list = await res.json() as { key: string }[]
  const keys = list.map(m => m.key)
  expect(keys).toContain('core')
  expect(keys).toContain('hr')
  expect(keys).toContain('esign')
})
