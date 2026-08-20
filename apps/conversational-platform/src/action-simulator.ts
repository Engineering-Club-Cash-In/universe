import {
  FAKE_ACTION_ADAPTER_COMPATIBILITY_ID,
  SimulationActionRegistry,
  validateTypedRecordAgainstSchema,
  type ActionRegistry,
} from "./action-registry";
import { canonicalizeForHash, cloneAndFreeze, deepClone, hashCanonical, isSafeString } from "./canonical";
import { validateManifestIntegrity } from "./compiler";
import { RecordingEffectSink, type RecordedEffectEntry } from "./effect-sink";
import { resumeRun, startRun, type ResumeRunInput, type StartRunInput } from "./engine";
import {
  FakeTrustedClaimRepository,
  VersionedPolicyEngine,
  type AuthorizationDecisionInput,
} from "./policy-engine";
import type {
  ActionAdapterReference,
  CompiledExecuteActionStep,
  CompiledManifest,
  EffectResolution,
  EngineTransition,
  ExecuteActionCommand,
  ExecuteActionPayload,
  RunStateSnapshot,
  TypedValue,
} from "./types";

export type FakeActionObservation =
  | {
      readonly state: "CONFIRMED";
      readonly output: Readonly<Record<string, TypedValue>>;
      readonly businessResultCode?: string;
    }
  | {
      readonly state: "FAILED_PERMANENT" | "UNKNOWN" | "RECONCILING" | "MANUAL_REVIEW";
      readonly reason: string;
    };

export interface ExecuteActionAttempt {
  readonly executionAttemptId: string;
  readonly logicalEffectId: string;
  readonly actionKey: string;
  readonly actionVersion: string;
  readonly actionHash: string;
  readonly payloadHash: string;
  readonly input: Readonly<Record<string, TypedValue>>;
}

interface SimulationActionAdapter {
  readonly capabilityMode: "SIMULATION";
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly implementationCompatibilityId: "fake-action-adapter/v1";
  readonly adapterHash: string;
  execute(attempt: ExecuteActionAttempt): FakeActionObservation;
}

export interface FakeActionAdapterInput {
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly implementationCompatibilityId: "fake-action-adapter/v1";
  readonly adapterHash: string;
  readonly fixtures: readonly {
    readonly actionKey: string;
    readonly actionVersion: string;
    readonly observation: FakeActionObservation;
  }[];
}

export class FakeActionAdapter implements SimulationActionAdapter {
  readonly capabilityMode = "SIMULATION" as const;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly implementationCompatibilityId = FAKE_ACTION_ADAPTER_COMPATIBILITY_ID;
  readonly adapterHash: string;
  readonly #fixtures = new Map<string, FakeActionObservation>();
  readonly #recordedAttempts: ExecuteActionAttempt[] = [];

  static isAuthentic(value: unknown): value is FakeActionAdapter {
    return typeof value === "object"
      && value !== null
      && #fixtures in value
      && Object.getPrototypeOf(value) === FakeActionAdapter.prototype;
  }

  constructor(input: FakeActionAdapterInput) {
    this.adapterKey = input.adapterKey;
    this.adapterVersion = input.adapterVersion;
    this.adapterHash = input.adapterHash;
    const expectedHash = hashCanonical("action-adapter", {
      adapterKey: input.adapterKey,
      adapterVersion: input.adapterVersion,
      implementationCompatibilityId: input.implementationCompatibilityId,
    });
    if (input.implementationCompatibilityId !== FAKE_ACTION_ADAPTER_COMPATIBILITY_ID || input.adapterHash !== expectedHash) {
      throw new Error("Invalid fake adapter compatibility identity");
    }
    for (const fixture of input.fixtures) {
      if (!isFakeActionObservation(fixture.observation)) throw new Error("Invalid fake action observation");
      const key = actionKey(fixture.actionKey, fixture.actionVersion);
      if (this.#fixtures.has(key)) throw new Error(`Duplicate fake action fixture ${fixture.actionKey}@${fixture.actionVersion}`);
      this.#fixtures.set(key, cloneAndFreeze(deepClone(fixture.observation)));
    }
    Object.freeze(this);
  }

  execute(attempt: ExecuteActionAttempt): FakeActionObservation {
    const observation = this.#fixtures.get(actionKey(attempt.actionKey, attempt.actionVersion));
    if (observation === undefined) throw new Error(`Missing fake action fixture ${attempt.actionKey}@${attempt.actionVersion}`);
    this.#recordedAttempts.push(cloneAndFreeze(deepClone(attempt)));
    return cloneAndFreeze(deepClone(observation));
  }

  attempts(): readonly ExecuteActionAttempt[] {
    return this.#recordedAttempts.map((attempt) => cloneAndFreeze(deepClone(attempt)));
  }
}

export type SimulationDispatchResult =
  | { readonly kind: "TERMINAL"; readonly resolution: EffectResolution }
  | { readonly kind: "BLOCKED"; readonly ledgerState: "UNKNOWN" | "RECONCILING" | "MANUAL_REVIEW" }
  | { readonly kind: "REJECTED"; readonly reason: string }
  | { readonly kind: "PAYLOAD_HASH_CONFLICT"; readonly logicalEffectId: string };

export interface NetworkDenySimulatorInput {
  readonly actionRegistry: ActionRegistry;
  readonly policyEngine: VersionedPolicyEngine;
  readonly trustedClaimRepository: FakeTrustedClaimRepository;
  readonly actionAdapters: readonly SimulationActionAdapter[];
  readonly effectSink: RecordingEffectSink;
  readonly flowGrantId: string;
  readonly environment: "SIMULATION";
}

export class NetworkDenySimulator {
  readonly capabilityMode = "SIMULATION" as const;
  readonly networkMode = "DENY" as const;
  private readonly actionRegistry: ActionRegistry;
  private readonly policyEngine: VersionedPolicyEngine;
  private readonly trustedClaimRepository: FakeTrustedClaimRepository;
  private readonly actionAdapters: readonly SimulationActionAdapter[];
  private readonly effectSink: RecordingEffectSink;
  private readonly flowGrantId: string;
  private readonly environment: "SIMULATION";
  private readonly issuedEffects = new Map<string, string>();

  constructor(input: NetworkDenySimulatorInput) {
    const dependencies: readonly unknown[] = [input.actionRegistry, input.policyEngine, input.trustedClaimRepository, input.effectSink, ...input.actionAdapters];
    if (
      input.environment !== "SIMULATION"
      || !SimulationActionRegistry.isAuthentic(input.actionRegistry)
      || !VersionedPolicyEngine.isAuthentic(input.policyEngine)
      || !FakeTrustedClaimRepository.isAuthentic(input.trustedClaimRepository)
      || !RecordingEffectSink.isAuthentic(input.effectSink)
      || input.actionAdapters.some((adapter) => !FakeActionAdapter.isAuthentic(adapter))
      || input.trustedClaimRepository.ownership !== "SYSTEM"
      || dependencies.some((dependency) => !isSimulationDependency(dependency))
      || dependencies.some(hasSecretRef)
    ) {
      throw new Error("Invalid network-deny simulation dependency");
    }
    this.actionRegistry = input.actionRegistry;
    this.policyEngine = input.policyEngine;
    this.trustedClaimRepository = input.trustedClaimRepository;
    this.actionAdapters = Object.freeze([...input.actionAdapters]);
    this.effectSink = input.effectSink;
    this.flowGrantId = input.flowGrantId;
    this.environment = input.environment;
    Object.freeze(this);
  }

  start(input: StartRunInput): EngineTransition {
    const transition = startRun(input);
    this.rememberIssuedEffects(input.manifest, transition);
    return transition;
  }

  resume(input: ResumeRunInput): EngineTransition {
    const waitingStep = input.runState.currentStepId === null
      ? undefined
      : input.manifest.steps.find((step) => step.id === input.runState.currentStepId);
    if (input.runState.status === "WAITING_EFFECT" && waitingStep?.type === "execute_action") {
      const expected = expectedCommand(input.manifest, input.runState);
      const recorded = this.effectSink.effect(input.resolution.logicalEffectId)?.resolution;
      if (
        expected === undefined
        || this.issuedEffects.get(expected.logicalEffectId) !== issuedEffectHash(input.manifest, input.runState, expected)
        || recorded === undefined
        || canonicalizeForHash(recorded) !== canonicalizeForHash(input.resolution)
      ) {
        return invalidResumeTransition(input.runState, "effect resolution not recorded by simulation sink");
      }
    }
    const transition = resumeRun(input);
    if (transition.nextRunState.consumedContinuations[input.resolution.effectContinuationId] !== undefined) {
      this.issuedEffects.delete(input.resolution.logicalEffectId);
    }
    this.rememberIssuedEffects(input.manifest, transition);
    return transition;
  }

  dispatch(input: {
    readonly manifest: CompiledManifest;
    readonly runState: RunStateSnapshot;
    readonly command: ExecuteActionCommand;
    readonly now: string;
  }): SimulationDispatchResult {
    const integrity = validateManifestIntegrity(input.manifest);
    if (!integrity.ok) return rejected("MANIFEST_INTEGRITY_FAILED");
    if (!isCanonicalTimestamp(input.now)) return rejected("INVALID_EVALUATION_TIME");
    if (!isExecuteActionCommandShape(input.command)) return rejected("INVALID_COMMAND_DTO");

    const existing = this.effectSink.effect(input.command.logicalEffectId);
    if (existing !== undefined && existing.payloadHash !== input.command.payloadHash) {
      return cloneAndFreeze({ kind: "PAYLOAD_HASH_CONFLICT", logicalEffectId: input.command.logicalEffectId });
    }

    const expected = expectedCommand(input.manifest, input.runState);
    if (expected === undefined || canonicalizeForHash(expected) !== canonicalizeForHash(input.command)) return rejected("COMMAND_MANIFEST_MISMATCH");
    if (existing !== undefined) return resultFromEntry(existing);
    const issued = this.issuedEffects.get(input.command.logicalEffectId);
    if (issued !== issuedEffectHash(input.manifest, input.runState, input.command)) return rejected("RUN_STATE_NOT_ISSUED_BY_SIMULATOR");

    const descriptor = input.manifest.actionDescriptors.find(
      (candidate) => candidate.actionKey === input.command.actionRef.actionKey && candidate.actionVersion === input.command.actionRef.actionVersion,
    );
    const registered = this.actionRegistry.resolve(input.command.actionRef.actionKey, input.command.actionRef.actionVersion);
    if (descriptor === undefined || registered === undefined || registered.actionHash !== descriptor.actionHash) return rejected("ACTION_DEPENDENCY_MISMATCH");

    const adapter = this.actionAdapters.find((candidate) => adapterMatches(candidate, descriptor.adapter));
    if (adapter === undefined) return rejected("ACTION_ADAPTER_MISSING");

    const accepted = this.effectSink.acceptEffect(input.command);
    if (accepted !== "INSERTED") return accepted === "PAYLOAD_HASH_CONFLICT"
      ? cloneAndFreeze({ kind: "PAYLOAD_HASH_CONFLICT", logicalEffectId: input.command.logicalEffectId })
      : resultFromEntry(this.effectSink.effect(input.command.logicalEffectId)!);

    const loadedClaims = this.trustedClaimRepository.loadForDispatch(input.command.payload.subjectId, input.command.payload.conversationId);
    const decisionInput: AuthorizationDecisionInput = {
      logicalEffectId: input.command.logicalEffectId,
      manifestHash: input.manifest.manifestHash,
      actionRef: deepClone(input.command.actionRef),
      flowGrantId: this.flowGrantId,
      environment: this.environment,
      purpose: descriptor.purpose,
      trustedClaims: deepClone(loadedClaims.claims),
      dataClasses: deepClone(descriptor.dataClasses),
      subjectId: input.command.payload.subjectId,
      conversationId: input.command.payload.conversationId,
      evaluatedAt: input.now,
    };
    const decision = this.policyEngine.evaluate(descriptor.policy, decisionInput);
    this.effectSink.recordPolicy(input.command.logicalEffectId, decision, loadedClaims.generation);
    if (decision.decision === "DENY") {
      const resolution = terminalResolution(input.command, "DENIED");
      this.effectSink.recordResult(input.command.logicalEffectId, "DENIED", resolution);
      return cloneAndFreeze({ kind: "TERMINAL", resolution });
    }

    const executionAttemptId = hashCanonical("execution-attempt", {
      logicalEffectId: input.command.logicalEffectId,
      attemptOrdinal: 1,
      adapter: descriptor.adapter,
    });
    let observation: FakeActionObservation;
    try {
      observation = adapter.execute({
        executionAttemptId,
        logicalEffectId: input.command.logicalEffectId,
        actionKey: descriptor.actionKey,
        actionVersion: descriptor.actionVersion,
        actionHash: descriptor.actionHash,
        payloadHash: input.command.payloadHash,
        input: deepClone(input.command.payload.input),
      });
    } catch (_caught) {
      this.effectSink.recordAttempt(input.command.logicalEffectId, {
        executionAttemptId,
        observation: { state: "MANUAL_REVIEW", reason: "FAKE_ADAPTER_EXECUTION_ERROR" },
      });
      this.effectSink.recordResult(input.command.logicalEffectId, "MANUAL_REVIEW");
      return cloneAndFreeze({ kind: "BLOCKED", ledgerState: "MANUAL_REVIEW" });
    }
    this.effectSink.recordAttempt(input.command.logicalEffectId, {
      executionAttemptId,
      observation: deepClone(observation),
    });
    return this.applyObservation(input.command, descriptor.outputSchema, descriptor.businessResultCodes, observation);
  }

  private rememberIssuedEffects(manifest: CompiledManifest, transition: EngineTransition): void {
    for (const command of transition.commands) {
      if (command.kind === "EXECUTE_ACTION") {
        this.issuedEffects.set(command.logicalEffectId, issuedEffectHash(manifest, transition.nextRunState, command));
      }
    }
  }

  private applyObservation(
    command: ExecuteActionCommand,
    outputSchema: CompiledManifest["actionDescriptors"][number]["outputSchema"],
    businessResultCodes: readonly string[],
    observation: FakeActionObservation,
  ): SimulationDispatchResult {
    switch (observation.state) {
      case "CONFIRMED": {
        const validBusinessResult = observation.businessResultCode === undefined || businessResultCodes.includes(observation.businessResultCode);
        const ledgerState = validateTypedRecordAgainstSchema(observation.output, outputSchema) && validBusinessResult ? "CONFIRMED" : "FAILED_PERMANENT";
        const resolution = ledgerState === "CONFIRMED" && observation.businessResultCode !== undefined
          ? terminalResolution(command, ledgerState, observation.businessResultCode)
          : terminalResolution(command, ledgerState);
        this.effectSink.recordResult(command.logicalEffectId, ledgerState, resolution);
        return cloneAndFreeze({ kind: "TERMINAL", resolution });
      }
      case "FAILED_PERMANENT": {
        const resolution = terminalResolution(command, "FAILED_PERMANENT");
        this.effectSink.recordResult(command.logicalEffectId, "FAILED_PERMANENT", resolution);
        return cloneAndFreeze({ kind: "TERMINAL", resolution });
      }
      case "UNKNOWN":
      case "RECONCILING":
      case "MANUAL_REVIEW":
        this.effectSink.recordResult(command.logicalEffectId, observation.state);
        return cloneAndFreeze({ kind: "BLOCKED", ledgerState: observation.state });
    }
  }
}

function expectedCommand(manifest: CompiledManifest, runState: RunStateSnapshot): ExecuteActionCommand | undefined {
  if (runState.manifestHash !== manifest.manifestHash || runState.status !== "WAITING_EFFECT" || runState.waitingContinuation === undefined || runState.currentStepId === null) return undefined;
  const step = manifest.steps.find((candidate): candidate is CompiledExecuteActionStep => candidate.id === runState.currentStepId && candidate.type === "execute_action");
  if (step === undefined) return undefined;
  const descriptor = manifest.actionDescriptors.find((candidate) => candidate.actionKey === step.actionRef.actionKey && candidate.actionVersion === step.actionRef.actionVersion);
  if (descriptor === undefined) return undefined;
  const payload: ExecuteActionPayload = {
    subjectId: step.subjectId,
    conversationId: step.conversationId,
    input: deepClone(step.input),
    purpose: descriptor.purpose,
    dataClasses: deepClone(descriptor.dataClasses),
  };
  const commandOrdinal = 0;
  const logicalEffectId = hashCanonical("logical-effect", { flowRunId: runState.runId, stepId: step.id, activationOrdinal: runState.activationOrdinal, commandKind: "EXECUTE_ACTION", commandOrdinal });
  const effectContinuationId = hashCanonical("effect-continuation", { flowRunId: runState.runId, stepId: step.id, activationOrdinal: runState.activationOrdinal, commandOrdinal });
  const payloadHash = hashCanonical("payload", { kind: "EXECUTE_ACTION", payload });
  if (
    runState.waitingContinuation.awaitedLogicalEffectId !== logicalEffectId
    || runState.waitingContinuation.effectContinuationId !== effectContinuationId
    || runState.waitingContinuation.expectedPayloadHash !== payloadHash
  ) return undefined;
  return cloneAndFreeze({
    kind: "EXECUTE_ACTION",
    blocking: true,
    completionMode: "ON_EFFECT_TERMINAL",
    logicalEffectId,
    effectContinuationId,
    commandOrdinal,
    activationOrdinal: runState.activationOrdinal,
    stepId: step.id,
    actionRef: deepClone(step.actionRef),
    retryPolicy: deepClone(descriptor.retryPolicy),
    reconcileMode: descriptor.reconcileMode,
    effectGuarantee: descriptor.effectGuarantee,
    payload,
    payloadHash,
    outcomeMappingVersion: step.outcomeMappingVersion,
    outcomeMappingHash: step.outcomeMappingHash,
    businessResultCodes: deepClone(step.businessResultCodes),
  });
}

function terminalResolution(command: ExecuteActionCommand, ledgerState: "CONFIRMED" | "DENIED" | "FAILED_PERMANENT", businessResultCode?: string): EffectResolution {
  const base = {
    effectContinuationId: command.effectContinuationId,
    logicalEffectId: command.logicalEffectId,
    payloadHash: command.payloadHash,
    ledgerState,
  };
  return businessResultCode === undefined ? cloneAndFreeze(base) : cloneAndFreeze({ ...base, businessResultCode });
}

function resultFromEntry(entry: RecordedEffectEntry): SimulationDispatchResult {
  if (entry.resolution !== undefined) return cloneAndFreeze({ kind: "TERMINAL", resolution: entry.resolution });
  if (entry.state === "UNKNOWN" || entry.state === "RECONCILING" || entry.state === "MANUAL_REVIEW") return cloneAndFreeze({ kind: "BLOCKED", ledgerState: entry.state });
  return rejected("EFFECT_NOT_RESOLVED");
}

function isExecuteActionCommandShape(value: unknown): value is ExecuteActionCommand {
  if (!isRecord(value) || !hasExactKeys(value, [
    "actionRef",
    "activationOrdinal",
    "blocking",
    "businessResultCodes",
    "commandOrdinal",
    "completionMode",
    "effectContinuationId",
    "effectGuarantee",
    "kind",
    "logicalEffectId",
    "outcomeMappingHash",
    "outcomeMappingVersion",
    "payload",
    "payloadHash",
    "reconcileMode",
    "retryPolicy",
    "stepId",
  ])) return false;
  if (value.kind !== "EXECUTE_ACTION" || value.blocking !== true || value.completionMode !== "ON_EFFECT_TERMINAL" || value.commandOrdinal !== 0) return false;
  if (!isRecord(value.payload) || !hasExactKeys(value.payload, ["conversationId", "dataClasses", "input", "purpose", "subjectId"])) return false;
  if (!isRecord(value.actionRef) || !isRecord(value.retryPolicy) || !Array.isArray(value.businessResultCodes) || !Array.isArray(value.payload.dataClasses) || !isRecord(value.payload.input)) return false;
  if (!Number.isSafeInteger(value.activationOrdinal) || Number(value.activationOrdinal) < 1) return false;
  if (typeof value.payloadHash !== "string" || value.payloadHash !== hashCanonical("payload", { kind: "EXECUTE_ACTION", payload: value.payload })) return false;
  return true;
}

function isFakeActionObservation(value: unknown): value is FakeActionObservation {
  if (!isRecord(value)) return false;
  switch (value.state) {
    case "CONFIRMED": {
      const expectedKeys = value.businessResultCode === undefined
        ? ["output", "state"]
        : ["businessResultCode", "output", "state"];
      if (!hasExactKeys(value, expectedKeys) || !isRecord(value.output)) return false;
      if (value.businessResultCode !== undefined && (typeof value.businessResultCode !== "string" || value.businessResultCode.length === 0 || !isSafeString(value.businessResultCode))) return false;
      return Object.entries(value.output).every(([key, item]) => key.length > 0 && isSafeString(key) && isTypedValueShape(item));
    }
    case "FAILED_PERMANENT":
    case "UNKNOWN":
    case "RECONCILING":
    case "MANUAL_REVIEW":
      return hasExactKeys(value, ["reason", "state"]) && typeof value.reason === "string" && value.reason.length > 0 && isSafeString(value.reason);
    default:
      return false;
  }
}

function isTypedValueShape(value: unknown): value is TypedValue {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "value"])) return false;
  switch (value.type) {
    case "string": return typeof value.value === "string" && isSafeString(value.value);
    case "number": return typeof value.value === "number" && Number.isFinite(value.value);
    case "boolean": return typeof value.value === "boolean";
    case "null": return value.value === null;
    default: return false;
  }
}

function adapterMatches(adapter: SimulationActionAdapter, reference: ActionAdapterReference): boolean {
  return adapter.adapterKey === reference.adapterKey
    && adapter.adapterVersion === reference.adapterVersion
    && adapter.implementationCompatibilityId === reference.implementationCompatibilityId
    && adapter.adapterHash === reference.adapterHash;
}

function issuedEffectHash(manifest: CompiledManifest, runState: RunStateSnapshot, command: ExecuteActionCommand): string {
  return hashCanonical("simulation-issued-effect", {
    manifestHash: manifest.manifestHash,
    runState,
    command,
  });
}

function invalidResumeTransition(runState: RunStateSnapshot, reason: string): EngineTransition {
  return cloneAndFreeze({
    nextRunState: deepClone(runState),
    commands: [],
    auditFacts: [],
    errors: [{ code: "INVALID_RESOLUTION", details: { reason } }],
  });
}

function isSimulationDependency(value: unknown): value is { readonly capabilityMode: "SIMULATION" } {
  return typeof value === "object" && value !== null && "capabilityMode" in value && value.capabilityMode === "SIMULATION";
}

function hasSecretRef(value: unknown): boolean {
  return typeof value === "object" && value !== null && Object.prototype.hasOwnProperty.call(value, "secretRef");
}

function rejected(reason: string): SimulationDispatchResult {
  return cloneAndFreeze({ kind: "REJECTED", reason });
}

function actionKey(key: string, version: string): string {
  return `${key}\u0000${version}`;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !isSafeString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
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
