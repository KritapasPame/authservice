import { db } from '../../db/client'
import { tenants, modules, tenantModules } from '../../db/schema'
import { createZitadelOrg } from '../../zitadel/client'
import { eq } from 'drizzle-orm'
import type { CreateTenantInput } from '@platform/contracts'

export async function createTenant(input: CreateTenantInput) {
  const orgId = await createZitadelOrg(input.name)
  const [row] = await db.insert(tenants).values({ ...input, zitadelOrgId: orgId }).returning()
  // เปิด module 'core' ให้ทุก tenant อัตโนมัติ — permission tenant.* (T8) เกาะ module นี้
  const [core] = await db.select().from(modules).where(eq(modules.key, 'core'))
  if (core) await db.insert(tenantModules).values({ tenantId: row.id, moduleId: core.id })
  return row
}
export const listTenants = () => db.select().from(tenants)
