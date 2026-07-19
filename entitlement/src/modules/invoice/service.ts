import { db } from '../../db/client'
import { invoices, tenants } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const listInvoices = (tenantId: number) => db.select().from(invoices).where(eq(invoices.tenantId, tenantId))

export async function createInvoice(tenantId: number, i: { description: string; amount: number }) {
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!t) throw { notFound: 'tenant' }
  // placeholder ต้อง unique เอง — UNIQUE(number) ถ้าใช้ 'PENDING' ตรงๆ แล้ว insert สองอันพร้อมกัน (หรือ crash ก่อน update ด้านล่าง) จะชนกันวืด
  const [row] = await db.insert(invoices).values({ tenantId, number: 'PENDING-' + crypto.randomUUID(), ...i }).returning()
  const number = `INV-${new Date().getFullYear()}-${String(row.id).padStart(4, '0')}`   // เลขรันจาก id — ชนกันไม่ได้
  await db.update(invoices).set({ number }).where(eq(invoices.id, row.id))
  return { ...row, number }
}

export async function markPaid(number: string) {
  const [inv] = await db.select().from(invoices).where(eq(invoices.number, number))
  if (!inv) throw { notFound: 'invoice' }
  await db.update(invoices).set({ status: 'paid', paidAt: new Date() }).where(eq(invoices.id, inv.id))
  return { ok: true }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function printHtml(number: string, type: 'invoice' | 'receipt') {
  const [inv] = await db.select().from(invoices).where(eq(invoices.number, number))
  if (!inv) throw { notFound: 'invoice' }
  if (type === 'receipt' && inv.status !== 'paid') throw { notPaid: number }
  const [t] = await db.select().from(tenants).where(eq(tenants.id, inv.tenantId))
  const title = type === 'receipt' ? 'ใบเสร็จรับเงิน / Receipt' : 'ใบแจ้งหนี้ / Invoice'
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${inv.number}</title>
<style>body{font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 20px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}@media print{button{display:none}}</style></head>
<body><h1>${title}</h1><p>เลขที่ ${inv.number}<br>ลูกค้า: ${esc(t.name)}</p>
<table><tr><th>รายการ</th><th class="r">จำนวนเงิน (บาท)</th></tr><tr><td>${esc(inv.description)}</td><td class="r">${inv.amount.toLocaleString()}</td></tr></table>
<p>${type === 'receipt' ? 'ชำระเมื่อ ' + inv.paidAt!.toISOString().slice(0, 10) : 'ออกเมื่อ ' + inv.issuedAt.toISOString().slice(0, 10)}</p>
<button onclick="print()">พิมพ์</button></body></html>`
}
