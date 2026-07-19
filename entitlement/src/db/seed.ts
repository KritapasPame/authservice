import { eq } from 'drizzle-orm'
import { db } from './client'
import { modules, permissions } from './schema'

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
  { key: 'esign.document.read', moduleKey: 'esign' },
  { key: 'esign.document.create', moduleKey: 'esign' },
  { key: 'esign.document.sign', moduleKey: 'esign' },
  { key: 'esign.document.send', moduleKey: 'esign' },
  { key: 'esign.template.manage', moduleKey: 'esign' },
  { key: 'esign.audit.report', moduleKey: 'esign' },
]

// idempotent — เรียกซ้ำได้ ไม่แตะ row เดิม
export async function seedBase() {
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
}
