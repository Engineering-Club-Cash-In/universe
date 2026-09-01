import { describe, expect, test } from 'bun:test';
import { carteraCatalog } from '../src/cartera-catalog';
import { parseFirstSliceManifest } from '../scripts/manifest-validator';

const COMMIT = '56717ddef8f0bbd8c8633172c8ca2c85c248dfd7';
const PATH = 'apps/cartera-back/src/controllers/registerPayment.ts';
const PATHS = new Set([PATH, 'apps/cartera-back/src/utils/functions/uploadsFiles.ts']);

function manifest(entry: Readonly<Record<string, unknown>>): unknown {
  return { commit: COMMIT, entries: [entry] };
}

const validRemove = {
  path: PATH,
  line: 139,
  method: 'console.log',
  classification: 'remove',
  disposition: 'remove',
  event: null,
  outcome: null,
  rationale: 'debug_or_sensitive_intermediate_state',
} as const;

describe('first-slice manifest validator', () => {
  test('accepts an exact remove entry', () => {
    expect(parseFirstSliceManifest(manifest(validRemove), carteraCatalog, COMMIT, PATHS).entries)
      .toHaveLength(1);
  });

  test('rejects invalid enums and inconsistent remove/event combinations', () => {
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove, classification: 'keep',
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove, disposition: 'event', event: null, outcome: null,
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
  });

  test('rejects unknown catalog events and outcomes', () => {
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove,
      classification: 'replace',
      disposition: 'event',
      event: 'payment.unknown',
      outcome: 'completed',
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove,
      classification: 'replace',
      disposition: 'event',
      event: 'payment.integrity_anomaly',
      outcome: 'unknown',
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
  });

  test('rejects paths outside the slice and unsafe rationales', () => {
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove, path: 'apps/cartera-back/src/controllers/payments.ts',
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove, rationale: 'unsafe rationale\nnext',
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
  });

  test('rejects unknown root and entry properties', () => {
    expect(() => parseFirstSliceManifest({
      commit: COMMIT, entries: [validRemove], unexpectedRoot: true,
    }, carteraCatalog, COMMIT, PATHS)).toThrow();
    expect(() => parseFirstSliceManifest(manifest({
      ...validRemove, unexpected: true,
    }), carteraCatalog, COMMIT, PATHS)).toThrow();
  });
});
