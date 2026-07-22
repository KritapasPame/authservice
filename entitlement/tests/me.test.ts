import { test, expect } from 'bun:test'
import { bearer } from './helpers/auth-mock'
import { Elysia } from 'elysia'
import { db } from '../src/db/client'
import { tenants, companies, users, userCompanies } from '../src/db/schema'

const { meRouter } = await import('../src/modules/me/route')

const app = new Elysia().use(meRouter)
const get = (headers?: Record<string, string>) => app.handle(new Request('http://localhost/me/memberships', { headers }))

const suffix = Date.now() + '-' + Math.random().toString(36).slice(2, 8)

test('ไม่มี token → 401', async () => {
  expect((await get()).status).toBe(401)
})

test('sub ไม่อยู่ในตาราง users → []', async () => {
  const res = await get({ authorization: bearer({ sub: 'me-ghost-' + suffix }) })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([])
})

test('user มี membership → companyName/position/isAdmin ครบ', async () => {
  const [t] = await db.insert(tenants).values({ name: 'T-me-' + suffix, slug: 'me-' + suffix, zitadelOrgId: 'org_me_' + suffix }).returning()
  const [c] = await db.insert(companies).values({ tenantId: t.id, name: 'บริษัท Me ' + suffix }).returning()
  const [u] = await db.insert(users).values({ zitadelUserId: 'me-user-' + suffix, tenantId: t.id, email: `me-${suffix}@example.com` }).returning()
  await db.insert(userCompanies).values({ userId: u.id, companyId: c.id, position: 'ผู้จัดการ' })

  const res = await get({ authorization: bearer({ sub: 'me-user-' + suffix }) })
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual([{ companyId: c.id, companyName: 'บริษัท Me ' + suffix, position: 'ผู้จัดการ', isAdmin: false }])
})
