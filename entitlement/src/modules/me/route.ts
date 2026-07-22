import { Elysia } from 'elysia'
import { requireAuth } from '../../http/auth'
import { db } from '../../db/client'
import { users, userCompanies, companies } from '../../db/schema'
import { eq } from 'drizzle-orm'

// ข้อมูล membership ของ user ที่ login เอง — ให้ product (eSign) ประกอบหน้าโปรไฟล์
export const meRouter = new Elysia({ prefix: '/me' }).use(requireAuth)
  .get('/memberships', async ({ auth }) => {
    const [u] = await db.select().from(users).where(eq(users.zitadelUserId, auth.claims.sub as string))
    if (!u) return []
    return db.select({ companyId: userCompanies.companyId, companyName: companies.name, position: userCompanies.position, isAdmin: userCompanies.isAdmin })
      .from(userCompanies).innerJoin(companies, eq(companies.id, userCompanies.companyId)).where(eq(userCompanies.userId, u.id))
  })
