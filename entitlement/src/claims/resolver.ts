import { db } from '../db/client'
import { users, userCompanies, userPermissions, permissions, platformAdmins, modules, tenantModules, tenants, companies, packages, packagePermissions } from '../db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import type { PlatformClaims, Grant } from '@platform/contracts'

// management keys ให้ admin เสมอ (platform plane) — ไม่ผ่าน filter แพ็ค/โมดูล
const MANAGEMENT_KEYS = ['tenant.user.manage', 'tenant.company.manage']

export async function resolveClaims(zid: string): Promise<PlatformClaims> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.zitadelUserId, zid))
  if (admin) return { role: 'superadmin' }
  const [u] = await db.select().from(users).where(eq(users.zitadelUserId, zid))
  if (!u || u.status !== 'active') return {}  // user ถูก disable → ไม่มีสิทธิ์ เหมือนยังไม่ provision

  const [t] = await db.select().from(tenants).leftJoin(packages, eq(tenants.packageId, packages.id)).where(eq(tenants.id, u.tenantId))
  const pkg = t?.packages ?? null

  const [enabled, memberships, userPermRows, pkgPermRows] = await Promise.all([
    db.select({ id: modules.id, key: modules.key }).from(tenantModules)
      .innerJoin(modules, eq(tenantModules.moduleId, modules.id))
      .where(and(eq(tenantModules.tenantId, u.tenantId), eq(tenantModules.enabled, true))),
    db.select().from(userCompanies).where(eq(userCompanies.userId, u.id)),
    db.select({ companyId: userPermissions.companyId, key: permissions.key, moduleId: permissions.moduleId })
      .from(userPermissions).innerJoin(permissions, eq(userPermissions.permissionId, permissions.id))
      .where(eq(userPermissions.userId, u.id)),
    pkg ? db.select({ key: permissions.key, moduleId: permissions.moduleId })
      .from(packagePermissions).innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id))
      .where(eq(packagePermissions.packageId, pkg.id)) : Promise.resolve(null),
  ])
  const enabledIds = [...new Set(enabled.map(m => m.id))]
  // allowed = แพ็ค ∩ โมดูลที่เปิด — tenant ไม่มีแพ็ค = จำกัดด้วยโมดูลอย่างเดียว
  const allowed = pkgPermRows && new Set(pkgPermRows.filter(p => enabledIds.includes(p.moduleId)).map(p => p.key))
  const ok = (p: { key: string; moduleId: number }) => enabledIds.includes(p.moduleId) && (!allowed || allowed.has(p.key))

  // admin = "ทุกอย่างเท่าที่แพ็ค+โมดูลให้" + management keys — ไม่มี '*' ต่ำกว่า superadmin (spec §Resolver ข้อ 5)
  const isAdminSomewhere = u.isGroupAdmin || memberships.some(m => m.isAdmin)
  const modulePerms = isAdminSomewhere && enabledIds.length
    ? await db.select({ key: permissions.key, moduleId: permissions.moduleId }).from(permissions).where(inArray(permissions.moduleId, enabledIds))
    : []
  const adminPerms = isAdminSomewhere ? [...new Set([...modulePerms.filter(ok).map(p => p.key), ...MANAGEMENT_KEYS])] : []

  // group admin เห็นทุกบริษัท active ใน tenant ไม่อิง membership
  const companyIds = u.isGroupAdmin
    ? (await db.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, u.tenantId), eq(companies.status, 'active')))).map(c => c.id)
    : memberships.map(m => m.companyId)

  const grants: Record<string, Grant> = {}
  for (const c of companyIds) {
    if (u.isGroupAdmin) grants[String(c)] = { roles: ['groupcompanyadmin'], permissions: adminPerms }
    else if (memberships.find(m => m.companyId === c)!.isAdmin) grants[String(c)] = { roles: ['admin'], permissions: adminPerms }
    else grants[String(c)] = { roles: [], permissions: [...new Set(userPermRows.filter(p => p.companyId === c && ok(p)).map(p => p.key))] }
  }
  const grantsSize = JSON.stringify(grants).length
  if (grantsSize > 4096) console.warn(`resolveClaims: oversized grants for user ${u.id} (${grantsSize} bytes) — token-per-active-company may be needed (spec §5)`)
  return { tenantId: u.tenantId, companies: companyIds, modules: enabled.map(m => m.key), grants, ...(pkg ? { package: pkg.slug } : {}) }
}
