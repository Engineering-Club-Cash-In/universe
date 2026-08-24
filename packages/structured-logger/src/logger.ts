import { randomUUID } from 'node:crypto';
import type { CountInvariantDefinition, EventCatalogDefinition, FieldDefinition } from './catalog-types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FIELD_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_EVENT_PATTERN = /^[a-z][a-z0-9_.]{0,127}$/;
const FORBIDDEN_FIELD_TERMS = [
  'body', 'bodies', 'request', 'requests', 'response', 'responses', 'query', 'queries',
  'param', 'params', 'parameter', 'parameters', 'parametro', 'parametros', 'header', 'headers',
  'cookie', 'cookies', 'token', 'tokens', 'authorization', 'authorizations',
  'autorizacion', 'autorizaciones', 'password', 'passwords', 'contrasena', 'contrasenas',
  'secret', 'secrets', 'credential', 'credentials', 'credencial', 'credenciales',
  'apikey', 'apikeys', 'api_key', 'api_keys', 'connectionstring', 'connectionstrings',
  'connection_string', 'connection_strings', 'message', 'messages', 'stack', 'stacks',
  'cause', 'causes', 'axioserror', 'axioserrors', 'axios_error', 'axios_errors',
  'file', 'files', 'blob', 'blobs', 'buffer', 'buffers', 'xml', 'xmls', 'soap', 'soaps',
  'html', 'htmls', 'pdf', 'pdfs',
  'url', 'urls', 'localpath', 'localpaths', 'local_path', 'local_paths', 'filepath',
  'filepaths', 'file_path', 'file_paths', 'ruta_local', 'rutas_locales',
  'customername', 'customernames', 'customer_name', 'customer_names', 'clientname',
  'clientnames', 'client_name', 'client_names', 'username', 'usernames', 'user_name',
  'user_names', 'fullname', 'fullnames', 'full_name', 'full_names', 'firstname',
  'firstnames', 'first_name', 'first_names', 'lastname', 'lastnames', 'last_name',
  'last_names', 'name', 'names', 'nombre', 'nombres', 'correo', 'correos', 'domicilio',
  'domicilios', 'email', 'emails', 'phone', 'phones', 'telefono', 'telefonos', 'address',
  'addresses', 'direccion', 'direcciones', 'dpi', 'dpis', 'nit', 'nits', 'document', 'documents',
  'documento', 'documentos',
  'credit_id', 'credit_ids', 'credits_id', 'credits_ids', 'credito_id', 'credito_ids',
  'creditos_id', 'creditos_ids', 'payment_id', 'payment_ids', 'payments_id', 'payments_ids',
  'pago_id', 'pago_ids', 'pagos_id', 'pagos_ids', 'installment_id', 'installment_ids',
  'installments_id', 'installments_ids', 'cuota_id', 'cuota_ids', 'cuotas_id', 'cuotas_ids',
  'investor_id', 'investor_ids', 'investors_id', 'investors_ids', 'inversionista_id',
  'inversionista_ids', 'inversionistas_id', 'inversionistas_ids', 'invoice_id', 'invoice_ids',
  'invoices_id', 'invoices_ids', 'factura_id', 'factura_ids', 'facturas_id', 'facturas_ids',
  'receipt_id', 'receipt_ids', 'receipts_id', 'receipts_ids', 'boleta', 'boletas',
  'boleta_id', 'boleta_ids', 'boletas_id', 'boletas_ids', 'sifco_code', 'sifco_codes',
  'amount', 'amounts', 'monto', 'montos', 'balance', 'balances', 'saldo', 'saldos', 'mora',
  'debt', 'debts', 'deuda', 'deudas', 'principal', 'capital', 'interest', 'interests',
  'interes', 'intereses', 'iva', 'vat', 'cuota', 'cuotas', 'percentage', 'percentages',
  'percent', 'percents', 'porcentaje', 'porcentajes', 'free_text', 'comment', 'comments',
  'note', 'notes',
] as const;
const FORBIDDEN_FIELD_PATTERN = new RegExp(
  `(^|_)(?:${FORBIDDEN_FIELD_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})($|_)`,
  'i',
);
const CANONICAL_JOB_NAMES = new Set([
  'process_late_fees', 'upsert_advisor_effectiveness', 'expire_portfolio_purchases',
  'generate_monthly_close', 'verify_sat_invoices', 'report_failed_sat_invoices',
  'generate_daily_invoice_snapshot',
]);
const CONTEXT_FIELDS = new Set(['request_id', 'operation_id', 'run_id']);
const RESERVED_EVENT_FIELDS = new Set([
  'timestamp', 'schema_version', 'service', 'environment', 'event', 'outcome', 'level',
  'request_id', 'operation_id', 'run_id',
]);

function hasOwn(record: object, field: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function isCanonicalJobNameDefinition(definition: FieldDefinition | undefined): boolean {
  return definition?.type === 'enum' && definition.values.length === CANONICAL_JOB_NAMES.size &&
    new Set(definition.values).size === CANONICAL_JOB_NAMES.size &&
    definition.values.every((value) => CANONICAL_JOB_NAMES.has(value));
}

function isForbiddenField(field: string, definition?: FieldDefinition): boolean {
  return FORBIDDEN_FIELD_PATTERN.test(field) &&
    !(field === 'job_name' && isCanonicalJobNameDefinition(definition));
}

export type Environment = 'local' | 'development' | 'staging' | 'production';
export interface CorrelationContext {
  readonly request_id?: string;
  readonly operation_id?: string;
  readonly run_id?: string;
}

export interface StructuredLoggerConfig {
  readonly service: string;
  readonly environment: Environment;
  readonly clock?: () => Date;
  readonly sink?: (line: string) => void;
}

type EventName<C extends EventCatalogDefinition> = Extract<keyof C['events'], string>;
type OutcomeName<C extends EventCatalogDefinition, E extends EventName<C>> =
  Extract<keyof C['events'][E]['outcomes'], string>;
type Outcome<C extends EventCatalogDefinition, E extends EventName<C>, O extends OutcomeName<C, E>> =
  C['events'][E]['outcomes'][O];
type RequiredField<C extends EventCatalogDefinition, E extends EventName<C>, O extends OutcomeName<C, E>> =
  Extract<Outcome<C, E, O>['required'][number], keyof C['fields']>;
type OptionalField<C extends EventCatalogDefinition, E extends EventName<C>, O extends OutcomeName<C, E>> =
  Extract<Outcome<C, E, O>['optional'][number], keyof C['fields']>;
type OutcomeConstants<C extends EventCatalogDefinition, E extends EventName<C>, O extends OutcomeName<C, E>> =
  Outcome<C, E, O> extends Readonly<{ constants: infer Constants }> ? Constants : Readonly<Record<never, never>>;
type ConstantField<C extends EventCatalogDefinition, E extends EventName<C>, O extends OutcomeName<C, E>> =
  Extract<keyof OutcomeConstants<C, E, O>, keyof C['fields']>;

type FieldValue<D> =
  D extends Readonly<{ type: 'boolean' }> ? boolean :
  D extends Readonly<{ type: 'integer' }> ? number :
  D extends Readonly<{ type: 'enum'; values: readonly (infer V)[] }> ? V :
  D extends Readonly<{ type: 'string' | 'timestamp' | 'uuid' }> ? string :
  never;

type InvariantMandatoryField<I extends CountInvariantDefinition> =
  Extract<I['total'] | I['parts'][number], string>;
type InvariantOptionalField<I extends CountInvariantDefinition> = Extract<I['optionalParts'][number], string>;
type InvariantField<I extends CountInvariantDefinition> = InvariantMandatoryField<I> | InvariantOptionalField<I>;
type PayloadField<C extends EventCatalogDefinition, E extends EventName<C>, O extends OutcomeName<C, E>> =
  RequiredField<C, E, O> | OptionalField<C, E, O>;
type CountField<C extends EventCatalogDefinition> = number extends C['countInvariants']['length']
  ? never
  : string extends InvariantField<C['countInvariants'][number]>
    ? never
    : InvariantField<C['countInvariants'][number]>;

type CountInvariantPayload<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  I extends CountInvariantDefinition,
  Declared extends keyof C['fields'] = Extract<InvariantField<I>, PayloadField<C, E, O>>,
> = ([InvariantMandatoryField<I>] extends [PayloadField<C, E, O>]
  ? { readonly [K in Extract<InvariantMandatoryField<I>, keyof C['fields']>]-?: FieldValue<C['fields'][K]> } &
    { readonly [K in Extract<InvariantOptionalField<I>, RequiredField<C, E, O>>]-?: FieldValue<C['fields'][K]> } &
    { readonly [K in Extract<InvariantOptionalField<I>, OptionalField<C, E, O>>]?: FieldValue<C['fields'][K]> }
  : never) |
  ([Declared] extends [OptionalField<C, E, O>]
    ? { readonly [K in Declared]?: never }
    : never);

type CountInvariantPayloads<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  Invariants extends readonly CountInvariantDefinition[] = C['countInvariants'],
> = string extends InvariantField<Invariants[number]> ? object
  : number extends Invariants['length'] ? object
  : Invariants extends readonly [
    infer First extends CountInvariantDefinition,
    ...infer Rest extends readonly CountInvariantDefinition[],
  ]
    ? CountInvariantPayload<C, E, O, First> & CountInvariantPayloads<C, E, O, Rest>
    : object;

type CountInvariantMemberInput<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  I extends CountInvariantDefinition,
  P,
  Declared extends keyof C['fields'] = Extract<InvariantField<I>, PayloadField<C, E, O>>,
  Present extends Declared = Extract<keyof P, Declared>,
> = [Present] extends [never]
  ? [Declared] extends [OptionalField<C, E, O>] ? object : never
  : P extends { readonly [K in Present]-?: FieldValue<C['fields'][K]> }
    ? P extends CountInvariantPayload<C, E, O, I> ? object : never
    : never;

type InvalidCountInvariantMembers<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  I extends CountInvariantDefinition,
  P,
> = P extends unknown
  ? CountInvariantMemberInput<C, E, O, I, P> extends never ? P : never
  : never;

type CountInvariantInput<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  I extends CountInvariantDefinition,
  P,
> = [InvalidCountInvariantMembers<C, E, O, I, P>] extends [never] ? object : never;

type CountInvariantInputs<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  P,
  Invariants extends readonly CountInvariantDefinition[] = C['countInvariants'],
> = string extends InvariantField<Invariants[number]> ? object
  : number extends Invariants['length'] ? object
  : Invariants extends readonly [
    infer First extends CountInvariantDefinition,
    ...infer Rest extends readonly CountInvariantDefinition[],
  ]
    ? CountInvariantInput<C, E, O, First, P> & CountInvariantInputs<C, E, O, P, Rest>
    : object;

type ExactPayloadMemberInput<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  P,
> = Exclude<keyof P, keyof EventPayload<C, E, O>> extends never ? object : never;

type InvalidExactPayloadMembers<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  P,
> = P extends unknown
  ? ExactPayloadMemberInput<C, E, O, P> extends never ? P : never
  : never;

type ExactPayloadInput<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
  P,
> = [InvalidExactPayloadMembers<C, E, O, P>] extends [never] ? object : never;

export type EventPayload<
  C extends EventCatalogDefinition,
  E extends EventName<C>,
  O extends OutcomeName<C, E>,
> = {
  readonly [K in Exclude<RequiredField<C, E, O>, ConstantField<C, E, O> | CountField<C>>]: FieldValue<C['fields'][K]>;
} & {
  readonly [K in Exclude<OptionalField<C, E, O>, ConstantField<C, E, O> | CountField<C>>]?: FieldValue<C['fields'][K]>;
} & {
  readonly [K in ConstantField<C, E, O>]: OutcomeConstants<C, E, O>[K];
} & CountInvariantPayloads<C, E, O>;

export type StructuredEvent = Readonly<Record<string, unknown>>;

export class StructuredLoggerValidationError extends Error {
  readonly code: string;
  readonly event: string;
  readonly field: string | undefined;

  constructor(code: string, event: string, field?: string) {
    const safeField = field && SAFE_FIELD_PATTERN.test(field) ? field : undefined;
    const safeEvent = SAFE_EVENT_PATTERN.test(event) ? event : '[invalid]';
    super([code, safeEvent, safeField].filter(Boolean).join(':'));
    this.name = 'StructuredLoggerValidationError';
    this.code = code;
    this.event = safeEvent;
    this.field = safeField;
  }
}

export function createCorrelationId(): string {
  return randomUUID();
}

function snapshotInputRecord(value: unknown, code: string, event: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code, event);
  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail(code, event);
  }
  if (prototype !== Object.prototype && prototype !== null) fail(code, event);
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail(code, event);
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('accessor_field', event, key);
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

function deepSnapshot(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') fail('invalid_catalog', 'logger_config');
  if (seen.has(value)) fail('invalid_catalog', 'logger_config');
  seen.add(value);
  let descriptors: PropertyDescriptorMap;
  let prototype: object | null;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    fail('invalid_catalog', 'logger_config');
  }
  if (Array.isArray(value)) {
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number') {
      fail('invalid_catalog', 'logger_config');
    }
    const result: unknown[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('invalid_catalog', 'logger_config');
      result.push(deepSnapshot(descriptor.value, seen));
    }
    const allowedKeys = new Set(['length', ...result.map((_, index) => String(index))]);
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowedKeys.has(key))) {
      fail('invalid_catalog', 'logger_config');
    }
    seen.delete(value);
    return Object.freeze(result);
  }
  if (prototype !== Object.prototype && prototype !== null) fail('invalid_catalog', 'logger_config');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') fail('invalid_catalog', 'logger_config');
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('invalid_catalog', 'logger_config');
    result[key] = deepSnapshot(descriptor.value, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function snapshotCatalog(catalog: EventCatalogDefinition): EventCatalogDefinition {
  return deepSnapshot(catalog, new WeakSet()) as EventCatalogDefinition;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function validateFieldDefinition(definition: FieldDefinition, field: string): void {
  const record = definition as Readonly<Record<string, unknown>>;
  if (definition.type === 'boolean' || definition.type === 'timestamp' || definition.type === 'uuid') {
    if (!exactKeys(record, ['type'])) fail('invalid_catalog', 'logger_config', field);
    return;
  }
  if (definition.type === 'integer') {
    if (!exactKeys(record, ['type', 'min', 'max']) || !Number.isSafeInteger(definition.min) ||
      !Number.isSafeInteger(definition.max) || definition.min > definition.max) {
      fail('invalid_catalog', 'logger_config', field);
    }
    return;
  }
  if (definition.type === 'enum') {
    if (!exactKeys(record, ['type', 'values']) || !Array.isArray(definition.values) || definition.values.length === 0 ||
      definition.values.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\r\n]/.test(value)) ||
      new Set(definition.values).size !== definition.values.length) {
      fail('invalid_catalog', 'logger_config', field);
    }
    return;
  }
  if (definition.type !== 'string' || !exactKeys(record, ['type', 'maxLength', 'pattern']) ||
    !Number.isSafeInteger(definition.maxLength) || definition.maxLength < 1 || definition.maxLength > 1024 ||
    typeof definition.pattern !== 'string' || definition.pattern.length > 512) {
    fail('invalid_catalog', 'logger_config', field);
  }
  try {
    new RegExp(definition.pattern);
  } catch {
    fail('invalid_catalog', 'logger_config', field);
  }
}

function validateCatalog(catalog: EventCatalogDefinition): void {
  if (!Number.isSafeInteger(catalog.schemaVersion) || catalog.schemaVersion < 1) fail('invalid_catalog', 'logger_config');
  const commonNames = ['timestamp', 'schema_version', 'service', 'environment', 'request_id', 'operation_id', 'run_id'];
  if (!exactKeys(catalog.commonFields, commonNames)) fail('invalid_catalog', 'logger_config');
  for (const [field, definition] of Object.entries(catalog.commonFields)) validateFieldDefinition(definition, field);
  const { timestamp, schema_version: schemaVersion, service, environment, request_id: requestId,
    operation_id: operationId, run_id: runId } = catalog.commonFields;
  if (timestamp?.type !== 'timestamp' || schemaVersion?.type !== 'integer' ||
    schemaVersion.min !== catalog.schemaVersion || schemaVersion.max !== catalog.schemaVersion ||
    service?.type !== 'string' || service.maxLength !== 64 || service.pattern !== '^[0-9A-Za-z._-]+$' ||
    environment?.type !== 'enum' || environment.values.join(',') !== 'local,development,staging,production' ||
    requestId?.type !== 'uuid' || operationId?.type !== 'uuid' || runId?.type !== 'uuid') {
    fail('invalid_catalog', 'logger_config');
  }
  for (const [field, definition] of Object.entries(catalog.fields)) {
    if (!SAFE_FIELD_PATTERN.test(field) || isForbiddenField(field, definition) || RESERVED_EVENT_FIELDS.has(field)) {
      fail('invalid_catalog', 'logger_config', field);
    }
    validateFieldDefinition(definition, field);
  }
  if (Object.keys(catalog.events).length === 0) fail('invalid_catalog', 'logger_config');
  for (const [event, eventDefinition] of Object.entries(catalog.events)) {
    if (!SAFE_EVENT_PATTERN.test(event) || !exactKeys(eventDefinition as unknown as Readonly<Record<string, unknown>>, ['outcomes']) ||
      Object.keys(eventDefinition.outcomes).length === 0) fail('invalid_catalog', 'logger_config');
    for (const [outcome, definition] of Object.entries(eventDefinition.outcomes)) {
      if (!SAFE_FIELD_PATTERN.test(outcome) || !['info', 'warn', 'error'].includes(definition.level) ||
        !Array.isArray(definition.required) || !Array.isArray(definition.optional)) fail('invalid_catalog', 'logger_config');
      const fields = [...definition.required, ...definition.optional];
      if (fields.some((field) => typeof field !== 'string' || !hasOwn(catalog.fields, field)) ||
        new Set(fields).size !== fields.length) fail('invalid_catalog', 'logger_config');
      const constants = definition.constants ?? {};
      if (Object.keys(constants).some((field) => !fields.includes(field))) fail('invalid_catalog', 'logger_config');
      for (const [field, value] of Object.entries(constants)) validateField(catalog.fields[field]!, value, event, field);
    }
  }
  const provider = catalog.fields.provider;
  const operation = catalog.fields.operation;
  if ((provider === undefined) !== (operation === undefined)) fail('invalid_catalog', 'logger_config');
  if (provider && operation) {
    if (provider.type !== 'enum' || operation.type !== 'enum' ||
      !exactKeys(catalog.providerOperations, provider.values)) fail('invalid_catalog', 'logger_config');
    for (const [name, operations] of Object.entries(catalog.providerOperations)) {
      if (!provider.values.includes(name) || !Array.isArray(operations) || operations.length === 0 ||
        operations.some((value) => !operation.values.includes(value)) || new Set(operations).size !== operations.length) {
        fail('invalid_catalog', 'logger_config');
      }
    }
  } else if (Object.keys(catalog.providerOperations).length !== 0) fail('invalid_catalog', 'logger_config');
  for (const invariant of catalog.countInvariants) {
    const names = [invariant.total, ...invariant.parts, ...invariant.optionalParts];
    if (invariant.parts.length === 0 || new Set(names).size !== names.length || names.some((field) => catalog.fields[field]?.type !== 'integer')) {
      fail('invalid_catalog', 'logger_config');
    }
  }
}

function fail(code: string, event: string, field?: string): never {
  throw new StructuredLoggerValidationError(code, event, field);
}

function validateField(definition: FieldDefinition, value: unknown, event: string, field: string): void {
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') fail('invalid_type', event, field);
    return;
  }
  if (definition.type === 'integer') {
    if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < definition.min || value > definition.max) {
      fail('invalid_integer', event, field);
    }
    return;
  }
  if (definition.type === 'enum') {
    if (typeof value !== 'string' || !definition.values.includes(value)) fail('invalid_enum', event, field);
    return;
  }
  if (definition.type === 'string') {
    if (typeof value !== 'string' || value.length > definition.maxLength || !new RegExp(definition.pattern).test(value)) {
      fail('invalid_string', event, field);
    }
    return;
  }
  if (definition.type === 'uuid') {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail('invalid_uuid', event, field);
    return;
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('invalid_timestamp', event, field);
}

function validatePayload(
  catalog: EventCatalogDefinition,
  event: string,
  outcome: string,
  payloadValue: unknown,
): { readonly payload: Readonly<Record<string, unknown>>; readonly level: string } {
  const eventDefinition = catalog.events[event];
  if (!eventDefinition) fail('unknown_event', 'unknown');
  const outcomeDefinition = eventDefinition.outcomes[outcome];
  if (!outcomeDefinition) fail('unknown_outcome', event, 'outcome');
  const payload = snapshotInputRecord(payloadValue, 'invalid_payload', event);

  const allowed = new Set([...outcomeDefinition.required, ...outcomeDefinition.optional]);
  for (const field of Object.keys(payload)) {
    if (isForbiddenField(field, catalog.fields[field])) fail('forbidden_field', event, field);
    if (!allowed.has(field)) fail('extra_field', event, field);
  }
  for (const field of outcomeDefinition.required) {
    if (!hasOwn(payload, field)) fail('missing_field', event, field);
  }
  for (const field of allowed) {
    if (!hasOwn(payload, field)) continue;
    const definition = catalog.fields[field];
    if (!definition) fail('undefined_field', event, field);
    validateField(definition, payload[field], event, field);
  }
  for (const [field, constant] of Object.entries(outcomeDefinition.constants ?? {})) {
    if (payload[field] !== constant) fail('constant_mismatch', event, field);
  }

  const provider = payload.provider;
  const operation = payload.operation;
  if (typeof provider === 'string' && typeof operation === 'string') {
    const allowedOperations = catalog.providerOperations[provider];
    if (!allowedOperations?.includes(operation)) fail('invalid_provider_operation', event, 'operation');
  }

  for (const invariant of catalog.countInvariants) {
    const invariantFields = [invariant.total, ...invariant.parts, ...invariant.optionalParts];
    const presentFields = invariantFields.filter((field) => hasOwn(payload, field));
    if (presentFields.length === 0) continue;
    const mandatoryFields = [invariant.total, ...invariant.parts];
    if (mandatoryFields.some((field) => !hasOwn(payload, field))) {
      fail('count_invariant', event, invariant.total);
    }
    const total = payload[invariant.total];
    const requiredParts = invariant.parts.map((field) => payload[field]);
    if (typeof total !== 'number' || requiredParts.some((value) => typeof value !== 'number')) {
      fail('count_invariant', event, invariant.total);
    }
    const optionalParts = invariant.optionalParts.map((field) => payload[field]);
    if (optionalParts.some((value) => value !== undefined && typeof value !== 'number')) {
      fail('count_invariant', event, invariant.total);
    }
    const sum = [...requiredParts, ...optionalParts]
      .reduce<number>((accumulator, value) => accumulator + (typeof value === 'number' ? value : 0), 0);
    if (total !== sum) fail('count_invariant', event, invariant.total);
  }

  return { payload, level: outcomeDefinition.level };
}

function validateContext(
  catalog: EventCatalogDefinition,
  event: string,
  contextValue: unknown,
): Readonly<Record<string, unknown>> {
  const context = snapshotInputRecord(contextValue ?? {}, 'invalid_context', event);
  for (const field of Object.keys(context)) {
    if (!CONTEXT_FIELDS.has(field)) {
      if (isForbiddenField(field)) fail('forbidden_field', event, field);
      fail('extra_context_field', event, field);
    }
    const definition = catalog.commonFields[field];
    if (!definition) fail('undefined_context_field', event, field);
    validateField(definition, context[field], event, field);
  }
  return context;
}

export function createStructuredLogger<const C extends EventCatalogDefinition>(
  catalog: C,
  config: StructuredLoggerConfig,
) {
  const validatedCatalog = snapshotCatalog(catalog);
  validateCatalog(validatedCatalog);
  const serviceDefinition = validatedCatalog.commonFields.service;
  const environmentDefinition = validatedCatalog.commonFields.environment;
  if (!serviceDefinition || !environmentDefinition) fail('invalid_catalog', 'logger_config');
  const service = config.service;
  const environment = config.environment;
  const configuredClock = config.clock;
  const configuredSink = config.sink;
  validateField(serviceDefinition, service, 'logger_config', 'service');
  validateField(environmentDefinition, environment, 'logger_config', 'environment');
  const clock = configuredClock ?? (() => new Date());
  const sink = configuredSink ?? ((line: string) => console.log(line));

  const emitUnsafe = (
    event: string,
    outcome: string,
    payloadValue: unknown,
    contextValue: unknown = {},
  ): StructuredEvent => {
    const { payload, level } = validatePayload(validatedCatalog, event, outcome, payloadValue);
    const context = validateContext(validatedCatalog, event, contextValue);
    const now = clock();
    let epochMilliseconds: number;
    try {
      epochMilliseconds = Date.prototype.getTime.call(now);
    } catch {
      fail('invalid_clock', event, 'timestamp');
    }
    if (!Number.isFinite(epochMilliseconds)) fail('invalid_clock', event, 'timestamp');
    const timestamp = Date.prototype.toISOString.call(new Date(epochMilliseconds));
    const structuredEvent: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    structuredEvent.timestamp = timestamp;
    structuredEvent.schema_version = validatedCatalog.schemaVersion;
    structuredEvent.service = service;
    structuredEvent.environment = environment;
    structuredEvent.event = event;
    structuredEvent.outcome = outcome;
    structuredEvent.level = level;
    for (const [field, value] of Object.entries(context)) structuredEvent[field] = value;
    for (const [field, value] of Object.entries(payload)) structuredEvent[field] = value;
    const frozenEvent = Object.freeze(structuredEvent);
    sink(JSON.stringify(frozenEvent));
    return frozenEvent;
  };

  const emit = <
    E extends EventName<C>,
    O extends OutcomeName<C, E>,
    const P extends EventPayload<C, E, O>,
  >(
    event: E,
    outcome: O,
    payload: P & ExactPayloadInput<C, E, O, P> & CountInvariantInputs<C, E, O, P>,
    context: CorrelationContext = {},
  ): StructuredEvent => emitUnsafe(event, outcome, payload, context);

  return { emit, emitUnsafe } as const;
}
