# Elysia with Bun runtime

## Getting Started
To get started with this template, simply paste this command into your terminal:
```bash
bun create elysia ./elysia-example
```

## Development
To start the development server run:
```bash
bun run dev
```

Open http://localhost:3000/ with your browser to see the result.

## Nexa internal payment receiver

`POST /internal/nexa/payments/apply` is disabled by default. In production it is
registered only when `LOG_ENVIRONMENT=production` and
`NEXA_INTERNAL_PAYMENTS_ENABLED=true` are set exactly. Operators must also
configure `NEXA_INTERNAL_API_SECRET` for HMAC authentication and explicitly add
an active credit entry to `cartera.nexa_credit_bindings`; credits without an
allowed binding remain rejected.

Automatic FEL billing is a separate production-only opt-in:
`NEXA_AUTOMATIC_INVOICING_ENABLED=true`. It stays disabled outside
`LOG_ENVIRONMENT=production` and whenever `SIMULAR_FACTURAS=true`. A payment is
persisted as `billing_pending` before invoicing and becomes `billed` only after
all linked payment rows complete the existing Cofidi flow. When billing is
intentionally disabled, the API acknowledges the applied payment with additive
`billingStatus: "PENDING"`; it does not claim fiscal completion. Once a provider call
starts, crashes, partial results, ambiguous responses, or local persistence
failures leave `billing_running`/`billing_unknown` for manual reconciliation;
they are never retried as fiscal mutations automatically.

Each applied Nexa payment row gets a generated PNG "boleta" (transfer number,
amount, date, credit, client) uploaded to `R2_BUCKET` under a random key
(`boletas-nexa/<uuid>.png`, never the pago_id: the bucket is public) and
registered in `cartera.boletas` with the `URL_PUBLIC_R2` prefix, like the
boletas uploaded from the front. An uploaded image that does not end up
registered is deleted from the bucket (best-effort, logged on failure). It is
best-effort: generated after the payment is applied, never awaited, and a
failure only logs `nexa.boleta_imagen.error`. The `generate_nexa_receipt_images`
job (every 15 minutes) retries missing ones and backfills older payments.
Enabled by default; `NEXA_BOLETA_IMAGEN_ENABLED=false` turns off both the
trigger and the job.

When a Nexa payment row is deleted (`marcarCreditoComoCaido`, the plazo reduction in
`syncScheduleOnTermsChange`, `ajustarCuotasConSIFCO`), its PNG is also deleted from
R2, only after the transaction commits, without awaiting, and only when
`LOG_ENVIRONMENT=production` (baked into the image by the prod deploy). DEV and
local share the bucket and may hold PROD URLs, so there it only logs. Only keys
matching `boletas-nexa/<uuid>.png` are deleted; failures log
`nexa.boleta_imagen.error` with `paso: "borrar_r2_tras_borrar_pago"` and the key.
Left out on purpose: `reversePayment` (it only voids rows of `failed` events, which
never get an image, and zero placeholders) and the admin tools `recalculateFromJson`,
`processFromExcelFull` and `migration.ts`, which delete the `boletas` row but leave
the PNG (delete it by hand). A URL already handed out works until the deletion, plus
whatever the CDN cache keeps.
