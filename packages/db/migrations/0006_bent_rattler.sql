CREATE TYPE "public"."debt_direction" AS ENUM('payable', 'receivable');--> statement-breakpoint
ALTER TYPE "public"."tx_type" ADD VALUE 'borrow';--> statement-breakpoint
ALTER TYPE "public"."tx_type" ADD VALUE 'lend';--> statement-breakpoint
ALTER TYPE "public"."tx_type" ADD VALUE 'repay';--> statement-breakpoint
ALTER TYPE "public"."tx_type" ADD VALUE 'collect';--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"direction" "debt_direction" NOT NULL,
	"kind" text DEFAULT 'personal' NOT NULL,
	"counterparty" text NOT NULL,
	"note" text,
	"principal" numeric(38, 8) NOT NULL,
	"due_date" date,
	"voided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "debt_id" uuid;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debts_ws_idx" ON "debts" USING btree ("workspace_id","direction");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tx_debt_idx" ON "transactions" USING btree ("debt_id");