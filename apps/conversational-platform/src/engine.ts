import { cloneAndFreeze, cloneCanonicalValue, deepClone, hashCanonical, isReservedName, isSafeString } from "./canonical";
import { validateManifestIntegrity } from "./compiler";
import { resolveOutcomeMapper } from "./outcome-mapping";
import type {
  AuditFact,
  CompiledManifest,
  CompiledStep,
  EffectResolution,
  EngineCommand,
  EngineError,
  EngineTransition,
  ExpressionAst,
  RunStateSnapshot,
  SendMessagePayload,
  TypedValue,
} from "./types";

export interface StartRunInput {
  readonly manifest: CompiledManifest;
  readonly runId: string;
  readonly initialVariables?: Readonly<Record<string, TypedValue>>;
  readonly transitionBudget: number;
}

export interface ResumeRunInput {
  readonly manifest: CompiledManifest;
  readonly runState: RunStateSnapshot;
  readonly resolution: EffectResolution;
  readonly transitionBudget: number;
}

interface ExecutionAccumulator {
  readonly commands: EngineCommand[];
  readonly auditFacts: AuditFact[];
  readonly errors: EngineError[];
}

interface ExpressionResult {
  readonly ok: boolean;
  readonly value?: TypedValue;
  readonly error?: EngineError;
}

const SHA256_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ENGINE_ERROR_CODES = new Set<EngineError["code"]>([
  "INVALID_TRANSITION_BUDGET",
  "MANIFEST_MISMATCH",
  "MANIFEST_INTEGRITY_FAILED",
  "INVALID_RUN_STATE",
  "INVALID_RESOLUTION",
  "ACTIVATION_ORDINAL_OVERFLOW",
  "TRANSITION_BUDGET_EXCEEDED",
  "STEP_NOT_FOUND",
  "EXPRESSION_EVALUATION_FAILED",
  "NO_CONDITION_BRANCH_MATCHED",
  "NON_CONSUMABLE_EFFECT_STATE",
  "RUN_NOT_WAITING_EFFECT",
  "CONTINUATION_MISMATCH",
  "CONSUMED_CONTINUATION_CONFLICT",
  "OUTCOME_MAPPER_NOT_FOUND",
]);

export function startRun(input: StartRunInput): EngineTransition {
  const baseState = quarantineStartState(input.manifest, input.runId);
  const manifestValidation = validateManifestIntegrity(input.manifest);
  if (!manifestValidation.ok) {
    return transition(baseState, [], [], [engineError("MANIFEST_INTEGRITY_FAILED", { reasons: manifestValidation.errors.join(",") })]);
  }
  if (!isValidBudget(input.transitionBudget)) {
    return transition(baseState, [], [], [engineError("INVALID_TRANSITION_BUDGET", { transitionBudget: String(input.transitionBudget) })]);
  }
  if (!isSafeString(input.runId) || input.runId.length === 0) {
    return transition(baseState, [], [], [engineError("INVALID_RUN_STATE", { field: "runId" })]);
  }
  if (!isValidVariables(input.initialVariables ?? {})) {
    return transition(baseState, [], [], [engineError("INVALID_RUN_STATE", { field: "initialVariables" })]);
  }

  const state: RunStateSnapshot = cloneAndFreeze({
    runId: input.runId,
    manifestHash: input.manifest.manifestHash,
    status: "RUNNING",
    currentStepId: input.manifest.entryStepId,
    variables: cloneVariables(input.initialVariables ?? {}),
    activationOrdinal: 0,
    consumedContinuations: {},
  });
  const accumulator: ExecutionAccumulator = {
    commands: [],
    auditFacts: [{ type: "RUN_STARTED", details: { runId: input.runId, manifestHash: input.manifest.manifestHash } }],
    errors: [],
  };

  return continueRun(input.manifest, state, input.transitionBudget, accumulator);
}

export function resumeRun(input: ResumeRunInput): EngineTransition {
  const fallbackState = safeReturnState(input.runState, input.manifest);
  const manifestValidation = validateManifestIntegrity(input.manifest);
  if (!manifestValidation.ok) {
    return transition(fallbackState, [], [], [engineError("MANIFEST_INTEGRITY_FAILED", { reasons: manifestValidation.errors.join(",") })]);
  }
  if (!isRecord(input.runState)) {
    return transition(fallbackState, [], [], [engineError("INVALID_RUN_STATE", { reasons: "not-object" })]);
  }
  if (input.runState.manifestHash !== input.manifest.manifestHash) {
    return transition(fallbackState, [], [], [engineError("MANIFEST_MISMATCH", { runManifestHash: String(input.runState.manifestHash), manifestHash: input.manifest.manifestHash })]);
  }
  if (!isValidBudget(input.transitionBudget)) {
    return transition(fallbackState, [], [], [engineError("INVALID_TRANSITION_BUDGET", { transitionBudget: String(input.transitionBudget) })]);
  }
  const stateValidation = validateRunState(input.runState, input.manifest);
  if (!stateValidation.ok) {
    return transition(fallbackState, [], [], [engineError("INVALID_RUN_STATE", { reasons: stateValidation.reasons.join(",") })]);
  }
  if (!isValidResolution(input.resolution)) {
    return transition(fallbackState, [], [], [engineError("INVALID_RESOLUTION", { reason: "invalid resolution" })]);
  }

  const mapper = resolveOutcomeMapper(input.manifest.outcomeMappingVersion, input.manifest.outcomeMappingHash);
  if (mapper === undefined) {
    return transition(fallbackState, [], [], [engineError("OUTCOME_MAPPER_NOT_FOUND", { version: input.manifest.outcomeMappingVersion })]);
  }

  const consumed = input.runState.consumedContinuations[input.resolution.effectContinuationId];
  if (consumed !== undefined) {
    const outcome = mapper.map(input.resolution.ledgerState);
    if (
      consumed.logicalEffectId === input.resolution.logicalEffectId &&
      consumed.payloadHash === input.resolution.payloadHash &&
      consumed.ledgerState === input.resolution.ledgerState &&
      outcome === consumed.outcome
    ) {
      return transition(
        fallbackState,
        [],
        [{ type: "CONTINUATION_ALREADY_CONSUMED", details: { effectContinuationId: input.resolution.effectContinuationId, outcome: consumed.outcome } }],
        [],
      );
    }
    return transition(fallbackState, [], [], [engineError("CONSUMED_CONTINUATION_CONFLICT", { effectContinuationId: input.resolution.effectContinuationId })]);
  }

  if (input.runState.status !== "WAITING_EFFECT" || input.runState.waitingContinuation === undefined) {
    const hasConsumedContinuations = Object.keys(input.runState.consumedContinuations).length > 0;
    return transition(
      fallbackState,
      [],
      [],
      [engineError(hasConsumedContinuations ? "CONTINUATION_MISMATCH" : "RUN_NOT_WAITING_EFFECT", { status: input.runState.status })],
    );
  }

  const continuation = input.runState.waitingContinuation;
  if (
    continuation.effectContinuationId !== input.resolution.effectContinuationId ||
    continuation.awaitedLogicalEffectId !== input.resolution.logicalEffectId ||
    continuation.expectedPayloadHash !== input.resolution.payloadHash ||
    continuation.outcomeMappingVersion !== mapper.version ||
    continuation.outcomeMappingHash !== mapper.hash
  ) {
    return transition(fallbackState, [], [], [engineError("CONTINUATION_MISMATCH", { effectContinuationId: input.resolution.effectContinuationId })]);
  }

  const outcome = mapper.map(input.resolution.ledgerState);
  if (outcome === undefined || !isConsumableLedgerState(input.resolution.ledgerState)) {
    return transition(fallbackState, [], [], [engineError("NON_CONSUMABLE_EFFECT_STATE", { ledgerState: input.resolution.ledgerState })]);
  }

  const nextStepId = continuation.terminalOutcomeTransitions[outcome];
  const consumedContinuations = {
    ...cloneConsumedContinuations(input.runState.consumedContinuations),
    [continuation.effectContinuationId]: {
      outcome,
      ledgerState: input.resolution.ledgerState,
      logicalEffectId: input.resolution.logicalEffectId,
      payloadHash: input.resolution.payloadHash,
    },
  };
  const resumedState: RunStateSnapshot = cloneAndFreeze({
    runId: input.runState.runId,
    manifestHash: input.runState.manifestHash,
    status: "RUNNING",
    currentStepId: nextStepId,
    variables: cloneVariables(input.runState.variables),
    activationOrdinal: input.runState.activationOrdinal,
    consumedContinuations,
  });
  const accumulator: ExecutionAccumulator = {
    commands: [],
    auditFacts: [{ type: "CONTINUATION_CONSUMED", details: { effectContinuationId: continuation.effectContinuationId, outcome } }],
    errors: [],
  };

  return continueRun(input.manifest, resumedState, input.transitionBudget, accumulator);
}

function continueRun(manifest: CompiledManifest, initialState: RunStateSnapshot, transitionBudget: number, accumulator: ExecutionAccumulator): EngineTransition {
  let state = cloneRunState(initialState);
  let remainingBudget = transitionBudget;
  const stepsById = new Map(manifest.steps.map((step) => [step.id, step]));

  while (state.status === "RUNNING") {
    if (remainingBudget <= 0) {
      const error = engineError("TRANSITION_BUDGET_EXCEEDED", { currentStepId: state.currentStepId ?? "null" });
      accumulator.errors.push(error);
      accumulator.auditFacts.push({ type: "RUN_FAILED", details: { reason: error.code } });
      state = failState(state, error.code);
      break;
    }
    if (state.activationOrdinal >= Number.MAX_SAFE_INTEGER) {
      const error = engineError("ACTIVATION_ORDINAL_OVERFLOW", { activationOrdinal: String(state.activationOrdinal) });
      accumulator.errors.push(error);
      accumulator.auditFacts.push({ type: "RUN_FAILED", details: { reason: error.code } });
      state = failState(state, error.code);
      break;
    }

    const stepId = state.currentStepId;
    const step = stepId === null ? undefined : stepsById.get(stepId);
    if (step === undefined) {
      const error = engineError("STEP_NOT_FOUND", { currentStepId: stepId ?? "null" });
      accumulator.errors.push(error);
      accumulator.auditFacts.push({ type: "RUN_FAILED", details: { reason: error.code } });
      state = failState(state, error.code);
      break;
    }

    remainingBudget -= 1;
    const activationOrdinal = state.activationOrdinal + 1;
    accumulator.auditFacts.push({ type: "STEP_ACTIVATED", stepId: step.id, details: { activationOrdinal: String(activationOrdinal) } });
    state = activateStep(manifest, state, step, activationOrdinal, accumulator);
  }

  return transition(state, accumulator.commands, accumulator.auditFacts, accumulator.errors);
}

function activateStep(manifest: CompiledManifest, state: RunStateSnapshot, step: CompiledStep, activationOrdinal: number, accumulator: ExecutionAccumulator): RunStateSnapshot {
  switch (step.type) {
    case "set_variable": {
      const variables = { ...cloneVariables(state.variables), [step.variable]: cloneCanonicalValue(step.value) };
      accumulator.auditFacts.push({ type: "VARIABLE_SET", stepId: step.id, details: { variable: step.variable } });
      return runningState(state, step.next, variables, activationOrdinal);
    }
    case "condition": {
      for (const branch of step.branches) {
        const evaluated = evaluateExpression(branch.when, state.variables, step.id);
        if (!evaluated.ok) {
          const error = evaluated.error ?? engineError("EXPRESSION_EVALUATION_FAILED", { stepId: step.id }, step.id);
          accumulator.errors.push(error);
          accumulator.auditFacts.push({ type: "RUN_FAILED", stepId: step.id, details: { reason: error.code } });
          return failState({ ...state, activationOrdinal }, error.code);
        }
        if (evaluated.value?.type === "boolean" && evaluated.value.value) {
          accumulator.auditFacts.push({ type: "CONDITION_BRANCH_SELECTED", stepId: step.id, details: { outcome: branch.outcome } });
          return runningState(state, branch.next, cloneVariables(state.variables), activationOrdinal);
        }
      }
      const error = engineError("NO_CONDITION_BRANCH_MATCHED", { stepId: step.id }, step.id);
      accumulator.errors.push(error);
      accumulator.auditFacts.push({ type: "RUN_FAILED", stepId: step.id, details: { reason: error.code } });
      return failState({ ...state, activationOrdinal }, error.code);
    }
    case "send_message": {
      const payload: SendMessagePayload = cloneAndFreeze({ contentVersionId: step.content.contentVersionId, text: step.content.text });
      const commandOrdinal = 0;
      const logicalEffectId = hashCanonical("logical-effect", { flowRunId: state.runId, stepId: step.id, activationOrdinal, commandKind: "SEND_MESSAGE", commandOrdinal });
      const effectContinuationId = hashCanonical("effect-continuation", { flowRunId: state.runId, stepId: step.id, activationOrdinal, commandOrdinal });
      const payloadHash = hashCanonical("payload", { kind: "SEND_MESSAGE", payload });
      const command: EngineCommand = cloneAndFreeze({
        kind: "SEND_MESSAGE",
        blocking: true,
        completionMode: "ON_EFFECT_TERMINAL",
        logicalEffectId,
        effectContinuationId,
        commandOrdinal,
        activationOrdinal,
        stepId: step.id,
        payload,
        payloadHash,
        outcomeMappingVersion: step.outcomeMappingVersion,
        outcomeMappingHash: step.outcomeMappingHash,
      });
      accumulator.commands.push(command);
      accumulator.auditFacts.push({ type: "COMMAND_EMITTED", stepId: step.id, details: { logicalEffectId, effectContinuationId } });
      accumulator.auditFacts.push({ type: "CONTINUATION_WAITING", stepId: step.id, details: { effectContinuationId } });
      return cloneAndFreeze({
        runId: state.runId,
        manifestHash: manifest.manifestHash,
        status: "WAITING_EFFECT",
        currentStepId: step.id,
        variables: cloneVariables(state.variables),
        activationOrdinal,
        consumedContinuations: cloneConsumedContinuations(state.consumedContinuations),
        waitingContinuation: {
          effectContinuationId,
          awaitedLogicalEffectId: logicalEffectId,
          expectedPayloadHash: payloadHash,
          outcomeMappingVersion: step.outcomeMappingVersion,
          outcomeMappingHash: step.outcomeMappingHash,
          state: "WAITING",
          terminalOutcomeTransitions: { requested: step.transitions.requested, failed: step.transitions.failed },
        },
      });
    }
    case "end":
      accumulator.auditFacts.push({ type: "RUN_COMPLETED", stepId: step.id, details: { activationOrdinal: String(activationOrdinal) } });
      return cloneAndFreeze({
        runId: state.runId,
        manifestHash: state.manifestHash,
        status: "COMPLETED",
        currentStepId: null,
        variables: cloneVariables(state.variables),
        activationOrdinal,
        consumedContinuations: cloneConsumedContinuations(state.consumedContinuations),
      });
  }
}

function evaluateExpression(expression: ExpressionAst, variables: Readonly<Record<string, TypedValue>>, stepId: string): ExpressionResult {
  switch (expression.kind) {
    case "literal":
      return { ok: true, value: cloneCanonicalValue(expression.value) };
    case "variable": {
      const value = variables[expression.name];
      return value !== undefined && value.type === expression.valueType
        ? { ok: true, value: cloneCanonicalValue(value) }
        : { ok: false, error: engineError("EXPRESSION_EVALUATION_FAILED", { variable: expression.name }, stepId) };
    }
    case "compare":
      return evaluateComparison(expression, variables, stepId);
    case "not": {
      const evaluated = evaluateExpression(expression.expression, variables, stepId);
      if (!evaluated.ok || evaluated.value?.type !== "boolean") return { ok: false, error: evaluated.error ?? engineError("EXPRESSION_EVALUATION_FAILED", { operator: "not" }, stepId) };
      return { ok: true, value: { type: "boolean", value: !evaluated.value.value } };
    }
    case "and":
    case "or":
      return evaluateLogical(expression.kind, expression.expressions, variables, stepId);
  }
}

function evaluateComparison(expression: Extract<ExpressionAst, { readonly kind: "compare" }>, variables: Readonly<Record<string, TypedValue>>, stepId: string): ExpressionResult {
  const left = evaluateExpression(expression.left, variables, stepId);
  const right = evaluateExpression(expression.right, variables, stepId);
  if (!left.ok || !right.ok || left.value === undefined || right.value === undefined) return { ok: false, error: left.error ?? right.error ?? engineError("EXPRESSION_EVALUATION_FAILED", { operator: expression.operator }, stepId) };
  if (expression.operator === "eq" || expression.operator === "neq") {
    const equal = left.value.type === right.value.type && left.value.value === right.value.value;
    return { ok: true, value: { type: "boolean", value: expression.operator === "eq" ? equal : !equal } };
  }
  if (left.value.type !== "number" || right.value.type !== "number") return { ok: false, error: engineError("EXPRESSION_EVALUATION_FAILED", { operator: expression.operator }, stepId) };
  return { ok: true, value: { type: "boolean", value: compareNumbers(left.value.value, right.value.value, expression.operator) } };
}

function evaluateLogical(kind: "and" | "or", expressions: readonly ExpressionAst[], variables: Readonly<Record<string, TypedValue>>, stepId: string): ExpressionResult {
  if (expressions.length === 0) return { ok: false, error: engineError("EXPRESSION_EVALUATION_FAILED", { operator: kind }, stepId) };
  for (const expression of expressions) {
    const evaluated = evaluateExpression(expression, variables, stepId);
    if (!evaluated.ok || evaluated.value?.type !== "boolean") return { ok: false, error: evaluated.error ?? engineError("EXPRESSION_EVALUATION_FAILED", { operator: kind }, stepId) };
    if (kind === "and" && !evaluated.value.value) return { ok: true, value: { type: "boolean", value: false } };
    if (kind === "or" && evaluated.value.value) return { ok: true, value: { type: "boolean", value: true } };
  }
  return { ok: true, value: { type: "boolean", value: kind === "and" } };
}

function compareNumbers(left: number, right: number, operator: "gt" | "gte" | "lt" | "lte"): boolean {
  switch (operator) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
  }
}

function validateRunState(state: unknown, manifest: CompiledManifest): { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (!isRecord(state)) return { ok: false, reasons: ["not-object"] };
  const baseKeys = ["activationOrdinal", "consumedContinuations", "currentStepId", "manifestHash", "runId", "status", "variables"];
  switch (state.status) {
    case "RUNNING":
    case "COMPLETED":
      if (!hasExactKeys(state, baseKeys)) reasons.push("fields");
      break;
    case "WAITING_EFFECT":
      if (!hasExactKeys(state, [...baseKeys, "waitingContinuation"])) reasons.push("fields");
      break;
    case "FAILED":
      if (!hasExactKeys(state, state.lastErrorCode === undefined ? baseKeys : [...baseKeys, "lastErrorCode"])) reasons.push("fields");
      if (state.lastErrorCode !== undefined && !isEngineErrorCode(state.lastErrorCode)) reasons.push("lastErrorCode");
      break;
    default:
      reasons.push("status");
  }
  if (typeof state.runId !== "string" || !isSafeString(state.runId) || state.runId.length === 0) reasons.push("runId");
  if (state.manifestHash !== manifest.manifestHash) reasons.push("manifestHash");
  if (typeof state.activationOrdinal !== "number" || !Number.isSafeInteger(state.activationOrdinal) || state.activationOrdinal < 0 || state.activationOrdinal >= Number.MAX_SAFE_INTEGER) reasons.push("activationOrdinal");
  if (!isValidVariables(state.variables as Readonly<Record<string, TypedValue>>)) reasons.push("variables");
  if (!isConsumedRecord(state.consumedContinuations)) reasons.push("consumedContinuations");
  const stepIds = new Set(manifest.steps.map((step) => step.id));
  switch (state.status) {
    case "WAITING_EFFECT":
      if (typeof state.currentStepId !== "string" || !stepIds.has(state.currentStepId)) {
        reasons.push("waitingEffectStep");
        break;
      }
      if (!isExpectedWaitingContinuation(state.waitingContinuation, state, manifest)) reasons.push("waitingEffect");
      break;
    case "RUNNING":
      if (typeof state.currentStepId !== "string" || !stepIds.has(state.currentStepId)) reasons.push("running");
      break;
    case "COMPLETED":
      if (state.currentStepId !== null) reasons.push("completed");
      break;
    case "FAILED":
      if (state.currentStepId !== null && (typeof state.currentStepId !== "string" || !stepIds.has(state.currentStepId))) reasons.push("failed");
      break;
    default:
      reasons.push("status");
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function isExpectedWaitingContinuation(value: unknown, state: Record<string, unknown>, manifest: CompiledManifest): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["awaitedLogicalEffectId", "effectContinuationId", "expectedPayloadHash", "outcomeMappingHash", "outcomeMappingVersion", "state", "terminalOutcomeTransitions"])) return false;
  if (!isRecord(value.terminalOutcomeTransitions) || !hasExactKeys(value.terminalOutcomeTransitions, ["failed", "requested"])) return false;
  const step = manifest.steps.find((candidate) => candidate.id === state.currentStepId);
  if (step?.type !== "send_message") return false;
  if (value.terminalOutcomeTransitions.requested !== step.transitions.requested || value.terminalOutcomeTransitions.failed !== step.transitions.failed) return false;
  const stepIds = new Set(manifest.steps.map((candidate) => candidate.id));
  if (!stepIds.has(step.transitions.requested) || !stepIds.has(step.transitions.failed)) return false;
  if (value.outcomeMappingVersion !== step.outcomeMappingVersion || value.outcomeMappingVersion !== manifest.outcomeMappingVersion) return false;
  if (value.outcomeMappingHash !== step.outcomeMappingHash || value.outcomeMappingHash !== manifest.outcomeMappingHash) return false;
  if (value.state !== "WAITING") return false;
  if (typeof state.runId !== "string" || !isSafeString(state.runId) || typeof state.currentStepId !== "string" || !Number.isSafeInteger(state.activationOrdinal)) return false;
  const activationOrdinal = state.activationOrdinal;
  const commandOrdinal = 0;
  const logicalEffectId = hashCanonical("logical-effect", { flowRunId: state.runId, stepId: state.currentStepId, activationOrdinal, commandKind: "SEND_MESSAGE", commandOrdinal });
  const effectContinuationId = hashCanonical("effect-continuation", { flowRunId: state.runId, stepId: state.currentStepId, activationOrdinal, commandOrdinal });
  const expectedPayloadHash = hashCanonical("payload", { kind: "SEND_MESSAGE", payload: { contentVersionId: step.content.contentVersionId, text: step.content.text } });
  return value.awaitedLogicalEffectId === logicalEffectId && value.effectContinuationId === effectContinuationId && value.expectedPayloadHash === expectedPayloadHash;
}

function isConsumedRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const [key, consumed] of Object.entries(value)) {
    if (!isHashIdentifier(key) || !isRecord(consumed) || !hasExactKeys(consumed, ["ledgerState", "logicalEffectId", "outcome", "payloadHash"])) return false;
    if ((consumed.outcome !== "requested" && consumed.outcome !== "failed") || !isConsumableLedgerState(consumed.ledgerState) || !isHashIdentifier(consumed.logicalEffectId) || !isHashIdentifier(consumed.payloadHash)) return false;
  }
  return true;
}

function isValidVariables(variables: Readonly<Record<string, TypedValue>>): boolean {
  if (!isRecord(variables)) return false;
  for (const [key, value] of Object.entries(variables)) {
    if (isReservedName(key) || !isSafeString(key) || !isTypedValue(value)) return false;
  }
  return true;
}

function isTypedValue(value: unknown): value is TypedValue {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "value"])) return false;
  switch (value.type) {
    case "string":
      return typeof value.value === "string" && isSafeString(value.value);
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value);
    case "boolean":
      return typeof value.value === "boolean";
    case "null":
      return value.value === null;
    default:
      return false;
  }
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

function isValidResolution(value: unknown): value is EffectResolution {
  if (!isRecord(value) || !hasExactKeys(value, ["effectContinuationId", "ledgerState", "logicalEffectId", "payloadHash"])) return false;
  return (
    typeof value.effectContinuationId === "string" &&
    isSafeString(value.effectContinuationId) &&
    typeof value.logicalEffectId === "string" &&
    isSafeString(value.logicalEffectId) &&
    typeof value.payloadHash === "string" &&
    isSafeString(value.payloadHash) &&
    (isConsumableLedgerState(value.ledgerState) || value.ledgerState === "UNKNOWN" || value.ledgerState === "RECONCILING" || value.ledgerState === "MANUAL_REVIEW" || value.ledgerState === "NOT_APPLIED" || value.ledgerState === "CANCELLED_BEFORE_DISPATCH")
  );
}

function isValidBudget(transitionBudget: number): boolean {
  return Number.isSafeInteger(transitionBudget) && transitionBudget > 0 && transitionBudget < Number.MAX_SAFE_INTEGER;
}

function isConsumableLedgerState(ledgerState: unknown): ledgerState is "CONFIRMED" | "DENIED" | "FAILED_PERMANENT" {
  return ledgerState === "CONFIRMED" || ledgerState === "DENIED" || ledgerState === "FAILED_PERMANENT";
}

function isHashIdentifier(value: unknown): value is string {
  return typeof value === "string" && isSafeString(value) && SHA256_HASH_PATTERN.test(value);
}

function isEngineErrorCode(value: unknown): value is EngineError["code"] {
  return typeof value === "string" && ENGINE_ERROR_CODES.has(value as EngineError["code"]);
}

function runningState(previous: RunStateSnapshot, currentStepId: string, variables: Readonly<Record<string, TypedValue>>, activationOrdinal: number): RunStateSnapshot {
  return cloneAndFreeze({ runId: previous.runId, manifestHash: previous.manifestHash, status: "RUNNING", currentStepId, variables: cloneVariables(variables), activationOrdinal, consumedContinuations: cloneConsumedContinuations(previous.consumedContinuations) });
}

function failState(previous: RunStateSnapshot, code: EngineError["code"]): RunStateSnapshot {
  return cloneAndFreeze({ runId: previous.runId, manifestHash: previous.manifestHash, status: "FAILED", currentStepId: previous.currentStepId, variables: cloneVariables(previous.variables), activationOrdinal: previous.activationOrdinal, consumedContinuations: cloneConsumedContinuations(previous.consumedContinuations), lastErrorCode: code });
}

function quarantineStartState(manifest: unknown, runId: unknown): RunStateSnapshot {
  const manifestHash = isRecord(manifest) && typeof manifest.manifestHash === "string" && isSafeString(manifest.manifestHash) ? manifest.manifestHash : "invalid-manifest";
  return cloneAndFreeze({
    runId: typeof runId === "string" && isSafeString(runId) && runId.length > 0 ? runId : "invalid-run",
    manifestHash,
    status: "FAILED",
    currentStepId: null,
    variables: {},
    activationOrdinal: 0,
    consumedContinuations: {},
  });
}

function safeReturnState(state: unknown, manifest: unknown): RunStateSnapshot {
  try {
    if (isRecord(state)) return cloneRunState(state as unknown as RunStateSnapshot);
  } catch (_caught) {
    // Fall through to quarantine state; invalid caller data must not escape or throw.
  }
  return quarantineStartState(manifest, isRecord(state) ? state.runId : "invalid-run");
}

function cloneRunState(state: RunStateSnapshot): RunStateSnapshot {
  return cloneAndFreeze(deepClone(state));
}

function cloneVariables(variables: Readonly<Record<string, TypedValue>>): Readonly<Record<string, TypedValue>> {
  return cloneAndFreeze(deepClone(variables));
}

function cloneConsumedContinuations(consumed: RunStateSnapshot["consumedContinuations"]): RunStateSnapshot["consumedContinuations"] {
  return cloneAndFreeze(deepClone(consumed));
}

function transition(nextRunState: RunStateSnapshot, commands: readonly EngineCommand[], auditFacts: readonly AuditFact[], errors: readonly EngineError[]): EngineTransition {
  return cloneAndFreeze({ nextRunState, commands, auditFacts, errors });
}

function engineError(code: EngineError["code"], details: Readonly<Record<string, string>>, stepId?: string): EngineError {
  return stepId === undefined ? { code, details } : { code, details, stepId };
}
