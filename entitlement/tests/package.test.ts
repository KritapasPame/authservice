import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, users, companies, userCompanies } from '../src/db/schema'

const { packageRouter } = await import('../src/modules/package/route')
const { companyRouter } = await import('../src/modules/company/route')
const { setTenantPackage } = await import('../src/modules/package/service')
const { resolveClaims } = await import('../src/claims/resolver')

const adminApp = new Elysia().use(packageRouter)
const companyApp = new Elysia().use(companyRouter)

const superadmin = bearer({ sub: 'z-sa-pkg', 'urn:platform:role': 'superadmin' })

const adminReq = (method: string, path: string, body?: unknown) =>
  adminApp.handle(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: superadmin },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

const companyPost = (headers: Record<string, string>, body: unknown) =>
  companyApp.handle(new Request('http://localhost/companies', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

const companyGet = (headers: Record<string, string>, tenantId: number) =>
  companyApp.handle(new Request(`http://localhost/companies/${tenantId}`, { headers }))

let seq = 0
async function makeTenant() {
  const slug = `pkg-t-${Date.now()}-${++seq}`
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row
}
async function makeActiveUser(tenantId: number) {
  const slug = `pkg-u-${Date.now()}-${++seq}`
  const [row] = await db.insert(users).values({ zitadelUserId: 'zu_' + slug, tenantId, email: slug + '@example.com' }).returning()
  return row
}

test('CRUD package: create มี permissionKeys, GET list เห็น permissionKeys + tenantCount, PUT update เปลี่ยนชื่อ+permissionKeys', async () => {
  const slug = `pkg-crud-${Date.now()}`
  const created = await adminReq('POST', '/admin/packages', {
    name: 'Starter', slug, seatLimit: 10, companyLimit: 2, adminLimit: 1,
    permissionKeys: ['employee.read', 'employee.write'],
  })
  expect(created.status).toBe(200)
  const createdBody = await created.json() as { id: number; permissionKeys: string[] }
  expect(createdBody.permissionKeys.sort()).toEqual(['employee.read', 'employee.write'])

  const list = await adminReq('GET', '/admin/packages')
  expect(list.status).toBe(200)
  const listBody = await list.json() as { id: number; slug: string; permissionKeys: string[]; tenantCount: number }[]
  const found = listBody.find(p => p.slug === slug)!
  expect(found).toBeDefined()
  expect(found.permissionKeys.sort()).toEqual(['employee.read', 'employee.write'])
  expect(found.tenantCount).toBe(0)

  const updated = await adminReq('PUT', `/admin/packages/${createdBody.id}`, { name: 'Starter Plus', permissionKeys: ['employee.read'] })
  expect(updated.status).toBe(200)

  const list2 = await adminReq('GET', '/admin/packages')
  const found2 = (await list2.json() as { id: number; name: string; permissionKeys: string[] }[]).find(p => p.id === createdBody.id)!
  expect(found2.name).toBe('Starter Plus')
  expect(found2.permissionKeys).toEqual(['employee.read'])
})

test('PATCH /admin/tenants/:id/package ผูก tenant กับแพ็ค แล้ว resolveClaims มี package slug', async () => {
  const slug = `pkg-bind-${Date.now()}`
  const created = await adminReq('POST', '/admin/packages', {
    name: 'Bind Pkg', slug, seatLimit: 10, companyLimit: 10, adminLimit: 10, permissionKeys: [],
  })
  expect(created.status).toBe(200)

  const tenant = await makeTenant()
  const user = await makeActiveUser(tenant.id)

  const patchRes = await adminReq('PATCH', `/admin/tenants/${tenant.id}/package`, { packageSlug: slug })
  expect(patchRes.status).toBe(200)

  const claims = await resolveClaims(user.zitadelUserId) as { package?: string }
  expect(claims.package).toBe(slug)
})

test('PATCH tenant package ด้วย slug ไม่มีจริง → 404', async () => {
  const tenant = await makeTenant()
  const res = await adminReq('PATCH', `/admin/tenants/${tenant.id}/package`, { packageSlug: 'no-such-package' })
  expect(res.status).toBe(404)
})

test('POST /companies เกิน companyLimit ของแพ็ค → 403 { quota: "company", limit }', async () => {
  const slug = `pkg-quota-${Date.now()}`
  const created = await adminReq('POST', '/admin/packages', {
    name: 'Quota Pkg', slug, seatLimit: 10, companyLimit: 1, adminLimit: 10, permissionKeys: [],
  })
  expect(created.status).toBe(200)

  const tenant = await makeTenant()
  await setTenantPackage(tenant.id, slug)

  const auth = { authorization: bearer({ sub: 'z-quota', 'urn:platform:role': 'superadmin' }) }
  const first = await companyPost(auth, { tenantId: tenant.id, name: 'Co 1' })
  expect(first.status).toBe(200)

  const second = await companyPost(auth, { tenantId: tenant.id, name: 'Co 2' })
  expect(second.status).toBe(403)
  const body = await second.json() as { quota: string; limit: number }
  expect(body).toEqual({ quota: 'company', limit: 1 })
})

test('tenant ไม่มีแพ็ค → สร้าง company ได้ไม่จำกัด', async () => {
  const tenant = await makeTenant()
  const auth = { authorization: bearer({ sub: 'z-unlimited', 'urn:platform:role': 'superadmin' }) }
  for (let i = 0; i < 5; i++) {
    const res = await companyPost(auth, { tenantId: tenant.id, name: `Co ${i}` })
    expect(res.status).toBe(200)
  }
})

test('GET /companies/:tenantId คืน field users เป็นจำนวนสมาชิก', async () => {
  const tenant = await makeTenant()
  const [company] = await db.insert(companies).values({ tenantId: tenant.id, name: 'Users Co' }).returning()
  const u1 = await makeActiveUser(tenant.id)
  const u2 = await makeActiveUser(tenant.id)
  await db.insert(userCompanies).values([{ userId: u1.id, companyId: company.id }, { userId: u2.id, companyId: company.id }])

  const auth = { authorization: bearer({ sub: 'z-count', 'urn:platform:role': 'superadmin' }) }
  const res = await companyGet(auth, tenant.id)
  expect(res.status).toBe(200)
  const rows = await res.json() as { id: number; users: number }[]
  const found = rows.find(r => r.id === company.id)!
  expect(found.users).toBe(2)
})
