ALTER TABLE "public"."vehicle_vendors" ADD COLUMN IF NOT EXISTS "gender" text;--> statement-breakpoint
ALTER TABLE "public"."vehicle_vendors" ALTER COLUMN "phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "public"."companies" ADD COLUMN IF NOT EXISTS "razon_social" text;
