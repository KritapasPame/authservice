import { Elysia, t } from 'elysia'
import { signupPersonal } from './service'

// public — สมัคร personal tenant เอง ไม่ต้อง auth (ไม่มี .use(requireAuth))
export const signupRouter = new Elysia({ prefix: '/signup' })
  .post('/personal', async ({ body, set }) => {
    try { return await signupPersonal(body) }
    catch (e: any) {
      if (e?.invalidPackage) { set.status = 400; return { invalidPackage: e.invalidPackage } }
      if (e?.emailTaken) { set.status = 409; return { emailTaken: e.emailTaken } }
      throw e
    }
  }, { body: t.Object({ email: t.String({ format: 'email' }), packageSlug: t.String() }) })
