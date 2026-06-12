CREATE TABLE IF NOT EXISTS "metas_mensuales" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" varchar(50) NOT NULL,
	"anio" integer NOT NULL,
	"mes" integer NOT NULL,
	"monto" numeric(18, 2) NOT NULL,
	"descripcion" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "metas_mensuales_tipo_anio_mes_unique" UNIQUE("tipo","anio","mes")
);
