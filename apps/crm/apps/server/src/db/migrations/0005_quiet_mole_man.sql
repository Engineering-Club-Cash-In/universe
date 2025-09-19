CREATE TYPE "public"."estado_contacto" AS ENUM('contactado', 'no_contesta', 'numero_equivocado', 'promesa_pago', 'acuerdo_parcial', 'rechaza_pagar');--> statement-breakpoint
CREATE TYPE "public"."estado_contrato" AS ENUM('activo', 'completado', 'incobrable', 'recuperado');--> statement-breakpoint
CREATE TYPE "public"."estado_mora" AS ENUM('al_dia', 'mora_30', 'mora_60', 'mora_90', 'mora_120', 'mora_120_plus', 'pagado', 'incobrable');--> statement-breakpoint
CREATE TYPE "public"."metodo_contacto" AS ENUM('llamada', 'whatsapp', 'email', 'visita_domicilio', 'carta_notarial');--> statement-breakpoint
CREATE TYPE "public"."tipo_recuperacion" AS ENUM('entrega_voluntaria', 'tomado', 'orden_secuestro');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'cobros';--> statement-breakpoint
CREATE TABLE "casos_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"estado_mora" "estado_mora" NOT NULL,
	"monto_en_mora" numeric(12, 2) NOT NULL,
	"dias_mora_maximo" integer NOT NULL,
	"cuotas_vencidas" integer NOT NULL,
	"responsable_cobros" text NOT NULL,
	"telefono_principal" text NOT NULL,
	"telefono_alternativo" text,
	"email_contacto" text NOT NULL,
	"direccion_contacto" text NOT NULL,
	"proximo_contacto" timestamp,
	"metodo_contacto_proximo" "metodo_contacto",
	"activo" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contactos_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"fecha_contacto" timestamp DEFAULT now() NOT NULL,
	"metodo_contacto" "metodo_contacto" NOT NULL,
	"estado_contacto" "estado_contacto" NOT NULL,
	"duracion_llamada" integer,
	"comentarios" text NOT NULL,
	"acuerdos_alcanzados" text,
	"compromisos_pago" text,
	"requiere_seguimiento" boolean DEFAULT false,
	"fecha_proximo_contacto" timestamp,
	"realizado_por" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contratos_financiamiento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"monto_financiado" numeric(12, 2) NOT NULL,
	"cuota_mensual" numeric(12, 2) NOT NULL,
	"numero_cuotas" integer NOT NULL,
	"tasa_interes" numeric(5, 2) NOT NULL,
	"fecha_inicio" timestamp NOT NULL,
	"fecha_vencimiento" timestamp NOT NULL,
	"dia_pago_mensual" integer DEFAULT 15 NOT NULL,
	"estado" "estado_contrato" DEFAULT 'activo' NOT NULL,
	"responsable_cobros" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convenios_pago" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"monto_acordado" numeric(12, 2) NOT NULL,
	"numero_cuotas_convenio" integer NOT NULL,
	"monto_cuota_convenio" numeric(12, 2) NOT NULL,
	"fecha_inicio_convenio" timestamp NOT NULL,
	"activo" boolean DEFAULT true,
	"cumplido" boolean DEFAULT false,
	"cuotas_cumplidas" integer DEFAULT 0,
	"condiciones_especiales" text,
	"aprobado_por" text NOT NULL,
	"fecha_aprobacion" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cuotas_pago" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contrato_id" uuid NOT NULL,
	"numero_cuota" integer NOT NULL,
	"fecha_vencimiento" timestamp NOT NULL,
	"monto_cuota" numeric(12, 2) NOT NULL,
	"fecha_pago" timestamp,
	"monto_pagado" numeric(12, 2),
	"monto_mora" numeric(12, 2) DEFAULT '0.00',
	"estado_mora" "estado_mora" DEFAULT 'al_dia' NOT NULL,
	"dias_mora" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificaciones_cobros" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"tipo_notificacion" text NOT NULL,
	"canal" "metodo_contacto" NOT NULL,
	"asunto" text NOT NULL,
	"mensaje" text NOT NULL,
	"enviada" boolean DEFAULT false,
	"fecha_envio" timestamp,
	"respuesta" text,
	"fecha_programada" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recuperaciones_vehiculo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_cobro_id" uuid NOT NULL,
	"tipo_recuperacion" "tipo_recuperacion" NOT NULL,
	"fecha_recuperacion" timestamp,
	"orden_secuestro" boolean DEFAULT false,
	"numero_expediente" text,
	"juzgado_competente" text,
	"completada" boolean DEFAULT false,
	"observaciones" text,
	"responsable_recuperacion" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"electricity_bill" text,
	"bank_statements" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_urls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "renapinfo" (
	"dpi" varchar(20) PRIMARY KEY NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"second_name" varchar(100),
	"third_name" varchar(100),
	"first_last_name" varchar(100) NOT NULL,
	"second_last_name" varchar(100),
	"married_last_name" varchar(100),
	"picture" varchar(255),
	"birth_date" date,
	"gender" varchar(1),
	"civil_status" varchar(1),
	"nationality" varchar(100),
	"borned_in" varchar(100),
	"department_borned_in" varchar(100),
	"municipality_borned_in" varchar(100),
	"death_date" date,
	"ocupation" varchar(100),
	"cedula_order" varchar(50),
	"cedula_register" varchar(50),
	"dpi_expiracy_date" date
);
--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ALTER COLUMN "vehicle_rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "liveness_validated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD COLUMN "valuator_comment" text;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD COLUMN "no_comments_checked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "gps_activo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "dispositivo_gps" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "imei_gps" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "ubicacion_actual_gps" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "ultima_señal_gps" timestamp;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "seguro_vigente" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "numero_poliza" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "compania_seguro" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "fecha_inicio_seguro" timestamp;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "fecha_vencimiento_seguro" timestamp;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "monto_asegurado" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "deducible" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "tipo_cobertura" text;--> statement-breakpoint
ALTER TABLE "casos_cobros" ADD CONSTRAINT "casos_cobros_contrato_id_contratos_financiamiento_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos_financiamiento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casos_cobros" ADD CONSTRAINT "casos_cobros_responsable_cobros_user_id_fk" FOREIGN KEY ("responsable_cobros") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contactos_cobros" ADD CONSTRAINT "contactos_cobros_caso_cobro_id_casos_cobros_id_fk" FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contactos_cobros" ADD CONSTRAINT "contactos_cobros_realizado_por_user_id_fk" FOREIGN KEY ("realizado_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_financiamiento" ADD CONSTRAINT "contratos_financiamiento_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_financiamiento" ADD CONSTRAINT "contratos_financiamiento_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_financiamiento" ADD CONSTRAINT "contratos_financiamiento_responsable_cobros_user_id_fk" FOREIGN KEY ("responsable_cobros") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos_financiamiento" ADD CONSTRAINT "contratos_financiamiento_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convenios_pago" ADD CONSTRAINT "convenios_pago_caso_cobro_id_casos_cobros_id_fk" FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convenios_pago" ADD CONSTRAINT "convenios_pago_aprobado_por_user_id_fk" FOREIGN KEY ("aprobado_por") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuotas_pago" ADD CONSTRAINT "cuotas_pago_contrato_id_contratos_financiamiento_id_fk" FOREIGN KEY ("contrato_id") REFERENCES "public"."contratos_financiamiento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificaciones_cobros" ADD CONSTRAINT "notificaciones_cobros_caso_cobro_id_casos_cobros_id_fk" FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recuperaciones_vehiculo" ADD CONSTRAINT "recuperaciones_vehiculo_caso_cobro_id_casos_cobros_id_fk" FOREIGN KEY ("caso_cobro_id") REFERENCES "public"."casos_cobros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recuperaciones_vehiculo" ADD CONSTRAINT "recuperaciones_vehiculo_responsable_recuperacion_user_id_fk" FOREIGN KEY ("responsable_recuperacion") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_urls" ADD CONSTRAINT "magic_urls_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;