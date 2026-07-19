import { test, expect } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, presets } from '../src/db/schema'

const { presetRouter } = await import('../src/modules/preset/route')

const app = new Elysia().use(presetRouter)
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.handle(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

const superadmin = bearer({ sub: 'z-sa', 'urn:platform:role': 'superadmin' })
// caller ฝั่ง tenant ที่ถือ tenant.user.manage (ใช้ทดสอบ guard ข้าม tenant / system preset)
const managerOf = (tenantId: number) => bearer({
  sub: 'z-mgr', 'urn:platform:role': 'tenant_admin', 'urn:platform:tenantId': tenantId,
  'urn:platform:grants': { '1': { roles: [], permissions: ['tenant.user.manage'] } },
})

let seq = 0
async function makeTenant() {
  const slug = `preset-${Date.now()}-${++seq}`
  const [tenant] = await db.insert(tenants).values({ name: 'T-' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return { tenant }
}

test('POST /presets + GET list — permissionKeys ครบ, system preset โผล่ทุก tenant', async () => {
  const { tenant } = await makeTenant()
  const res = await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'Staff', slug: 'staff', permissionKeys: ['esign.document.read', 'esign.document.sign'] })
  expect(res.status).toBe(200)
  const list = await (await req('GET', `/presets/${tenant.id}`, { authorization: superadmin })).json()
  expect(list.find((p: any) => p.slug === 'staff').permissionKeys.sort()).toEqual(['esign.document.read', 'esign.document.sign'])
})

test('system preset (tenantId null) โผล่ใน list ของทุก tenant', async () => {
  const { tenant: t1 } = await makeTenant()
  const { tenant: t2 } = await makeTenant()
  const sysSlug = `sys-${Date.now()}-${++seq}`
  await db.insert(presets).values({ tenantId: null, name: 'System Preset', slug: sysSlug })
  const list1 = await (await req('GET', `/presets/${t1.id}`, { authorization: superadmin })).json()
  const list2 = await (await req('GET', `/presets/${t2.id}`, { authorization: superadmin })).json()
  expect(list1.some((p: any) => p.slug === sysSlug)).toBe(true)
  expect(list2.some((p: any) => p.slug === sysSlug)).toBe(true)
})

test('POST /presets ด้วย permission key มั่ว → 404 {missing}', async () => {
  const { tenant } = await makeTenant()
  const res = await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'Bad', slug: `bad-${Date.now()}-${++seq}`, permissionKeys: ['no.such.key'] })
  expect(res.status).toBe(404)
  expect(await res.json()).toEqual({ missing: ['no.such.key'] })
})

test('PUT /presets/:id แทนที่ permissionKeys ทั้งชุด', async () => {
  const { tenant } = await makeTenant()
  const created = await (await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'X', slug: `x-${Date.now()}-${++seq}`, permissionKeys: ['esign.document.read'] })).json()
  const put = await req('PUT', `/presets/${created.id}`, { authorization: superadmin }, { permissionKeys: ['esign.document.sign'] })
  expect(put.status).toBe(200)
  const list = await (await req('GET', `/presets/${tenant.id}`, { authorization: superadmin })).json()
  expect(list.find((p: any) => p.id === created.id).permissionKeys).toEqual(['esign.document.sign'])
})

test('DELETE /presets/:id ลบแล้วหายจาก list; ลบซ้ำ → 404', async () => {
  const { tenant } = await makeTenant()
  const created = await (await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'Del', slug: `del-${Date.now()}-${++seq}`, permissionKeys: [] })).json()
  expect((await req('DELETE', `/presets/${created.id}`, { authorization: superadmin })).status).toBe(200)
  const list = await (await req('GET', `/presets/${tenant.id}`, { authorization: superadmin })).json()
  expect(list.find((p: any) => p.id === created.id)).toBeUndefined()
  // ลบซ้ำ → route lookup ก่อนเสมอ (guard PUT/DELETE) → หาไม่เจอ → 404
  expect((await req('DELETE', `/presets/${created.id}`, { authorization: superadmin })).status).toBe(404)
})

test('slug ซ้ำใน tenant เดียวกัน → 409', async () => {
  const { tenant } = await makeTenant()
  const slug = `dup-${Date.now()}-${++seq}`
  expect((await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'A', slug, permissionKeys: [] })).status).toBe(200)
  expect((await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'B', slug, permissionKeys: [] })).status).toBe(409)
})

test('caller ต่าง tenant → 403 ทั้ง POST/GET/PUT/DELETE', async () => {
  const { tenant } = await makeTenant()
  const alien = managerOf(tenant.id + 9999)
  expect((await req('POST', '/presets', { authorization: alien }, { tenantId: tenant.id, name: 'X', slug: `guard-${Date.now()}-${++seq}`, permissionKeys: [] })).status).toBe(403)
  expect((await req('GET', `/presets/${tenant.id}`, { authorization: alien })).status).toBe(403)

  const created = await (await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'Y', slug: `guard2-${Date.now()}-${++seq}`, permissionKeys: [] })).json()
  expect((await req('PUT', `/presets/${created.id}`, { authorization: alien }, { name: 'Z' })).status).toBe(403)
  expect((await req('DELETE', `/presets/${created.id}`, { authorization: alien })).status).toBe(403)
})

test('system preset (tenantId null) แก้/ลบได้เฉพาะ superadmin — tenant manager โดน 403', async () => {
  const { tenant } = await makeTenant()
  const sysSlug = `sys-guard-${Date.now()}-${++seq}`
  const [sys] = await db.insert(presets).values({ tenantId: null, name: 'Sys', slug: sysSlug }).returning()
  const mgr = managerOf(tenant.id)
  expect((await req('PUT', `/presets/${sys.id}`, { authorization: mgr }, { name: 'Hacked' })).status).toBe(403)
  expect((await req('DELETE', `/presets/${sys.id}`, { authorization: mgr })).status).toBe(403)
  expect((await req('PUT', `/presets/${sys.id}`, { authorization: superadmin }, { name: 'Renamed' })).status).toBe(200)
  expect((await req('DELETE', `/presets/${sys.id}`, { authorization: superadmin })).status).toBe(200)
})

test('PUT/DELETE preset ที่ไม่มีจริง → 404', async () => {
  expect((await req('PUT', '/presets/999999999', { authorization: superadmin }, { name: 'X' })).status).toBe(404)
  expect((await req('DELETE', '/presets/999999999', { authorization: superadmin })).status).toBe(404)
})

test('PUT /presets/:id name ใหม่ + permissionKeys มั่ว → 404 {missing}, name ไม่เปลี่ยน (กัน partial write)', async () => {
  const { tenant } = await makeTenant()
  const created = await (await req('POST', '/presets', { authorization: superadmin }, { tenantId: tenant.id, name: 'เดิม', slug: `partial-${Date.now()}-${++seq}`, permissionKeys: [] })).json()
  const put = await req('PUT', `/presets/${created.id}`, { authorization: superadmin }, { name: 'ใหม่', permissionKeys: ['no.such.key'] })
  expect(put.status).toBe(404)
  expect(await put.json()).toEqual({ missing: ['no.such.key'] })
  const list = await (await req('GET', `/presets/${tenant.id}`, { authorization: superadmin })).json()
  expect(list.find((p: any) => p.id === created.id).name).toBe('เดิม')
})
