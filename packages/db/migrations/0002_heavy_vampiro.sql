CREATE TABLE "net_worth_snapshots" (
	"workspace_id" uuid NOT NULL,
	"day" date NOT NULL,
	"net_worth" numeric(38, 8) NOT NULL,
	"complete" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_snapshots_workspace_id_day_pk" PRIMARY KEY("workspace_id","day")
);
--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;