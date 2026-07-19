import { db } from '../../db/client'
import { packages, packagePermissions, permissions, tenants, users, companies, userCompanies } from '../../db/schema'
import { eq, inArray, and, count } from 'drizzle-orm'
import type { CreatePackageInput } from '@platform/contracts'

// เหมือน role/service.ts assignPermissions — resolve key → row, throw { missing } ถ้าหาไม่เจอ
const resolveKeys = async (keys: string[]) => {
  const rows = await db.select().from(permissions).where(inArray(permissions.key, keys))
  const missing = keys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  return rows
}

export async function listPackages() {
  const ps = await db.select().from(packages)
  const perms = ps.length ? await db.select({ packageId: packagePermissions.packageId, key: permissions.key })
    .from(packagePermissions).innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id)) : []
  const counts = await db.select({ packageId: tenants.packageId, n: count() }).from(tenants).groupBy(tenants.packageId)
  return ps.map(p => ({ ...p, permissionKeys: perms.filter(r => r.packageId === p.id).map(r => r.key),
    tenantCount: counts.find(c => c.packageId === p.id)?.n ?? 0 }))
}

export async function createPackage(i: CreatePackageInput) {
  const rows = await resolveKeys(i.permissionKeys)
  const { permissionKeys, ...cols } = i
  const [p] = await db.insert(packages).values(cols).returning()
  if (rows.length) await db.insert(packagePermissions).values(rows.map(r => ({ packageId: p.id, permissionId: r.id })))
  return { ...p, permissionKeys: rows.map(r => r.key) }
}

export async function updatePackage(id: number, i: Partial<CreatePackageInput>) {
  const { permissionKeys, ...cols } = i
  if (Object.keys(cols).length) await db.update(packages).set(cols).where(eq(packages.id, id))
  if (permissionKeys) {
    const rows = await resolveKeys(permissionKeys)
    await db.delete(packagePermissions).where(eq(packagePermissions.packageId, id))
    if (rows.length) await db.insert(packagePermissions).values(rows.map(r => ({ packageId: id, permissionId: r.id })))
  }
  return { ok: true }
}

export async function setTenantPackage(tenantId: number, packageSlug: string) {
  const [p] = await db.select().from(packages).where(eq(packages.slug, packageSlug))
  if (!p) throw { notFound: 'package' }
  await db.update(tenants).set({ packageId: p.id }).where(eq(tenants.id, tenantId))
  return { ok: true }
}

export const tenantPackage = async (tenantId: number) =>
  (await db.select({ p: packages }).from(tenants).innerJoin(packages, eq(tenants.packageId, packages.id)).where(eq(tenants.id, tenantId)))[0]?.p ?? null

// เช็คตอนจะ "เพิ่ม" — usage ปัจจุบัน >= limit → 403 (tenant ไม่มีแพ็ค = ไม่จำกัด)
export async function checkQuota(tenantId: number, kind: 'seat' | 'company' | 'admin') {
  const pkg = await tenantPackage(tenantId)
  if (!pkg) return
  const usage = kind === 'seat'
    ? (await db.select({ n: count() }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'))))[0].n
    : kind === 'company'
      ? (await db.select({ n: count() }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.status, 'active'))))[0].n
      : (await db.select({ n: count() }).from(userCompanies).innerJoin(companies, eq(userCompanies.companyId, companies.id))
          .where(and(eq(companies.tenantId, tenantId), eq(userCompanies.isAdmin, true))))[0].n
  const limit = kind === 'seat' ? pkg.seatLimit : kind === 'company' ? pkg.companyLimit : pkg.adminLimit
  if (usage >= limit) throw { quota: kind, limit }
}
