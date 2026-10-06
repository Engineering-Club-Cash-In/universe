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

## Fiscal response and recovery

Cartera persists application and `billing_pending` before returning the existing `APPLIED` / `billingStatus: PENDING` response. Its runtime continues the fiscal batch asynchronously, using the existing durable `billing_running` CAS fence and invoice handler. Nexa can approve the transfer without waiting for Cofidi/SAT and continues billing retries without reapplying money.

In the single-process Cartera deployment, retries while the local fiscal task is alive return PENDING. The in-memory registry is only a liveness hint, not a queue or persistence substitute: nonce/payload checks and the database fence still apply. After a crash (or a request reaching a different process), an orphan `billing_running` fails closed for reconciliation; it is never automatically invoiced again. This release does not introduce multi-replica fiscal ownership or a new queue service.

Definitive fiscal rejections stay `billing_failed`: subsequent calls return 503 without another fiscal request. Nexa exhausts its existing bounded retry budget and raises `billing_reconciliation_required`; operations must reconcile the rejection before explicitly re-enabling fiscal processing.

Success is persisted as `billed`. Ambiguous provider/persistence results retain `billing_unknown`/the running fence and require reconciliation. There is no automatic restart of an uncertain fiscal operation. Pending work that had not claimed the fiscal fence remains recoverable by Nexa's existing retries.
