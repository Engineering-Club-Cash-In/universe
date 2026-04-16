ALTER TABLE "presentations" ADD COLUMN "start_month" integer;
--> statement-breakpoint
ALTER TABLE "presentations" ADD COLUMN "start_year" integer;
--> statement-breakpoint
ALTER TABLE "presentations" ADD COLUMN "end_month" integer;
--> statement-breakpoint
ALTER TABLE "presentations" ADD COLUMN "end_year" integer;
--> statement-breakpoint
UPDATE "presentations"
SET
	"start_month" = "month",
	"start_year" = "year",
	"end_month" = "month",
	"end_year" = "year";
--> statement-breakpoint
ALTER TABLE "presentations" ALTER COLUMN "start_month" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "presentations" ALTER COLUMN "start_year" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "presentations" ALTER COLUMN "end_month" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "presentations" ALTER COLUMN "end_year" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_start_month_range_check" CHECK ("start_month" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_end_month_range_check" CHECK ("end_month" BETWEEN 1 AND 12);
--> statement-breakpoint
ALTER TABLE "presentations" ADD CONSTRAINT "presentations_range_order_check" CHECK ("start_year" < "end_year" OR ("start_year" = "end_year" AND "start_month" <= "end_month"));
--> statement-breakpoint
ALTER TABLE "presentations" DROP COLUMN "month";
--> statement-breakpoint
ALTER TABLE "presentations" DROP COLUMN "year";
