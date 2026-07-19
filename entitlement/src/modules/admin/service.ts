import { eq, and, inArray, count } from 'drizzle-orm'
import { db } from '../../db/client'
import { tenants, users, companies, packages, userCompanies } from '../../db/schema'
import { env } from '../../config/env'
import { listLoginEvents } from '../../zitadel/client'

// admin console — ภาพรวม/รายละเอียด tenant (V2: per-user permissions + packages)
export async function overview() {
  const ts = await db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug, type: tenants.type,
    status: tenants.status, pkg: packages.slug, seatLimit: packages.seatLimit })
    .from(tenants).leftJoin(packages, eq(tenants.packageId, packages.id))
  const userCounts = await db.select({ tenantId: users.tenantId, n: count() }).from(users).where(eq(users.status, 'active')).groupBy(users.tenantId)
  const companyCounts = await db.select({ tenantId: companies.tenantId, n: count() }).from(companies).groupBy(companies.tenantId)
  return {
    tenants: ts.map(t => ({
      id: t.id, name: t.name, slug: t.slug, type: t.type, status: t.status,
      package: t.pkg, seatLimit: t.seatLimit,
      users: userCounts.find(c => c.tenantId === t.id)?.n ?? 0,
      companies: companyCounts.find(c => c.tenantId === t.id)?.n ?? 0,
    })),
  }
}

export async function tenantDetail(id: number) {
  const [row] = await db.select().from(tenants).leftJoin(packages, eq(tenants.packageId, packages.id)).where(eq(tenants.id, id))
  if (!row) throw { notFound: 'tenant' }
  const cos = await db.select().from(companies).where(eq(companies.tenantId, id))
  const ms = cos.length ? await db.select().from(userCompanies).where(inArray(userCompanies.companyId, cos.map(c => c.id))) : []
  const seats = (await db.select({ n: count() }).from(users).where(and(eq(users.tenantId, id), eq(users.status, 'active'))))[0].n
  return {
    tenant: row.tenants,
    package: row.packages,
    usage: { seats, companies: cos.filter(c => c.status === 'active').length, admins: ms.filter(m => m.isAdmin).length },
    companies: cos.map(c => ({ id: c.id, name: c.name, status: c.status,
      users: ms.filter(m => m.companyId === c.id).length, admins: ms.filter(m => m.companyId === c.id && m.isAdmin).length })),
  }
}

// zitadel mgmt PAT ยังไม่ setup ใน dev (manual console step) — unset → caller (route) map เป็น 501 (honest signal ไม่ปลอมเป็น [])
// tenantId (optional) — กรอง events ฝั่งเราจาก org ของ tenant นั้น (Zitadel client เดิมไม่ต้องแก้ ไม่รองรับ filter ใน request)
export async function loginEvents(tenantId?: number) {
  if (!env.ZITADEL_MGMT_URL || !env.ZITADEL_MGMT_TOKEN) return { notConfigured: true as const }
  const raw = await listLoginEvents()
  if (tenantId === undefined) return { events: raw }
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!tenant) throw { notFound: 'tenant' }
  // event object (Zitadel Admin API v1) มี resourceOwner = org ID ของ resource ที่เกิด event — ใช้ field นี้กรอง
  // ถ้า events ไม่มี field นี้เลย (เช่น mock ทดสอบ) คืนแบบไม่กรอง กันกรองแล้วได้ [] ทั้งที่จริงมีของ tenant นั้น
  const events = (raw as any)?.events
  if (!Array.isArray(events) || !events.some(e => e && typeof e === 'object' && 'resourceOwner' in e)) return { events: raw }
  return { events: { ...raw, events: events.filter((e: any) => e.resourceOwner === tenant.zitadelOrgId) } }
}
