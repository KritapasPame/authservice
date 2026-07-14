import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { eq, isNull } from 'drizzle-orm'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, modules, permissions, roles, rolePermissions } from '../src/db/schema'

const { seedSystemRoles } = await import('../src/modules/role/seed')
const { roleRouter } = await import('../src/modules/role/route')

async function makeTenant(slug: string) {
  const [row] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return row.id
}

const post = (path: string, headers: Record<string, string>, body: unknown) =>
  new Elysia().use(roleRouter).handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))

const get = (path: string, headers: Record<string, string>) =>
  new Elysia().use(roleRouter).handle(new Request(`http://localhost${path}`, { headers }))

test('seedSystemRoles creates modules/permissions/system roles, idempotent on repeat call', async () => {
  await seedSystemRoles()
  const modulesAfterFirst = await db.select().from(modules)
  const permissionsAfterFirst = await db.select().from(permissions)
  const systemRolesAfterFirst = await db.select().from(roles).where(isNull(roles.tenantId))

  const coreModule = modulesAfterFirst.find(m => m.key === 'core')
  const hrModule = modulesAfterFirst.find(m => m.key === 'hr')
  const esignModule = modulesAfterFirst.find(m => m.key === 'esign')
  expect(coreModule).toBeDefined()
  expect(hrModule).toBeDefined()
  expect(esignModule).toBeDefined()

  const permKeys = permissionsAfterFirst.map(p => p.key)
  expect(permKeys).toContain('tenant.company.manage')
  expect(permKeys).toContain('tenant.user.manage')
  expect(permKeys).toContain('employee.read')
  expect(permKeys).toContain('employee.write')
  expect(permKeys).toContain('esign.document.sign')

  const groupAdmin = systemRolesAfterFirst.find(r => r.slug === 'group_admin')
  const companyAdmin = systemRolesAfterFirst.find(r => r.slug === 'company_admin')
  expect(groupAdmin?.grantAll).toBe(true)
  expect(companyAdmin?.grantAll).toBe(true)

  // call again — must not duplicate
  await seedSystemRoles()
  const modulesAfterSecond = await db.select().from(modules)
  const permissionsAfterSecond = await db.select().from(permissions)
  const systemRolesAfterSecond = await db.select().from(roles).where(isNull(roles.tenantId))

  expect(modulesAfterSecond.length).toBe(modulesAfterFirst.length)
  expect(permissionsAfterSecond.length).toBe(permissionsAfterFirst.length)
  expect(systemRolesAfterSecond.length).toBe(systemRolesAfterFirst.length)
})

test('superadmin creates tenant role with grantAll → row marked grantAll', async () => {
  const tenantId = await makeTenant('role-sa-' + Date.now())
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const res = await post('/roles', { authorization: auth }, { tenantId, name: 'Group Admin', slug: 'group_admin', grantAll: true })
  expect(res.status).toBe(200)
  const row = await res.json() as { id: number; tenantId: number; grantAll: boolean }
  expect(row.tenantId).toBe(tenantId)
  expect(row.grantAll).toBe(true)
})

test('assign permissions to a role creates role_permissions rows', async () => {
  await seedSystemRoles()
  const tenantId = await makeTenant('role-assign-' + Date.now())
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const createRes = await post('/roles', { authorization: auth }, { tenantId, name: 'HR Viewer', slug: 'hr-viewer' })
  const role = await createRes.json() as { id: number }

  const res = await post(`/roles/${role.id}/permissions`, { authorization: auth }, { permissionKeys: ['employee.read', 'esign.document.sign'] })
  expect(res.status).toBe(200)

  const perms = await db.select().from(permissions)
  const employeeRead = perms.find(p => p.key === 'employee.read')!
  const esignSign = perms.find(p => p.key === 'esign.document.sign')!
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id))
  const permIds = rows.map(r => r.permissionId).sort()
  expect(permIds).toEqual([employeeRead.id, esignSign.id].sort())
})

test('assign unknown permission key → error listing missing keys', async () => {
  const tenantId = await makeTenant('role-unknown-' + Date.now())
  const auth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  const createRes = await post('/roles', { authorization: auth }, { tenantId, name: 'Weird Role', slug: 'weird-role' })
  const role = await createRes.json() as { id: number }

  const res = await post(`/roles/${role.id}/permissions`, { authorization: auth }, { permissionKeys: ['does.not.exist'] })
  expect(res.status).toBe(404)
  const body = await res.json() as { missing: string[] }
  expect(body.missing).toEqual(['does.not.exist'])
})

test('GET /roles/:tenantId as tenant user with * grant → 200, includes system + tenant roles', async () => {
  await seedSystemRoles()
  const tenantId = await makeTenant('role-list-' + Date.now())
  const superAuth = bearer({ sub: 'z1', 'urn:platform:role': 'superadmin' })
  await post('/roles', { authorization: superAuth }, { tenantId, name: 'Custom Role', slug: 'custom-role' })

  const auth = bearer({
    sub: 'z2', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['*'] } },
  })
  const res = await get(`/roles/${tenantId}`, { authorization: auth })
  expect(res.status).toBe(200)
  const list = await res.json() as { slug: string; tenantId: number | null }[]
  const slugs = list.map(r => r.slug)
  expect(slugs).toContain('group_admin') // system role
  expect(slugs).toContain('custom-role') // tenant role
})

test('GET /roles/:tenantId as different tenant user → 403', async () => {
  const tenantId = await makeTenant('role-victim-' + Date.now())
  const otherTenantId = await makeTenant('role-attacker-' + Date.now())
  const auth = bearer({
    sub: 'z3', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': otherTenantId,
    'urn:platform:grants': { '1': { roles: ['group_admin'], permissions: ['*'] } },
  })
  const res = await get(`/roles/${tenantId}`, { authorization: auth })
  expect(res.status).toBe(403)
})

test('POST /roles with no token → 401', async () => {
  const res = await post('/roles', {}, { tenantId: 1, name: 'Nope', slug: 'nope' })
  expect(res.status).toBe(401)
})
