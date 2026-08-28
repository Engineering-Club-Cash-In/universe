-- Etiqueta cada DTE con el RUBRO del pago que cubre, para poder re-facturar solo
-- lo que faltó cuando una corrida de /facturar-pago-completo sale a medias.
--
-- Problema que resuelve:
--   /facturar-pago-completo emite hasta 5 DTEs por pago (MORA, OTROS_SERVICIOS,
--   OTROS, INTERESES por inversionista, INTERESES_CUBE) y cada bloque tiene su
--   propio try/catch: si uno falla, los demás siguen. Hasta ahora el concepto solo
--   vivía en memoria (`facturasGeneradas.tipo`) y no se guardaba, así que una
--   corrida parcial dejaba el pago trabado: el guard era todo-o-nada ("¿hay alguna
--   factura ACTIVA? → 400") y la única salida era anular todo a mano.
--
--   Con el concepto persistido, el endpoint puede diffear ESPERADO vs LOGRADO y
--   emitir únicamente los rubros faltantes (src/cofidi/facturasFaltantes.ts).
--
-- Decisiones:
--   • varchar(30) y NO enum de pg: agregar un valor nuevo no obliga a migrar un
--     tipo (ALTER TYPE ... ADD VALUE no corre dentro de transacción y ha dado
--     guerra en este repo). Los valores válidos los impone el código.
--   • NULLABLE: las facturas viejas y las genéricas (/facturar-generico, que no
--     conoce el rubro) quedan sin etiqueta. El diff trata "concepto NULL" como
--     BLOQUEADO → se mantiene el 400 conservador de hoy para esos pagos.
--     El backfill (src/scripts/backfill-concepto-facturas.ts) etiqueta a
--     posteriori solo los matches inequívocos por monto.
--   • inversionista_id solo se llena con concepto='INTERESES' (el DTE de la parte
--     de un inversionista). INTERESES_CUBE es el residuo de CUBE y va en NULL.
--     La FK solo valida que el inversionista exista; no hay ON DELETE.

ALTER TABLE "cartera"."facturas_electronicas"
  ADD COLUMN IF NOT EXISTS "concepto" varchar(30);

ALTER TABLE "cartera"."facturas_electronicas"
  ADD COLUMN IF NOT EXISTS "inversionista_id" integer;

DO $$
BEGIN
  -- conrelid calificado: sin él, un constraint homónimo en CUALQUIER otra tabla
  -- del cluster haría que este FK nunca se cree, en silencio.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_facturas_electronicas_inversionista'
      AND conrelid = '"cartera"."facturas_electronicas"'::regclass
  ) THEN
    ALTER TABLE "cartera"."facturas_electronicas"
      ADD CONSTRAINT "fk_facturas_electronicas_inversionista"
      FOREIGN KEY ("inversionista_id")
      REFERENCES "cartera"."inversionistas"("inversionista_id");
  END IF;
END $$;

-- CHECK en vez de enum: valida los 5 valores conocidos al ESCRIBIR (un typo en un
-- repair manual revienta aquí con error claro, no días después como un 400
-- "concepto desconocido" en el endpoint) y agregar un valor nuevo es un simple
-- DROP+ADD del constraint, sin ALTER TYPE.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_facturas_electronicas_concepto'
      AND conrelid = '"cartera"."facturas_electronicas"'::regclass
  ) THEN
    ALTER TABLE "cartera"."facturas_electronicas"
      ADD CONSTRAINT "chk_facturas_electronicas_concepto"
      CHECK (
        concepto IS NULL
        OR concepto IN ('MORA', 'OTROS_SERVICIOS', 'OTROS', 'INTERESES', 'INTERESES_CUBE')
      );
  END IF;
END $$;

-- El diff de re-facturación filtra por (pago_id, status='ACTIVA') y lee concepto.
CREATE INDEX IF NOT EXISTS "idx_facturas_pago_concepto"
  ON "cartera"."facturas_electronicas" ("pago_id", "concepto");
