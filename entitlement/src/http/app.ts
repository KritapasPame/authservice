import { Elysia } from 'elysia'
import { tenantRouter } from '../modules/tenant/route'
import { companyRouter } from '../modules/company/route'
import { roleRouter } from '../modules/role/route'
import { moduleRouter } from '../modules/module/route'
import { userRouter } from '../modules/user/route'
import { claimsRouter } from '../claims/route'
import { zitadelClaimsRouter } from '../claims/zitadel-route'
import { adminRouter } from '../modules/admin/route'

export function createApp() {
  return new Elysia().get('/health', () => ({ ok: true }))
    .use(tenantRouter)
    .use(companyRouter)
    .use(roleRouter)
    .use(moduleRouter)
    .use(userRouter)
    .use(claimsRouter)
    .use(zitadelClaimsRouter)
    .use(adminRouter)
}
