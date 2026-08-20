import { cloneAndFreeze, deepClone, hashCanonical, isReservedName, isSafeString } from "./canonical";
import type {
  ActionDescriptor,
  ActionPolicyReference,
  ActionSchema,
  EffectGuarantee,
  ReconcileMode,
  TypedValue,
} from "./types";

export interface CreateActionDescriptorInput {
  readonly actionKey: string;
  readonly actionVersion: string;
  readonly inputSchema: ActionSchema;
  readonly outputSchema: ActionSchema;
  readonly sensitivity: ActionDescriptor["sensitivity"];
  readonly purpose: string;
  readonly dataClasses: readonly string[];
  readonly retryPolicy: {
    readonly retryPolicyKey: string;
    readonly retryPolicyVersion: string;
    readonly maxAttempts: number;
  };
  readonly reconcileMode: ReconcileMode;
  readonly effectGuarantee: EffectGuarantee;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly policy: ActionPolicyReference;
  readonly businessResultCodes: readonly string[];
}

export interface ActionRegistry {
  readonly capabilityMode: "SIMULATION";
  resolve(actionKey: string, actionVersion: string): ActionDescriptor | undefined;
}

export const FAKE_ACTION_ADAPTER_COMPATIBILITY_ID = "fake-action-adapter/v1" as const;

export function createActionDescriptor(input: CreateActionDescriptorInput): ActionDescriptor {
  assertIdentifier(input.actionKey, "actionKey");
  assertVersion(input.actionVersion, "actionVersion");
  assertSchema(input.inputSchema, "inputSchema");
  assertSchema(input.outputSchema, "outputSchema");
  if (input.sensitivity !== "NON_SENSITIVE" && input.sensitivity !== "SENSITIVE" && input.sensitivity !== "PRIVILEGED") throw new Error("Invalid sensitivity");
  assertIdentifier(input.purpose, "purpose");
  assertIdentifiers(input.dataClasses, "dataClasses");
  assertIdentifier(input.retryPolicy.retryPolicyKey, "retryPolicyKey");
  assertVersion(input.retryPolicy.retryPolicyVersion, "retryPolicyVersion");
  if (!Number.isSafeInteger(input.retryPolicy.maxAttempts) || input.retryPolicy.maxAttempts < 1) {
    throw new Error("Invalid maxAttempts");
  }
  assertIdentifier(input.adapterKey, "adapterKey");
  assertVersion(input.adapterVersion, "adapterVersion");
  assertIdentifier(input.policy.policyKey, "policyKey");
  assertVersion(input.policy.policyVersion, "policyVersion");
  assertHash(input.policy.policyHash, "policyHash");
  assertIdentifiers(input.businessResultCodes, "businessResultCodes");
  if (input.reconcileMode !== "READ_ONLY" && input.reconcileMode !== "WEBHOOK_ONLY" && input.reconcileMode !== "MUTATING") throw new Error("Invalid reconcileMode");
  if (!["RECEIVER_DEDUP", "RECONCILABLE", "AT_LEAST_ONCE", "AT_MOST_ONCE", "MANUAL_ON_AMBIGUITY"].includes(input.effectGuarantee)) throw new Error("Invalid effectGuarantee");

  const inputSchema = normalizeSchema(input.inputSchema);
  const outputSchema = normalizeSchema(input.outputSchema);
  const adapter = {
    adapterKey: input.adapterKey,
    adapterVersion: input.adapterVersion,
    implementationCompatibilityId: FAKE_ACTION_ADAPTER_COMPATIBILITY_ID,
    adapterHash: hashCanonical("action-adapter", {
      adapterKey: input.adapterKey,
      adapterVersion: input.adapterVersion,
      implementationCompatibilityId: FAKE_ACTION_ADAPTER_COMPATIBILITY_ID,
    }),
  };
  const retryPolicy = {
    retryPolicyKey: input.retryPolicy.retryPolicyKey,
    retryPolicyVersion: input.retryPolicy.retryPolicyVersion,
    retryPolicyHash: hashCanonical("action-retry-policy", input.retryPolicy),
    maxAttempts: input.retryPolicy.maxAttempts,
  };
  const withoutHash = {
    descriptorVersion: "action-descriptor/v1" as const,
    actionKey: input.actionKey,
    actionVersion: input.actionVersion,
    inputSchema,
    inputSchemaHash: hashCanonical("action-input-schema", inputSchema),
    outputSchema,
    outputSchemaHash: hashCanonical("action-output-schema", outputSchema),
    sensitivity: input.sensitivity,
    purpose: input.purpose,
    dataClasses: uniqueSorted(input.dataClasses),
    retryPolicy,
    reconcileMode: input.reconcileMode,
    effectGuarantee: input.effectGuarantee,
    adapter,
    policy: deepClone(input.policy),
    businessResultCodes: uniqueSorted(input.businessResultCodes),
  };
  return cloneAndFreeze({ ...withoutHash, actionHash: hashCanonical("action-descriptor", withoutHash) });
}

export class SimulationActionRegistry implements ActionRegistry {
  readonly capabilityMode = "SIMULATION" as const;
  readonly #descriptors = new Map<string, ActionDescriptor>();

  static isAuthentic(value: unknown): value is SimulationActionRegistry {
    return typeof value === "object"
      && value !== null
      && #descriptors in value
      && Object.getPrototypeOf(value) === SimulationActionRegistry.prototype;
  }

  constructor(descriptors: readonly ActionDescriptor[]) {
    for (const descriptor of descriptors) {
      if (!validateActionDescriptorIntegrity(descriptor)) {
        throw new Error("Invalid action descriptor");
      }
      const key = registryKey(descriptor.actionKey, descriptor.actionVersion);
      const existing = this.#descriptors.get(key);
      if (existing !== undefined && existing.actionHash !== descriptor.actionHash) {
        throw new Error(`Action immutable descriptor conflict for ${descriptor.actionKey}@${descriptor.actionVersion}`);
      }
      this.#descriptors.set(key, cloneAndFreeze(deepClone(descriptor)));
    }
    Object.freeze(this);
  }

  resolve(actionKey: string, actionVersion: string): ActionDescriptor | undefined {
    if (actionVersion === "latest") return undefined;
    const descriptor = this.#descriptors.get(registryKey(actionKey, actionVersion));
    return descriptor === undefined ? undefined : cloneAndFreeze(deepClone(descriptor));
  }
}

export function validateActionDescriptorIntegrity(value: unknown): value is ActionDescriptor {
  if (!isRecord(value) || !hasExactKeys(value, [
    "actionHash",
    "actionKey",
    "actionVersion",
    "adapter",
    "businessResultCodes",
    "dataClasses",
    "descriptorVersion",
    "effectGuarantee",
    "inputSchema",
    "inputSchemaHash",
    "outputSchema",
    "outputSchemaHash",
    "policy",
    "purpose",
    "reconcileMode",
    "retryPolicy",
    "sensitivity",
  ])) return false;
  if (value.descriptorVersion !== "action-descriptor/v1" || !isIdentifier(value.actionKey) || !isVersion(value.actionVersion) || value.actionVersion === "latest") return false;
  if (!isActionSchema(value.inputSchema) || !isActionSchema(value.outputSchema)) return false;
  if (value.inputSchemaHash !== hashCanonical("action-input-schema", value.inputSchema) || value.outputSchemaHash !== hashCanonical("action-output-schema", value.outputSchema)) return false;
  if (value.sensitivity !== "NON_SENSITIVE" && value.sensitivity !== "SENSITIVE" && value.sensitivity !== "PRIVILEGED") return false;
  if (!isIdentifier(value.purpose) || !isSortedUniqueIdentifierArray(value.dataClasses) || !isSortedUniqueIdentifierArray(value.businessResultCodes)) return false;
  if (value.reconcileMode !== "READ_ONLY" && value.reconcileMode !== "WEBHOOK_ONLY" && value.reconcileMode !== "MUTATING") return false;
  if (!["RECEIVER_DEDUP", "RECONCILABLE", "AT_LEAST_ONCE", "AT_MOST_ONCE", "MANUAL_ON_AMBIGUITY"].includes(String(value.effectGuarantee))) return false;
  if (!isAdapter(value.adapter) || !isPolicyReference(value.policy) || !isRetryPolicy(value.retryPolicy)) return false;
  const { actionHash: _actionHash, ...withoutHash } = value;
  return value.actionHash === hashCanonical("action-descriptor", withoutHash);
}

export function validateTypedRecordAgainstSchema(value: unknown, schema: ActionSchema): value is Readonly<Record<string, TypedValue>> {
  if (!isRecord(value) || !isActionSchema(schema)) return false;
  const fields = new Map(schema.fields.map((field) => [field.name, field]));
  for (const field of schema.fields) {
    const candidate = value[field.name];
    if (candidate === undefined) {
      if (field.required) return false;
      continue;
    }
    if (!isTypedValue(candidate) || candidate.type !== field.type) return false;
  }
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) return false;
  }
  return true;
}

function normalizeSchema(schema: ActionSchema): ActionSchema {
  return cloneAndFreeze({
    schemaVersion: "typed-record/v1",
    fields: [...schema.fields]
      .map((field) => ({ name: field.name, type: field.type, required: field.required }))
      .sort((left, right) => compareStrings(left.name, right.name)),
    additionalProperties: false,
  });
}

function assertSchema(schema: ActionSchema, field: string): void {
  if (!isActionSchema(schema)) throw new Error(`Invalid ${field}`);
}

function isActionSchema(value: unknown): value is ActionSchema {
  if (!isRecord(value) || !hasExactKeys(value, ["additionalProperties", "fields", "schemaVersion"])) return false;
  if (value.schemaVersion !== "typed-record/v1" || value.additionalProperties !== false || !Array.isArray(value.fields)) return false;
  const names = new Set<string>();
  const orderedNames: string[] = [];
  for (const field of value.fields) {
    if (!isRecord(field) || !hasExactKeys(field, ["name", "required", "type"]) || !isIdentifier(field.name) || typeof field.required !== "boolean" || !isValueType(field.type)) return false;
    if (names.has(field.name)) return false;
    names.add(field.name);
    orderedNames.push(field.name);
  }
  return orderedNames.every((name, index) => index === 0 || compareStrings(orderedNames[index - 1]!, name) < 0);
}

function isAdapter(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["adapterHash", "adapterKey", "adapterVersion", "implementationCompatibilityId"])
    && isIdentifier(value.adapterKey)
    && isVersion(value.adapterVersion)
    && value.adapterVersion !== "latest"
    && value.implementationCompatibilityId === FAKE_ACTION_ADAPTER_COMPATIBILITY_ID
    && value.adapterHash === hashCanonical("action-adapter", {
      adapterKey: value.adapterKey,
      adapterVersion: value.adapterVersion,
      implementationCompatibilityId: value.implementationCompatibilityId,
    });
}

function isPolicyReference(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ["policyHash", "policyKey", "policyVersion"])
    && isIdentifier(value.policyKey)
    && isVersion(value.policyVersion)
    && value.policyVersion !== "latest"
    && isHash(value.policyHash);
}

function isRetryPolicy(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["maxAttempts", "retryPolicyHash", "retryPolicyKey", "retryPolicyVersion"])) return false;
  if (!isIdentifier(value.retryPolicyKey) || !isVersion(value.retryPolicyVersion) || value.retryPolicyVersion === "latest" || !Number.isSafeInteger(value.maxAttempts) || Number(value.maxAttempts) < 1) return false;
  return value.retryPolicyHash === hashCanonical("action-retry-policy", {
    retryPolicyKey: value.retryPolicyKey,
    retryPolicyVersion: value.retryPolicyVersion,
    maxAttempts: value.maxAttempts,
  });
}

function isTypedValue(value: unknown): value is TypedValue {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "value"])) return false;
  switch (value.type) {
    case "string": return typeof value.value === "string" && isSafeString(value.value);
    case "number": return typeof value.value === "number" && Number.isFinite(value.value);
    case "boolean": return typeof value.value === "boolean";
    case "null": return value.value === null;
    default: return false;
  }
}

function assertIdentifier(value: string, field: string): void {
  if (!isIdentifier(value)) throw new Error(`Invalid ${field}`);
}

function assertVersion(value: string, field: string): void {
  if (!isVersion(value) || value === "latest") throw new Error(`Invalid ${field}`);
}

function assertIdentifiers(values: readonly string[], field: string): void {
  if (!isUniqueIdentifierArray(uniqueSorted(values)) || new Set(values).size !== values.length) throw new Error(`Invalid ${field}`);
}

function assertHash(value: string, field: string): void {
  if (!isHash(value)) throw new Error(`Invalid ${field}`);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && isSafeString(value) && !isReservedName(value);
}

function isVersion(value: unknown): value is string {
  return isIdentifier(value);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isUniqueIdentifierArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isIdentifier) && new Set(value).size === value.length;
}

function isSortedUniqueIdentifierArray(value: unknown): value is readonly string[] {
  return isUniqueIdentifierArray(value) && value.every((item, index) => index === 0 || compareStrings(value[index - 1]!, item) < 0);
}

function isValueType(value: unknown): value is TypedValue["type"] {
  return value === "string" || value === "number" || value === "boolean" || value === "null";
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function registryKey(actionKey: string, actionVersion: string): string {
  return `${actionKey}\u0000${actionVersion}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
