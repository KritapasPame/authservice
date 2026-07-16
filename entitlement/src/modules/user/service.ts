import { db } from '../../db/client'
import { users, userCompanies, userRoles, roles, tenants, companies } from '../../db/schema'
import { createZitadelUser } from '../../zitadel/client'
import { canManageTenant } from '../../http/auth'
import { eq, inArray, isNull, or, and } from 'drizzle-orm'
import type { InviteUserInput } from '@platform/contracts'

export async function inviteUser(i: InviteUserInput, callerClaims: Record<string, any>) {
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
  // slug อาจชนกับ system role (tenantId null) หรือ role ของ tenant อื่นที่ใช้ slug ซ้ำ — จำกัดแค่ system role + role ของ tenant นี้เอง
  // validate ก่อนสร้าง zitadel user/DB rows เหมือน companyIds ด้านบน — กัน orphan
  const rs = i.roleSlugs.length
    ? await db.select().from(roles).where(and(inArray(roles.slug, i.roleSlugs), or(isNull(roles.tenantId), eq(roles.tenantId, i.tenantId))))
    : []
  // privilege-escalation guard: แนบ role grantAll ('*') ได้เฉพาะ caller ที่ถือ '*' อยู่แล้ว (หรือ superadmin)
  const escalating = rs.filter(r => r.grantAll)
  if (escalating.length && !canManageTenant(callerClaims, i.tenantId)) throw { forbiddenRole: escalating.map(r => r.slug) }
  const zid = await createZitadelUser(tenant.zitadelOrgId, i.email)
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: i.tenantId, email: i.email }).returning()
  if (companyIds.length) await db.insert(userCompanies).values(companyIds.map(companyId => ({ userId: u.id, companyId })))
  if (rs.length) await db.insert(userRoles).values(rs.map(r => ({ userId: u.id, roleId: r.id, companyId: null })))
  return u
}

export async function getUser(id: number) {
  const [u] = await db.select().from(users).where(eq(users.id, id))
  return u
}

export async function setStatus(id: number, status: string) {
  await db.update(users).set({ status }).where(eq(users.id, id))
  return { ok: true }
}

export async function addCompany(user: { id: number; tenantId: number }, companyId: number) {
  const [c] = await db.select().from(companies).where(and(eq(companies.id, companyId), eq(companies.tenantId, user.tenantId)))
  if (!c) throw { invalidCompany: companyId }
  await db.insert(userCompanies).values({ userId: user.id, companyId }).onConflictDoNothing()
  return { ok: true }
}

// ถอน membership แล้วลบ role ที่ scope company นั้นด้วย — กัน role ผีกลับมาทำงานถ้า add membership กลับ
export async function removeCompany(userId: number, companyId: number) {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId)))
  await db.delete(userCompanies).where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
  return { ok: true }
}
