CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"number" text NOT NULL,
	"description" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "package_permissions" (
	"package_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "package_permissions_package_id_permission_id_pk" PRIMARY KEY("package_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"seat_limit" integer NOT NULL,
	"company_limit" integer NOT NULL,
	"admin_limit" integer NOT NULL,
	"doc_limit_monthly" integer,
	"allow_group_admin" boolean DEFAULT true NOT NULL,
	"self_signup" boolean DEFAULT false NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "packages_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "preset_permissions" (
	"preset_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "preset_permissions_preset_id_permission_id_pk" PRIMARY KEY("preset_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "presets_tenant_slug_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	CONSTRAINT "user_permissions_user_id_company_id_permission_id_pk" PRIMARY KEY("user_id","company_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "package_id" integer;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "type" text DEFAULT 'org' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_companies" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_companies" ADD COLUMN "position" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_group_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_permissions" ADD CONSTRAINT "package_permissions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "package_permissions" ADD CONSTRAINT "package_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preset_permissions" ADD CONSTRAINT "preset_permissions_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preset_permissions" ADD CONSTRAINT "preset_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presets" ADD CONSTRAINT "presets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;