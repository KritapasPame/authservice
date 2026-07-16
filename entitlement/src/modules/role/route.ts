import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin, canManageTenant } from '../../http/auth'
import { createRole, getRole, assignPermissions, listRoles } from './service'

// role management: canManageTenant แบบไม่ส่ง perm = เฉพาะ '*' ผ่าน
// (V1 simplification — no fine-grained tenant.user.manage check here, noted for security review)

export const roleRouter = new Elysia({ prefix: '/roles' }).use(requireAuth)
  .post('/', ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId)) { set.status = 403; return 'forbidden' }
    return createRole(body)
  }, { body: t.Object({ tenantId: t.Number(), name: t.String(), slug: t.String(), grantAll: t.Optional(t.Boolean()) }) })
  .post('/:id/permissions', async ({ auth, params, body, set }) => {
    const role = await getRole(Number(params.id))
    if (!role) { set.status = 404; return 'role not found' }
    // system role (tenantId null) → superadmin only; tenant role → guarded by its own tenant
    const allowed = role.tenantId === null ? isSuperadmin(auth.claims) : canManageTenant(auth.claims, role.tenantId)
    if (!allowed) { set.status = 403; return 'forbidden' }
    try {
      await assignPermissions(role.id, body.permissionKeys)
      return { ok: true }
    } catch (e: any) {
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      throw e
    }
  }, { body: t.Object({ permissionKeys: t.Array(t.String()) }) })
  .get('/:tenantId', ({ auth, params, set }) => {
    const tenantId = Number(params.tenantId)
    if (!canManageTenant(auth.claims, tenantId)) { set.status = 403; return 'forbidden' }
    return listRoles(tenantId)
  })
