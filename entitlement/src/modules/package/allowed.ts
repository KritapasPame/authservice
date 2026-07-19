import { db } from '../../db/client'
import { tenants, tenantModules, modules, permissions, packagePermissions } from '../../db/schema'
import { eq, and, inArray } from 'drizzle-orm'

// allowed keys ของ tenant = แพ็ค ∩ โมดูลที่เปิด — null = ไม่มีแพ็ค (ไม่จำกัด, dev/legacy)
export async function allowedKeys(tenantId: number): Promise<Set<string> | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!t?.packageId) return null
  const enabled = await db.select({ id: modules.id }).from(tenantModules).innerJoin(modules, eq(tenantModules.moduleId, modules.id))
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)))
  const rows = enabled.length ? await db.select({ key: permissions.key }).from(packagePermissions)
    .innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id))
    .where(and(eq(packagePermissions.packageId, t.packageId), inArray(permissions.moduleId, enabled.map(m => m.id)))) : []
  return new Set(rows.map(r => r.key))
}
