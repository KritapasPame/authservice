import { db } from '../../db/client'
import { packages, packagePermissions, permissions, tenants, companies, users, userCompanies, tenantModules } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { createTenant } from '../tenant/service'
import { createZitadelUser, deleteZitadelOrg } from '../../zitadel/client'

export async function signupPersonal(i: { email: string; packageSlug: string; password?: string }) {
  const [pkg] = await db.select().from(packages).where(and(eq(packages.slug, i.packageSlug), eq(packages.selfSignup, true)))
  if (!pkg) throw { invalidPackage: i.packageSlug }
  if ((await db.select().from(users).where(eq(users.email, i.email))).length) throw { emailTaken: i.email }
  const t = await createTenant({ name: i.email, slug: 'p-' + crypto.randomUUID().slice(0, 8) })
  await db.update(tenants).set({ packageId: pkg.id, type: 'personal' }).where(eq(tenants.id, t.id))
  const [co] = await db.insert(companies).values({ tenantId: t.id, name: i.email }).returning()
  const zid = await createZitadelUser(t.zitadelOrgId, i.email, i.password).catch(async e => {
    // rollback ของที่สร้างไปแล้ว — ไม่ทิ้ง tenant/org กำพร้า (email ซ้ำใน Zitadel เจอบ่อยสุด)
    await db.delete(tenantModules).where(eq(tenantModules.tenantId, t.id))
    await db.delete(companies).where(eq(companies.id, co.id))
    await db.delete(tenants).where(eq(tenants.id, t.id))
    await Promise.resolve(deleteZitadelOrg(t.zitadelOrgId)).catch(() => {})
    if (String(e?.message).includes(' 409 ')) throw { emailTaken: i.email }
    throw e
  })
  const [u] = await db.insert(users).values({ zitadelUserId: zid, tenantId: t.id, email: i.email }).returning()
  await db.insert(userCompanies).values({ userId: u.id, companyId: co.id, isAdmin: true })   // เจ้าของ space ตัวเอง → resolver เดินเส้น admin ปกติ
  const mods = await db.selectDistinct({ moduleId: permissions.moduleId }).from(packagePermissions)
    .innerJoin(permissions, eq(packagePermissions.permissionId, permissions.id)).where(eq(packagePermissions.packageId, pkg.id))
  if (mods.length) await db.insert(tenantModules).values(mods.map(m => ({ tenantId: t.id, moduleId: m.moduleId }))).onConflictDoNothing()
  return { tenantId: t.id, userId: u.id }
}
