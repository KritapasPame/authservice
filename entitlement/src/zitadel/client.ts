import { env } from '../config/env'
const call = (path: string, body: unknown) => fetch(env.ZITADEL_MGMT_URL + path, {
  method: 'POST',
  headers: { authorization: `Bearer ${env.ZITADEL_MGMT_TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
}).then(async r => { if (!r.ok) throw new Error(`zitadel ${path} ${r.status} ${await r.text()}`); return r.json() })

export const createZitadelOrg = (name: string) => call('/v2/organizations', { name }).then((r: any) => r.organizationId)
export const createZitadelUser = (orgId: string, email: string) =>
  call('/v2/users/human', { organization: { orgId }, email: { email, isVerified: false }, username: email })
    .then((r: any) => r.userId)
