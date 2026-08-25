# Catálogo ejecutable generado

> No editar manualmente. Fuente: `src/cartera-catalog.ts`.

Schema version: **1**

## Campos comunes

| Campo | Contrato |
|---|---|
| `environment` | enum: local, development, staging, production |
| `operation_id` | uuid |
| `request_id` | uuid |
| `run_id` | uuid |
| `schema_version` | integer 1..1 |
| `service` | string max=64 pattern=^[0-9A-Za-z._-]+$ |
| `timestamp` | timestamp |

## Campos de payload

| Campo | Contrato |
|---|---|
| `advisor_assignment_source` | enum: provided, derived, unassigned |
| `affected_installment_count` | integer 0..1000000000 |
| `anomaly_code` | enum: duplicate_pending_installment |
| `assignment_mode` | enum: add, replace, process |
| `attempt` | integer 1..10 |
| `audit_operation` | enum: query, diagnostic |
| `auth_reason` | enum: missing, invalid, expired |
| `change_set` | enum: terms, schedule, investors, status, mixed |
| `commit_ref` | string max=40 pattern=^[0-9a-f]{7,40}$ |
| `contribution_operation` | enum: create, update |
| `credit_closed` | boolean |
| `credit_state_transition` | enum: to_active, to_agreement, to_delinquent, unchanged |
| `credit_type` | enum: new, renewal |
| `credit_updated` | boolean |
| `distribution_mode` | enum: standard, frozen_split, proportional_fallback, clamped |
| `due_date_operation` | enum: batch_update, repair_missing_february, change_start_date, list_change_history, single_update, json_bulk_update |
| `duration_ms` | integer 0..86400000 |
| `error_code` | enum: not_configured, invalid_input, timeout, connection_refused, http_4xx, http_5xx, invalid_payload, parse_failed, not_found, provider_rejected, access_denied, rate_limited, provider_unavailable, database_unavailable, conflict, integrity_violation, persistence_failed, unknown |
| `failed_count` | integer 0..1000000000 |
| `fallback_applied` | boolean |
| `http_status` | integer 100..599 |
| `installment_closed` | boolean |
| `investments_reversed` | boolean |
| `investor_count` | integer 0..1000000000 |
| `job_name` | enum: process_late_fees, upsert_advisor_effectiveness, expire_portfolio_purchases, generate_monthly_close, verify_sat_invoices, report_failed_sat_invoices, generate_daily_invoice_snapshot |
| `late_fee_operation` | enum: history, deactivate, create, update, process, condone, list, bulk_condone |
| `late_fee_recreation` | enum: not_required, completed, failed |
| `liquidation_mode` | enum: single, batch, credit |
| `lock_state` | enum: not_attempted, acquired, failed |
| `manual_action_required` | boolean |
| `method` | enum: POST |
| `migration_operation` | enum: adjust_schedule, import_payments |
| `mime_family` | enum: image, pdf, other |
| `notification_attempted` | boolean |
| `operation` | enum: certify_document, lookup_internal_document, get_document, void_document, verify_document, lookup_taxpayer, list_clients, list_client_loans, get_loan_detail, list_installments, get_surcharges, get_statement, get_loan_info, bulk_sync, put_upload, put_invoice_pdf, create_signed_url, delete_object, fetch_invoice_logo, send_failed_invoice_report, write |
| `payment_kind` | enum: normal, other_only, capital_only, agreement |
| `previous_payment_state` | enum: applied, pending, unknown |
| `processed_count` | integer 0..1000000000 |
| `provider` | enum: cofidi_sat, cofidi_nit, sifco, cloudflare_r2, remote_asset, email_provider |
| `reason_code` | enum: schema_invalid, duplicate_receipt, payment_not_found, credit_not_found, agreement_already_active, payment_already_applied, no_investors, purchase_exceeds_mirror, missing_participation_date, state_conflict, provider_rejected, local_state_inconsistent, manual_reconciliation_required, invalid_late_fee_amount, invalid_installment_count, overdue_count_mismatch, excluded_credit_state, amount_out_of_range, override_reason_missing, user_not_found, active_late_fee_not_found, concurrent_run, installments_not_found, paid_installment_conflict, item_failures, missing_payment_reference, overdue_installments_remain, capital_contribution_not_found, no_actionable_items |
| `recalculation_operation` | enum: recalculate, process_pools, delete_credits, update_investor_installments |
| `recalculation_strategy` | enum: single, bulk, from_json, migration |
| `recovery_applied` | boolean |
| `requested_state` | enum: active, inactive |
| `retryable` | boolean |
| `reversal_path` | enum: already_pending, validated_payment |
| `route_template` | enum: /upload, /newPayment |
| `rubric_count` | integer 0..1000000000 |
| `skipped_count` | integer 0..1000000000 |
| `status_code` | integer 100..599 |
| `succeeded_count` | integer 0..1000000000 |
| `version` | string max=64 pattern=^[0-9A-Za-z._-]+$ |
| `voiding_mode` | enum: single, batch, payment_reversal |

## Eventos y outcomes

### `audit.persistence`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `degraded` | `warn` | `operation`, `retryable`, `error_code` | — | — |
| `failed` | `error` | `operation`, `retryable`, `error_code` | — | — |

### `auth.jwt_validation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `rejected` | `warn` | `auth_reason` | — | — |

### `credit.capital_contribution`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `contribution_operation`, `duration_ms` | — | — |
| `failed` | `error` | `contribution_operation`, `duration_ms`, `error_code` | — | `error_code=persistence_failed` |
| `rejected` | `warn` | `contribution_operation`, `duration_ms`, `reason_code` | — | — |

### `credit.capital_payment_audit`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `audit_operation`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |
| `diagnostic_completed` | `info` | `audit_operation`, `duration_ms` | — | `audit_operation=diagnostic` |
| `failed` | `error` | `audit_operation`, `duration_ms`, `error_code` | — | — |
| `partially_completed` | `warn` | `audit_operation`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |
| `rejected` | `warn` | `audit_operation`, `duration_ms`, `reason_code` | — | — |

### `credit.creation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `created` | `info` | `credit_type`, `investor_count`, `rubric_count`, `advisor_assignment_source`, `notification_attempted`, `duration_ms` | — | — |
| `failed` | `error` | `credit_type`, `investor_count`, `rubric_count`, `advisor_assignment_source`, `notification_attempted`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `credit_type`, `investor_count`, `rubric_count`, `advisor_assignment_source`, `notification_attempted`, `duration_ms`, `reason_code` | — | — |

### `credit.due_date`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `due_date_operation`, `duration_ms` | `processed_count`, `succeeded_count`, `failed_count`, `skipped_count` | — |
| `failed` | `error` | `due_date_operation`, `duration_ms`, `error_code` | — | — |
| `partially_completed` | `warn` | `due_date_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `duration_ms`, `reason_code` | — | — |
| `partially_persisted` | `error` | `due_date_operation`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `due_date_operation`, `duration_ms`, `reason_code` | — | — |
| `skipped` | `info` | `due_date_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `duration_ms`, `reason_code` | — | — |

### `credit.late_fee`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `late_fee_operation`, `duration_ms` | `processed_count`, `succeeded_count`, `failed_count`, `skipped_count` | — |
| `degraded` | `warn` | `late_fee_operation`, `duration_ms`, `error_code` | — | — |
| `failed` | `error` | `late_fee_operation`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `late_fee_operation`, `duration_ms`, `reason_code` | — | — |
| `skipped` | `info` | `late_fee_operation`, `duration_ms`, `reason_code` | — | — |

### `credit.liquidation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |
| `failed` | `error` | `processed_count`, `succeeded_count`, `failed_count`, `duration_ms`, `error_code` | — | — |
| `partially_completed` | `warn` | `processed_count`, `succeeded_count`, `failed_count`, `duration_ms`, `reason_code` | — | — |

### `credit.schedule_recalculation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `recalculation_strategy`, `recalculation_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `manual_action_required`, `duration_ms` | — | — |
| `failed` | `error` | `recalculation_strategy`, `recalculation_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `manual_action_required`, `duration_ms`, `error_code` | — | — |
| `partially_completed` | `warn` | `recalculation_strategy`, `recalculation_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |
| `partially_persisted` | `error` | `recalculation_strategy`, `recalculation_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `manual_action_required`, `duration_ms`, `error_code` | — | `manual_action_required=true` |
| `rejected` | `warn` | `recalculation_strategy`, `recalculation_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |

### `credit.update`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `change_set`, `duration_ms` | — | — |
| `failed` | `error` | `change_set`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `change_set`, `duration_ms`, `reason_code` | — | — |

### `http.request`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `method`, `route_template`, `status_code`, `duration_ms` | — | — |
| `failed` | `error` | `method`, `route_template`, `status_code`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `method`, `route_template`, `status_code`, `duration_ms`, `reason_code` | — | — |

### `integration.request`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `provider`, `operation`, `duration_ms`, `attempt`, `retryable` | `http_status` | — |
| `failed` | `error` | `provider`, `operation`, `duration_ms`, `attempt`, `retryable`, `error_code` | `http_status` | — |

### `investor.assignment`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `assignment_mode`, `investor_count`, `duration_ms` | — | — |
| `failed` | `error` | `assignment_mode`, `investor_count`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `assignment_mode`, `investor_count`, `duration_ms`, `reason_code` | — | — |

### `investor.liquidation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `liquidation_mode`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |
| `failed` | `error` | `liquidation_mode`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms`, `error_code` | — | — |
| `partially_completed` | `warn` | `liquidation_mode`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms`, `reason_code` | — | — |
| `reversed` | `info` | `liquidation_mode`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |

### `invoice.voiding`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `voiding_mode`, `provider`, `processed_count`, `succeeded_count`, `failed_count`, `manual_action_required`, `duration_ms` | — | — |
| `failed` | `error` | `voiding_mode`, `provider`, `processed_count`, `succeeded_count`, `failed_count`, `manual_action_required`, `duration_ms`, `error_code` | — | — |
| `local_state_inconsistent` | `error` | `voiding_mode`, `provider`, `processed_count`, `succeeded_count`, `failed_count`, `manual_action_required`, `duration_ms`, `error_code` | — | `manual_action_required=true` |
| `provider_rejected` | `warn` | `voiding_mode`, `provider`, `processed_count`, `succeeded_count`, `failed_count`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |

### `job.execution`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `job_name`, `duration_ms` | `processed_count`, `succeeded_count`, `failed_count`, `skipped_count` | — |
| `failed` | `error` | `job_name`, `duration_ms`, `error_code` | `processed_count`, `succeeded_count`, `failed_count`, `skipped_count` | — |

### `payment.agreement_creation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `created` | `info` | `credit_state_transition`, `duration_ms` | — | — |
| `failed` | `error` | `credit_state_transition`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `credit_state_transition`, `duration_ms`, `reason_code` | — | — |

### `payment.agreement_status_change`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `changed` | `info` | `requested_state`, `credit_state_transition`, `late_fee_recreation`, `manual_action_required`, `duration_ms` | — | — |
| `failed` | `error` | `requested_state`, `credit_state_transition`, `late_fee_recreation`, `manual_action_required`, `duration_ms`, `error_code` | — | — |
| `partially_changed` | `warn` | `requested_state`, `credit_state_transition`, `late_fee_recreation`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |

### `payment.application`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `applied` | `info` | `payment_kind`, `installment_closed`, `credit_closed`, `manual_action_required`, `duration_ms` | — | — |
| `failed` | `error` | `payment_kind`, `installment_closed`, `credit_closed`, `manual_action_required`, `duration_ms`, `error_code` | — | — |
| `partially_applied` | `warn` | `payment_kind`, `installment_closed`, `credit_closed`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |

### `payment.integrity_anomaly`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `blocked` | `error` | `anomaly_code`, `recovery_applied` | — | — |
| `recovered` | `warn` | `anomaly_code`, `recovery_applied` | — | — |

### `payment.investor_distribution`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `blocked` | `warn` | `distribution_mode`, `fallback_applied`, `duration_ms`, `reason_code` | — | — |
| `completed` | `info` | `distribution_mode`, `fallback_applied`, `duration_ms` | — | — |
| `failed` | `error` | `distribution_mode`, `fallback_applied`, `duration_ms`, `error_code` | — | — |
| `fallback` | `warn` | `distribution_mode`, `fallback_applied`, `duration_ms`, `reason_code` | — | — |

### `payment.registration`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `payment_kind`, `duration_ms`, `lock_state` | — | — |
| `failed` | `error` | `payment_kind`, `duration_ms`, `lock_state`, `error_code` | — | — |
| `rejected` | `warn` | `payment_kind`, `duration_ms`, `lock_state`, `reason_code` | — | — |

### `payment.revalidation`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `credit_updated`, `installment_closed`, `duration_ms` | — | — |
| `failed` | `error` | `credit_updated`, `installment_closed`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `credit_updated`, `installment_closed`, `duration_ms`, `reason_code` | — | — |

### `payment.reversal`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `previous_payment_state`, `credit_updated`, `investments_reversed`, `manual_action_required`, `duration_ms` | — | — |
| `failed` | `error` | `previous_payment_state`, `credit_updated`, `investments_reversed`, `manual_action_required`, `duration_ms`, `error_code` | — | — |
| `partially_completed` | `warn` | `previous_payment_state`, `credit_updated`, `investments_reversed`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |
| `rejected` | `warn` | `previous_payment_state`, `credit_updated`, `investments_reversed`, `manual_action_required`, `duration_ms`, `reason_code` | — | — |

### `payment.reversal_to_pending`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `reversal_path`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |
| `failed` | `error` | `duration_ms`, `error_code` | — | — |
| `local_state_inconsistent` | `error` | `reversal_path`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms`, `error_code` | — | `error_code=persistence_failed` |
| `partially_completed` | `warn` | `reversal_path`, `processed_count`, `succeeded_count`, `failed_count`, `duration_ms` | — | — |
| `rejected` | `warn` | `duration_ms`, `reason_code` | — | — |

### `payment.sifco_migration`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `completed` | `info` | `migration_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `duration_ms` | — | — |
| `partially_completed` | `warn` | `migration_operation`, `processed_count`, `succeeded_count`, `failed_count`, `skipped_count`, `duration_ms`, `reason_code` | — | — |

### `payment.upload`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `failed` | `error` | `mime_family`, `duration_ms`, `error_code` | — | — |
| `rejected` | `warn` | `mime_family`, `duration_ms`, `reason_code` | — | — |
| `stored` | `info` | `mime_family`, `duration_ms` | — | — |

### `service.lifecycle`

| Outcome | Level | Required | Optional | Constants |
|---|---|---|---|---|
| `started` | `info` | `version`, `commit_ref` | — | — |
| `stopping` | `info` | `version`, `commit_ref` | — | — |

## Provider → operations

| Provider | Operations |
|---|---|
| `cloudflare_r2` | `put_upload`, `put_invoice_pdf`, `create_signed_url`, `delete_object` |
| `cofidi_nit` | `lookup_taxpayer` |
| `cofidi_sat` | `certify_document`, `lookup_internal_document`, `get_document`, `void_document`, `verify_document` |
| `email_provider` | `send_failed_invoice_report` |
| `remote_asset` | `fetch_invoice_logo` |
| `sifco` | `list_clients`, `list_client_loans`, `get_loan_detail`, `list_installments`, `get_surcharges`, `get_statement`, `get_loan_info`, `bulk_sync` |

## Invariantes de conteo

- `processed_count` = `succeeded_count` + `failed_count` + `skipped_count`.
