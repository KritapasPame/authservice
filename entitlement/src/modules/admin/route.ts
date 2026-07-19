import { Elysia } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { overview, tenantDetail, loginEvents } from './service'

export const adminRouter = new Elysia({ prefix: '/admin' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/overview', () => overview())
  .get('/tenants/:id', async ({ params, set }) => {
    try {
      return await tenantDetail(Number(params.id))
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      throw e
    }
  })
  .get('/logins', async ({ query, set }) => {
    try {
      const tenantId = query.tenantId !== undefined ? Number(query.tenantId) : undefined
      const result = await loginEvents(tenantId)
      if ('notConfigured' in result) { set.status = 501; return { error: 'zitadel mgmt not configured' } }
      return result.events
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      throw e
    }
  })
