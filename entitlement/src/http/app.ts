import { Elysia, ElysiaCustomStatusResponse } from 'elysia'
import { tenantRouter } from '../modules/tenant/route'
import { companyRouter } from '../modules/company/route'
import { moduleRouter } from '../modules/module/route'
import { userRouter } from '../modules/user/route'
import { presetRouter } from '../modules/preset/route'
import { packageRouter } from '../modules/package/route'
import { invoiceRouter } from '../modules/invoice/route'
import { claimsRouter } from '../claims/route'
import { zitadelClaimsRouter } from '../claims/zitadel-route'
import { adminRouter } from '../modules/admin/route'
import { meRouter } from '../modules/me/route'
import { signupRouter } from '../modules/signup/route'
import { staticRouter } from './static'

export function createApp() {
  return new Elysia()
    // catch-all for genuinely unexpected errors (e.g. the Zitadel client's Error, which carries the
    // upstream URL/status/body) — never let the raw error message reach the client. Intentional 4xx
    // paths (throw status(...), or plain objects each route already catches) never reach this handler:
    // status() responses resolve before onError runs, and thrown objects are caught locally per-route.
    // VALIDATION is passed through untouched so Elysia's own 422 body still works. NOT_FOUND
    // (no route matched — e.g. a stray or path-traversal-normalized request under /admin) is a
    // genuine 404, not an unexpected error; pass it through as plain 404 instead of masking it as 500.
    // Intentional thrown `status(...)` responses (e.g. requireAuth's `throw status(401, ...)`
    // inside a scoped `.derive`) surface here as an ElysiaCustomStatusResponse instead of being
    // auto-resolved by Elysia — without this branch they'd fall through to the 500 case below and
    // a plain missing-token request would answer 500 instead of 401. Pass its real status through.
    .onError(({ code, error, set }) => {
      if (code === 'VALIDATION') return
      if (code === 'NOT_FOUND') {
        set.status = 404
        return 'not found'
      }
      if (error instanceof ElysiaCustomStatusResponse) {
        set.status = error.code
        return error.response
      }
      console.error(error)
      set.status = 500
      return { error: 'internal' }
    })
    .get('/health', () => ({ ok: true }))
    .use(tenantRouter)
    .use(companyRouter)
    .use(moduleRouter)
    .use(userRouter)
    .use(presetRouter)
    .use(packageRouter)
    .use(invoiceRouter)
    .use(claimsRouter)
    .use(zitadelClaimsRouter)
    .use(adminRouter)
    .use(signupRouter)
    .use(meRouter)
    .use(staticRouter) // GET /admin, /admin/* — serves admin-ui/ (see static.ts)
}
