import { db } from '../../db/client'
import { companies } from '../../db/schema'
import { eq } from 'drizzle-orm'
import type { CreateCompanyInput } from '@platform/contracts'

export async function createCompany(input: CreateCompanyInput) {
  const [row] = await db.insert(companies).values(input).returning()
  return row
}
export const listByTenant = (tenantId: number) => db.select().from(companies).where(eq(companies.tenantId, tenantId))
