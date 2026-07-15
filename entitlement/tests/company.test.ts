import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants } from '../src/db/schema'

const { companyRouter } = await import('../src/modules/company/route')

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

const post = (headers: Record<string, string>, body: unknown) =>
  new Elysia().use(companyRouter).handle(new Request('http://localhost/companies', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

const get = (headers: Record<string, string>, tenantId: number) =>
  new Elysia().use(companyRouter).handle(new Request(`http://localhost/companies/${tenantId}`, { headers }))

test('POST /companies as superadmin creates company under tenant', async () => {
  const tenantId = await makeTenant('sa-' + Date.now())
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const res = await post({ authorization: auth }, { tenantId, name: 'Acme HQ' })
  expect(res.status).toBe(200)
  const row = await res.json() as { id: number; tenantId: number; name: string }
  expect(row.id).toBeGreaterThan(0)
  expect(row.tenantId).toBe(tenantId)
})

test('POST /companies with parentCompanyId stores parent id', async () => {
  const tenantId = await makeTenant('parent-' + Date.now())
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const parentRes = await post({ authorization: auth }, { tenantId, name: 'Parent Co' })
  const parent = await parentRes.json() as { id: number }
  const childRes = await post({ authorization: auth }, { tenantId, name: 'Child Co', parentCompanyId: parent.id })
  expect(childRes.status).toBe(200)
  const child = await childRes.json() as { parentCompanyId: number }
  expect(child.parentCompanyId).toBe(parent.id)
})

test('S5: parentCompanyId belonging to another tenant → 400, company not created', async () => {
  const tenantId = await makeTenant('parent-own-' + Date.now())
  const otherTenantId = await makeTenant('parent-other-' + Date.now())
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const otherParentRes = await post({ authorization: auth }, { tenantId: otherTenantId, name: 'Other Tenant Parent' })
  const otherParent = await otherParentRes.json() as { id: number }

  const res = await post({ authorization: auth }, { tenantId, name: 'Should Not Create', parentCompanyId: otherParent.id })
  expect(res.status).toBe(400)
  const body = await res.json() as { invalidParent: number }
  expect(body.invalidParent).toBe(otherParent.id)
})

test('POST /companies as tenant user with tenant.company.manage grant creates in own tenant', async () => {
  const tenantId = await makeTenant('grant-' + Date.now())
  const auth = bearer({
    sub: 'z2', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['tenant.company.manage'] } },
  })
  const res = await post({ authorization: auth }, { tenantId, name: 'Own Tenant Co' })
  expect(res.status).toBe(200)
  const row = await res.json() as { tenantId: number }
  expect(row.tenantId).toBe(tenantId)
})

test('POST /companies as tenant user of a different tenant → 403', async () => {
  const tenantId = await makeTenant('victim-' + Date.now())
  const otherTenantId = await makeTenant('attacker-' + Date.now())
  const auth = bearer({
    sub: 'z3', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': otherTenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['tenant.company.manage'] } },
  })
  const res = await post({ authorization: auth }, { tenantId, name: 'Should Not Create' })
  expect(res.status).toBe(403)
})

test('GET /companies/:tenantId tenant isolation — different tenant user → 403, not empty array', async () => {
  const tenantId = await makeTenant('list-' + Date.now())
  const otherTenantId = await makeTenant('outsider-' + Date.now())
  const auth = bearer({
    sub: 'z4', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': otherTenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['tenant.company.manage'] } },
  })
  const res = await get({ authorization: auth }, tenantId)
  expect(res.status).toBe(403)
})

test('POST /companies with no token → 401', async () => {
  const res = await post({}, { tenantId: 1, name: 'Nope' })
  expect(res.status).toBe(401)
})
