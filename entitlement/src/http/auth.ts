import { Elysia } from 'elysia'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '../config/env'

const JWKS = createRemoteJWKSet(new URL(env.ZITADEL_JWKS_URL))

// { as: 'scoped' } จำเป็น — derive ของ plugin เป็น local scope by default ใน Elysia 1.x
// ถ้าไม่ใส่ route ที่ .use(requireAuth) จะไม่ได้ auth และ middleware ไม่รันเลย
export const requireAuth = new Elysia({ name: 'requireAuth' }).derive({ as: 'scoped' }, async ({ headers, status }) => {
  const token = headers.authorization?.replace('Bearer ', '')
  const payload = token ? await jwtVerify(token, JWKS, { issuer: env.ZITADEL_ISSUER, audience: env.ZITADEL_AUDIENCE })
    .then(r => r.payload, () => null) : null
  if (!payload) throw status(401, 'unauthorized')  // ไม่มี token / verify fail / หมดอายุ → 401 (ไม่หลุดเป็น 500)
  return { auth: { sub: payload.sub as string, claims: payload as Record<string, any> } }
})

export const isSuperadmin = (c: Record<string, any>) => c['urn:platform:role'] === 'superadmin'
export const getGrant = (c: Record<string, any>, companyId: number) =>
  (c['urn:platform:grants'] ?? {})[String(companyId)] ?? { roles: [], permissions: [] }
export const can = (c: Record<string, any>, companyId: number, perm: string) => {
  const g = getGrant(c, companyId); return g.permissions.includes('*') || g.permissions.includes(perm)
}
// '*' จาก grant_all ไม่ถูกกรองด้วย module — service ปลายทางต้องเช็ค hasModule ควบคู่กับ can เสมอ
export const hasModule = (c: Record<string, any>, key: string) => (c['urn:platform:modules'] ?? []).includes(key)
