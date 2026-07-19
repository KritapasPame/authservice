import { Elysia, t } from 'elysia'
import { requireAuth, canManageTenant, isGroupAdmin } from '../../http/auth'
import { inviteUser, getUser, setStatus, addCompany, removeCompany, getPermissions, setPermissions, setAdmin, listTenantUsers } from './service'

export const userRouter = new Elysia({ prefix: '/users' }).use(requireAuth)
  .post('/invite', async ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await inviteUser(body)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      if (e?.invalidCompanies) { set.status = 400; return { invalidCompanies: e.invalidCompanies } }
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      if (e?.forbiddenKeys) { set.status = 403; return { forbiddenKeys: e.forbiddenKeys } }  // management key ปฏิเสธเสมอ — เหมือน setPermissions
      if (e?.quota) { set.status = 403; return { quota: e.quota, limit: e.limit } }
      if (e?.overPackage) { set.status = 400; return { overPackage: e.overPackage } }
      throw e
    }
  }, { body: t.Object({ tenantId: t.Number(), email: t.String({ format: 'email' }), companyIds: t.Array(t.Number()), presetSlug: t.Optional(t.String()), permissionKeys: t.Optional(t.Array(t.String())) }) })
  .patch('/:id/status', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return setStatus(user.id, body.status)
  }, { body: t.Object({ status: t.Union([t.Literal('active'), t.Literal('disabled')]) }) })
  .post('/:id/companies', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await addCompany(user, body.companyId)
    } catch (e: any) {
      if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } }
      throw e
    }
  }, { body: t.Object({ companyId: t.Number() }) })
  .delete('/:id/companies/:companyId', async ({ auth, params, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return removeCompany(user.id, Number(params.companyId))
  })
  .get('/tenant/:tenantId', ({ auth, params, set }) => {
    const tenantId = Number(params.tenantId)
    if (!canManageTenant(auth.claims, tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    return listTenantUsers(tenantId)
  })
  .get('/:id/permissions', async ({ auth, params, query, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try { return await getPermissions(user.id, Number(query.companyId)) }
    catch (e: any) { if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } } throw e }
  })
  .put('/:id/permissions', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!canManageTenant(auth.claims, user.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try { return await setPermissions(user, body) }
    catch (e: any) {
      if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } }
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      if (e?.forbiddenKeys) { set.status = 403; return { forbiddenKeys: e.forbiddenKeys } }  // management key ปฏิเสธเสมอ — สิทธิ์นี้ให้ผ่าน admin flag เท่านั้น
      if (e?.overPackage) { set.status = 400; return { overPackage: e.overPackage } }
      throw e
    }
  }, { body: t.Object({ companyId: t.Number(), position: t.Optional(t.String()), permissionKeys: t.Array(t.String()) }) })
  .patch('/:id/admin', async ({ auth, params, body, set }) => {
    const user = await getUser(Number(params.id))
    if (!user) { set.status = 404; return 'user not found' }
    if (!isGroupAdmin(auth.claims, user.tenantId)) { set.status = 403; return 'forbidden' }   // เข้มกว่า user.manage — ตั้ง admin ได้เฉพาะ group admin ขึ้นไป
    try { return await setAdmin(user, body) }
    catch (e: any) {
      if (e?.invalidCompany !== undefined) { set.status = 400; return { invalidCompany: e.invalidCompany } }
      if (e?.quota) { set.status = 403; return { quota: e.quota, limit: e.limit } }
      throw e
    }
  }, { body: t.Union([t.Object({ groupAdmin: t.Boolean() }), t.Object({ companyId: t.Number(), admin: t.Boolean() })]) })
