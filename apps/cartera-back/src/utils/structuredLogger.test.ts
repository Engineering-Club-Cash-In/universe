import { describe, expect, test } from 'bun:test';
import {
  createCarteraStructuredLogger,
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
});
