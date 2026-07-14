import { db } from '../../db/client'
import { modules, tenantModules } from '../../db/schema'
import { eq, and } from 'drizzle-orm'

export const listModules = () => db.select().from(modules)

export const getModuleByKey = async (key: string) => (await db.select().from(modules).where(eq(modules.key, key)))[0]

// upsert tenantModules row for (tenantId, moduleId) — throws { notFound: true } if key unknown, caller maps to 404
export async function setTenantModule(tenantId: number, key: string, enabled: boolean) {
  const mod = await getModuleByKey(key)
  if (!mod) throw { notFound: true }
  await db.insert(tenantModules).values({ tenantId, moduleId: mod.id, enabled })
    .onConflictDoUpdate({ target: [tenantModules.tenantId, tenantModules.moduleId], set: { enabled } })
  return mod
}

// join tenantModules × modules where tenantId AND enabled=true → module keys (consumed by T11 claims resolver)
export async function enabledModuleKeys(tenantId: number): Promise<string[]> {
  const rows = await db.select({ key: modules.key }).from(tenantModules)
    .innerJoin(modules, eq(tenantModules.moduleId, modules.id))
    .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)))
  return rows.map(r => r.key)
}
