-- 0039 · CB-028 — Págalo en CRM (modelo MVP de 3 tablas)
-- ============================================================================
--
-- MODELO
-- ------
-- pagalo_payment_groups  : intención, snapshot de cuotas/montos y despacho.
-- pagalo_payment_links   : dos links, generaciones, transacción y voucher.
-- pagalo_payment_events  : auditoría append-only.
--
-- Negocio genera dos links por grupo: CAPITAL no facturable y MORA_INTERES
-- facturable. Un solo ACCEPT deja PARTIALLY_PAID. Solo dos ACCEPT elegidos como
-- application_source, con voucher disponible y montos correctos, permiten
-- READY_TO_APPLY. COMPLETED ocurre después de respuesta APPLIED de cartera.
--
-- IDEMPOTENCIA
-- ------------
-- external_identifier, request_uuid y transaction_uuid son únicos. Solo una
-- generación activa y una application_source por (grupo,tipo). Grupo funciona
-- como outbox durable hacia cartera usando lease/retry; cartera vuelve a
-- deduplicar con crm_group_id y UUIDs de transacción.
--
-- AUDITORÍA
-- ---------
-- Grupo guarda creador y selección congelada. Link guarda parámetros, URL,
-- respuesta, transacción y voucher. Events guarda quién/cuándo/cambio/error.
-- Regenerar crea fila generation+1; nunca sobrescribe link anterior.
--
-- SEGURIDAD
-- ---------
-- JSONs son sanitizados. Nunca guardar authorization, Bearer token, PAN completo,
-- CVV ni fecha de expiración. request_auth es código de transacción, no secreto.
--
-- OPERACIÓN
-- ---------
-- Expand-only; objetos todavía no existen ni fueron aplicados. NO ejecutar
-- automáticamente. Revisar y correr manualmente en ambiente controlado.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pagalo_payment_groups (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  caso_cobro_id            uuid REFERENCES public.casos_cobros(id) ON DELETE SET NULL,
  -- Gestión concreta para mostrar generación/envío en Historial.
  contacto_cobro_id        uuid REFERENCES public.contactos_cobros(id) ON DELETE SET NULL,
  numero_credito_sifco     varchar(40) NOT NULL,
  -- ID opaco de cartera-back; bases separadas, sin FK local.
  cartera_credito_id       integer NOT NULL,
  pagalo_environment       text NOT NULL,
  currency                 varchar(3) NOT NULL DEFAULT 'GTQ',

  capital_total            numeric(18,2) NOT NULL,
  facturable_total         numeric(18,2) NOT NULL,
  total_amount             numeric(18,2) NOT NULL,

  -- Array inmutable de cuotas/rubros. Cada item contiene link_type,
  -- cartera_cuota_id, numero_cuota, rubro, amount, facturable y snapshot fuente.
  allocations_snapshot     jsonb NOT NULL,

  -- DRAFT / LINKS_PENDING / PENDING_PAYMENT / PARTIALLY_PAID /
  -- READY_TO_APPLY / APPLYING / COMPLETED / APPLICATION_FAILED /
  -- REVIEW_REQUIRED / CANCELLED.
  status                   text NOT NULL DEFAULT 'DRAFT',

  -- MVP false/NULL. Snapshot permite habilitar expiración global después.
  expiration_enabled       boolean NOT NULL DEFAULT false,
  expiration_hours         integer,

  created_by               text NOT NULL REFERENCES public."user"(id),
  ready_to_apply_at        timestamp with time zone,
  sent_to_cartera_at       timestamp with time zone,
  application_started_at   timestamp with time zone,
  completed_at             timestamp with time zone,
  cancelled_at             timestamp with time zone,

  -- Outbox integrado: worker reclama fila con FOR UPDATE SKIP LOCKED.
  application_payload_hash varchar(64),
  cartera_import_id        integer,
  dispatch_attempt_count   integer NOT NULL DEFAULT 0,
  next_dispatch_at         timestamp with time zone,
  dispatch_claimed_at      timestamp with time zone,
  dispatch_claim_token     uuid,
  last_dispatch_error      text,

  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT pagalo_payment_groups_status_chk CHECK (
    status IN (
      'DRAFT', 'LINKS_PENDING', 'PENDING_PAYMENT', 'PARTIALLY_PAID',
      'READY_TO_APPLY', 'APPLYING', 'COMPLETED', 'APPLICATION_FAILED',
      'REVIEW_REQUIRED', 'CANCELLED'
    )
  ),
  CONSTRAINT pagalo_payment_groups_environment_chk CHECK (
    pagalo_environment IN ('STAGING', 'PRODUCTION')
  ),
  CONSTRAINT pagalo_payment_groups_amounts_chk CHECK (
    capital_total > 0 AND facturable_total > 0 AND total_amount > 0
  ),
  CONSTRAINT pagalo_payment_groups_total_matches_chk CHECK (
    total_amount = capital_total + facturable_total
  ),
  CONSTRAINT pagalo_payment_groups_allocations_array_chk CHECK (
    jsonb_typeof(allocations_snapshot) = 'array'
    AND jsonb_array_length(allocations_snapshot) > 0
  ),
  CONSTRAINT pagalo_payment_groups_expiration_chk CHECK (
    (expiration_enabled = false AND expiration_hours IS NULL)
    OR (
      expiration_enabled = true
      AND expiration_hours IS NOT NULL
      AND expiration_hours > 0
    )
  ),
  CONSTRAINT pagalo_payment_groups_dispatch_attempts_chk CHECK (
    dispatch_attempt_count >= 0
  ),
  CONSTRAINT pagalo_payment_groups_payload_hash_chk CHECK (
    application_payload_hash IS NULL
    OR application_payload_hash ~ '^[0-9a-f]{64}$'
  )
);

COMMENT ON TABLE public.pagalo_payment_groups IS
  'Intención CB-028: agrupa links CAPITAL y MORA_INTERES, snapshot de cuotas y despacho idempotente hacia cartera.';
COMMENT ON COLUMN public.pagalo_payment_groups.allocations_snapshot IS
  'Snapshot inmutable de cuotas/rubros usado para calcular links; debe estar sanitizado.';
COMMENT ON COLUMN public.pagalo_payment_groups.application_payload_hash IS
  'SHA-256 del payload normalizado enviado a cartera; mismo grupo no puede cambiar contenido al reintentar.';
COMMENT ON COLUMN public.pagalo_payment_groups.cartera_import_id IS
  'ID opaco de cartera.pagalo_payment_imports; sin FK porque bases están separadas.';

CREATE UNIQUE INDEX IF NOT EXISTS pagalo_payment_groups_contact_uq
  ON public.pagalo_payment_groups(contacto_cobro_id);
CREATE INDEX IF NOT EXISTS pagalo_payment_groups_status_idx
  ON public.pagalo_payment_groups(status);
CREATE INDEX IF NOT EXISTS pagalo_payment_groups_credit_idx
  ON public.pagalo_payment_groups(numero_credito_sifco, created_at);
CREATE INDEX IF NOT EXISTS pagalo_payment_groups_case_idx
  ON public.pagalo_payment_groups(caso_cobro_id);
CREATE INDEX IF NOT EXISTS pagalo_payment_groups_dispatch_idx
  ON public.pagalo_payment_groups(next_dispatch_at)
  WHERE status IN ('READY_TO_APPLY', 'APPLICATION_FAILED');
CREATE INDEX IF NOT EXISTS pagalo_payment_groups_dispatch_claim_idx
  ON public.pagalo_payment_groups(dispatch_claimed_at)
  WHERE status = 'APPLYING';


-- LINKS, GENERACIONES, TRANSACCIÓN Y VOUCHER
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pagalo_payment_links (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  group_id                 uuid NOT NULL REFERENCES public.pagalo_payment_groups(id),
  link_type                text NOT NULL,
  generation               integer NOT NULL DEFAULT 1,

  external_identifier      varchar(150) NOT NULL,
  pagalo_request_uuid      varchar(64),
  pagalo_short_uuid        varchar(64),
  payment_url              text,
  api_base_url             text NOT NULL,
  status                   text NOT NULL DEFAULT 'CREATING',

  -- Sanitizados: nunca headers/tokens/tarjeta.
  request_payload          jsonb NOT NULL,
  response_payload         jsonb,
  http_status              integer,
  error_code               text,
  error_message            text,

  -- Se llenan cuando callback/job observa transacción.
  pagalo_transaction_uuid  varchar(64),
  transaction_status       text,
  transaction_amount       numeric(18,2),
  transaction_currency     varchar(3),
  request_id               varchar(100),
  -- Código comercial de autorización; NO credencial del header.
  request_auth             varchar(100),
  is_application_source    boolean NOT NULL DEFAULT false,

  voucher_source           text NOT NULL DEFAULT 'NONE',
  voucher_url              text,
  voucher_storage_key      text,
  voucher_sha256           varchar(64),
  voucher_generated_at     timestamp with time zone,

  expires_at               timestamp with time zone,
  supersedes_link_id       uuid REFERENCES public.pagalo_payment_links(id) ON DELETE SET NULL,

  -- Lease/backoff del job. Callback actualiza misma fila por transaction_uuid.
  next_poll_at             timestamp with time zone,
  poll_claimed_at          timestamp with time zone,
  poll_attempts            integer NOT NULL DEFAULT 0,
  last_polled_at           timestamp with time zone,
  last_poll_error          text,

  requested_by             text NOT NULL REFERENCES public."user"(id),
  requested_at             timestamp with time zone NOT NULL DEFAULT now(),
  activated_at             timestamp with time zone,
  paid_at                  timestamp with time zone,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT pagalo_payment_links_external_id_uq UNIQUE (external_identifier),
  CONSTRAINT pagalo_payment_links_request_uuid_uq UNIQUE (pagalo_request_uuid),
  CONSTRAINT pagalo_payment_links_transaction_uuid_uq UNIQUE (pagalo_transaction_uuid),
  CONSTRAINT pagalo_payment_links_generation_uq UNIQUE (group_id, link_type, generation),
  CONSTRAINT pagalo_payment_links_type_chk CHECK (
    link_type IN ('CAPITAL', 'MORA_INTERES')
  ),
  CONSTRAINT pagalo_payment_links_status_chk CHECK (
    status IN (
      'CREATING', 'ACTIVE', 'PAID', 'REJECTED', 'CANCELLED',
      'EXPIRED', 'REPLACED', 'ERROR'
    )
  ),
  CONSTRAINT pagalo_payment_links_generation_chk CHECK (generation > 0),
  CONSTRAINT pagalo_payment_links_poll_attempts_chk CHECK (poll_attempts >= 0),
  CONSTRAINT pagalo_payment_links_transaction_amount_chk CHECK (
    transaction_amount IS NULL OR transaction_amount > 0
  ),
  CONSTRAINT pagalo_payment_links_application_source_chk CHECK (
    is_application_source = false OR (
      transaction_status IS NOT NULL
      AND transaction_status = 'ACCEPT'
      AND pagalo_transaction_uuid IS NOT NULL
      AND transaction_amount IS NOT NULL
      AND paid_at IS NOT NULL
      AND voucher_source <> 'NONE'
    )
  ),
  CONSTRAINT pagalo_payment_links_voucher_source_chk CHECK (
    voucher_source IN ('NONE', 'PAGALO', 'GENERATED')
  ),
  CONSTRAINT pagalo_payment_links_voucher_shape_chk CHECK (
    (
      voucher_source = 'NONE'
      AND voucher_url IS NULL
      AND voucher_storage_key IS NULL
      AND voucher_sha256 IS NULL
      AND voucher_generated_at IS NULL
    )
    OR (voucher_source = 'PAGALO' AND voucher_url IS NOT NULL)
    OR (
      voucher_source = 'GENERATED'
      AND voucher_url IS NOT NULL
      AND voucher_storage_key IS NOT NULL
      AND voucher_sha256 IS NOT NULL
      AND voucher_generated_at IS NOT NULL
    )
  )
);

COMMENT ON TABLE public.pagalo_payment_links IS
  'Generaciones de links Págalo. Incluye transacción final y voucher; regenerar crea fila nueva.';
COMMENT ON COLUMN public.pagalo_payment_links.external_identifier IS
  'Identificador único interno enviado a Págalo; también permite consulta por id_external.';
COMMENT ON COLUMN public.pagalo_payment_links.request_payload IS
  'Parámetros exactos enviados a Págalo, sanitizados y sin authorization.';
COMMENT ON COLUMN public.pagalo_payment_links.request_auth IS
  'Código de autorización de transacción devuelto por Págalo, no credencial.';

CREATE UNIQUE INDEX IF NOT EXISTS pagalo_payment_links_active_type_uq
  ON public.pagalo_payment_links(group_id, link_type)
  WHERE status IN ('CREATING', 'ACTIVE');
CREATE UNIQUE INDEX IF NOT EXISTS pagalo_payment_links_application_source_uq
  ON public.pagalo_payment_links(group_id, link_type)
  WHERE is_application_source = true;
CREATE INDEX IF NOT EXISTS pagalo_payment_links_group_idx
  ON public.pagalo_payment_links(group_id);
CREATE INDEX IF NOT EXISTS pagalo_payment_links_poll_idx
  ON public.pagalo_payment_links(next_poll_at)
  WHERE status IN ('CREATING', 'ACTIVE');


-- AUDITORÍA APPEND-ONLY
-- ============================================================================
-- Eventos esperados: GROUP_CREATED, LINK_CREATED, LINK_SENT,
-- TRANSACTION_ACCEPTED, GROUP_READY, SENT_TO_CARTERA, CARTERA_APPLIED, ERROR.
CREATE TABLE IF NOT EXISTS public.pagalo_payment_events (
  id                       serial PRIMARY KEY,
  group_id                 uuid NOT NULL REFERENCES public.pagalo_payment_groups(id),
  link_id                  uuid REFERENCES public.pagalo_payment_links(id),
  event_type               text NOT NULL,
  source                   text NOT NULL,
  actor_user_id            text REFERENCES public."user"(id),
  from_status              text,
  to_status                text,
  payload                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at              timestamp with time zone NOT NULL DEFAULT now(),
  created_at               timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pagalo_payment_events IS
  'Bitácora append-only del ciclo Págalo: quién, cuándo, cambio de estado, envío, aplicación y errores.';
COMMENT ON COLUMN public.pagalo_payment_events.payload IS
  'Contexto pequeño sanitizado; nunca credenciales ni datos sensibles de tarjeta.';

CREATE INDEX IF NOT EXISTS pagalo_payment_events_group_time_idx
  ON public.pagalo_payment_events(group_id, occurred_at);
CREATE INDEX IF NOT EXISTS pagalo_payment_events_type_idx
  ON public.pagalo_payment_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS pagalo_payment_events_link_idx
  ON public.pagalo_payment_events(link_id);

-- INVARIANTES DEL SERVICIO (EN UNA TRANSACCIÓN)
-- ============================================================================
-- 1. Snapshot incluye CAPITAL y MORA_INTERES y sumas coinciden con cabecera.
-- 2. CAPITAL facturable=false; INTERES/MORA/IVA facturable=true.
-- 3. Antes de READY_TO_APPLY existen exactamente dos application_source ACCEPT,
--    uno por tipo, con montos/moneda correctos y voucher disponible.
-- 4. READY_TO_APPLY y evento GROUP_READY se escriben juntos.
-- 5. Worker reclama grupo con lease; retries conservan payload/hash.
-- 6. COMPLETED solo después de respuesta APPLIED de cartera.
-- 7. Regeneración crea nueva fila y marca anterior REPLACED; nunca UPDATE de
--    external_identifier, URL, payload o transacción histórica.
