import { db } from '../../db/client'
import { roles, permissions, rolePermissions } from '../../db/schema'
import { eq, inArray, isNull, or } from 'drizzle-orm'

export type CreateRoleInput = { tenantId: number; name: string; slug: string; grantAll?: boolean }

export async function createRole(input: CreateRoleInput) {
  const [row] = await db.insert(roles).values(input).returning()
  return row
}

export const getRole = async (id: number) => (await db.select().from(roles).where(eq(roles.id, id)))[0]

// throws { missing: string[] } if some permissionKeys don't exist — caller maps to a 404-style response
export async function assignPermissions(roleId: number, permissionKeys: string[]) {
  const rows = await db.select().from(permissions).where(inArray(permissions.key, permissionKeys))
  const foundKeys = new Set(rows.map(r => r.key))
  const missing = permissionKeys.filter(k => !foundKeys.has(k))
  if (missing.length > 0) throw { missing }

  await db.insert(rolePermissions).values(rows.map(r => ({ roleId, permissionId: r.id }))).onConflictDoNothing()
  return rows
}

export const listRoles = (tenantId: number) =>
  db.select().from(roles).where(or(isNull(roles.tenantId), eq(roles.tenantId, tenantId)))
