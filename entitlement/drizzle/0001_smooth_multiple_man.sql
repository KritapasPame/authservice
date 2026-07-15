CREATE INDEX "companies_tenant_id_idx" ON "companies" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "roles_tenant_id_idx" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_slug_uq" UNIQUE NULLS NOT DISTINCT("tenant_id","slug");