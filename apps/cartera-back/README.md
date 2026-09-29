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
