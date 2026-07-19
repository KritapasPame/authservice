import { db } from '../../db/client'
import { presets, presetPermissions, permissions } from '../../db/schema'
import { eq, inArray, isNull, or } from 'drizzle-orm'
import type { CreatePresetInput } from '@platform/contracts'

const resolveKeys = async (keys: string[]) => {
  const rows = keys.length ? await db.select().from(permissions).where(inArray(permissions.key, keys)) : []
  const missing = keys.filter(k => !rows.some(r => r.key === k))
  if (missing.length) throw { missing }
  return rows
}

export async function listPresets(tenantId: number) {
  const ps = await db.select().from(presets).where(or(isNull(presets.tenantId), eq(presets.tenantId, tenantId)))
  const rows = ps.length ? await db.select({ presetId: presetPermissions.presetId, key: permissions.key })
    .from(presetPermissions).innerJoin(permissions, eq(presetPermissions.permissionId, permissions.id))
    .where(inArray(presetPermissions.presetId, ps.map(p => p.id))) : []
  return ps.map(p => ({ ...p, permissionKeys: rows.filter(r => r.presetId === p.id).map(r => r.key) }))
}

export async function createPreset(i: CreatePresetInput) {
  const rows = await resolveKeys(i.permissionKeys)
  const [p] = await db.insert(presets).values({ tenantId: i.tenantId, name: i.name, slug: i.slug }).returning()
  if (rows.length) await db.insert(presetPermissions).values(rows.map(r => ({ presetId: p.id, permissionId: r.id })))
  return { ...p, permissionKeys: rows.map(r => r.key) }
}

export const getPreset = async (id: number) => (await db.select().from(presets).where(eq(presets.id, id)))[0]

export async function updatePreset(id: number, i: { name?: string; permissionKeys?: string[] }) {
  const rows = i.permissionKeys ? await resolveKeys(i.permissionKeys) : undefined
  if (i.name) await db.update(presets).set({ name: i.name }).where(eq(presets.id, id))
  if (i.permissionKeys) {
    await db.delete(presetPermissions).where(eq(presetPermissions.presetId, id))
    if (rows!.length) await db.insert(presetPermissions).values(rows!.map(r => ({ presetId: id, permissionId: r.id })))
  }
  return { ok: true }
}

export async function deletePreset(id: number) {
  await db.delete(presetPermissions).where(eq(presetPermissions.presetId, id))
  await db.delete(presets).where(eq(presets.id, id))
  return { ok: true }
}
