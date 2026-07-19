import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { listPackages, createPackage, updatePackage, setTenantPackage } from './service'

const packageBody = {
  name: t.String(), slug: t.String(), seatLimit: t.Number(), companyLimit: t.Number(), adminLimit: t.Number(),
  docLimitMonthly: t.Optional(t.Number()), allowGroupAdmin: t.Optional(t.Boolean()), selfSignup: t.Optional(t.Boolean()),
  price: t.Optional(t.Number()), permissionKeys: t.Array(t.String()),
}

export const packageRouter = new Elysia({ prefix: '/admin' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/packages', () => listPackages())
  .post('/packages', async ({ body, set }) => {
    try {
      return await createPackage(body)
    } catch (e: any) {
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      throw e
    }
  }, { body: t.Object(packageBody) })
  .put('/packages/:id', async ({ params, body, set }) => {
    try {
      return await updatePackage(Number(params.id), body)
    } catch (e: any) {
      if (e?.missing) { set.status = 404; return { missing: e.missing } }
      throw e
    }
  }, { body: t.Object({ ...packageBody, name: t.Optional(t.String()), slug: t.Optional(t.String()),
    seatLimit: t.Optional(t.Number()), companyLimit: t.Optional(t.Number()), adminLimit: t.Optional(t.Number()),
    permissionKeys: t.Optional(t.Array(t.String())) }) })
  .patch('/tenants/:id/package', async ({ params, body, set }) => {
    try {
      return await setTenantPackage(Number(params.id), body.packageSlug)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return { notFound: e.notFound } }
      throw e
    }
  }, { body: t.Object({ packageSlug: t.String() }) })
