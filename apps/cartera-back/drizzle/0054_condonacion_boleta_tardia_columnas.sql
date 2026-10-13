-- Boleta pagada a tiempo y registrada tarde: ligar cada condonación con las filas de su pago.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Manual en PROD, ANTES del código, después de 0053. Es aditiva: dos columnas
-- NULL sin default (solo catálogo, no reescribe tablas) y un índice único
-- parcial sobre moras_condonaciones (tabla chica). El código anterior no las
-- conoce y sigue funcionando igual.
--
-- ⚠️ SIN ESTA MIGRACIÓN EL CÓDIGO NUEVO ROMPE TODO PAGO: Drizzle lista TODAS las
-- columnas en cada insert(pagos_credito), update().returning() y findFirst.
-- Con el código nuevo sobre una base sin 0054 fallan los ~17 sitios que insertan
-- en pagos_credito (registerPayment = cualquier pago, createCredit, paymentAgreement,
-- credits, payments, importación Excel, migration), payments.ts:521/1302/1881,
-- investor.ts:1729 y las condonaciones individual y masiva (latefee.ts:2546, 3590):
-- NO se puede registrar ningún pago ni crear créditos.
--
-- Prerrequisito: 0051 aplicada (usa anulada_at). Aplicar también en DEV (Neon
-- green-tree) y en las bases locales usadas ANTES de mergear el stack a develop.
-- ALTER TABLE pagos_credito toma ACCESS EXCLUSIVE: correr fuera de la ventana del
-- cron de mora (00:05–00:20 GT). Es idempotente si hay que reintentar.
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- El cliente pagó con boleta a tiempo pero el asesor la registró tarde; cartera
-- condona la mora generada por el retraso del registro, antes de registrar el pago.
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
-- • intento_id (UUID de la apertura del modal) liga la condonación con las filas
--   de pagos_credito.boleta_tardia_intento_id. SIN FK a propósito, igual que
--   pago_id en 0043 y pagos_pendientes_ids en 0052: el pago puede borrarse y el
--   registro de la condonación debe sobrevivir.
-- • Índice único parcial (solo las vivas): red de la base contra condonar dos
--   veces el mismo intento; un intento anulado puede volver a condonar.
SET lock_timeout = '5s';

ALTER TABLE cartera.moras_condonaciones
  ADD COLUMN IF NOT EXISTS intento_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_moras_condonaciones_intento_viva
  ON cartera.moras_condonaciones (intento_id)
  WHERE intento_id IS NOT NULL AND anulada_at IS NULL;

ALTER TABLE cartera.pagos_credito
  ADD COLUMN IF NOT EXISTS boleta_tardia_intento_id uuid;
