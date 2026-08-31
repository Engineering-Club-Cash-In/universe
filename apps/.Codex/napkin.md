# Napkin Runbook

## Curation Rules

- Re-prioritize on every read.
- Keep recurring, high-value notes only.
- Max 10 items per category.
- Each item includes date + "Do instead".

## Execution & Validation (Highest Priority)

## Shell & Command Reliability

## Domain Behavior Guardrails

1. **[2026-08-31] Cobros identifica asesor cartera por `user.email` contra `email_cash_in`.**
   Do instead: use `getPoolPorAsesor()` and normalized `email_cash_in`; do not use legacy `/advisor` email.
2. **[2026-08-31] `getAllCredits` devuelve bucket motor por SIFCO; POST bulk exige `estado`.**
   Do instead: para lectura de bucket sin estado, dividir SIFCOs en lotes GET de máximo 50 y desactivar caché si decide acceso.
1. **[2026-08-26] Págalo reminder test mode targets `TEST_PHONES[0]`.**
   Do instead: keep `TEST_MESSAGE=true` for manual reminder runs; verify phone position 0 before sending.

## User Directives

1. **[2026-08-26] Default communication uses Caveman full mode.**
   Do instead: write terse, actionable Spanish unless user disables it.
