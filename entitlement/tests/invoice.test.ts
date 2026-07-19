import { test, expect, mock } from 'bun:test'
import { Elysia } from 'elysia'
import { bearer } from './helpers/auth-mock'
import { db } from '../src/db/client'
import { tenants, invoices } from '../src/db/schema'
import { eq } from 'drizzle-orm'

// mock zitadel client กัน side-effect ตอน import chain (กติกาเดียวกับไฟล์ test อื่น — mock ทุก export)
mock.module('../src/zitadel/client', () => ({
  createZitadelOrg: mock(async () => 'org_mock_' + Date.now()),
  createZitadelUser: mock(async () => 'user_mock'),
  listLoginEvents: mock(async () => ({ events: [] })),
}))

const { invoiceRouter } = await import('../src/modules/invoice/route')

const app = new Elysia().use(invoiceRouter)
const req = (method: string, path: string, headers: Record<string, string>, body?: unknown) =>
  app.handle(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))

const superadmin = bearer({ sub: 'z-sa', 'urn:platform:role': 'superadmin' })
const tenantAdmin = bearer({ sub: 'z-ta', 'urn:platform:role': 'tenant_admin' })

async function makeTenant() {
  const slug = 'inv-' + Date.now()
  const [tenant] = await db.insert(tenants).values({ name: 'Acme ' + slug, slug, zitadelOrgId: 'org_' + slug }).returning()
  return tenant
}

test('POST /admin/tenants/:id/invoices ออก invoice ได้เลข INV- + status issued', async () => {
  const tenant = await makeTenant()
  const res = await req('POST', `/admin/tenants/${tenant.id}/invoices`, { authorization: superadmin }, { description: 'ค่าบริการรายเดือน', amount: 1000 })
  expect(res.status).toBe(200)
  const body = await res.json() as { number: string; status: string; tenantId: number }
  expect(body.number).toStartWith('INV-')
  expect(body.status).toBe('issued')
  expect(body.tenantId).toBe(tenant.id)
})

test('PATCH /admin/invoices/:number/paid → status paid, paidAt ไม่ null', async () => {
  const tenant = await makeTenant()
  const created = await req('POST', `/admin/tenants/${tenant.id}/invoices`, { authorization: superadmin }, { description: 'ค่าบริการ', amount: 500 })
  const { number } = await created.json() as { number: string }

  const res = await req('PATCH', `/admin/invoices/${number}/paid`, { authorization: superadmin })
  expect(res.status).toBe(200)

  const [row] = await db.select().from(invoices).where(eq(invoices.number, number))
  expect(row.status).toBe('paid')
  expect(row.paidAt).not.toBeNull()
})

test('GET /admin/invoices/:number/print?type=invoice → HTML มีชื่อ tenant + ยอด', async () => {
  const tenant = await makeTenant()
  const created = await req('POST', `/admin/tenants/${tenant.id}/invoices`, { authorization: superadmin }, { description: 'ค่าบริการทดสอบ', amount: 1234 })
  const { number } = await created.json() as { number: string }

  const res = await req('GET', `/admin/invoices/${number}/print?type=invoice`, { authorization: superadmin })
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toStartWith('text/html')
  const html = await res.text()
  expect(html).toContain(tenant.name)
  expect(html).toContain('1,234')
})

test('GET /admin/invoices/:number/print?type=receipt ก่อนจ่าย → 400 / หลังจ่าย → 200', async () => {
  const tenant = await makeTenant()
  const created = await req('POST', `/admin/tenants/${tenant.id}/invoices`, { authorization: superadmin }, { description: 'ค่าบริการ', amount: 800 })
  const { number } = await created.json() as { number: string }

  const before = await req('GET', `/admin/invoices/${number}/print?type=receipt`, { authorization: superadmin })
  expect(before.status).toBe(400)
  expect(await before.json()).toEqual({ notPaid: number })

  await req('PATCH', `/admin/invoices/${number}/paid`, { authorization: superadmin })

  const after = await req('GET', `/admin/invoices/${number}/print?type=receipt`, { authorization: superadmin })
  expect(after.status).toBe(200)
  expect(after.headers.get('content-type')).toStartWith('text/html')
})

test('ไม่ใช่ superadmin → 403 ทุก endpoint', async () => {
  const tenant = await makeTenant()
  expect((await req('GET', `/admin/tenants/${tenant.id}/invoices`, { authorization: tenantAdmin })).status).toBe(403)
  expect((await req('POST', `/admin/tenants/${tenant.id}/invoices`, { authorization: tenantAdmin }, { description: 'x', amount: 1 })).status).toBe(403)
  expect((await req('PATCH', `/admin/invoices/INV-2026-0001/paid`, { authorization: tenantAdmin })).status).toBe(403)
  expect((await req('GET', `/admin/invoices/INV-2026-0001/print`, { authorization: tenantAdmin })).status).toBe(403)
})
