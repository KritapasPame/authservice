import { pgTable, serial, integer, text, boolean, unique, primaryKey, index, timestamp } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  zitadelOrgId: text('zitadel_org_id').notNull().unique(),
  status: text('status').notNull().default('active'),
  packageId: integer('package_id').references(() => packages.id),
  type: text('type').notNull().default('org'),   // 'org' | 'personal'
})

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  code: text('code'),
  parentCompanyId: integer('parent_company_id'),
  status: text('status').notNull().default('active'),
}, (t) => ({ tenantIdx: index('companies_tenant_id_idx').on(t.tenantId) }))

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  zitadelUserId: text('zitadel_user_id').notNull().unique(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  status: text('status').notNull().default('active'),
  isGroupAdmin: boolean('is_group_admin').notNull().default(false),
})

export const userCompanies = pgTable('user_companies', {
  userId: integer('user_id').notNull().references(() => users.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
  isAdmin: boolean('is_admin').notNull().default(false),
  position: text('position'),   // ป้ายตำแหน่งแสดงผล ไม่มีผลต่อสิทธิ์
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.companyId] }) }))

export const modules = pgTable('modules', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),   // 'hr' | 'esign'
  name: text('name').notNull(),
})

export const tenantModules = pgTable('tenant_modules', {
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  moduleId: integer('module_id').notNull().references(() => modules.id),
  enabled: boolean('enabled').notNull().default(true),
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.moduleId] }) }))

export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id), // null = system role
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  grantAll: boolean('grant_all').notNull().default(false),
}, (t) => ({
  slugUq: unique('roles_tenant_slug_uq').on(t.tenantId, t.slug).nullsNotDistinct(),
  tenantIdx: index('roles_tenant_id_idx').on(t.tenantId),
}))

export const permissions = pgTable('permissions', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),          // 'employee.read'
  moduleId: integer('module_id').notNull().references(() => modules.id),
})

export const rolePermissions = pgTable('role_permissions', {
  roleId: integer('role_id').notNull().references(() => roles.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }))

export const userRoles = pgTable('user_roles', {
  id: serial('id').primaryKey(),  // PK แยก — companyId เป็น null ได้ (Postgres ห้าม null ใน composite PK)
  userId: integer('user_id').notNull().references(() => users.id),
  roleId: integer('role_id').notNull().references(() => roles.id),
  companyId: integer('company_id').references(() => companies.id), // null = ทุก company ใน tenant
}, (t) => ({ uq: unique('user_roles_uq').on(t.userId, t.roleId, t.companyId).nullsNotDistinct() }))

export const platformAdmins = pgTable('platform_admins', {
  zitadelUserId: text('zitadel_user_id').primaryKey(),  // superadmin (platform plane)
})

// --- V2: per-user permissions + packages (spec 2026-07-19) ---

export const packages = pgTable('packages', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  seatLimit: integer('seat_limit').notNull(),
  companyLimit: integer('company_limit').notNull(),
  adminLimit: integer('admin_limit').notNull(),
  docLimitMonthly: integer('doc_limit_monthly'),            // null = ไม่จำกัด (ฝั่ง eSign เป็นคนนับ)
  allowGroupAdmin: boolean('allow_group_admin').notNull().default(true),
  selfSignup: boolean('self_signup').notNull().default(false),
  price: integer('price').notNull().default(0),             // บาท/เดือน
})

export const packagePermissions = pgTable('package_permissions', {
  packageId: integer('package_id').notNull().references(() => packages.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.packageId, t.permissionId] }) }))

export const presets = pgTable('presets', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').references(() => tenants.id), // null = system preset
  name: text('name').notNull(),
  slug: text('slug').notNull(),
}, (t) => ({ slugUq: unique('presets_tenant_slug_uq').on(t.tenantId, t.slug).nullsNotDistinct() }))

export const presetPermissions = pgTable('preset_permissions', {
  presetId: integer('preset_id').notNull().references(() => presets.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.presetId, t.permissionId] }) }))

// หัวใจแบบ A — สิทธิ์รายคนต่อบริษัท (source of truth เดียว)
export const userPermissions = pgTable('user_permissions', {
  userId: integer('user_id').notNull().references(() => users.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
  permissionId: integer('permission_id').notNull().references(() => permissions.id),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.companyId, t.permissionId] }) }))

export const invoices = pgTable('invoices', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  number: text('number').notNull().unique(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),                      // บาทเต็ม
  status: text('status').notNull().default('issued'),       // 'issued' | 'paid'
  issuedAt: timestamp('issued_at').notNull().defaultNow(),
  paidAt: timestamp('paid_at'),
})
