import type { EventCatalogDefinition } from './catalog-types';

const MAX_DURATION_MS = 86_400_000;
const MAX_COUNT = 1_000_000_000;

export const carteraCatalog = {
  schemaVersion: 1,
  commonFields: {
    timestamp: { type: 'timestamp' },
    schema_version: { type: 'integer', min: 1, max: 1 },
    service: { type: 'string', maxLength: 64, pattern: '^[0-9A-Za-z._-]+$' },
    environment: { type: 'enum', values: ['local', 'development', 'staging', 'production'] },
    request_id: { type: 'uuid' },
    operation_id: { type: 'uuid' },
    run_id: { type: 'uuid' },
  },
  fields: {
    version: { type: 'string', maxLength: 64, pattern: '^[0-9A-Za-z._-]+$' },
    commit_ref: { type: 'string', maxLength: 40, pattern: '^[0-9a-f]{7,40}$' },
    method: { type: 'enum', values: ['POST'] },
    route_template: { type: 'enum', values: ['/upload', '/newPayment'] },
    status_code: { type: 'integer', min: 100, max: 599 },
    http_status: { type: 'integer', min: 100, max: 599 },
    duration_ms: { type: 'integer', min: 0, max: MAX_DURATION_MS },
    attempt: { type: 'integer', min: 1, max: 10 },
    processed_count: { type: 'integer', min: 0, max: MAX_COUNT },
    succeeded_count: { type: 'integer', min: 0, max: MAX_COUNT },
    failed_count: { type: 'integer', min: 0, max: MAX_COUNT },
    skipped_count: { type: 'integer', min: 0, max: MAX_COUNT },
    affected_installment_count: { type: 'integer', min: 0, max: MAX_COUNT },
    investor_count: { type: 'integer', min: 0, max: MAX_COUNT },
    rubric_count: { type: 'integer', min: 0, max: MAX_COUNT },
    retryable: { type: 'boolean' },
    recovery_applied: { type: 'boolean' },
    installment_closed: { type: 'boolean' },
    credit_closed: { type: 'boolean' },
    manual_action_required: { type: 'boolean' },
    fallback_applied: { type: 'boolean' },
    credit_updated: { type: 'boolean' },
    investments_reversed: { type: 'boolean' },
    notification_attempted: { type: 'boolean' },
    audit_operation: { type: 'enum', values: ['query', 'diagnostic'] },
    contribution_operation: { type: 'enum', values: ['create', 'update'] },
    error_code: {
      type: 'enum',
      values: [
        'not_configured', 'invalid_input', 'timeout', 'connection_refused',
        'http_4xx', 'http_5xx', 'invalid_payload', 'parse_failed', 'not_found',
        'provider_rejected', 'access_denied', 'rate_limited', 'provider_unavailable',
        'database_unavailable', 'conflict', 'integrity_violation', 'persistence_failed',
        'unknown',
      ],
    },
    reason_code: {
      type: 'enum',
      values: [
        'schema_invalid', 'duplicate_receipt', 'payment_not_found', 'credit_not_found',
        'agreement_already_active', 'payment_already_applied', 'no_investors',
        'purchase_exceeds_mirror', 'missing_participation_date', 'state_conflict',
        'provider_rejected', 'local_state_inconsistent', 'manual_reconciliation_required',
      ],
    },
    auth_reason: { type: 'enum', values: ['missing', 'invalid', 'expired'] },
    job_name: {
      type: 'enum',
      values: [
        'process_late_fees', 'upsert_advisor_effectiveness', 'expire_portfolio_purchases',
        'generate_monthly_close', 'verify_sat_invoices', 'report_failed_sat_invoices',
        'generate_daily_invoice_snapshot',
      ],
    },
    provider: {
      type: 'enum',
      values: ['cofidi_sat', 'cofidi_nit', 'sifco', 'cloudflare_r2', 'remote_asset', 'email_provider'],
    },
    operation: {
      type: 'enum',
      values: [
        'certify_document', 'lookup_internal_document', 'get_document', 'void_document',
        'verify_document', 'lookup_taxpayer', 'list_clients', 'list_client_loans',
        'get_loan_detail', 'list_installments', 'get_surcharges', 'get_statement',
        'get_loan_info', 'bulk_sync', 'put_upload', 'put_invoice_pdf',
        'create_signed_url', 'delete_object', 'fetch_invoice_logo',
        'send_failed_invoice_report', 'write',
      ],
    },
    mime_family: { type: 'enum', values: ['image', 'pdf', 'other'] },
    payment_kind: { type: 'enum', values: ['normal', 'other_only', 'capital_only', 'agreement'] },
    lock_state: { type: 'enum', values: ['not_attempted', 'acquired', 'failed'] },
    anomaly_code: { type: 'enum', values: ['duplicate_pending_installment'] },
    distribution_mode: { type: 'enum', values: ['standard', 'frozen_split', 'proportional_fallback', 'clamped'] },
    credit_state_transition: { type: 'enum', values: ['to_active', 'to_agreement', 'to_delinquent', 'unchanged'] },
    requested_state: { type: 'enum', values: ['active', 'inactive'] },
    late_fee_recreation: { type: 'enum', values: ['not_required', 'completed', 'failed'] },
    previous_payment_state: { type: 'enum', values: ['applied', 'pending'] },
    voiding_mode: { type: 'enum', values: ['single', 'batch', 'payment_reversal'] },
    credit_type: { type: 'enum', values: ['new', 'renewal'] },
    advisor_assignment_source: { type: 'enum', values: ['provided', 'derived', 'unassigned'] },
    change_set: { type: 'enum', values: ['terms', 'schedule', 'investors', 'status', 'mixed'] },
    recalculation_strategy: { type: 'enum', values: ['single', 'bulk', 'from_json', 'migration'] },
    assignment_mode: { type: 'enum', values: ['add', 'replace', 'process'] },
    liquidation_mode: { type: 'enum', values: ['single', 'batch', 'credit'] },
  },
  events: {
    'service.lifecycle': { outcomes: {
      started: { level: 'info', required: ['version', 'commit_ref'], optional: [] },
      stopping: { level: 'info', required: ['version', 'commit_ref'], optional: [] },
    } },
    'http.request': { outcomes: {
      completed: { level: 'info', required: ['method', 'route_template', 'status_code', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['method', 'route_template', 'status_code', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['method', 'route_template', 'status_code', 'duration_ms', 'error_code'], optional: [] },
    } },
    'auth.jwt_validation': { outcomes: {
      rejected: { level: 'warn', required: ['auth_reason'], optional: [] },
    } },
    'job.execution': { outcomes: {
      completed: { level: 'info', required: ['job_name', 'duration_ms'], optional: ['processed_count', 'succeeded_count', 'failed_count', 'skipped_count'] },
      failed: { level: 'error', required: ['job_name', 'duration_ms', 'error_code'], optional: ['processed_count', 'succeeded_count', 'failed_count', 'skipped_count'] },
    } },
    'integration.request': { outcomes: {
      completed: { level: 'info', required: ['provider', 'operation', 'duration_ms', 'attempt', 'retryable'], optional: ['http_status'] },
      failed: { level: 'error', required: ['provider', 'operation', 'duration_ms', 'attempt', 'retryable', 'error_code'], optional: ['http_status'] },
    } },
    'audit.persistence': { outcomes: {
      degraded: { level: 'warn', required: ['operation', 'retryable', 'error_code'], optional: [] },
      failed: { level: 'error', required: ['operation', 'retryable', 'error_code'], optional: [] },
    } },
    'payment.upload': { outcomes: {
      stored: { level: 'info', required: ['mime_family', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['mime_family', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['mime_family', 'duration_ms', 'error_code'], optional: [] },
    } },
    'payment.registration': { outcomes: {
      completed: { level: 'info', required: ['payment_kind', 'duration_ms', 'lock_state'], optional: [] },
      rejected: { level: 'warn', required: ['payment_kind', 'duration_ms', 'lock_state', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['payment_kind', 'duration_ms', 'lock_state', 'error_code'], optional: [] },
    } },
    'payment.integrity_anomaly': { outcomes: {
      recovered: { level: 'warn', required: ['anomaly_code', 'recovery_applied'], optional: [] },
      blocked: { level: 'error', required: ['anomaly_code', 'recovery_applied'], optional: [] },
    } },
    'payment.application': { outcomes: {
      applied: { level: 'info', required: ['payment_kind', 'installment_closed', 'credit_closed', 'manual_action_required', 'duration_ms'], optional: [] },
      partially_applied: { level: 'warn', required: ['payment_kind', 'installment_closed', 'credit_closed', 'manual_action_required', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['payment_kind', 'installment_closed', 'credit_closed', 'manual_action_required', 'duration_ms', 'error_code'], optional: [] },
    } },
    'payment.revalidation': { outcomes: {
      completed: { level: 'info', required: ['credit_updated', 'installment_closed', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['credit_updated', 'installment_closed', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['credit_updated', 'installment_closed', 'duration_ms', 'error_code'], optional: [] },
    } },
    'payment.investor_distribution': { outcomes: {
      completed: { level: 'info', required: ['distribution_mode', 'fallback_applied', 'duration_ms'], optional: [] },
      fallback: { level: 'warn', required: ['distribution_mode', 'fallback_applied', 'duration_ms', 'reason_code'], optional: [] },
      blocked: { level: 'warn', required: ['distribution_mode', 'fallback_applied', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['distribution_mode', 'fallback_applied', 'duration_ms', 'error_code'], optional: [] },
    } },
    'payment.agreement_creation': { outcomes: {
      created: { level: 'info', required: ['credit_state_transition', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['credit_state_transition', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['credit_state_transition', 'duration_ms', 'error_code'], optional: [] },
    } },
    'payment.agreement_status_change': { outcomes: {
      changed: { level: 'info', required: ['requested_state', 'credit_state_transition', 'late_fee_recreation', 'manual_action_required', 'duration_ms'], optional: [] },
      partially_changed: { level: 'warn', required: ['requested_state', 'credit_state_transition', 'late_fee_recreation', 'manual_action_required', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['requested_state', 'credit_state_transition', 'late_fee_recreation', 'manual_action_required', 'duration_ms', 'error_code'], optional: [] },
    } },
    'payment.reversal': { outcomes: {
      completed: { level: 'info', required: ['previous_payment_state', 'credit_updated', 'investments_reversed', 'manual_action_required', 'duration_ms'], optional: [] },
      partially_completed: { level: 'warn', required: ['previous_payment_state', 'credit_updated', 'investments_reversed', 'manual_action_required', 'duration_ms', 'reason_code'], optional: [] },
      rejected: { level: 'warn', required: ['previous_payment_state', 'credit_updated', 'investments_reversed', 'manual_action_required', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['previous_payment_state', 'credit_updated', 'investments_reversed', 'manual_action_required', 'duration_ms', 'error_code'], optional: [] },
    } },
    'invoice.voiding': { outcomes: {
      completed: { level: 'info', required: ['voiding_mode', 'provider', 'processed_count', 'succeeded_count', 'failed_count', 'manual_action_required', 'duration_ms'], optional: [] },
      provider_rejected: { level: 'warn', required: ['voiding_mode', 'provider', 'processed_count', 'succeeded_count', 'failed_count', 'manual_action_required', 'duration_ms', 'reason_code'], optional: [] },
      local_state_inconsistent: { level: 'error', required: ['voiding_mode', 'provider', 'processed_count', 'succeeded_count', 'failed_count', 'manual_action_required', 'duration_ms', 'error_code'], optional: [], constants: { manual_action_required: true } },
      failed: { level: 'error', required: ['voiding_mode', 'provider', 'processed_count', 'succeeded_count', 'failed_count', 'manual_action_required', 'duration_ms', 'error_code'], optional: [] },
    } },
    'credit.creation': { outcomes: {
      created: { level: 'info', required: ['credit_type', 'investor_count', 'rubric_count', 'advisor_assignment_source', 'notification_attempted', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['credit_type', 'investor_count', 'rubric_count', 'advisor_assignment_source', 'notification_attempted', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['credit_type', 'investor_count', 'rubric_count', 'advisor_assignment_source', 'notification_attempted', 'duration_ms', 'error_code'], optional: [] },
    } },
    'credit.capital_contribution': { outcomes: {
      failed: { level: 'error', required: ['contribution_operation', 'duration_ms', 'error_code'], optional: [], constants: { error_code: 'persistence_failed' } },
    } },
    'credit.capital_payment_audit': { outcomes: {
      completed: { level: 'info', required: ['audit_operation', 'processed_count', 'succeeded_count', 'failed_count', 'duration_ms'], optional: [] },
      diagnostic_completed: { level: 'info', required: ['audit_operation', 'duration_ms'], optional: [], constants: { audit_operation: 'diagnostic' } },
      partially_completed: { level: 'warn', required: ['audit_operation', 'processed_count', 'succeeded_count', 'failed_count', 'duration_ms'], optional: [] },
      failed: { level: 'error', required: ['audit_operation', 'duration_ms', 'error_code'], optional: [] },
    } },
    'credit.update': { outcomes: {
      completed: { level: 'info', required: ['change_set', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['change_set', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['change_set', 'duration_ms', 'error_code'], optional: [] },
    } },
    'credit.schedule_recalculation': { outcomes: {
      completed: { level: 'info', required: ['recalculation_strategy', 'affected_installment_count', 'duration_ms'], optional: [] },
      failed: { level: 'error', required: ['recalculation_strategy', 'affected_installment_count', 'duration_ms', 'error_code'], optional: [] },
    } },
    'investor.assignment': { outcomes: {
      completed: { level: 'info', required: ['assignment_mode', 'investor_count', 'duration_ms'], optional: [] },
      rejected: { level: 'warn', required: ['assignment_mode', 'investor_count', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['assignment_mode', 'investor_count', 'duration_ms', 'error_code'], optional: [] },
    } },
    'investor.liquidation': { outcomes: {
      completed: { level: 'info', required: ['liquidation_mode', 'processed_count', 'succeeded_count', 'failed_count', 'duration_ms'], optional: [] },
      reversed: { level: 'info', required: ['liquidation_mode', 'processed_count', 'succeeded_count', 'failed_count', 'duration_ms'], optional: [] },
      partially_completed: { level: 'warn', required: ['liquidation_mode', 'processed_count', 'succeeded_count', 'failed_count', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['liquidation_mode', 'processed_count', 'succeeded_count', 'failed_count', 'duration_ms', 'error_code'], optional: [] },
    } },
    'credit.liquidation': { outcomes: {
      completed: { level: 'info', required: ['processed_count', 'succeeded_count', 'failed_count', 'duration_ms'], optional: [] },
      partially_completed: { level: 'warn', required: ['processed_count', 'succeeded_count', 'failed_count', 'duration_ms', 'reason_code'], optional: [] },
      failed: { level: 'error', required: ['processed_count', 'succeeded_count', 'failed_count', 'duration_ms', 'error_code'], optional: [] },
    } },
  },
  providerOperations: {
    cofidi_sat: ['certify_document', 'lookup_internal_document', 'get_document', 'void_document', 'verify_document'],
    cofidi_nit: ['lookup_taxpayer'],
    sifco: ['list_clients', 'list_client_loans', 'get_loan_detail', 'list_installments', 'get_surcharges', 'get_statement', 'get_loan_info', 'bulk_sync'],
    cloudflare_r2: ['put_upload', 'put_invoice_pdf', 'create_signed_url', 'delete_object'],
    remote_asset: ['fetch_invoice_logo'],
    email_provider: ['send_failed_invoice_report'],
  },
  countInvariants: [
    {
      total: 'processed_count',
      parts: ['succeeded_count', 'failed_count'],
      optionalParts: ['skipped_count'],
    },
  ],
} as const satisfies EventCatalogDefinition;

export type CarteraCatalog = typeof carteraCatalog;
