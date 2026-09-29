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
