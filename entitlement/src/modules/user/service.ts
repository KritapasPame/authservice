import { db } from '../../db/client'
import { users, userCompanies, userRoles, roles, tenants, companies, userPermissions, permissions } from '../../db/schema'
import { createZitadelUser } from '../../zitadel/client'
import { canManageTenant } from '../../http/auth'
import { allowedKeys } from '../package/allowed'
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

export async function assignRole(user: { id: number; tenantId: number }, roleSlug: string, companyId: number | null, callerClaims: Record<string, any>) {
  // system ∪ tenant เดียวกัน (invariant เดียวกับ invite — resolver เชื่อ write path นี้)
  const matches = await db.select().from(roles).where(and(eq(roles.slug, roleSlug), or(isNull(roles.tenantId), eq(roles.tenantId, user.tenantId))))
  const role = matches.find(r => r.tenantId !== null) ?? matches[0]  // slug ชนระหว่าง system/tenant → เลือก tenant role
  if (!role) throw { notFound: 'role' }
  if (role.grantAll && !canManageTenant(callerClaims, user.tenantId)) throw { forbiddenRole: [role.slug] }
  if (companyId !== null) {
    // ต้องเป็นสมาชิก company อยู่แล้ว — resolver สร้าง grant เฉพาะ company ใน user_companies, กัน assign แล้ว no-op เงียบ
    const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, companyId)))
    if (!m) throw { invalidCompany: companyId }
  }
  await db.insert(userRoles).values({ userId: user.id, roleId: role.id, companyId }).onConflictDoNothing()
  return { ok: true }
}

export async function revokeRole(user: { id: number; tenantId: number }, roleSlug: string, companyId: number | null) {
  const matches = await db.select().from(roles).where(and(eq(roles.slug, roleSlug), or(isNull(roles.tenantId), eq(roles.tenantId, user.tenantId))))
  if (!matches.length) throw { notFound: 'role' }
  await db.delete(userRoles).where(and(eq(userRoles.userId, user.id), inArray(userRoles.roleId, matches.map(r => r.id)),
    companyId === null ? isNull(userRoles.companyId) : eq(userRoles.companyId, companyId)))
  return { ok: true }
}

// ถอน membership แล้วลบ role ที่ scope company นั้นด้วย — กัน role ผีกลับมาทำงานถ้า add membership กลับ
export async function removeCompany(userId: number, companyId: number) {
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.companyId, companyId)))
  await db.delete(userCompanies).where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
  return { ok: true }
}

export async function getPermissions(userId: number, companyId: number) {
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, userId), eq(userCompanies.companyId, companyId)))
  if (!m) throw { invalidCompany: companyId }
  const rows = await db.select({ key: permissions.key }).from(userPermissions)
    .innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
    .where(and(eq(userPermissions.userId, userId), eq(userPermissions.companyId, companyId)))
  return { companyId, position: m.position, permissionKeys: rows.map(r => r.key) }
}

// replace ทั้งชุด (copy-on-save จาก preset เกิดฝั่ง UI — server เห็นแค่ list สุดท้าย)
export async function setPermissions(user: { id: number; tenantId: number }, i: { companyId: number; position?: string; permissionKeys: string[] }) {
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId)))
  if (!m) throw { invalidCompany: i.companyId }
  const rows = i.permissionKeys.length ? await db.select().from(permissions).where(inArray(permissions.key, i.permissionKeys)) : []
  const missing = i.permissionKeys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  // management keys (tenant.*) เป็น platform plane เสมอ — ห้ามเข้ามาทาง user_permissions แม้ tenant ไม่มีแพ็ค (allowedKeys = null = unrestricted)
  // ให้ผ่านได้ทางเดียวคือ isGroupAdmin ผ่าน PATCH /:id/admin — เช็คก่อน allowedKeys กันหลุดตอน tenant ไม่มีแพ็ค
  const forbidden = i.permissionKeys.filter(k => k.startsWith('tenant.'))
  if (forbidden.length) throw { forbiddenKeys: forbidden }
  const allowed = await allowedKeys(user.tenantId)
  const over = allowed ? i.permissionKeys.filter(k => !allowed.has(k)) : []
  if (over.length) throw { overPackage: over }
  await db.delete(userPermissions).where(and(eq(userPermissions.userId, user.id), eq(userPermissions.companyId, i.companyId)))
  if (rows.length) await db.insert(userPermissions).values(rows.map(r => ({ userId: user.id, companyId: i.companyId, permissionId: r.id })))
  await db.update(userCompanies).set({ position: i.position ?? null }).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId)))
  return { ok: true }
}

export async function setAdmin(user: { id: number; tenantId: number }, i: { groupAdmin?: boolean; companyId?: number; admin?: boolean }) {
  if (i.groupAdmin !== undefined) { await db.update(users).set({ isGroupAdmin: i.groupAdmin }).where(eq(users.id, user.id)); return { ok: true } }
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId!)))
  if (!m) throw { invalidCompany: i.companyId }
  await db.update(userCompanies).set({ isAdmin: i.admin! }).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId!)))
  return { ok: true }
}

export async function listTenantUsers(tenantId: number) {
  const us = await db.select().from(users).where(eq(users.tenantId, tenantId))
  const ms = us.length ? await db.select().from(userCompanies).where(inArray(userCompanies.userId, us.map(u => u.id))) : []
  return us.map(u => ({ id: u.id, email: u.email, status: u.status, isGroupAdmin: u.isGroupAdmin,
    memberships: ms.filter(m => m.userId === u.id).map(m => ({ companyId: m.companyId, position: m.position, isAdmin: m.isAdmin })) }))
}
