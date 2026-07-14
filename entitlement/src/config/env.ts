const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v }
export const env = {
  DATABASE_URL: need('DATABASE_URL'),
  PORT: Number(process.env.PORT ?? 3000),
  ZITADEL_ISSUER: need('ZITADEL_ISSUER'),        // เช่น https://auth.company.com
  ZITADEL_JWKS_URL: need('ZITADEL_JWKS_URL'),    // {issuer}/oauth/v2/keys
  ZITADEL_AUDIENCE: need('ZITADEL_AUDIENCE'),    // project/client id
  ZITADEL_MGMT_URL: process.env.ZITADEL_MGMT_URL ?? '',
  ZITADEL_MGMT_TOKEN: process.env.ZITADEL_MGMT_TOKEN ?? '', // service user PAT
  CLAIMS_SHARED_SECRET: need('CLAIMS_SHARED_SECRET'),
}
