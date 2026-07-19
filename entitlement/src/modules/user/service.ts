import { db } from '../../db/client'
import { users, userCompanies, tenants, companies, userPermissions, permissions, presets, presetPermissions } from '../../db/schema'
import { createZitadelUser } from '../../zitadel/client'
import { allowedKeys } from '../package/allowed'
import { checkQuota, tenantPackage } from '../package/service'
import { eq, inArray, isNull, or, and } from 'drizzle-orm'
import type { InviteUserInput } from '@platform/contracts'

export async function inviteUser(i: InviteUserInput) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, i.tenantId))
  if (!tenant) throw { notFound: 'tenant' }
  await checkQuota(i.tenantId, 'seat')
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
  // สิทธิ์เริ่มต้น: permissionKeys ตรงชนะ preset — preset เป็นแค่ template (copy-on-save)
  // slug ชนกัน system กับ tenant ตัวเอง (เช่น seed มา slug เดียวกัน) → tenant preset ชนะเสมอ ไม่พึ่ง order จาก DB
  const presetMatches = i.presetSlug
    ? await db.select().from(presets).where(and(eq(presets.slug, i.presetSlug), or(isNull(presets.tenantId), eq(presets.tenantId, i.tenantId))))
    : []
  const preset = presetMatches.find(p => p.tenantId !== null) ?? presetMatches[0]
  if (i.presetSlug && !preset) throw { notFound: 'preset' }
  const keys = i.permissionKeys ?? (preset
    ? (await db.select({ key: permissions.key }).from(presetPermissions).innerJoin(permissions, eq(presetPermissions.permissionId, permissions.id)).where(eq(presetPermissions.presetId, preset.id))).map(r => r.key)
    : [])
  const rows = keys.length ? await db.select().from(permissions).where(inArray(permissions.key, keys)) : []
  const missing = keys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  // management keys (tenant.*) ห้ามเข้าทาง invite เสมอ — เหมือน setPermissions (ผ่านได้ทาง PATCH /:id/admin เท่านั้น)
  // preset ระบบไม่มี tenant.* อยู่แล้ว แต่เช็คไว้เผื่อ preset ของ tenant เอง/permissionKeys ตรงที่ผู้เรียกยัดมา
  const forbidden = keys.filter(k => k.startsWith('tenant.'))
  if (forbidden.length) throw { forbiddenKeys: forbidden }
  const allowed = await allowedKeys(i.tenantId)
  const over = allowed ? keys.filter(k => !allowed.has(k)) : []
  if (over.length) throw { overPackage: over }
  const zid = await createZitadelUser(tenant.zitadelOrgId, i.email)
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: i.tenantId, email: i.email }).returning()
  if (companyIds.length) await db.insert(userCompanies).values(companyIds.map(companyId => ({ userId: u.id, companyId, position: preset?.name ?? null })))
  if (rows.length && companyIds.length) await db.insert(userPermissions).values(companyIds.flatMap(companyId => rows.map(r => ({ userId: u.id, companyId, permissionId: r.id }))))
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

// ถอน membership + สิทธิ์ scope company นั้น (กันสิทธิ์ผีกลับมาเมื่อ add กลับ)
export async function removeCompany(userId: number, companyId: number) {
  await db.delete(userPermissions).where(and(eq(userPermissions.userId, userId), eq(userPermissions.companyId, companyId)))
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
  if (i.groupAdmin !== undefined) {
    // group admin กินสิทธิ์ tenant.* ทั้งก้อน — แพ็คที่ไม่อนุญาต (allowGroupAdmin: false) ห้ามเปิด
    if (i.groupAdmin === true) {
      const pkg = await tenantPackage(user.tenantId)
      if (pkg && !pkg.allowGroupAdmin) throw { quota: 'groupAdmin', limit: 0 }
    }
    await db.update(users).set({ isGroupAdmin: i.groupAdmin }).where(eq(users.id, user.id)); return { ok: true }
  }
  const [m] = await db.select().from(userCompanies).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId!)))
  if (!m) throw { invalidCompany: i.companyId }
  if (i.admin === true) await checkQuota(user.tenantId, 'admin')
  await db.update(userCompanies).set({ isAdmin: i.admin! }).where(and(eq(userCompanies.userId, user.id), eq(userCompanies.companyId, i.companyId!)))
  return { ok: true }
}

export async function listTenantUsers(tenantId: number) {
  const us = await db.select().from(users).where(eq(users.tenantId, tenantId))
  const ms = us.length ? await db.select().from(userCompanies).where(inArray(userCompanies.userId, us.map(u => u.id))) : []
  return us.map(u => ({ id: u.id, email: u.email, status: u.status, isGroupAdmin: u.isGroupAdmin,
    memberships: ms.filter(m => m.userId === u.id).map(m => ({ companyId: m.companyId, position: m.position, isAdmin: m.isAdmin })) }))
}
