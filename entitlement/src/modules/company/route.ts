import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { createCompany, listByTenant } from './service'

// company management เป็น tenant-scoped แต่ grants ถูก key ด้วย companyId — เช็คทุก grant ของ tenant นั้น
// ว่ามี permission tenant.company.manage (หรือ grant_all '*') อยู่บ้างไหม แทนที่จะเช็ค companyId เดียว
const canManageTenant = (claims: Record<string, any>, tenantId: number) =>
  isSuperadmin(claims) || (claims['urn:platform:tenantId'] === tenantId &&
    Object.values(claims['urn:platform:grants'] ?? {}).some((g: any) => g.permissions.includes('*') || g.permissions.includes('tenant.company.manage')))

export const companyRouter = new Elysia({ prefix: '/companies' }).use(requireAuth)
  .post('/', ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId)) { set.status = 403; return 'forbidden' }
    return createCompany(body)
  }, { body: t.Object({ tenantId: t.Number(), name: t.String(), code: t.Optional(t.String()), parentCompanyId: t.Optional(t.Number()) }) })
  .get('/:tenantId', ({ auth, params, set }) => {
    const tenantId = Number(params.tenantId)
    if (!canManageTenant(auth.claims, tenantId)) { set.status = 403; return 'forbidden' }
    return listByTenant(tenantId)
  })
