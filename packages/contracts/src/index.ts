export type Grant = { roles: string[]; permissions: string[] }
export type PlatformClaims =
  | { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant> }
  | { role: 'superadmin' }
  | Record<string, never> // unprovisioned

export type CreateTenantInput = { name: string; slug: string }
export type CreateCompanyInput = { tenantId: number; name: string; code?: string; parentCompanyId?: number }
export type InviteUserInput = { tenantId: number; email: string; companyIds: number[]; roleSlugs: string[] }
