# Págalo: mora sola — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir grupos Págalo con solo `MORA_INTERES`, sin link ni evidencia CAPITAL ficticia, preservando importaciones de dos links.

**Architecture:** Nuevas migraciones correctivas, porque `0039` y `0008` ya corrieron. CRM deriva links requeridos desde `capital_total`; Cartera permite evidencia CAPITAL nula únicamente si ese total es cero. Drizzle replica constraints.

**Tech Stack:** PostgreSQL, Drizzle ORM, TypeScript, Bun.

---

## Límites

- Incluye migraciones y schemas Drizzle para uno/dos links.
- No ejecuta SQL contra base compartida.
- No incluye UI, Págalo HTTP, worker ni pagos reales.
- No commit/push por instrucción vigente.

### Task 1: Baseline de tipos

**Files:** Ninguno.

- [x] Ejecutar antes de editar:

```bash
cd crm/apps/server && bun run check-types
cd ../../../cartera-back && bunx tsc --noEmit
```

CRM pasó. Cartera conserva cuatro errores preexistentes en
`reinvestmentReport.ts` y `reinvestmentReport.test.ts`; no se corrigen en esta
entrega.

### Task 2: Compatibilidad CRM

**Files:**

- Create: `crm/apps/server/src/db/migrations/0045_cb028_pagalo_optional_capital.sql`
- Modify: `crm/apps/server/src/db/schema/pagalo-payments.ts:212-220`

- [x] Crear migración expand-only:

```sql
-- 0045 · CB-028 — CAPITAL opcional para links de solo mora
-- 0039 ya fue aplicada. No reescribe historial ni crea links Q0.
ALTER TABLE public.pagalo_payment_groups
  DROP CONSTRAINT IF EXISTS pagalo_payment_groups_amounts_chk;

ALTER TABLE public.pagalo_payment_groups
  ADD CONSTRAINT pagalo_payment_groups_amounts_chk CHECK (
    capital_total >= 0
    AND facturable_total > 0
    AND total_amount > 0
  );

COMMENT ON COLUMN public.pagalo_payment_groups.capital_total IS
  'Suma no facturable CAPITAL. Cero solo representa mora sola; no autoriza link CAPITAL de Q0.';
```

- [x] Reemplazar check Drizzle por:

```ts
check(
  "pagalo_payment_groups_amounts_chk",
  sql`${t.capitalTotal} >= 0 AND ${t.facturableTotal} > 0 AND ${t.totalAmount} > 0`,
),
```

`capitalTotal` sigue `.notNull()`: cero es valor explícito.

- [x] Verificar:

```bash
cd crm/apps/server && bun run check-types
git diff --check -- crm/apps/server/src/db/migrations/0045_cb028_pagalo_optional_capital.sql crm/apps/server/src/db/schema/pagalo-payments.ts
```

### Task 3: Compatibilidad Cartera

**Files:**

- Create: `cartera-back/drizzle/cobros-02/0009_pagalo_optional_capital.sql`
- Modify: `cartera-back/src/database/db/schema.ts:762-873`

- [x] Crear migración:

```sql
-- 0009 · CB-028 — CAPITAL opcional para importación de mora sola
-- Requiere el ledger creado por 0008; no reescribe esa migración.
ALTER TABLE cartera.pagalo_payment_imports
  ALTER COLUMN capital_transaction_uuid DROP NOT NULL,
  ALTER COLUMN capital_external_identifier DROP NOT NULL,
  ALTER COLUMN capital_paid_at DROP NOT NULL;

ALTER TABLE cartera.pagalo_payment_imports
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_amounts_chk,
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_transactions_different_chk,
  DROP CONSTRAINT IF EXISTS pagalo_payment_imports_external_ids_different_chk;

ALTER TABLE cartera.pagalo_payment_imports
  ADD CONSTRAINT pagalo_payment_imports_amounts_chk CHECK (
    capital_total >= 0 AND facturable_total > 0 AND total_amount > 0
  ),
  ADD CONSTRAINT pagalo_payment_imports_capital_evidence_chk CHECK (
    (capital_total = 0 AND capital_transaction_uuid IS NULL
      AND capital_external_identifier IS NULL AND capital_request_id IS NULL
      AND capital_request_auth IS NULL AND capital_paid_at IS NULL)
    OR
    (capital_total > 0 AND capital_transaction_uuid IS NOT NULL
      AND capital_external_identifier IS NOT NULL AND capital_paid_at IS NOT NULL)
  ),
  ADD CONSTRAINT pagalo_payment_imports_transactions_different_chk CHECK (
    capital_transaction_uuid IS NULL
    OR capital_transaction_uuid <> facturable_transaction_uuid
  ),
  ADD CONSTRAINT pagalo_payment_imports_external_ids_different_chk CHECK (
    capital_external_identifier IS NULL
    OR capital_external_identifier <> facturable_external_identifier
  );
```

Implementación endurecida: el archivo real envuelve DDL en `BEGIN`/`COMMIT` y
usa un bloque `DO` con catálogo para ejecutar cada `DROP NOT NULL` solamente si
la columna sigue marcada `NOT NULL`. Así una ejecución manual repetida no falla
ni deja cambios parciales.

- [x] En Drizzle, quitar `.notNull()` de `capital_transaction_uuid`,
  `capital_external_identifier` y `capital_paid_at`; agregar exactamente los
  cuatro checks anteriores. Mantener UNIQUE de CAPITAL: PostgreSQL acepta varios
  `NULL` y protege valores reales.

- [x] Cambiar comentarios de “dos ACCEPT” a “uno o dos ACCEPT requeridos”.

- [x] Verificar:

```bash
cd cartera-back && bunx tsc --noEmit
git diff --check -- cartera-back/drizzle/cobros-02/0009_pagalo_optional_capital.sql cartera-back/src/database/db/schema.ts
```

### Task 4: Cierre de entrega

**Files:**

- Modify: `docs/features/pagalo/02-generacion-links-ficha-360.md:143-166`

- [x] Cambiar sección DB a “migraciones creadas, pendientes de ejecutar
  manualmente en DEV”. No correr `db:migrate`, `drizzle-kit push` ni SQL remoto.

- [x] Buscar reglas antiguas y revisar árbol:

```bash
rg -n "capital_total > 0 AND facturable_total > 0|Evidencia mínima de los dos ACCEPT|dos ACCEPT Págalo" \
  crm/apps/server/src/db/schema/pagalo-payments.ts \
  crm/apps/server/src/db/migrations/0045_cb028_pagalo_optional_capital.sql \
  cartera-back/src/database/db/schema.ts \
  cartera-back/drizzle/cobros-02/0009_pagalo_optional_capital.sql
git diff --check
git status --short
```

Expected: cero reglas antiguas en archivos modificados; no commit/push.

## Cobertura

- Mora sola sin CAPITAL ficticio: Tasks 2 y 3.
- Uno/dos links derivados de `capital_total`: Tasks 2 y 3.
- Evidencia CAPITAL ausente solo si monto CAPITAL es cero: Task 3.
- Migraciones nuevas, sin reescribir aplicadas: Tasks 2 y 3.

UI, generación Págalo, polling, cancelación, endpoint idempotente, transacción
de `registerPayment`, vouchers y pagos reales quedan para planes posteriores.
