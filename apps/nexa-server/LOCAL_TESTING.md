# Nexa UAT Local Testing

This flow tests the integration locally without exposing a real webhook URL.

## 1. Start cartera-back

From `apps/cartera-back`:

```bash
INTERNAL_API_KEY=dev-secret bun run devStart
```

## 2. Configure nexa-server

From `apps/nexa-server`, make sure `.env` has:

```env
DATABASE_URL=postgres://...
PORT=7010
CARTERA_API_BASE_URL=http://localhost:7000
INTERNAL_API_KEY=dev-secret
NEXA_WEBHOOK_FLOW_ID=local-flow
NEXA_WEBHOOK_BEARER_TOKEN=local-webhook-token
```

## 3. Start nexa-server

```bash
bun run db:migrate
bun run dev
```

Health check:

```bash
curl http://localhost:7010/health
```

## 4. Bootstrap the Nexa payment token

```bash
curl -X POST http://localhost:7010/admin/tokens/bootstrap \
  -H "Authorization: Bearer dev-secret"
```

## 5. Create one token user for a credit

Replace `123` and the DPI with valid local data:

```bash
curl -X POST http://localhost:7010/admin/token-users \
  -H "Authorization: Bearer dev-secret" \
  -H "Content-Type: application/json" \
  -d '{
    "creditoId": 123,
    "description": "Credito 123",
    "nationalId": "1234567890101"
  }'
```

Save the returned 16-digit `token`.

## 6. Simulate ACH Worker payment

In `ACH Worker Tester.postman_collection.json`, use the returned token as `account.accountNumber`.

Example:

```json
{
  "account": {
    "accountNumber": 1234567310005010,
    "accountType": "Current",
    "bank": "NSOAGTGT"
  },
  "accountTo": {
    "accountNumber": 19451958,
    "accountType": "Savings",
    "bank": "INDLGTGC",
    "destinationRouting": "162900420"
  },
  "currency": "GTQ",
  "amount": 50,
  "description": "Test transaction",
  "fileType": "TIF"
}
```

## 7. Simulate the local webhook notification

This calls `POST /webhook/v1/payment-token` locally and then applies the payment in cartera.

```bash
bun run webhook:simulate 1234567310005010 4617307 50
```

Arguments:

- `1234567310005010`: token returned by `/admin/token-users`
- `4617307`: reference to use for idempotency
- `50`: amount in GTQ

Expected response:

```json
{"reference":"4617307","status":"OK"}
```

## 8. Validate

Check:

- `nexa_payment_transactions.processing_status = APPLIED`
- The payment exists in cartera.
- `nexa-server` logs show review `APPROVED` sent to Nexa UAT.

Use a new reference for each re-test unless you intentionally want to validate duplicate/idempotent behavior.
