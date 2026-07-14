import { test, expect } from 'bun:test'
import { db } from '../src/db/client'
import { tenants } from '../src/db/schema'

test('insert + read tenant', async () => {
  const [t] = await db.insert(tenants).values({ name: 'SC Group', slug: 'sc-'+Date.now(), zitadelOrgId: 'org_'+Date.now() }).returning()
  expect(t.id).toBeGreaterThan(0)
})
