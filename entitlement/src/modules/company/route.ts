import { Elysia, t } from 'elysia'
import { requireAuth, canManageTenant } from '../../http/auth'
import { createCompany, listByTenant } from './service'

export const companyRouter = new Elysia({ prefix: '/companies' }).use(requireAuth)
  .post('/', async ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId, 'tenant.company.manage')) { set.status = 403; return 'forbidden' }
    try {
      return await createCompany(body)
    } catch (e: any) {
      if (e?.invalidParent !== undefined) { set.status = 400; return { invalidParent: e.invalidParent } }
      throw e
    }
  }, { body: t.Object({ tenantId: t.Number(), name: t.String(), code: t.Optional(t.String()), parentCompanyId: t.Optional(t.Number()) }) })
  .get('/:tenantId', ({ auth, params, set }) => {
    const tenantId = Number(params.tenantId)
    if (!canManageTenant(auth.claims, tenantId, 'tenant.company.manage')) { set.status = 403; return 'forbidden' }
    return listByTenant(tenantId)
  })
