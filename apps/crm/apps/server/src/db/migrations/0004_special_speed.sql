CREATE TABLE "inspection_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"category" text NOT NULL,
	"item" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"severity" text DEFAULT 'critical' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_checklist_items" ADD CONSTRAINT "inspection_checklist_items_inspection_id_vehicle_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."vehicle_inspections"("id") ON DELETE no action ON UPDATE no action;