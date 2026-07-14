import { mock } from 'bun:test'

// mock.module('jose', ...) เป็น process-global ทั้ง `bun test` run — override ครั้งเดียวที่นี่แล้ว
// ทุก test ที่ต้อง mock jose ต้อง import ไฟล์นี้ (ห้าม mock.module('jose') ซ้ำที่ไฟล์อื่น)
// test ไหนต้องใช้ jose crypto จริง ห้ามรันร่วม process กับไฟล์ที่ import helper นี้
// auth.test.ts เคส "no token → 401" ไม่เรียก jwtVerify เลย (payload เป็น null ตั้งแต่ไม่มี token) จึงไม่กระทบ
mock.module('jose', () => ({
  createRemoteJWKSet: () => () => {},
  jwtVerify: mock(async (token: string) => ({ payload: JSON.parse(token) })), // token ที่ไม่ใช่ JSON → throw เหมือน jose จริงตอน verify fail
}))

export const bearer = (claims: Record<string, unknown>) => `Bearer ${JSON.stringify(claims)}`
