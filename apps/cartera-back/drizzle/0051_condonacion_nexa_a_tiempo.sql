-- Condonación automática de la mora de un pago Nexa (ACH) que llegó a tiempo.
--
-- ── ORDEN DE DESPLIEGUE ─────────────────────────────────────────────────────
-- Va a producción ANTES que el código que la usa. Es aditiva: columnas nuevas
-- que admiten NULL, un valor nuevo de enum y un usuario de sistema; el código
-- anterior no las conoce y sigue funcionando igual.
--
-- ⚠️ `ALTER TYPE … ADD VALUE` NO puede usarse dentro de la MISMA transacción
-- que lo crea. Aplicar este archivo tal cual (cada sentencia autocommitea con
-- `psql -f`), NO envuelto en BEGIN/COMMIT junto con código que inserte el valor.
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- Una transferencia ACH vía Nexa llega 1–3 días hábiles después de que el
-- cliente la envía, y Nexa no informa la fecha de envío. Mientras tanto el cron
-- de mora (que NO cambia) le genera mora a la cuota. Cuando el pago llega
-- dentro de 3 días hábiles del vencimiento y deja el crédito al día, cartera
-- condona la mora de esa(s) cuota(s) antes de registrar el pago.
--
-- ── DECISIONES ──────────────────────────────────────────────────────────────
-- • moras_condonaciones.nexa_payment_event_id: la condonación queda ligada al
--   evento Nexa que la originó. Índice único parcial (solo las vivas): el
--   reintento del mismo evento no puede condonar dos veces, pero si un rechazo
--   definitivo la anuló, un reintento posterior puede volver a decidir.
-- • moras_condonaciones.anulada_at: la condonación se ANULA (no se borra)
--   cuando el pago es rechazado de forma definitiva. Queda el rastro de los
--   dos hechos; el reporte de condonaciones excluye las anuladas.
-- • mora_pagada_cuota.condonacion_id: cada fila CONDONACION del ledger apunta
--   a su condonación, para poder compensarla (ANULACION) sin buscar por texto.
--   Sin FK a propósito, igual que pago_id (ver 0043): el ledger es un registro
--   que sobrevive a lo que lo originó.
-- • Origen nuevo de moras_historial: CONDONACION_NEXA_A_TIEMPO. Ningún
--   reporte filtra por origen, así que es aditivo.
-- • Usuario de sistema: moras_condonaciones.usuario_id es NOT NULL y el
--   reporte hace INNER JOIN con platform_users. Se crea uno idempotente,
--   INACTIVO y con un password_hash que no es un hash bcrypt válido, así que
--   con ESA contraseña no entra nadie. ⚠️ Eso NO lo protege del todo: hoy
--   `/auth` no está protegido (cualquiera puede cambiarle la contraseña a un
--   usuario CONTA y el login no revisa is_active) — ver hallazgo de seguridad
--   aparte.
-- • Tablas con pocas filas por crédito: los índices se crean sin CONCURRENTLY.

ALTER TABLE cartera.moras_condonaciones
  ADD COLUMN IF NOT EXISTS nexa_payment_event_id integer,
  ADD COLUMN IF NOT EXISTS anulada_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_moras_condonaciones_nexa_evento_viva
  ON cartera.moras_condonaciones (nexa_payment_event_id)
  WHERE nexa_payment_event_id IS NOT NULL AND anulada_at IS NULL;

ALTER TABLE cartera.mora_pagada_cuota
  ADD COLUMN IF NOT EXISTS condonacion_id integer;

CREATE INDEX IF NOT EXISTS mora_pagada_cuota_idx_condonacion
  ON cartera.mora_pagada_cuota (condonacion_id)
  WHERE condonacion_id IS NOT NULL;

ALTER TYPE cartera.mora_evento_origen ADD VALUE IF NOT EXISTS 'CONDONACION_NEXA_A_TIEMPO';

INSERT INTO cartera.platform_users (email, password_hash, role, is_active)
VALUES ('sistema-nexa@clubcashin.local', '!sin-login-usuario-de-sistema', 'CONTA', false)
ON CONFLICT (email) DO NOTHING;
