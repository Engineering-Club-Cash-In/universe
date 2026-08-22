import type { EventCatalogDefinition } from '../src/catalog-types';

export interface ManifestEntry {
  readonly path: string;
  readonly line: number;
  readonly method: string;
  readonly classification: 'remove' | 'replace';
  readonly disposition: 'remove' | 'event';
  readonly event: string | null;
  readonly outcome: string | null;
  readonly rationale: string;
}

export interface Manifest {
  readonly commit: string;
  readonly entries: readonly ManifestEntry[];
}

const METHOD_PATTERN = /^console\.(log|error|warn|time|timeEnd|table)$/;
const RATIONALE_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

function recordOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Readonly<Record<string, unknown>>;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

function hasExactKeys(record: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(record);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

export function parseFirstSliceManifest(
  value: unknown,
  catalog: EventCatalogDefinition,
  expectedCommit: string,
  allowedPaths: ReadonlySet<string>,
): Manifest {
  const root = recordOf(value);
  if (!root || !hasExactKeys(root, new Set(['commit', 'entries'])) || root.commit !== expectedCommit || !Array.isArray(root.entries)) {
    throw new Error('invalid first-slice manifest root');
  }
  const entries: ManifestEntry[] = [];
  const keys = new Set<string>();
  for (const rawEntry of root.entries) {
    const entry = recordOf(rawEntry);
    if (!entry || !hasExactKeys(entry, new Set([
      'path', 'line', 'method', 'classification', 'disposition',
      'event', 'outcome', 'rationale',
    ]))) throw new Error('invalid first-slice manifest entry');
    const path = entry.path;
    const line = entry.line;
    const method = entry.method;
    const classification = entry.classification;
    const disposition = entry.disposition;
    const event = nullableString(entry.event);
    const outcome = nullableString(entry.outcome);
    const rationale = entry.rationale;
    if (typeof path !== 'string' || !allowedPaths.has(path)) throw new Error('invalid manifest path');
    if (!Number.isSafeInteger(line) || typeof line !== 'number' || line < 1) throw new Error('invalid manifest line');
    if (typeof method !== 'string' || !METHOD_PATTERN.test(method)) throw new Error('invalid manifest method');
    if (classification !== 'remove' && classification !== 'replace') throw new Error('invalid manifest classification');
    if (disposition !== 'remove' && disposition !== 'event') throw new Error('invalid manifest disposition');
    if (typeof rationale !== 'string' || !RATIONALE_PATTERN.test(rationale)) throw new Error('invalid manifest rationale');
    if (event === undefined || outcome === undefined) throw new Error('invalid manifest event fields');
    if (disposition === 'remove') {
      if (classification !== 'remove' || event !== null || outcome !== null) {
        throw new Error('inconsistent remove manifest entry');
      }
    } else {
      if (classification !== 'replace' || event === null || outcome === null) {
        throw new Error('inconsistent event manifest entry');
      }
      const eventDefinition = catalog.events[event];
      if (!eventDefinition?.outcomes[outcome]) throw new Error('unknown manifest event outcome');
    }
    const entryKey = `${path}:${line}:${method}`;
    if (keys.has(entryKey)) throw new Error('duplicate manifest entry');
    keys.add(entryKey);
    entries.push({ path, line, method, classification, disposition, event, outcome, rationale });
  }
  if (entries.length === 0) throw new Error('empty first-slice manifest');
  return { commit: expectedCommit, entries };
}
