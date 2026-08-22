import { expect, test } from 'bun:test';
import { carteraCatalog } from '../src/cartera-catalog';
import { createStructuredLogger } from '../src/logger';

const logger = createStructuredLogger(carteraCatalog, {
  service: 'cartera-back',
  environment: 'staging',
  sink: () => undefined,
});

if (false) {
  logger.emit('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1 });

  // @ts-expect-error unknown event
  logger.emit('payment.unknown', 'stored', { mime_family: 'pdf', duration_ms: 1 });

  // @ts-expect-error unknown outcome
  logger.emit('payment.upload', 'completed', { mime_family: 'pdf', duration_ms: 1 });

  // @ts-expect-error invalid enum
  logger.emit('payment.upload', 'stored', { mime_family: 'video', duration_ms: 1 });

  // @ts-expect-error missing required field
  logger.emit('payment.upload', 'stored', { duration_ms: 1 });

  // @ts-expect-error extra field
  logger.emit('payment.upload', 'stored', { mime_family: 'pdf', duration_ms: 1, body: 'blocked' });
}

test('typed API compiles with the catalog-derived contract', () => {
  expect(typeof logger.emit).toBe('function');
});
