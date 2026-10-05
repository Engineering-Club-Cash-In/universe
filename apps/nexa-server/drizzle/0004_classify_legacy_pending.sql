UPDATE "nexa_payment_transactions"
SET "processing_status" = 'MANUAL_REVIEW',
    "failure_reason" = 'legacy_pending_requires_reconciliation',
    "next_attempt_at" = NULL,
    "lease_until" = NULL,
    "updated_at" = NOW()
WHERE "processing_status" = 'PENDING';
