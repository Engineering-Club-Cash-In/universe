CREATE TABLE "vehicle_vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"dpi" text NOT NULL,
	"vendor_type" text NOT NULL,
	"company_name" text,
	"email" text,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_vendors_dpi_unique" UNIQUE("dpi")
);
--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ALTER COLUMN "vehicle_rating" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vendor_id_vehicle_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vehicle_vendors"("id") ON DELETE no action ON UPDATE no action;