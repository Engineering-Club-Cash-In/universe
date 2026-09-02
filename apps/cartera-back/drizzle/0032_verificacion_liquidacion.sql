-- Snapshot del cuadre de cada liquidación del mes.
-- El job (verify_liquidation_balance) corre el 11, 12 y 13 a las 08:00 GT y
-- solo evalúa las liquidaciones del mes que todavía no cuadran. Una fila por
-- liquidación: el reintento actualiza la misma fila y sube `intentos`.
--
-- Ecuación verificada (montos, no créditos):
--   espejo - compras_no_absorbidas == historico + reinversion_total

CREATE TABLE IF NOT EXISTS "cartera"."verificacion_liquidacion" (
  "id"                      serial PRIMARY KEY NOT NULL,
  "liquidacion_id"          integer NOT NULL,
  "inversionista_id"        integer NOT NULL,
  "periodo"                 varchar(7) NOT NULL,
  "espejo"                  numeric(18, 8) NOT NULL,
  "historico"               numeric(18, 8) NOT NULL,
  "reinversion_total"       numeric(18, 2) NOT NULL,
  "compras_no_absorbidas"   numeric(18, 8) DEFAULT '0' NOT NULL,
  "descuadre"               numeric(18, 8) NOT NULL,
  "cuadra"                  boolean NOT NULL,
  "intentos"                integer DEFAULT 1 NOT NULL,
  "detalle"                 jsonb,
  "primera_verificacion_at" timestamp with time zone DEFAULT now() NOT NULL,
  "verificado_at"           timestamp with time zone DEFAULT now() NOT NULL,
  "notificado_at"           timestamp with time zone,
  CONSTRAINT "verificacion_liquidacion_liquidacion_id_unique" UNIQUE("liquidacion_id")
);

DO $$ BEGIN
  ALTER TABLE "cartera"."verificacion_liquidacion"
    ADD CONSTRAINT "verificacion_liquidacion_liquidacion_id_fkey"
    FOREIGN KEY ("liquidacion_id")
    REFERENCES "cartera"."liquidaciones"("liquidacion_id")
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cartera"."verificacion_liquidacion"
    ADD CONSTRAINT "verificacion_liquidacion_inversionista_id_fkey"
    FOREIGN KEY ("inversionista_id")
    REFERENCES "cartera"."inversionistas"("inversionista_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_verif_liquidacion_periodo"
  ON "cartera"."verificacion_liquidacion" ("periodo", "cuadra");

CREATE INDEX IF NOT EXISTS "idx_verif_liquidacion_inv"
  ON "cartera"."verificacion_liquidacion" ("inversionista_id");

-- Procedencia de la reinversión automática: sella la fila de compra con la
-- liquidación que la produjo. Sin esto no hay forma de distinguirla de una
-- reubicación manual (manualReassignInvestor también escribe "reinversion") ni
-- de atribuirla a una liquidación concreta cuando hay dos en días seguidos.
ALTER TABLE "cartera"."compras_credito_inversionista"
  ADD COLUMN IF NOT EXISTS "liquidacion_id" integer;

DO $$ BEGIN
  ALTER TABLE "cartera"."compras_credito_inversionista"
    ADD CONSTRAINT "compras_credito_inversionista_liquidacion_id_fkey"
    FOREIGN KEY ("liquidacion_id")
    REFERENCES "cartera"."liquidaciones"("liquidacion_id")
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_compras_credito_inv_liquidacion"
  ON "cartera"."compras_credito_inversionista" ("liquidacion_id");
