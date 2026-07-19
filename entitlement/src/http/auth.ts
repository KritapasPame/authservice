import { createRequireAuth } from '@platform/auth'
import { env } from '../config/env'

// logic จริงอยู่ @platform/auth (แชร์กับ eSign และ service อื่น) — ที่นี่แค่ bind env ของ entitlement
export const requireAuth = createRequireAuth({ jwksUrl: env.ZITADEL_JWKS_URL, issuer: env.ZITADEL_ISSUER, audience: env.ZITADEL_AUDIENCE })
export { isSuperadmin, canManageTenant, getGrant, can, hasModule } from '@platform/auth'

import { isSuperadmin as _isSA } from '@platform/auth'
// groupcompanyadmin ของ tenant นั้น (หรือ superadmin) — guard สำหรับตั้ง admin flag
export const isGroupAdmin = (c: Record<string, any>, tenantId: number) =>
  _isSA(c) || (c['urn:platform:tenantId'] === tenantId &&
    Object.values(c['urn:platform:grants'] ?? {}).some((g: any) => g.roles?.includes('groupcompanyadmin')))
