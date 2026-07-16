import { Elysia, t } from 'elysia'
import { requireAuth, canManageTenant } from '../../http/auth'
import { inviteUser } from './service'

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
