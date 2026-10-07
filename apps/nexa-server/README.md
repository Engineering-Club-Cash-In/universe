# Nexa production lifecycle

`integration` does not start financial workers. `qa_real_payments` retains the existing DEV/QA-only target guard. `production` starts statement enrichment, application, review and reconciliation workers, with real Cartera and required mTLS.

Before changing a production deployment from the DEV pilot to the production ledger, configure:

- `NEXA_DEPLOYMENT_MODE=production`
- `CARTERA_TARGET_ENV=production`
- `CARTERA_API_BASE_URL`: production Cartera HTTPS URL
- `CARTERA_PRODUCTION_ALLOWED_ORIGINS`: comma-separated exact HTTPS origins, including that URL's origin
- `NEXA_CARTERA_EVENTS_SECRET`: at least 32 bytes, distinct from `CARTERA_INTERNAL_API_SECRET` and `NEXA_ADMIN_API_KEY`, and identical to Cartera's value; startup fails without it, because otherwise credit cancellations from Cartera are answered with 503 and the token users stay active
- Existing matching HMAC secrets and explicitly authorized credit bindings at the destination

Do not copy DEV environment variables into PROD. Publishing this code does not change the current pilot destination or activate Cartera's receiver/fiscal flags.

## Alertas por correo de revisión manual

Cada pasada del "Manual review scanner" (cada 5 minutos) junta los pagos en `MANUAL_REVIEW` (y los `billing_reconciliation_required`) que todavía no se avisaron y manda UN correo con el resumen: crédito, monto, referencia, transactionId, motivo, hora de Guatemala y el token enmascarado (solo los últimos 4 dígitos). Cada caso se avisa una sola vez (`nexa_payment_transactions.alerta_correo_enviada_at`); si el envío falla, no se marca, queda un log y se reintenta en la siguiente pasada. La migración 0006 da por avisados los casos que ya existían al desplegar: el primer correo trae solo los nuevos. Se manda por la API de Resend; en el modo `integration` no corre.

- `NEXA_ALERTAS_CORREOS`: destinatarios separados por comas. Valor de producción: `jalvarado@clubcashin.com,l.ralda@clubcashin.com,daniel.r@clubcashin.com`
- `RESEND_API_KEY`: la misma llave de Resend que usa cartera-back
- `EMAIL_DOMAIN`: dominio verificado en Resend para el remitente `no-reply@` (el mismo que cartera-back, por ejemplo `servicioscashin.com`)

Si falta cualquiera de las tres, el scanner sigue como antes (solo logs) y al arrancar deja un único log `manual_review_email_disabled` con las que faltan.

## Fiscal response and recovery

Cartera persists application and `billing_pending` before returning the existing `APPLIED` / `billingStatus: PENDING` response. Its runtime continues the fiscal batch asynchronously, using the existing durable `billing_running` CAS fence and invoice handler. Nexa can approve the transfer without waiting for Cofidi/SAT and continues billing retries without reapplying money.

In the single-process Cartera deployment, retries while the local fiscal task is alive return PENDING. The in-memory registry is only a liveness hint, not a queue or persistence substitute: nonce/payload checks and the database fence still apply. After a crash (or a request reaching a different process), an orphan `billing_running` fails closed for reconciliation; it is never automatically invoiced again. This release does not introduce multi-replica fiscal ownership or a new queue service.

Definitive fiscal rejections stay `billing_failed`: subsequent calls return 503 without another fiscal request. Nexa exhausts its existing bounded retry budget and raises `billing_reconciliation_required`; operations must reconcile the rejection before explicitly re-enabling fiscal processing.

Success is persisted as `billed`. Ambiguous provider/persistence results retain `billing_unknown`/the running fence and require reconciliation. There is no automatic restart of an uncertain fiscal operation. Pending work that had not claimed the fiscal fence remains recoverable by Nexa's existing retries.
