import { Elysia, t } from 'elysia'
import { env } from '../config/env'
import { resolveClaims } from './resolver'

export const claimsRouter = new Elysia({ prefix: '/internal' })
  .post('/claims', async ({ body, headers, set }) => {
    if (headers['x-claims-secret'] !== env.CLAIMS_SHARED_SECRET) { set.status = 401; return 'no' }
    return resolveClaims(body.zitadelUserId)
  }, { body: t.Object({ zitadelUserId: t.String() }) })
