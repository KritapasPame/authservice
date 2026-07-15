import { Elysia, t } from 'elysia'
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'
import { resolveClaims } from './resolver'

// constant-time compare — hash both sides to a fixed length first so timingSafeEqual never
// short-circuits on a length mismatch (which would itself leak timing information)
const sha256 = (s: string) => createHash('sha256').update(s).digest()
const validSecret = (given: string | undefined) => !!given && timingSafeEqual(sha256(given), sha256(env.CLAIMS_SHARED_SECRET))

// /internal/* must never be reachable from the public network — put it behind the
// compose-internal network / a separate non-public port (ingress must not proxy this prefix).
export const claimsRouter = new Elysia({ prefix: '/internal' })
  .post('/claims', async ({ body, headers, set }) => {
    if (!validSecret(headers['x-claims-secret'])) { set.status = 401; return 'no' }
    return resolveClaims(body.zitadelUserId)
  }, { body: t.Object({ zitadelUserId: t.String() }) })
