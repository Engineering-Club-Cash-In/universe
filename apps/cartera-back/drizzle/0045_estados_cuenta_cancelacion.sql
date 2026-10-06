-- 🔴 ORDEN DE DESPLIEGUE — 0045 va a producción ANTES que el código.
-- El código de este cambio inserta en `estados_cuenta_cancelacion` cada vez que
-- el operador pulsa «Cancelar Crédito» (vista previa del estado de cuenta). Si el
-- código sale primero, la vista previa falla con "relation ... does not exist"
-- (el operador conserva «Continuar sin documento», pero pierde el PDF).
--
-- NOTA: aplicar a mano en dev y prod (Cartera aplica el SQL a mano, no drizzle-kit).
--
-- ── CONTEXTO ────────────────────────────────────────────────────────────────
-- Antes de pasar un crédito a PENDIENTE_CANCELACION se genera un PDF con el
-- historial de pagos y el total para cancelar. Después de confirmar, el asesor
-- puede enviarle al cliente por WhatsApp un ENLACE a ese mismo archivo. Estas
-- tres tablas son nuevas y propias del feature: no se altera ninguna columna de
-- pagos ni de `credit_cancelations`.
--
-- `estados_cuenta_cancelacion`: una fila por PDF emitido (uno por clic). Guarda
-- la clave privada del archivo en R2 y su SHA-256 para poder recuperar el MISMO
-- archivo aunque el saldo cambie después, y detectar si se corrompió.
--
-- `monto_cancelacion` SIN CHECK >= 0, a propósito: el modal permite extras
-- negativos (descuentos) y hoy `credit_cancelations` acepta lo que salga. Este
-- documento no agrega reglas de negocio nuevas.
--
-- `estados_cuenta_cancelacion_enlaces`: un enlace público por envío
-- (`/ec/<código>`). Se guarda la HUELLA SHA-256 del código, nunca el código: con
-- acceso a la base no se puede reconstruir un enlace. Vence (`vence_at`), se
-- puede anular (`revocado_at`) y cuenta las aperturas.
--
-- `estados_cuenta_cancelacion_envios`: una fila por intento real de WhatsApp. Su
-- `id` es el `intentoId` que manda el front (uno por clic): repetir el mismo ID
-- devuelve el resultado existente en vez de mandar un segundo mensaje.
--
-- ON DELETE RESTRICT en las FKs: son registros financieros/auditoría y deben
-- sobrevivir; borrar un crédito con documentos emitidos tiene que fallar.

CREATE TABLE IF NOT EXISTS cartera.estados_cuenta_cancelacion (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credito_id            integer NOT NULL REFERENCES cartera.creditos(credito_id) ON DELETE RESTRICT,
  numero_credito_sifco  varchar(40) NOT NULL,
  cliente_nombre        varchar(200) NOT NULL,
  fecha_corte_gt        date NOT NULL,
  generado_at           timestamptz NOT NULL DEFAULT now(),
  generado_por_id       integer NOT NULL REFERENCES cartera.platform_users(id),
  monto_cancelacion     numeric(18,2) NOT NULL,
  entrada_json          jsonb NOT NULL,
  desglose_json         jsonb NOT NULL,
  pdf_key               text NOT NULL,
  pdf_sha256            char(64) NOT NULL,

  CONSTRAINT estados_cuenta_cancelacion_pdf_key_unique UNIQUE (pdf_key)
);

CREATE INDEX IF NOT EXISTS estados_cuenta_cancelacion_idx_credito_generado
  ON cartera.estados_cuenta_cancelacion (credito_id, generado_at DESC);

CREATE TABLE IF NOT EXISTS cartera.estados_cuenta_cancelacion_enlaces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id          uuid NOT NULL REFERENCES cartera.estados_cuenta_cancelacion(id) ON DELETE RESTRICT,
  codigo_sha256         char(64) NOT NULL,
  creado_por_id         integer NOT NULL REFERENCES cartera.platform_users(id),
  creado_at             timestamptz NOT NULL DEFAULT now(),
  vence_at              timestamptz NOT NULL,
  revocado_at           timestamptz,
  aperturas             integer NOT NULL DEFAULT 0,
  primera_apertura_at   timestamptz,
  ultima_apertura_at    timestamptz,

  CONSTRAINT estados_cuenta_cancelacion_enlaces_codigo_unique UNIQUE (codigo_sha256),
  CONSTRAINT estados_cuenta_cancelacion_enlaces_vence_despues
    CHECK (vence_at > creado_at)
);

CREATE INDEX IF NOT EXISTS estados_cuenta_cancelacion_enlaces_idx_documento
  ON cartera.estados_cuenta_cancelacion_enlaces (documento_id);

CREATE TABLE IF NOT EXISTS cartera.estados_cuenta_cancelacion_envios (
  id                     uuid PRIMARY KEY,  -- = intentoId (idempotencia)
  documento_id           uuid NOT NULL REFERENCES cartera.estados_cuenta_cancelacion(id) ON DELETE RESTRICT,
  enlace_id              uuid REFERENCES cartera.estados_cuenta_cancelacion_enlaces(id) ON DELETE RESTRICT,
  canal                  varchar(20) NOT NULL DEFAULT 'WHATSAPP',
  destinatario_telefono  varchar(20) NOT NULL,
  destinatario_fuente    varchar(30) NOT NULL,
  solicitado_por_id      integer NOT NULL REFERENCES cartera.platform_users(id),
  estado                 text NOT NULL,
  proveedor              varchar(40),
  proveedor_mensaje_id   text,
  error_resumen          text,
  solicitado_at          timestamptz NOT NULL DEFAULT now(),
  finalizado_at          timestamptz,

  CONSTRAINT estados_cuenta_cancelacion_envios_estado_valido
    CHECK (estado IN ('EN_PROCESO','ENVIADO','ERROR')),
  CONSTRAINT estados_cuenta_cancelacion_envios_canal_valido
    CHECK (canal IN ('WHATSAPP')),
  CONSTRAINT estados_cuenta_cancelacion_envios_fuente_valida
    CHECK (destinatario_fuente IN ('CASO_COBROS','LEAD','SOLICITUD'))
);

CREATE INDEX IF NOT EXISTS estados_cuenta_cancelacion_envios_idx_documento
  ON cartera.estados_cuenta_cancelacion_envios (documento_id, solicitado_at DESC);

CREATE INDEX IF NOT EXISTS estados_cuenta_cancelacion_envios_idx_estado
  ON cartera.estados_cuenta_cancelacion_envios (estado);
