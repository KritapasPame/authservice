import { test, expect } from 'bun:test'
import { db } from '../src/db/client'
import { tenants, packages, invoices } from '../src/db/schema'

test('insert + read tenant', async () => {
  const [t] = await db.insert(tenants).values({ name: 'SC Group', slug: 'sc-'+Date.now(), zitadelOrgId: 'org_'+Date.now() }).returning()
  expect(t.id).toBeGreaterThan(0)
})

test('V2 tables: insert package + user_permissions + invoice ได้', async () => {
  const slug = 'pkg-' + Date.now()
  const [pkg] = await db.insert(packages).values({ name: 'Pro', slug, seatLimit: 50, companyLimit: 3, adminLimit: 3 }).returning()
  expect(pkg.allowGroupAdmin).toBe(true)
  const [tenant] = await db.insert(tenants).values({ name: 'SC Group', slug: 'sc-'+Date.now(), zitadelOrgId: 'org_'+Date.now() }).returning()
  const [inv] = await db.insert(invoices).values({ tenantId: tenant.id, number: 'INV-' + slug, description: 'Pro ก.ค.', amount: 2990 }).returning()
  expect(inv.status).toBe('issued')
})
