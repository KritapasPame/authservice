import { pgTable, serial, integer, text, boolean, unique, primaryKey } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  zitadelOrgId: text('zitadel_org_id').notNull().unique(),
  status: text('status').notNull().default('active'),
})

export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  code: text('code'),
  parentCompanyId: integer('parent_company_id'),
  status: text('status').notNull().default('active'),
})

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  zitadelUserId: text('zitadel_user_id').notNull().unique(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  email: text('email').notNull(),
  status: text('status').notNull().default('active'),
})

export const userCompanies = pgTable('user_companies', {
  userId: integer('user_id').notNull().references(() => users.id),
  companyId: integer('company_id').notNull().references(() => companies.id),
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
})

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
