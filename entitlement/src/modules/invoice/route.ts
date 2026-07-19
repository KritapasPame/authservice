import { Elysia, t } from 'elysia'
import { requireAuth, isSuperadmin } from '../../http/auth'
import { listInvoices, createInvoice, markPaid, printHtml } from './service'

export const invoiceRouter = new Elysia({ prefix: '/admin' }).use(requireAuth)
  .onBeforeHandle(({ auth, set }) => { if (!isSuperadmin(auth.claims)) { set.status = 403; return 'forbidden' } })
  .get('/tenants/:id/invoices', ({ params }) => listInvoices(Number(params.id)))
  .post('/tenants/:id/invoices', async ({ params, body, set }) => {
    try {
      return await createInvoice(Number(params.id), body)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return { notFound: e.notFound } }
      throw e
    }
  }, { body: t.Object({ description: t.String(), amount: t.Number() }) })
  .patch('/invoices/:number/paid', async ({ params, set }) => {
    try {
      return await markPaid(params.number)
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return { notFound: e.notFound } }
      throw e
    }
  })
  .get('/invoices/:number/print', async ({ params, query, set }) => {
    const type = query.type === 'receipt' ? 'receipt' : 'invoice'
    try {
      const html = await printHtml(params.number, type)
      set.headers['content-type'] = 'text/html; charset=utf-8'
      return html
    } catch (e: any) {
      if (e?.notFound) { set.status = 404; return { notFound: e.notFound } }
      if (e?.notPaid) { set.status = 400; return { notPaid: e.notPaid } }
      throw e
    }
  })
