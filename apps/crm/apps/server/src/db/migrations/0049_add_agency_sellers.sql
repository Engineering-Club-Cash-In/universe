-- Vendedores de agencia/predio para el tracker: un usuario partner puede quedar
-- ligado a un vendedor y ver solo sus oportunidades.
--
-- Se reutiliza `vehicle_vendors` con un tercer `vendor_type` ('agencia') que
-- cuelga de una company. No se toca `opportunities.vendor_id`: ese es el
-- vendedor legal del carro usado y sale en el contrato.

ALTER TABLE "public"."vehicle_vendors" ADD COLUMN IF NOT EXISTS "company_id" uuid;--> statement-breakpoint
ALTER TABLE "public"."vehicle_vendors" ALTER COLUMN "dpi" DROP NOT NULL;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."vehicle_vendors" ADD CONSTRAINT "vehicle_vendors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."vehicle_vendors" ADD CONSTRAINT "vehicle_vendors_agencia_requiere_company_y_email" CHECK ("vendor_type" <> 'agencia' OR ("company_id" IS NOT NULL AND "email" IS NOT NULL));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "vehicle_vendors_company_id_idx" ON "public"."vehicle_vendors" USING btree ("company_id");--> statement-breakpoint

-- Tabla aparte para no sumar columnas a `opportunities`. El UNIQUE garantiza
-- que una oportunidad tenga un solo vendedor de agencia.
CREATE TABLE IF NOT EXISTS "public"."opportunity_agency_sellers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"seller_id" uuid NOT NULL,
	"assigned_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_agency_sellers_opportunity_id_unique" UNIQUE("opportunity_id")
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."opportunity_agency_sellers" ADD CONSTRAINT "opportunity_agency_sellers_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."opportunity_agency_sellers" ADD CONSTRAINT "opportunity_agency_sellers_seller_id_vehicle_vendors_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."vehicle_vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."opportunity_agency_sellers" ADD CONSTRAINT "opportunity_agency_sellers_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "opportunity_agency_sellers_seller_id_idx" ON "public"."opportunity_agency_sellers" USING btree ("seller_id");--> statement-breakpoint

-- NULL = gerente de esa agencia (ve todo). RESTRICT y no SET NULL: borrar al
-- vendedor no puede convertir a su usuario en gerente.
ALTER TABLE "public"."partner_members" ADD COLUMN IF NOT EXISTS "seller_id" uuid;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "public"."partner_members" ADD CONSTRAINT "partner_members_seller_id_vehicle_vendors_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."vehicle_vendors"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "partner_members_seller_id_idx" ON "public"."partner_members" USING btree ("seller_id");
