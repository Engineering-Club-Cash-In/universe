import { describe, expect, test } from 'bun:test';
import {
  createCarteraStructuredLogger,
  emitCreditCapitalContributionFailed,
  emitCreditCapitalContributionCompleted,
  emitCreditCapitalContributionRejected,
  emitCreditCapitalPaymentAuditCompleted,
  emitCreditCapitalPaymentAuditDiagnosticCompleted,
  emitCreditCapitalPaymentAuditFailed,
  emitCreditCapitalPaymentAuditRejected,
  emitCreditLateFee,
  emitCreditDueDate,
  emitInvoiceVoiding,
  emitPaymentReversal,
  emitPaymentReversalToPending,
  emitRecoveredDuplicatePendingInstallment,
  resolveCarteraLogEnvironment,
} from './structuredLogger';

describe('Cartera structured logger adapter', () => {
  test('maps existing deployment environment names to the logger contract', () => {
    expect(resolveCarteraLogEnvironment('DEV')).toBe('development');
    expect(resolveCarteraLogEnvironment('development')).toBe('development');
    expect(resolveCarteraLogEnvironment('LOCAL')).toBe('local');
    expect(resolveCarteraLogEnvironment('PROD')).toBe('production');
    expect(resolveCarteraLogEnvironment('production')).toBe('production');
    expect(resolveCarteraLogEnvironment('staging')).toBe('staging');
    expect(resolveCarteraLogEnvironment(undefined)).toBe('local');
    expect(resolveCarteraLogEnvironment('unexpected')).toBe('local');
  });

  test('emits only the approved recovered integrity anomaly payload', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitRecoveredDuplicatePendingInstallment(logger);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      timestamp: '2026-08-22T00:00:00.000Z',
      schema_version: 1,
      service: 'cartera-back',
      environment: 'staging',
      event: 'payment.integrity_anomaly',
      outcome: 'recovered',
      level: 'warn',
      anomaly_code: 'duplicate_pending_installment',
      recovery_applied: true,
    });
  });

  test('does not let audit sink failures alter endpoint control flow', () => {
    const logger = createCarteraStructuredLogger({
      sink: () => {
        throw new Error('synthetic sink failure');
      },
    });

    expect(() => emitCreditCapitalPaymentAuditCompleted({
      processedCount: 1,
      succeededCount: 1,
      failedCount: 0,
      durationMs: 1,
    }, logger)).not.toThrow();
    expect(() => emitCreditCapitalPaymentAuditDiagnosticCompleted({
      durationMs: 1,
    }, logger)).not.toThrow();
    expect(() => emitCreditCapitalPaymentAuditFailed({
      operation: 'query',
      durationMs: 1,
    }, logger)).not.toThrow();
  });

  test('emits bounded capital-payment audit outcomes without business data', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitCreditCapitalPaymentAuditCompleted({
      processedCount: 4,
      succeededCount: 4,
      failedCount: 0,
      durationMs: 25,
    }, logger);
    emitCreditCapitalPaymentAuditCompleted({
      processedCount: 4,
      succeededCount: 3,
      failedCount: 1,
      durationMs: 30,
    }, logger);
    emitCreditCapitalPaymentAuditDiagnosticCompleted({
      durationMs: 12,
    }, logger);
    emitCreditCapitalPaymentAuditFailed({
      operation: 'diagnostic',
      durationMs: 10,
    }, logger);
    emitCreditCapitalPaymentAuditRejected({
      operation: 'query',
      durationMs: 2,
    }, logger);

    expect(lines).toHaveLength(5);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'completed',
      level: 'info',
      audit_operation: 'query',
      processed_count: 4,
      succeeded_count: 4,
      failed_count: 0,
      duration_ms: 25,
    });
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'partially_completed',
      level: 'warn',
      audit_operation: 'query',
      processed_count: 4,
      succeeded_count: 3,
      failed_count: 1,
      duration_ms: 30,
    });
    expect(JSON.parse(lines[2] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'diagnostic_completed',
      level: 'info',
      audit_operation: 'diagnostic',
      duration_ms: 12,
    });
    expect(JSON.parse(lines[3] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'failed',
      level: 'error',
      audit_operation: 'diagnostic',
      duration_ms: 10,
      error_code: 'unknown',
    });
    expect(JSON.parse(lines[4] ?? '{}')).toMatchObject({
      event: 'credit.capital_payment_audit',
      outcome: 'rejected',
      level: 'warn',
      audit_operation: 'query',
      duration_ms: 2,
      reason_code: 'schema_invalid',
    });
    const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const forbiddenKeys = [
      'credito_id', 'pago_id', 'nombre', 'monto', 'message', 'stack', 'error',
    ];
    for (const entry of entries) {
      for (const key of forbiddenKeys) expect(entry).not.toHaveProperty(key);
    }
  });

  test('emits bounded capital-contribution persistence failures and isolates sink errors', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitCreditCapitalContributionFailed({ operation: 'create', durationMs: 12 }, logger);
    emitCreditCapitalContributionFailed({ operation: 'update', durationMs: 20 }, logger);
    emitCreditCapitalContributionCompleted({ operation: 'create', durationMs: 5 }, logger);
    emitCreditCapitalContributionRejected({ operation: 'update', durationMs: 6 }, logger);

    expect(lines).toHaveLength(4);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'credit.capital_contribution',
      outcome: 'failed',
      level: 'error',
      contribution_operation: 'create',
      duration_ms: 12,
      error_code: 'persistence_failed',
    });
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
      event: 'credit.capital_contribution',
      outcome: 'failed',
      level: 'error',
      contribution_operation: 'update',
      duration_ms: 20,
      error_code: 'persistence_failed',
    });
    expect(JSON.parse(lines[2] ?? '{}')).toMatchObject({
      event: 'credit.capital_contribution',
      outcome: 'completed',
      contribution_operation: 'create',
      duration_ms: 5,
    });
    expect(JSON.parse(lines[3] ?? '{}')).toMatchObject({
      event: 'credit.capital_contribution',
      outcome: 'rejected',
      contribution_operation: 'update',
      duration_ms: 6,
      reason_code: 'capital_contribution_not_found',
    });
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['credito_id', 'abono_id', 'inversionista_id', 'monto', 'message', 'stack', 'error']) {
        expect(entry).not.toHaveProperty(key);
      }
    }

    const broken = createCarteraStructuredLogger({
      sink: () => { throw new Error('synthetic sink failure'); },
    });
    expect(() => emitCreditCapitalContributionFailed({
      operation: 'create',
      durationMs: 1,
    }, broken)).not.toThrow();
  });

  test('emits bounded reversal-to-pending terminal outcomes and isolates sink errors', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitPaymentReversalToPending({ outcome: 'completed', reversalPath: 'already_pending', processedCount: 0, succeededCount: 0, failedCount: 0, durationMs: 4 }, logger);
    emitPaymentReversalToPending({ outcome: 'partially_completed', reversalPath: 'validated_payment', processedCount: 2, succeededCount: 1, failedCount: 1, durationMs: 8 }, logger);
    emitPaymentReversalToPending({ outcome: 'local_state_inconsistent', reversalPath: 'validated_payment', processedCount: 1, succeededCount: 0, failedCount: 1, errorCode: 'persistence_failed', durationMs: 7 }, logger);
    emitPaymentReversalToPending({ outcome: 'rejected', reasonCode: 'schema_invalid', durationMs: 1 }, logger);
    emitPaymentReversalToPending({ outcome: 'failed', errorCode: 'unknown', durationMs: 9 }, logger);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'completed', level: 'info', reversal_path: 'already_pending', processed_count: 0, succeeded_count: 0, failed_count: 0, duration_ms: 4 }),
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'partially_completed', level: 'warn', reversal_path: 'validated_payment', processed_count: 2, succeeded_count: 1, failed_count: 1, duration_ms: 8 }),
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'local_state_inconsistent', level: 'error', reversal_path: 'validated_payment', processed_count: 1, succeeded_count: 0, failed_count: 1, error_code: 'persistence_failed', duration_ms: 7 }),
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'rejected', level: 'warn', reason_code: 'schema_invalid', duration_ms: 1 }),
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'failed', level: 'error', error_code: 'unknown', duration_ms: 9 }),
    ]);
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['credito_id', 'pago_id', 'factura_id', 'uuid', 'nit', 'monto', 'message', 'stack', 'error']) expect(entry).not.toHaveProperty(key);
    }

    const broken = createCarteraStructuredLogger({ sink: () => { throw new Error('synthetic sink failure'); } });
    expect(() => emitPaymentReversalToPending({ outcome: 'failed', errorCode: 'unknown', durationMs: 1 }, broken)).not.toThrow();
  });

  test('emits finite late-fee outcomes and isolates sink failures', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitCreditLateFee({ outcome: 'completed', operation: 'create', durationMs: 12 }, logger);
    emitCreditLateFee({ outcome: 'completed', operation: 'process', durationMs: 25, processedCount: 8, succeededCount: 6, failedCount: 0, skippedCount: 2 }, logger);
    emitCreditLateFee({ outcome: 'skipped', operation: 'process', durationMs: 1, reasonCode: 'concurrent_run' }, logger);
    emitCreditLateFee({ outcome: 'rejected', operation: 'update', durationMs: 2, reasonCode: 'active_late_fee_not_found' }, logger);
    emitCreditLateFee({ outcome: 'degraded', operation: 'history', durationMs: 3, errorCode: 'persistence_failed' }, logger);
    emitCreditLateFee({ outcome: 'failed', operation: 'condone', durationMs: 4, errorCode: 'unknown' }, logger);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: 'credit.late_fee', outcome: 'completed', level: 'info', late_fee_operation: 'create', duration_ms: 12 }),
      expect.objectContaining({ event: 'credit.late_fee', outcome: 'completed', level: 'info', late_fee_operation: 'process', processed_count: 8, succeeded_count: 6, failed_count: 0, skipped_count: 2, duration_ms: 25 }),
      expect.objectContaining({ event: 'credit.late_fee', outcome: 'skipped', level: 'info', late_fee_operation: 'process', reason_code: 'concurrent_run' }),
      expect.objectContaining({ event: 'credit.late_fee', outcome: 'rejected', level: 'warn', late_fee_operation: 'update', reason_code: 'active_late_fee_not_found' }),
      expect.objectContaining({ event: 'credit.late_fee', outcome: 'degraded', level: 'warn', late_fee_operation: 'history', error_code: 'persistence_failed' }),
      expect.objectContaining({ event: 'credit.late_fee', outcome: 'failed', level: 'error', late_fee_operation: 'condone', error_code: 'unknown' }),
    ]);
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['credito_id', 'mora_id', 'numero_credito_sifco', 'monto', 'capital', 'motivo', 'email', 'message', 'stack', 'error']) expect(entry).not.toHaveProperty(key);
    }

    const broken = createCarteraStructuredLogger({ sink: () => { throw new Error('synthetic sink failure'); } });
    expect(() => emitCreditLateFee({ outcome: 'failed', operation: 'create', durationMs: 1, errorCode: 'unknown' }, broken)).not.toThrow();
  });

  test('emits finite due-date outcomes and isolates sink failures', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-22T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitCreditDueDate({ outcome: 'completed', operation: 'change_start_date', durationMs: 5 }, logger);
    emitCreditDueDate({ outcome: 'completed', operation: 'json_bulk_update', durationMs: 10, processedCount: 8, succeededCount: 6, failedCount: 0, skippedCount: 2 }, logger);
    emitCreditDueDate({ outcome: 'skipped', operation: 'repair_missing_february', durationMs: 6, processedCount: 2, succeededCount: 0, failedCount: 0, skippedCount: 2, reasonCode: 'missing_payment_reference' }, logger);
    emitCreditDueDate({ outcome: 'partially_completed', operation: 'batch_update', durationMs: 8, processedCount: 3, succeededCount: 2, failedCount: 1, skippedCount: 0, reasonCode: 'item_failures' }, logger);
    emitCreditDueDate({ outcome: 'rejected', operation: 'change_start_date', durationMs: 1, reasonCode: 'paid_installment_conflict' }, logger);
    emitCreditDueDate({ outcome: 'failed', operation: 'list_change_history', durationMs: 2, errorCode: 'unknown' }, logger);
    emitCreditDueDate({ outcome: 'partially_persisted', operation: 'change_start_date', durationMs: 9, errorCode: 'unknown' }, logger);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: 'credit.due_date', outcome: 'completed', level: 'info', due_date_operation: 'change_start_date', duration_ms: 5 }),
      expect.objectContaining({ event: 'credit.due_date', outcome: 'completed', level: 'info', due_date_operation: 'json_bulk_update', processed_count: 8, succeeded_count: 6, failed_count: 0, skipped_count: 2 }),
      expect.objectContaining({ event: 'credit.due_date', outcome: 'skipped', level: 'info', due_date_operation: 'repair_missing_february', processed_count: 2, succeeded_count: 0, failed_count: 0, skipped_count: 2, reason_code: 'missing_payment_reference' }),
      expect.objectContaining({ event: 'credit.due_date', outcome: 'partially_completed', level: 'warn', due_date_operation: 'batch_update', processed_count: 3, succeeded_count: 2, failed_count: 1, skipped_count: 0, reason_code: 'item_failures' }),
      expect.objectContaining({ event: 'credit.due_date', outcome: 'rejected', level: 'warn', due_date_operation: 'change_start_date', reason_code: 'paid_installment_conflict' }),
      expect.objectContaining({ event: 'credit.due_date', outcome: 'failed', level: 'error', due_date_operation: 'list_change_history', error_code: 'unknown' }),
      expect.objectContaining({ event: 'credit.due_date', outcome: 'partially_persisted', level: 'error', due_date_operation: 'change_start_date', error_code: 'unknown' }),
    ]);
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['credito_id', 'cuota_id', 'pago_id', 'numero_credito_sifco', 'fecha', 'dia_pago', 'changed_by', 'razon', 'path', 'sql', 'message', 'stack', 'error']) expect(entry).not.toHaveProperty(key);
    }

    const broken = createCarteraStructuredLogger({ sink: () => { throw new Error('synthetic sink failure'); } });
    expect(() => emitCreditDueDate({ outcome: 'failed', operation: 'json_bulk_update', durationMs: 1, errorCode: 'unknown' }, broken)).not.toThrow();
  });

  test('emits finite payment-reversal and invoice-voiding outcomes without business data', () => {
    const lines: string[] = [];
    const logger = createCarteraStructuredLogger({
      environment: 'staging',
      clock: () => new Date('2026-08-24T00:00:00.000Z'),
      sink: (line) => lines.push(line),
    });

    emitPaymentReversal({ outcome: 'completed', previousPaymentState: 'applied', creditUpdated: true, investmentsReversed: true, manualActionRequired: false, durationMs: 9 }, logger);
    emitPaymentReversal({ outcome: 'partially_completed', previousPaymentState: 'pending', creditUpdated: false, investmentsReversed: true, manualActionRequired: true, durationMs: 11, reasonCode: 'manual_reconciliation_required' }, logger);
    emitPaymentReversal({ outcome: 'rejected', previousPaymentState: 'unknown', creditUpdated: false, investmentsReversed: false, manualActionRequired: false, durationMs: 1, reasonCode: 'schema_invalid' }, logger);
    emitPaymentReversal({ outcome: 'failed', previousPaymentState: 'unknown', creditUpdated: false, investmentsReversed: false, manualActionRequired: false, durationMs: 2, errorCode: 'unknown' }, logger);
    emitInvoiceVoiding({ outcome: 'completed', processedCount: 2, succeededCount: 2, failedCount: 0, manualActionRequired: false, durationMs: 4 }, logger);
    emitInvoiceVoiding({ outcome: 'provider_rejected', processedCount: 2, succeededCount: 1, failedCount: 1, manualActionRequired: true, durationMs: 5, reasonCode: 'provider_rejected' }, logger);
    emitInvoiceVoiding({ outcome: 'local_state_inconsistent', processedCount: 1, succeededCount: 0, failedCount: 1, manualActionRequired: true, durationMs: 6, errorCode: 'persistence_failed' }, logger);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: 'payment.reversal', outcome: 'completed', previous_payment_state: 'applied', credit_updated: true, investments_reversed: true, manual_action_required: false }),
      expect.objectContaining({ event: 'payment.reversal', outcome: 'partially_completed', reason_code: 'manual_reconciliation_required', manual_action_required: true }),
      expect.objectContaining({ event: 'payment.reversal', outcome: 'rejected', previous_payment_state: 'unknown', reason_code: 'schema_invalid' }),
      expect.objectContaining({ event: 'payment.reversal', outcome: 'failed', previous_payment_state: 'unknown', error_code: 'unknown' }),
      expect.objectContaining({ event: 'invoice.voiding', outcome: 'completed', voiding_mode: 'payment_reversal', provider: 'cofidi_sat', processed_count: 2, succeeded_count: 2, failed_count: 0 }),
      expect.objectContaining({ event: 'invoice.voiding', outcome: 'provider_rejected', reason_code: 'provider_rejected', manual_action_required: true }),
      expect.objectContaining({ event: 'invoice.voiding', outcome: 'local_state_inconsistent', error_code: 'persistence_failed', manual_action_required: true }),
    ]);
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      for (const key of ['credito_id', 'pago_id', 'factura_id', 'uuid', 'serie', 'numero', 'fecha', 'nit', 'xml', 'base64', 'monto', 'path', 'sql', 'message', 'stack', 'error']) expect(entry).not.toHaveProperty(key);
    }

    const broken = createCarteraStructuredLogger({ sink: () => { throw new Error('synthetic sink failure'); } });
    expect(() => emitPaymentReversal({ outcome: 'failed', previousPaymentState: 'unknown', creditUpdated: false, investmentsReversed: false, manualActionRequired: false, durationMs: 1, errorCode: 'unknown' }, broken)).not.toThrow();
    expect(() => emitInvoiceVoiding({ outcome: 'failed', processedCount: 1, succeededCount: 0, failedCount: 1, manualActionRequired: true, durationMs: 1, errorCode: 'unknown' }, broken)).not.toThrow();
  });
});
