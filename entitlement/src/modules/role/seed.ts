import { eq, isNull, and } from 'drizzle-orm'
import { db } from '../../db/client'
import { modules, permissions, roles } from '../../db/schema'

const MODULES = [
  { key: 'core', name: 'Core' },
  { key: 'hr', name: 'HR' },
  { key: 'esign', name: 'eSign' },
]

const PERMISSIONS = [
  { key: 'tenant.company.manage', moduleKey: 'core' },
  { key: 'tenant.user.manage', moduleKey: 'core' },
  { key: 'employee.read', moduleKey: 'hr' },
  { key: 'employee.write', moduleKey: 'hr' },
  { key: 'esign.document.sign', moduleKey: 'esign' },
]

const SYSTEM_ROLES = [
  { slug: 'group_admin', name: 'Group Admin' },
  { slug: 'company_admin', name: 'Company Admin' },
]

// idempotent — safe to call repeatedly, never touches existing rows
export async function seedSystemRoles() {
  const moduleByKey = new Map<string, number>()
  for (const m of MODULES) {
    const [existing] = await db.select().from(modules).where(eq(modules.key, m.key))
    const row = existing
      ?? (await db.insert(modules).values(m).onConflictDoNothing().returning())[0]
      ?? (await db.select().from(modules).where(eq(modules.key, m.key)))[0]!
    moduleByKey.set(m.key, row.id)
  }

  for (const p of PERMISSIONS) {
    const [existing] = await db.select().from(permissions).where(eq(permissions.key, p.key))
    if (!existing) await db.insert(permissions).values({ key: p.key, moduleId: moduleByKey.get(p.moduleKey)! }).onConflictDoNothing()
  }

  for (const r of SYSTEM_ROLES) {
    const [existing] = await db.select().from(roles).where(and(eq(roles.slug, r.slug), isNull(roles.tenantId)))
    if (!existing) await db.insert(roles).values({ slug: r.slug, name: r.name, tenantId: null, grantAll: true })
  }
}
