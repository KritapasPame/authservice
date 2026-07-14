import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { inviteUser } from './service'

// user provisioning เป็น tenant-scoped — เช็คทุก grant ของ tenant นั้นว่ามี tenant.user.manage (หรือ grant_all '*') อยู่บ้างไหม
const canManageTenant = (claims: Record<string, any>, tenantId: number) =>
  isSuperadmin(claims) || (claims['urn:platform:tenantId'] === tenantId &&
    Object.values(claims['urn:platform:grants'] ?? {}).some((g: any) => g.permissions.includes('*') || g.permissions.includes('tenant.user.manage')))

export const userRouter = new Elysia({ prefix: '/users' }).use(requireAuth)
  .post('/invite', async ({ auth, body, set }) => {
    if (!canManageTenant(auth.claims, body.tenantId)) { set.status = 403; return 'forbidden' }
    try {
      return await inviteUser(body)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return `${e.notFound} not found` }
      if (e?.invalidCompanies) { set.status = 400; return { invalidCompanies: e.invalidCompanies } }
      throw e
    }
  }, { body: t.Object({ tenantId: t.Number(), email: t.String({ format: 'email' }), companyIds: t.Array(t.Number()), roleSlugs: t.Array(t.String()) }) })
