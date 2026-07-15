import { db } from '../db/client'
import { users, userCompanies, userRoles, roles, rolePermissions, permissions, platformAdmins, modules, tenantModules } from '../db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import type { PlatformClaims, Grant } from '@platform/contracts'

export async function resolveClaims(zid: string): Promise<PlatformClaims> {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.zitadelUserId, zid))
  if (admin) return { role: 'superadmin' }
  const [u] = await db.select().from(users).where(eq(users.zitadelUserId, zid))
  if (!u || u.status !== 'active') return {}  // user ถูก disable → ไม่มีสิทธิ์ เหมือนยังไม่ provision

  // none of these three depends on another's result (all need only u.tenantId/u.id) — run in parallel
  const [enabled, userCompanyRows, urs] = await Promise.all([
    db.select({ id: modules.id, key: modules.key }).from(tenantModules)
      .innerJoin(modules, eq(tenantModules.moduleId, modules.id))
      .where(and(eq(tenantModules.tenantId, u.tenantId), eq(tenantModules.enabled, true))),
    db.select().from(userCompanies).where(eq(userCompanies.userId, u.id)),
    db.select({ roleId: userRoles.roleId, companyId: userRoles.companyId, slug: roles.slug, grantAll: roles.grantAll })
      .from(userRoles).innerJoin(roles, eq(userRoles.roleId, roles.id)).where(eq(userRoles.userId, u.id)),
  ])
  const enabledIds = enabled.map(m => m.id)
  const companyIds = userCompanyRows.map(r => r.companyId)

  const roleIds = urs.map(r => r.roleId)
  const permRows = roleIds.length ? await db.select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions).innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(and(inArray(rolePermissions.roleId, roleIds), enabledIds.length ? inArray(permissions.moduleId, enabledIds) : eq(permissions.moduleId, -1))) : []
  const permByRole = new Map<number, string[]>()
  for (const p of permRows) permByRole.set(p.roleId, [...(permByRole.get(p.roleId) ?? []), p.key])

  const grants: Record<string, Grant> = {}
  for (const c of companyIds) {
    const rs = urs.filter(r => r.companyId === null || r.companyId === c)
    const permissionsForC = rs.some(r => r.grantAll) ? ['*'] : [...new Set(rs.flatMap(r => permByRole.get(r.roleId) ?? []))]
    grants[String(c)] = { roles: rs.map(r => r.slug), permissions: permissionsForC }
  }
  const grantsSize = JSON.stringify(grants).length
  if (grantsSize > 4096) console.warn(`resolveClaims: oversized grants for user ${u.id} (${grantsSize} bytes) — token-per-active-company may be needed (spec §5)`)
  return { tenantId: u.tenantId, companies: companyIds, modules: enabled.map(m => m.key), grants }
}
