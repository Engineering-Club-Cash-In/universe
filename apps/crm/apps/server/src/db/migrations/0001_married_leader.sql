CREATE TYPE "public"."user_role" AS ENUM('admin', 'sales');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'sales' NOT NULL;