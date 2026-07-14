import { db } from '../../db/client'
import { users, userCompanies, userRoles, roles, tenants, companies } from '../../db/schema'
import { createZitadelUser } from '../../zitadel/client'
import { eq, inArray, isNull, or, and } from 'drizzle-orm'
import type { InviteUserInput } from '@platform/contracts'

export async function inviteUser(i: InviteUserInput) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, i.tenantId))
  if (!tenant) throw { notFound: 'tenant' }
  // dedupe + validate companyIds จริงๆ เป็นของ tenant นี้ — กัน tenant-A admin ยัด company ของ tenant-B
  // (ต้อง validate ก่อนสร้าง zitadel user/DB rows กัน invite ที่ reject ทิ้ง orphan)
  const companyIds = [...new Set(i.companyIds)]
  if (companyIds.length) {
    const owned = await db.select().from(companies).where(and(inArray(companies.id, companyIds), eq(companies.tenantId, i.tenantId)))
    if (owned.length !== companyIds.length) {
      const ownedIds = new Set(owned.map(c => c.id))
      throw { invalidCompanies: companyIds.filter(id => !ownedIds.has(id)) }
    }
  }
  const zid = await createZitadelUser(tenant.zitadelOrgId, i.email)
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: i.tenantId, email: i.email }).returning()
  if (companyIds.length) await db.insert(userCompanies).values(companyIds.map(companyId => ({ userId: u.id, companyId })))
  // slug อาจชนกับ system role (tenantId null) หรือ role ของ tenant อื่นที่ใช้ slug ซ้ำ — จำกัดแค่ system role + role ของ tenant นี้เอง
  const rs = i.roleSlugs.length
    ? await db.select().from(roles).where(and(inArray(roles.slug, i.roleSlugs), or(isNull(roles.tenantId), eq(roles.tenantId, i.tenantId))))
    : []
  if (rs.length) await db.insert(userRoles).values(rs.map(r => ({ userId: u.id, roleId: r.id, companyId: null })))
  return u
}
