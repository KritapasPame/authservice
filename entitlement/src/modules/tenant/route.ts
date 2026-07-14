import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { createTenant, listTenants } from './service'

export const tenantRouter = new Elysia({ prefix: '/tenants' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/', () => listTenants())
  .post('/', ({ body }) => createTenant(body), { body: t.Object({ name: t.String(), slug: t.String() }) })
