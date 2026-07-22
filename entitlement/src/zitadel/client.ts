import { env } from '../config/env'
const call = (path: string, body: unknown) => fetch(env.ZITADEL_MGMT_URL + path, {
  method: 'POST',
  headers: { authorization: `Bearer ${env.ZITADEL_MGMT_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(async r => { if (!r.ok) throw new Error(`zitadel ${path} ${r.status} ${await r.text()}`); return r.json() })

export const createZitadelOrg = (name: string) => call('/v2/organizations', { name }).then((r: any) => r.organizationId)
export const createZitadelUser = (orgId: string, email: string, password?: string) =>
  // profile เป็น field บังคับของ AddHumanUser — ยังไม่มีชื่อจริงตอน invite ใช้ email local-part ไปก่อน user แก้เองทีหลังได้
  // isVerified: true — invite flow แอดมินกรอก email เอง (ไม่มี SMTP บน pretest ด้วย); self-signup ในอนาคตต้อง verify จริงใน flow ตัวเอง
  // password — self-signup ส่งมาด้วย = สร้าง user พร้อมรหัสจบใน call เดียว (ไม่มีสภาพ user ไร้รหัสค้าง)
  call('/v2/users/human', { organization: { orgId }, profile: { givenName: email.split('@')[0], familyName: email.split('@')[0] }, email: { email, isVerified: true }, username: email, ...(password && { password: { password, changeRequired: false } }) })
    .then((r: any) => r.userId)

// events search (Admin API) — POST {mgmt}/admin/v1/events/_search, requires IAM_OWNER_VIEWER/IAM_OWNER role on the PAT.
// 'user.token.added' = access token issued on a successful login/authentication.
// https://zitadel.com/docs/guides/integrate/zitadel-apis/event-api
export const listLoginEvents = () => call('/admin/v1/events/_search', { eventTypes: ['user.token.added', 'user.token.v2.added'] /* candidate set — exact name unverifiable without PAT; both harmless if absent */, limit: 100, asc: false })
