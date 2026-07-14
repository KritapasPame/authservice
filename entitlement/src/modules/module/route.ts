import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { listModules, setTenantModule } from './service'

export const moduleRouter = new Elysia({ prefix: '/modules' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/', () => listModules())
  .put('/tenants/:tenantId/:key', async ({ params, body, set }) => {
    try {
      await setTenantModule(Number(params.tenantId), params.key, body.enabled)
      return { ok: true }
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return 'module not found' }
      throw e
    }
  }, { body: t.Object({ enabled: t.Boolean() }) })
