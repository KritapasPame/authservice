import { Elysia } from 'elysia'
import { createRemoteJWKSet, jwtVerify } from 'jose'

// middleware ตรวจ JWT ของ Zitadel — แต่ละ service สร้าง instance เองด้วย env ของตัวเอง
// { as: 'scoped' } จำเป็น — derive ของ plugin เป็น local scope by default ใน Elysia 1.x
// ถ้าไม่ใส่ route ที่ .use(requireAuth) จะไม่ได้ auth และ middleware ไม่รันเลย
export const createRequireAuth = (opts: { jwksUrl: string; issuer: string; audience: string }) => {
  const JWKS = createRemoteJWKSet(new URL(opts.jwksUrl))
  return new Elysia({ name: 'requireAuth' }).derive({ as: 'scoped' }, async ({ headers, status }) => {
    const token = headers.authorization?.replace('Bearer ', '')
    const payload = token ? await jwtVerify(token, JWKS, { issuer: opts.issuer, audience: opts.audience })
      .then(r => r.payload, () => null) : null
    if (!payload) throw status(401, 'unauthorized')  // ไม่มี token / verify fail / หมดอายุ → 401 (ไม่หลุดเป็น 500)
    return { auth: { sub: payload.sub as string, claims: payload as Record<string, any> } }
  })
}

export const isSuperadmin = (c: Record<string, any>) => c['urn:platform:role'] === 'superadmin'
// tenant-scoped management guard — superadmin หรือ (tenant ตรง + grant ไหนก็ได้ถือ '*' หรือ perm ที่ระบุ)
// ไม่ส่ง perm = เฉพาะ '*' ผ่าน (role management / grantAll escalation ใช้แบบนี้)
export const canManageTenant = (c: Record<string, any>, tenantId: number, perm?: string) =>
  isSuperadmin(c) || (c['urn:platform:tenantId'] === tenantId &&
    Object.values(c['urn:platform:grants'] ?? {}).some((g: any) =>
      g.permissions.includes('*') || (perm !== undefined && g.permissions.includes(perm))))
export const getGrant = (c: Record<string, any>, companyId: number) =>
  (c['urn:platform:grants'] ?? {})[String(companyId)] ?? { roles: [], permissions: [] }
export const can = (c: Record<string, any>, companyId: number, perm: string) => {
  const g = getGrant(c, companyId); return g.permissions.includes('*') || g.permissions.includes(perm)
}
// '*' จาก grant_all ไม่ถูกกรองด้วย module — can() เดี่ยวๆ จึงทะลุ module ที่ tenant ไม่ได้เปิดได้
export const hasModule = (c: Record<string, any>, key: string) => (c['urn:platform:modules'] ?? []).includes(key)
// API หลักสำหรับฝั่ง product (eSign, HR, ...) — เช็ค module + permission จบในตัวเดียว ลืม hasModule ไม่ได้
export const canUse = (c: Record<string, any>, companyId: number, moduleKey: string, perm: string) =>
  hasModule(c, moduleKey) && can(c, companyId, perm)
