import { db } from '../../db/client'
import { companies, userCompanies } from '../../db/schema'
import { eq, and, inArray, count } from 'drizzle-orm'
import type { CreateCompanyInput } from '@platform/contracts'
import { checkQuota } from '../package/service'

export async function createCompany(input: CreateCompanyInput) {
  await checkQuota(input.tenantId, 'company')
  if (input.parentCompanyId != null) {
    const [parent] = await db.select().from(companies).where(and(eq(companies.id, input.parentCompanyId), eq(companies.tenantId, input.tenantId)))
    if (!parent) throw { invalidParent: input.parentCompanyId }
  }
  const [row] = await db.insert(companies).values(input).returning()
  return row
}

export async function listByTenant(tenantId: number) {
  const cos = await db.select().from(companies).where(eq(companies.tenantId, tenantId))
  const counts = cos.length ? await db.select({ companyId: userCompanies.companyId, n: count() }).from(userCompanies)
    .where(inArray(userCompanies.companyId, cos.map(c => c.id))).groupBy(userCompanies.companyId) : []
  return cos.map(c => ({ ...c, users: counts.find(x => x.companyId === c.id)?.n ?? 0 }))
}
