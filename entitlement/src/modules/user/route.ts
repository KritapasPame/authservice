import { Elysia, t } from 'elysia'
import { requireAuth, canManageTenant } from '../../http/auth'
import { inviteUser, getUser, setStatus, addCompany, removeCompany } from './service'

export const userRouter = new Elysia({ prefix: '/users' }).use(requireAuth)
  .post('/invite', async ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId, 'tenant.user.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await inviteUser(body, auth.claims)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      if (e?.invalidCompanies) { set.status = 400; return { invalidCompanies: e.invalidCompanies } }
      if (e?.forbiddenRole) { set.status = 403; return { forbiddenRole: e.forbiddenRole } }
      throw e
    }
  }, { body: t.Object({ tenantId: t.Number(), email: t.String({ format: 'email' }), companyIds: t.Array(t.Number()), roleSlugs: t.Array(t.String()) }) })
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
