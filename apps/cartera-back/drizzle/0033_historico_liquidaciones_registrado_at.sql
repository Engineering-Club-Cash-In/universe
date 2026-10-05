-- Instante real en que se insertó cada foto del histórico de liquidación.
--
-- `fecha` guarda el período DECLARADO y puede venir retroactivo: la liquidación
-- acepta una fecha_liquidacion explícita, y una liquidación revertida y rehecha
-- conserva la original mientras su foto se reescribe con los saldos del momento
-- real. Eso obligaba a inferir el instante buscando en la bitácora del espejo un
-- movimiento cuyo saldo coincidiera con el que la foto guardó, y esa búsqueda
-- puede acertarle a una transacción anterior que dejó los mismos montos.
--
-- Lo pone el default de la base, no la aplicación, así que no se puede pasar
-- retroactivo ni reescribir desde el código.
--
-- Se agrega SIN default primero para que las filas existentes queden en NULL en
-- vez de recibir todas la hora de la migración: para esas se sigue infiriendo.
ALTER TABLE "cartera"."historico_liquidaciones_espejo"
  ADD COLUMN IF NOT EXISTS "registrado_at" timestamp with time zone;

ALTER TABLE "cartera"."historico_liquidaciones_espejo"
  ALTER COLUMN "registrado_at" SET DEFAULT now();

CREATE INDEX IF NOT EXISTS "idx_historico_liq_registrado_at"
  ON "cartera"."historico_liquidaciones_espejo" ("registrado_at");
