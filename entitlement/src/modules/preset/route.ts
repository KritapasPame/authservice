import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin, canManageTenant } from '../../http/auth'
import { listPresets, createPreset, getPreset, updatePreset, deletePreset } from './service'

// preset management guard: tenant preset → canManageTenant(tenant.user.manage); system preset (tenantId null) → superadmin เท่านั้น
export const presetRouter = new Elysia({ prefix: '/presets' }).use(requireAuth)
  .get('/:tenantId', ({ auth, params, set }) => {
    const tenantId = Number(params.tenantId)
    if (!canManageTenant(auth.claims, tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return listPresets(tenantId)
  })
  .post('/', async ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await createPreset(body)
    } catch (e: any) {
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      if (e?.cause?.code === '23505') { set.status = 409; return 'slug already exists' } // drizzle ห่อ postgres error ไว้ใน .cause
      throw e
    }
  }, { body: t.Object({ tenantId: t.Number(), name: t.String(), slug: t.String(), permissionKeys: t.Array(t.String()) }) })
  .put('/:id', async ({ auth, params, body, set }) => {
    const preset = await getPreset(Number(params.id))
    if (!preset) { set.status = 404; return 'preset not found' }
    const allowed = preset.tenantId === null ? isSuperadmin(auth.claims) : canManageTenant(auth.claims, preset.tenantId, 'tenant.user.manage')
    if (!allowed) { set.status = 403; return 'forbidden' }
    try {
      return await updatePreset(preset.id, body)
    } catch (e: any) {
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      throw e
    }
  }, { body: t.Object({ name: t.Optional(t.String()), permissionKeys: t.Optional(t.Array(t.String())) }) })
  .delete('/:id', async ({ auth, params, set }) => {
    const preset = await getPreset(Number(params.id))
    if (!preset) { set.status = 404; return 'preset not found' }
    const allowed = preset.tenantId === null ? isSuperadmin(auth.claims) : canManageTenant(auth.claims, preset.tenantId, 'tenant.user.manage')
    if (!allowed) { set.status = 403; return 'forbidden' }
    return deletePreset(preset.id)
  })
