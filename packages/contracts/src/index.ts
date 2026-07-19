export type Grant = { roles: string[]; permissions: string[] }
export type PlatformClaims =
  | { tenantId: number; companies: number[]; modules: string[]; grants: Record<string, Grant>; package?: string }
  | { role: 'superadmin' }
  | Record<string, never> // unprovisioned

export type CreateTenantInput = { name: string; slug: string }
export type CreateCompanyInput = { tenantId: number; name: string; code?: string; parentCompanyId?: number }
export type InviteUserInput = { tenantId: number; email: string; companyIds: number[]; presetSlug?: string; permissionKeys?: string[] }
export type SetPermissionsInput = { companyId: number; position?: string; permissionKeys: string[] }
export type CreatePackageInput = { name: string; slug: string; seatLimit: number; companyLimit: number; adminLimit: number; docLimitMonthly?: number; allowGroupAdmin?: boolean; selfSignup?: boolean; price?: number; permissionKeys: string[] }
export type CreatePresetInput = { tenantId: number; name: string; slug: string; permissionKeys: string[] }
