import { Elysia } from 'elysia'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env'
import { resolveClaims } from './resolver'

// contract: zitadel/actions/token-claims.md §2-3 (ZITADEL-Signature HMAC scheme, §3)
const SIGNATURE_TOLERANCE_SECONDS = 300

function validSignature(header: string | null, raw: string, key: string): boolean {
  if (!key) return false // fail-closed: signing key not configured
  const t = header?.match(/t=(\d+)/)?.[1]
  const v1 = header?.match(/v1=([0-9a-f]+)/)?.[1]
  if (!t || !v1) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SECONDS) return false
  const mac = createHmac('sha256', key).update(`${t}.${raw}`).digest()
  const got = Buffer.from(v1, 'hex')
  return got.length === mac.length && timingSafeEqual(mac, got)
}

// adapter for Zitadel Actions v2 execution target, function `preaccesstoken` — see zitadel/actions/token-claims.md
export const zitadelClaimsRouter = new Elysia({ prefix: '/internal/zitadel' })
  .post('/token-claims', async ({ request, set }) => {
    const raw = await request.text()
    if (!validSignature(request.headers.get('ZITADEL-Signature'), raw, env.ZITADEL_ACTIONS_SIGNING_KEY)) {
      set.status = 401
      return 'no'
    }

    const payload = JSON.parse(raw) as { user?: { id?: string } }
    const zitadelUserId = payload.user?.id
    const claims = zitadelUserId ? await resolveClaims(zitadelUserId) : {}

    if ('role' in claims) return { append_claims: [{ key: 'urn:platform:role', value: claims.role }] }
    if (!('tenantId' in claims)) return {}
    return { append_claims: Object.entries(claims).map(([key, value]) => ({ key: `urn:platform:${key}`, value })) }
  })
