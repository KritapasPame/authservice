import { Elysia } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { overview, loginEvents } from './service'

export const adminRouter = new Elysia({ prefix: '/admin' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/overview', () => overview())
  .get('/logins', async ({ set }) => {
    const result = await loginEvents()
    if ('notConfigured' in result) { set.status = 501; return { error: 'zitadel mgmt not configured' } }
    return result.events
  })
