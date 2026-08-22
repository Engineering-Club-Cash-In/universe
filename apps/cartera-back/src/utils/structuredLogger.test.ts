import { describe, expect, test } from 'bun:test';
import {
  createCarteraStructuredLogger,
  emitCreditCapitalContributionFailed,
  emitCreditCapitalPaymentAuditCompleted,
  emitCreditCapitalPaymentAuditDiagnosticCompleted,
  emitCreditCapitalPaymentAuditFailed,
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

    expect(lines).toHaveLength(4);
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

    expect(lines).toHaveLength(2);
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
    emitPaymentReversalToPending({ outcome: 'rejected', reasonCode: 'schema_invalid', durationMs: 1 }, logger);
    emitPaymentReversalToPending({ outcome: 'failed', errorCode: 'unknown', durationMs: 9 }, logger);

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'completed', level: 'info', reversal_path: 'already_pending', processed_count: 0, succeeded_count: 0, failed_count: 0, duration_ms: 4 }),
      expect.objectContaining({ event: 'payment.reversal_to_pending', outcome: 'partially_completed', level: 'warn', reversal_path: 'validated_payment', processed_count: 2, succeeded_count: 1, failed_count: 1, duration_ms: 8 }),
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
});
