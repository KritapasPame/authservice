import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/client'
import { tenants, users, companies, tenantModules, modules } from '../../db/schema'
import { env } from '../../config/env'
import { listLoginEvents } from '../../zitadel/client'

// PDPA boundary — คืนแค่ count + module key ห้ามมี field ธุรกิจ (employee/salary/document/email) หลุดออกมา
// constant number of queries (4) ไม่ว่าจะมีกี่ tenant — ห้าม loop await ต่อ tenant
export async function overview() {
  const [tenantRows, userCounts, companyCounts, moduleRows] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name }).from(tenants),
    db.select({ tenantId: users.tenantId, count: sql<number>`count(*)::int` }).from(users).groupBy(users.tenantId),
    db.select({ tenantId: companies.tenantId, count: sql<number>`count(*)::int` }).from(companies).groupBy(companies.tenantId),
    db.select({ tenantId: tenantModules.tenantId, key: modules.key }).from(tenantModules)
      .innerJoin(modules, eq(tenantModules.moduleId, modules.id))
      .where(eq(tenantModules.enabled, true)),
  ])

  const userCountByTenant = new Map(userCounts.map(r => [r.tenantId, r.count]))
  const companyCountByTenant = new Map(companyCounts.map(r => [r.tenantId, r.count]))
  const modulesByTenant = new Map<number, string[]>()
  for (const r of moduleRows) modulesByTenant.set(r.tenantId, [...(modulesByTenant.get(r.tenantId) ?? []), r.key])

  return tenantRows.map(t => ({
    tenantId: t.id,
    name: t.name,
    userCount: userCountByTenant.get(t.id) ?? 0,
    companyCount: companyCountByTenant.get(t.id) ?? 0,
    enabledModules: modulesByTenant.get(t.id) ?? [],
  }))
}

// zitadel mgmt PAT ยังไม่ setup ใน dev (manual console step) — unset → caller (route) map เป็น 501 (honest signal ไม่ปลอมเป็น [])
export async function loginEvents() {
  if (!env.ZITADEL_MGMT_URL || !env.ZITADEL_MGMT_TOKEN) return { notConfigured: true as const }
  return { events: await listLoginEvents() }
}
