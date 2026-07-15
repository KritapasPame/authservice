import { db } from '../../db/client'
import { companies } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import type { CreateCompanyInput } from '@platform/contracts'

export async function createCompany(input: CreateCompanyInput) {
  if (input.parentCompanyId != null) {
    const [parent] = await db.select().from(companies).where(and(eq(companies.id, input.parentCompanyId), eq(companies.tenantId, input.tenantId)))
    if (!parent) throw { invalidParent: input.parentCompanyId }
  }
  const [row] = await db.insert(companies).values(input).returning()
  return row
}
export const listByTenant = (tenantId: number) => db.select().from(companies).where(eq(companies.tenantId, tenantId))
