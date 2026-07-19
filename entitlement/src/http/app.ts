import { Elysia } from 'elysia'
import { tenantRouter } from '../modules/tenant/route'
import { companyRouter } from '../modules/company/route'
import { roleRouter } from '../modules/role/route'
import { moduleRouter } from '../modules/module/route'
import { userRouter } from '../modules/user/route'
import { presetRouter } from '../modules/preset/route'
import { packageRouter } from '../modules/package/route'
import { invoiceRouter } from '../modules/invoice/route'
import { claimsRouter } from '../claims/route'
import { zitadelClaimsRouter } from '../claims/zitadel-route'
import { adminRouter } from '../modules/admin/route'

export function createApp() {
  return new Elysia()
    // catch-all for genuinely unexpected errors (e.g. the Zitadel client's Error, which carries the
    // upstream URL/status/body) — never let the raw error message reach the client. Intentional 4xx
    // paths (throw status(...), or plain objects each route already catches) never reach this handler:
    // status() responses resolve before onError runs, and thrown objects are caught locally per-route.
    // VALIDATION is passed through untouched so Elysia's own 422 body still works.
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') return
      console.error(error)
      set.status = 500
      return { error: 'internal' }
    })
    .get('/health', () => ({ ok: true }))
    .use(tenantRouter)
    .use(companyRouter)
    .use(roleRouter)
    .use(moduleRouter)
    .use(userRouter)
    .use(presetRouter)
    .use(packageRouter)
    .use(invoiceRouter)
    .use(claimsRouter)
    .use(zitadelClaimsRouter)
    .use(adminRouter)
}
