CREATE TABLE "seguimientos_programados" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"agente_id" text NOT NULL,
	"metodo_contacto" "metodo_contacto" NOT NULL,
	"intervalo_dias" integer NOT NULL,
	"ocurrencias_maximas" integer,
	"ocurrencias_realizadas" integer DEFAULT 0 NOT NULL,
	"fecha_inicio" timestamp NOT NULL,
	"fecha_fin" timestamp,
	"preset_original" text,
	"activo" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intervalo_dias_positive" CHECK ("seguimientos_programados"."intervalo_dias" > 0)
);
--> statement-breakpoint
ALTER TABLE "seguimientos_programados" ADD CONSTRAINT "seguimientos_programados_caso_cobro_id_casos_cobros_id_fk" FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seguimientos_programados" ADD CONSTRAINT "seguimientos_programados_agente_id_user_id_fk" FOREIGN KEY ("agente_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
