ALTER TYPE "public"."account_kind" ADD VALUE 'wallet' BEFORE 'brokerage';--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "unit_divisor" numeric(38, 18) DEFAULT '1' NOT NULL;