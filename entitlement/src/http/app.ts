import { Elysia } from 'elysia'

export function createApp() {
  return new Elysia().get('/health', () => ({ ok: true }))
  // routers ของ module จะถูก .use() ต่อที่นี่ (main-session รวมเอง)
}
