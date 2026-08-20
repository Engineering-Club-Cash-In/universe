import {
  CANONICAL_CODEC_HASH,
  CANONICAL_CODEC_VERSION,
  cloneAndFreeze,
  cloneCanonicalValue,
  deepClone,
  hashCanonical,
  isReservedName,
  isSafeString,
} from "./canonical";
import { SEND_MESSAGE_OUTCOME_MAPPING_HASH, SEND_MESSAGE_OUTCOME_MAPPING_VERSION } from "./outcome-mapping";
import type {
  CompileError,
  CompileResult,
  ConditionBranchDefinition,
  CompiledConditionBranch,
  CompiledManifest,
  CompiledStep,
  ExpressionAst,
  FlowDefinition,
  FlowStepDefinition,
  MessageContentDefinition,
  StepHandlerManifest,
  TypedValue,
} from "./types";

const STEP_HANDLER_VERSION = "phase1.0.0";
const IMPLEMENTATION_COMPATIBILITY_ID = "pure-phase1-slice";
const EXPRESSION_LANGUAGE_VERSION = "typed-expression-phase1-v1" as const;
const EXPRESSION_EXECUTOR_HASH = hashCanonical("expression-executor", {
  version: EXPRESSION_LANGUAGE_VERSION,
  compatibilityId: EXPRESSION_LANGUAGE_VERSION,
});
const SHA256_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

const ROOT_FIELDS = new Set(["schemaVersion", "flowId", "flowVersion", "entryStepId", "steps"]);
const MANIFEST_FIELDS = [
  "canonicalCodecHash",
  "canonicalCodecVersion",
  "definitionHash",
  "entryStepId",
  "expressionExecutorCompatibilityId",
  "expressionExecutorHash",
  "expressionLanguageVersion",
  "flowId",
  "flowVersion",
  "manifestHash",
  "outcomeMappingHash",
  "outcomeMappingVersion",
  "schemaVersion",
  "stepHandlers",
  "steps",
];
const STEP_HANDLER_FIELDS = ["blockingCommandCount", "completionMode", "handlerHash", "implementationCompatibilityId", "stepHandlerKey", "stepHandlerVersion", "stepType"];
const COMMON_COMPILED_STEP_FIELDS = ["blockingCommandCount", "handlerHash", "id", "implementationCompatibilityId", "stepHandlerKey", "stepHandlerVersion", "type"];
const COMMON_STEP_FIELDS = new Set(["id", "type"]);
const STEP_FIELDS: Readonly<Record<StepHandlerManifest["stepType"], ReadonlySet<string>>> = {
  set_variable: unionSet(COMMON_STEP_FIELDS, ["variable", "value", "next"]),
  condition: unionSet(COMMON_STEP_FIELDS, ["branches"]),
  send_message: unionSet(COMMON_STEP_FIELDS, ["content", "transitions"]),
  end: COMMON_STEP_FIELDS,
};

interface ParsedExpression {
  readonly expression: ExpressionAst;
  readonly valueType: TypedValue["type"];
  readonly reads: Readonly<Record<string, TypedValue["type"]>>;
}

interface DataflowState {
  readonly initialized: Readonly<Record<string, TypedValue["type"]>>;
}

interface ManifestValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function compileDefinition(definition: unknown): CompileResult {
  try {
    return compileDefinitionUnsafe(definition);
  } catch (caught) {
    return {
      ok: false,
      errors: [error("INVALID_DEFINITION", "$", { reason: caught instanceof Error ? caught.message : "unknown" })],
    };
  }
}

export function validateManifestIntegrity(manifest: unknown): ManifestValidationResult {
  try {
    const errors: string[] = [];
    if (!isRecord(manifest)) {
      return { ok: false, errors: ["manifest is not an object"] };
    }
    if (!hasExactKeys(manifest, MANIFEST_FIELDS)) errors.push("manifest fields");
    if (manifest.schemaVersion !== "compiled-manifest/phase1") errors.push("schemaVersion");
    if (manifest.canonicalCodecVersion !== CANONICAL_CODEC_VERSION) errors.push("canonicalCodecVersion");
    if (manifest.canonicalCodecHash !== CANONICAL_CODEC_HASH) errors.push("canonicalCodecHash");
    if (manifest.expressionLanguageVersion !== EXPRESSION_LANGUAGE_VERSION) errors.push("expressionLanguageVersion");
    if (manifest.expressionExecutorCompatibilityId !== EXPRESSION_LANGUAGE_VERSION) errors.push("expressionExecutorCompatibilityId");
    if (manifest.expressionExecutorHash !== EXPRESSION_EXECUTOR_HASH) errors.push("expressionExecutorHash");
    if (manifest.outcomeMappingVersion !== SEND_MESSAGE_OUTCOME_MAPPING_VERSION) errors.push("outcomeMappingVersion");
    if (manifest.outcomeMappingHash !== SEND_MESSAGE_OUTCOME_MAPPING_HASH) errors.push("outcomeMappingHash");
    if (!isSafeIdentifier(manifest.flowId) || !isSafeIdentifier(manifest.flowVersion) || !isSafeIdentifier(manifest.entryStepId)) errors.push("identity");
    if (!isSha256Id(manifest.manifestHash)) errors.push("manifestHash");
    if (!isSha256Id(manifest.definitionHash)) errors.push("definitionHash");
    if (!Array.isArray(manifest.stepHandlers) || !Array.isArray(manifest.steps)) errors.push("arrays");

    const expectedHandlers = stepHandlers();
    if (Array.isArray(manifest.stepHandlers)) {
      for (const handlerValue of manifest.stepHandlers) {
        if (!isRecord(handlerValue) || !hasExactKeys(handlerValue, STEP_HANDLER_FIELDS)) errors.push("stepHandler fields");
      }
      if (JSON.stringify(manifest.stepHandlers) !== JSON.stringify(expectedHandlers)) {
        errors.push("stepHandlers");
      }
    }

    if (Array.isArray(manifest.steps) && typeof manifest.entryStepId === "string") {
      validateCompiledSteps(manifest.steps, manifest.entryStepId, errors);
    }

    if (errors.length === 0) {
      const withoutHash = manifestWithoutHash(manifest as unknown as CompiledManifest);
      const recomputed = computeManifestHash(withoutHash);
      if (recomputed !== manifest.manifestHash) {
        errors.push("manifestHashRecompute");
      }
    }

    return { ok: errors.length === 0, errors };
  } catch (caught) {
    return { ok: false, errors: [caught instanceof Error ? caught.message : "manifest validation threw"] };
  }
}

export function computeManifestHash(manifestWithoutHashValue: Omit<CompiledManifest, "manifestHash">): string {
  return hashCanonical("manifest", manifestWithoutHashValue);
}

function compileDefinitionUnsafe(definition: unknown): CompileResult {
  const root = parseDefinitionRoot(definition);
  if (!root.ok) {
    return { ok: false, errors: root.errors };
  }
  const normalized = root.definition;
  const errors: CompileError[] = [];
  const stepsById = new Map<string, FlowStepDefinition>();
  const duplicateIds = new Set<string>();

  for (const [index, step] of normalized.steps.entries()) {
    if (stepsById.has(step.id)) {
      duplicateIds.add(step.id);
      errors.push(error("DUPLICATE_STEP_ID", `$.steps[${index}].id`, { stepId: step.id }));
    } else {
      stepsById.set(step.id, step);
    }
  }

  if (!stepsById.has(normalized.entryStepId)) {
    errors.push(error("ENTRY_STEP_NOT_FOUND", "$.entryStepId", { entryStepId: normalized.entryStepId }));
  }

  const transitions = new Map<string, string[]>();
  const compiledSteps: CompiledStep[] = [];

  for (const [index, step] of normalized.steps.entries()) {
    if (duplicateIds.has(step.id)) continue;
    const compiled = compileStep(step, index, errors);
    if (compiled !== undefined) {
      compiledSteps.push(compiled);
      transitions.set(step.id, transitionTargets(compiled));
    }
  }

  for (const [sourceStepId, targets] of transitions.entries()) {
    for (const target of targets) {
      if (!stepsById.has(target)) {
        errors.push(error("TRANSITION_TARGET_NOT_FOUND", `$.steps.${sourceStepId}.transitions`, { stepId: sourceStepId, target }));
      }
    }
  }

  if (stepsById.has(normalized.entryStepId)) {
    if (hasAnyCycle(transitions)) {
      errors.push(error("CYCLE_NOT_SUPPORTED", "$.steps", { entryStepId: normalized.entryStepId }));
    }
    if (!hasReachableEnd(normalized.entryStepId, compiledSteps, transitions)) {
      errors.push(error("NO_REACHABLE_END", "$.steps", { entryStepId: normalized.entryStepId }));
    }
    errors.push(...validateDataflow(normalized.entryStepId, compiledSteps, transitions));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const definitionHash = hashCanonical("definition", normalized);
  const withoutHash: Omit<CompiledManifest, "manifestHash"> = {
    schemaVersion: "compiled-manifest/phase1",
    flowId: normalized.flowId,
    flowVersion: normalized.flowVersion,
    entryStepId: normalized.entryStepId,
    definitionHash,
    canonicalCodecVersion: CANONICAL_CODEC_VERSION,
    canonicalCodecHash: CANONICAL_CODEC_HASH,
    expressionLanguageVersion: EXPRESSION_LANGUAGE_VERSION,
    expressionExecutorCompatibilityId: EXPRESSION_LANGUAGE_VERSION,
    expressionExecutorHash: EXPRESSION_EXECUTOR_HASH,
    outcomeMappingVersion: SEND_MESSAGE_OUTCOME_MAPPING_VERSION,
    outcomeMappingHash: SEND_MESSAGE_OUTCOME_MAPPING_HASH,
    stepHandlers: stepHandlers(),
    steps: compiledSteps,
  };
  const manifest: CompiledManifest = { ...withoutHash, manifestHash: computeManifestHash(withoutHash) };
  const manifestValidation = validateManifestIntegrity(manifest);
  if (!manifestValidation.ok) {
    return {
      ok: false,
      errors: [error("INTERNAL_MANIFEST_INVALID", "$.manifest", { reasons: manifestValidation.errors.join(",") })],
    };
  }
  return { ok: true, manifest: cloneAndFreeze(manifest) };
}

function parseDefinitionRoot(definition: unknown): { readonly ok: true; readonly definition: FlowDefinition } | { readonly ok: false; readonly errors: readonly CompileError[] } {
  const errors: CompileError[] = [];
  if (!isRecord(definition)) {
    return { ok: false, errors: [error("INVALID_DEFINITION", "$", { expected: "object" })] };
  }
  for (const key of Object.keys(definition)) {
    if (!ROOT_FIELDS.has(key)) errors.push(error("UNSUPPORTED_FIELD", `$.${key}`, { field: key }));
  }
  if (definition.schemaVersion !== "conversational-flow/phase1") errors.push(error("INVALID_SCHEMA_VERSION", "$.schemaVersion", { expected: "conversational-flow/phase1" }));
  if (!isSafeIdentifier(definition.flowId)) errors.push(error("INVALID_DEFINITION", "$.flowId", { expected: "safe string" }));
  if (!isSafeIdentifier(definition.flowVersion)) errors.push(error("INVALID_DEFINITION", "$.flowVersion", { expected: "safe string" }));
  if (!isSafeIdentifier(definition.entryStepId)) errors.push(error("INVALID_DEFINITION", "$.entryStepId", { expected: "safe string" }));
  if (!Array.isArray(definition.steps)) errors.push(error("INVALID_DEFINITION", "$.steps", { expected: "array" }));
  if (errors.length > 0) return { ok: false, errors };

  const steps: FlowStepDefinition[] = [];
  const rawSteps = definition.steps as readonly unknown[];
  for (const [index, rawStep] of rawSteps.entries()) {
    const parsed = parseStepRoot(rawStep, index);
    errors.push(...parsed.errors);
    if (parsed.step !== undefined) steps.push(parsed.step);
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    definition: {
      schemaVersion: "conversational-flow/phase1",
      flowId: definition.flowId as string,
      flowVersion: definition.flowVersion as string,
      entryStepId: definition.entryStepId as string,
      steps,
    },
  };
}

function parseStepRoot(rawStep: unknown, index: number): { readonly step?: FlowStepDefinition; readonly errors: readonly CompileError[] } {
  const errors: CompileError[] = [];
  if (!isRecord(rawStep)) return { errors: [error("INVALID_STEP_SHAPE", `$.steps[${index}]`, { expected: "object" })] };
  const rawType = rawStep.type;
  const rawId = rawStep.id;
  if (!isSafeIdentifier(rawId)) errors.push(error("INVALID_STEP_SHAPE", `$.steps[${index}].id`, { expected: "safe string" }));
  if (!isSafeIdentifier(rawType)) errors.push(error("INVALID_STEP_SHAPE", `$.steps[${index}].type`, { expected: "safe string" }));
  if (errors.length > 0) return { errors };
  const id = rawId as string;
  const type = rawType as string;

  if (!isSupportedStepType(type)) {
    return { step: { id, type }, errors: [error("UNSUPPORTED_STEP_TYPE", `$.steps[${index}].type`, { stepId: id, stepType: type })] };
  }
  const supportedType = type;
  for (const key of Object.keys(rawStep)) {
    if (!STEP_FIELDS[supportedType].has(key)) errors.push(error("UNSUPPORTED_FIELD", `$.steps[${index}].${key}`, { stepId: id, field: key }));
  }
  if (errors.length > 0) return { errors };

  switch (supportedType) {
    case "set_variable":
      if (typeof rawStep.variable === "string" && isReservedName(rawStep.variable)) {
        return { errors: [error("RESERVED_NAME", `$.steps[${index}].variable`, { stepId: id, variable: rawStep.variable })] };
      }
      if (!isSafeUserVariable(rawStep.variable) || !isTypedValue(rawStep.value) || !isSafeIdentifier(rawStep.next)) {
        return { errors: [error("INVALID_STEP_SHAPE", `$.steps[${index}]`, { stepId: id, stepType: type })] };
      }
      return { step: { id, type, variable: rawStep.variable, value: cloneCanonicalValue(rawStep.value), next: rawStep.next }, errors: [] };
    case "condition": {
      if (!Array.isArray(rawStep.branches) || rawStep.branches.length === 0) {
        return { errors: [error("INVALID_STEP_SHAPE", `$.steps[${index}].branches`, { stepId: id, stepType: type })] };
      }
      const branches = parseBranches(rawStep.branches, index, id, errors);
      return errors.length === 0 ? { step: { id, type, branches }, errors } : { errors };
    }
    case "send_message":
      if (!isMessageContent(rawStep.content) || !isTransitions(rawStep.transitions)) {
        return { errors: [error("INVALID_STEP_SHAPE", `$.steps[${index}]`, { stepId: id, stepType: type })] };
      }
      return {
        step: { id, type, content: rawStep.content, transitions: rawStep.transitions },
        errors: [],
      };
    case "end":
      return { step: { id, type }, errors: [] };
  }
}

function parseBranches(rawBranches: readonly unknown[], stepIndex: number, stepId: string, errors: CompileError[]): ConditionBranchDefinition[] {
  const branches: ConditionBranchDefinition[] = [];
  const outcomes = new Set<string>();
  for (const [branchIndex, rawBranch] of rawBranches.entries()) {
    if (!isRecord(rawBranch) || !isSafeIdentifier(rawBranch.outcome) || !isSafeIdentifier(rawBranch.next)) {
      errors.push(error("INVALID_STEP_SHAPE", `$.steps[${stepIndex}].branches[${branchIndex}]`, { stepId }));
      continue;
    }
    for (const key of Object.keys(rawBranch)) {
      if (key !== "outcome" && key !== "when" && key !== "next") errors.push(error("UNSUPPORTED_FIELD", `$.steps[${stepIndex}].branches[${branchIndex}].${key}`, { stepId, field: key }));
    }
    if (outcomes.has(rawBranch.outcome)) {
      errors.push(error("DUPLICATE_BRANCH_OUTCOME", `$.steps[${stepIndex}].branches[${branchIndex}].outcome`, { stepId, outcome: rawBranch.outcome }));
      continue;
    }
    outcomes.add(rawBranch.outcome);
    branches.push({ outcome: rawBranch.outcome, when: rawBranch.when, next: rawBranch.next });
  }
  return branches;
}

function compileStep(step: FlowStepDefinition, index: number, errors: CompileError[]): CompiledStep | undefined {
  const handlerManifest = stepHandlers().find((candidate) => candidate.stepType === step.type);
  if (handlerManifest === undefined) {
    errors.push(error("UNSUPPORTED_STEP_TYPE", `$.steps[${index}].type`, { stepId: step.id, stepType: step.type }));
    return undefined;
  }
  const base = {
    id: step.id,
    stepHandlerKey: handlerManifest.stepHandlerKey,
    stepHandlerVersion: handlerManifest.stepHandlerVersion,
    implementationCompatibilityId: handlerManifest.implementationCompatibilityId,
    handlerHash: handlerManifest.handlerHash,
  };

  switch (step.type) {
    case "set_variable": {
      if (typeof step.variable !== "string" || !isTypedValue(step.value) || typeof step.next !== "string") {
        errors.push(error("INVALID_STEP_SHAPE", `$.steps[${index}]`, { stepId: step.id, stepType: step.type }));
        return undefined;
      }
      return { ...base, type: "set_variable", variable: step.variable, value: cloneCanonicalValue(step.value), next: step.next, blockingCommandCount: 0 };
    }
    case "condition": {
      if (!Array.isArray(step.branches) || step.branches.length === 0) return undefined;
      const branches: CompiledConditionBranch[] = [];
      for (const [branchIndex, branch] of step.branches.entries()) {
        const parsed = parseExpressionAst(branch.when);
        if (parsed === undefined) {
          errors.push(
            error(isRecord(branch.when) ? "EXPRESSION_TYPE_ERROR" : "INVALID_EXPRESSION_AST", `$.steps[${index}].branches[${branchIndex}].when`, {
              stepId: step.id,
              outcome: branch.outcome,
            }),
          );
          continue;
        }
        if (parsed.valueType !== "boolean") {
          errors.push(error("EXPRESSION_TYPE_ERROR", `$.steps[${index}].branches[${branchIndex}].when`, { stepId: step.id, actual: parsed.valueType, expected: "boolean" }));
          continue;
        }
        branches.push({ outcome: branch.outcome, when: parsed.expression, expressionHash: hashCanonical("expression", parsed.expression), next: branch.next });
      }
      return branches.length > 0 ? { ...base, type: "condition", branches, blockingCommandCount: 0 } : undefined;
    }
    case "send_message": {
      if (!isMessageContent(step.content) || step.transitions?.requested === undefined || step.transitions.failed === undefined) return undefined;
      return {
        ...base,
        type: "send_message",
        content: { contentVersionId: step.content.contentVersionId, text: step.content.text },
        contentHash: hashCanonical("content", step.content),
        transitions: { requested: step.transitions.requested, failed: step.transitions.failed },
        completionMode: "ON_EFFECT_TERMINAL",
        outcomeMappingVersion: SEND_MESSAGE_OUTCOME_MAPPING_VERSION,
        outcomeMappingHash: SEND_MESSAGE_OUTCOME_MAPPING_HASH,
        blockingCommandCount: 1,
      };
    }
    case "end":
      return { ...base, type: "end", blockingCommandCount: 0 };
    default:
      errors.push(error("UNSUPPORTED_STEP_TYPE", `$.steps[${index}].type`, { stepId: step.id, stepType: step.type }));
      return undefined;
  }
}

function parseExpressionAst(value: unknown): ParsedExpression | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case "literal":
      if (!hasExactKeys(value, ["kind", "value"])) return undefined;
      return isTypedValue(value.value) ? { expression: { kind: "literal", value: cloneCanonicalValue(value.value) }, valueType: value.value.type, reads: {} } : undefined;
    case "variable":
      if (!hasExactKeys(value, ["kind", "name", "valueType"])) return undefined;
      return isSafeUserVariable(value.name) && isValueType(value.valueType)
        ? { expression: { kind: "variable", name: value.name, valueType: value.valueType }, valueType: value.valueType, reads: { [value.name]: value.valueType } }
        : undefined;
    case "compare": {
      if (!hasExactKeys(value, ["kind", "left", "operator", "right"])) return undefined;
      const left = parseExpressionAst(value.left);
      const right = parseExpressionAst(value.right);
      if (left === undefined || right === undefined || !isCompareOperator(value.operator)) return undefined;
      if ((value.operator === "gt" || value.operator === "gte" || value.operator === "lt" || value.operator === "lte") && (left.valueType !== "number" || right.valueType !== "number")) {
        return undefined;
      }
      if ((value.operator === "eq" || value.operator === "neq") && left.valueType !== right.valueType) return undefined;
      const reads = mergeReads(left.reads, right.reads);
      return reads === undefined ? undefined : { expression: { kind: "compare", operator: value.operator, left: left.expression, right: right.expression }, valueType: "boolean", reads };
    }
    case "not": {
      if (!hasExactKeys(value, ["expression", "kind"])) return undefined;
      const expression = parseExpressionAst(value.expression);
      if (expression === undefined || expression.valueType !== "boolean") return undefined;
      return { expression: { kind: "not", expression: expression.expression }, valueType: "boolean", reads: expression.reads };
    }
    case "and":
    case "or": {
      if (!hasExactKeys(value, ["expressions", "kind"]) || !Array.isArray(value.expressions) || value.expressions.length === 0) return undefined;
      const expressions: ExpressionAst[] = [];
      let reads: Readonly<Record<string, TypedValue["type"]>> = {};
      for (const raw of value.expressions) {
        const parsed = parseExpressionAst(raw);
        if (parsed === undefined || parsed.valueType !== "boolean") return undefined;
        expressions.push(parsed.expression);
        const merged = mergeReads(reads, parsed.reads);
        if (merged === undefined) return undefined;
        reads = merged;
      }
      return { expression: { kind: value.kind, expressions }, valueType: "boolean", reads };
    }
    default:
      return undefined;
  }
}

function validateDataflow(entryStepId: string, steps: readonly CompiledStep[], transitions: ReadonlyMap<string, readonly string[]>): readonly CompileError[] {
  const errors: CompileError[] = [];
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const inStates = new Map<string, DataflowState>();
  const queue: string[] = [entryStepId];
  inStates.set(entryStepId, { initialized: {} });
  const passes = steps.length + 1;
  let guard = 0;
  while (queue.length > 0 && guard < passes * passes) {
    guard += 1;
    const stepId = queue.shift();
    if (stepId === undefined) continue;
    const step = stepsById.get(stepId);
    const state = inStates.get(stepId);
    if (step === undefined || state === undefined) continue;
    const outState = applyDataflowStep(step, state, errors);
    for (const target of transitions.get(stepId) ?? []) {
      const previous = inStates.get(target);
      const merged = previous === undefined ? outState : intersectStates(previous, outState);
      if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(merged)) {
        inStates.set(target, merged);
        queue.push(target);
      }
    }
  }
  return errors;
}

function applyDataflowStep(step: CompiledStep, state: DataflowState, errors: CompileError[]): DataflowState {
  if (step.type === "set_variable") {
    return { initialized: { ...state.initialized, [step.variable]: step.value.type } };
  }
  if (step.type === "condition") {
    for (const branch of step.branches) {
      for (const [variable, expectedType] of Object.entries(readsForExpression(branch.when))) {
        if (state.initialized[variable] !== expectedType) {
          errors.push(error("VARIABLE_NOT_INITIALIZED", `$.steps.${step.id}.branches.${branch.outcome}.when`, { stepId: step.id, variable, expectedType }));
        }
      }
    }
  }
  return state;
}

function readsForExpression(expression: ExpressionAst): Readonly<Record<string, TypedValue["type"]>> {
  switch (expression.kind) {
    case "literal":
      return {};
    case "variable":
      return { [expression.name]: expression.valueType };
    case "compare":
      return mergeReads(readsForExpression(expression.left), readsForExpression(expression.right)) ?? {};
    case "not":
      return readsForExpression(expression.expression);
    case "and":
    case "or": {
      let reads: Readonly<Record<string, TypedValue["type"]>> = {};
      for (const item of expression.expressions) reads = mergeReads(reads, readsForExpression(item)) ?? {};
      return reads;
    }
  }
}

function validateCompiledSteps(rawSteps: readonly unknown[], entryStepId: string, errors: string[]): void {
  const ids = new Set<string>();
  const compiledSteps = rawSteps.filter(isRecord) as unknown as CompiledStep[];
  const transitions = new Map<string, string[]>();
  for (const rawStep of rawSteps) {
    if (!isRecord(rawStep) || !isSupportedStepType(rawStep.type) || typeof rawStep.id !== "string") {
      errors.push("step shape");
      continue;
    }
    if (!isSafeIdentifier(rawStep.id)) errors.push("step id");
    if (ids.has(rawStep.id)) errors.push("duplicate step id");
    ids.add(rawStep.id);
    const handlerManifest = stepHandlers().find((candidate) => candidate.stepType === rawStep.type);
    if (handlerManifest === undefined || rawStep.stepHandlerKey !== handlerManifest.stepHandlerKey || rawStep.stepHandlerVersion !== handlerManifest.stepHandlerVersion || rawStep.implementationCompatibilityId !== handlerManifest.implementationCompatibilityId || rawStep.handlerHash !== handlerManifest.handlerHash) errors.push(`handler ${rawStep.id}`);
    const step = rawStep as unknown as CompiledStep;
    switch (step.type) {
      case "set_variable":
        if (!hasExactKeys(rawStep, [...COMMON_COMPILED_STEP_FIELDS, "next", "value", "variable"]) || !isSafeUserVariable(step.variable) || !isTypedValue(step.value) || !isSafeIdentifier(step.next) || step.blockingCommandCount !== 0) errors.push(`set_variable ${step.id}`);
        transitions.set(step.id, [step.next]);
        break;
      case "condition":
        if (!hasExactKeys(rawStep, [...COMMON_COMPILED_STEP_FIELDS, "branches"]) || !Array.isArray(step.branches) || step.branches.length === 0 || step.blockingCommandCount !== 0) {
          errors.push(`condition ${step.id}`);
          transitions.set(step.id, []);
          break;
        }
        for (const branch of step.branches) {
          if (!isRecord(branch) || !hasExactKeys(branch, ["expressionHash", "next", "outcome", "when"]) || !isSafeIdentifier(branch.outcome) || !isSafeIdentifier(branch.next)) {
            errors.push(`branch ${step.id}`);
            continue;
          }
          const parsed = parseExpressionAst(branch.when);
          if (parsed === undefined || parsed.valueType !== "boolean" || !isSha256Id(branch.expressionHash) || branch.expressionHash !== hashCanonical("expression", branch.when)) errors.push(`expression ${step.id}`);
        }
        if (new Set(step.branches.map((branch) => branch.outcome)).size !== step.branches.length) errors.push(`outcome ${step.id}`);
        transitions.set(step.id, step.branches.map((branch) => branch.next));
        break;
      case "send_message":
        if (
          !hasExactKeys(rawStep, [...COMMON_COMPILED_STEP_FIELDS, "completionMode", "content", "contentHash", "outcomeMappingHash", "outcomeMappingVersion", "transitions"]) ||
          step.blockingCommandCount !== 1 ||
          step.completionMode !== "ON_EFFECT_TERMINAL" ||
          step.outcomeMappingVersion !== SEND_MESSAGE_OUTCOME_MAPPING_VERSION ||
          step.outcomeMappingHash !== SEND_MESSAGE_OUTCOME_MAPPING_HASH ||
          !isMessageContent(step.content) ||
          !isSha256Id(step.contentHash) ||
          step.contentHash !== hashCanonical("content", step.content) ||
          !isTransitions(step.transitions)
        )
          errors.push(`send_message ${step.id}`);
        transitions.set(step.id, [step.transitions.requested, step.transitions.failed]);
        break;
      case "end":
        if (!hasExactKeys(rawStep, COMMON_COMPILED_STEP_FIELDS) || step.blockingCommandCount !== 0) errors.push(`end ${step.id}`);
        transitions.set(step.id, []);
        break;
    }
  }
  for (const [stepId, targets] of transitions.entries()) {
    for (const target of targets) if (!ids.has(target)) errors.push(`transition ${stepId}`);
  }
  if (!ids.has(entryStepId)) errors.push("entryStepId");
  if (hasAnyCycle(transitions)) errors.push("cycle");
  if (ids.has(entryStepId) && !hasReachableEnd(entryStepId, compiledSteps, transitions)) errors.push("reachable end");
  if (ids.has(entryStepId) && validateDataflow(entryStepId, compiledSteps, transitions).length > 0) errors.push("dataflow");
}

function manifestWithoutHash(manifest: CompiledManifest): Omit<CompiledManifest, "manifestHash"> {
  return {
    schemaVersion: manifest.schemaVersion,
    flowId: manifest.flowId,
    flowVersion: manifest.flowVersion,
    entryStepId: manifest.entryStepId,
    definitionHash: manifest.definitionHash,
    canonicalCodecVersion: manifest.canonicalCodecVersion,
    canonicalCodecHash: manifest.canonicalCodecHash,
    expressionLanguageVersion: manifest.expressionLanguageVersion,
    expressionExecutorCompatibilityId: manifest.expressionExecutorCompatibilityId,
    expressionExecutorHash: manifest.expressionExecutorHash,
    outcomeMappingVersion: manifest.outcomeMappingVersion,
    outcomeMappingHash: manifest.outcomeMappingHash,
    stepHandlers: deepClone(manifest.stepHandlers),
    steps: deepClone(manifest.steps),
  };
}

function transitionTargets(step: CompiledStep): string[] {
  switch (step.type) {
    case "set_variable":
      return [step.next];
    case "condition":
      return step.branches.map((branch) => branch.next);
    case "send_message":
      return [step.transitions.requested, step.transitions.failed];
    case "end":
      return [];
  }
}

function hasReachableEnd(entryStepId: string, steps: readonly CompiledStep[], transitions: ReadonlyMap<string, readonly string[]>): boolean {
  const compiledById = new Map(steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const queue: string[] = [entryStepId];
  while (queue.length > 0) {
    const stepId = queue.shift();
    if (stepId === undefined || seen.has(stepId)) continue;
    seen.add(stepId);
    const step = compiledById.get(stepId);
    if (step === undefined) continue;
    if (step.type === "end") return true;
    for (const target of transitions.get(stepId) ?? []) queue.push(target);
  }
  return false;
}

function hasAnyCycle(transitions: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): boolean => {
    if (visiting.has(stepId)) return true;
    if (visited.has(stepId)) return false;
    visiting.add(stepId);
    for (const target of transitions.get(stepId) ?? []) {
      if (transitions.has(target) && visit(target)) return true;
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  };
  for (const stepId of transitions.keys()) {
    if (visit(stepId)) return true;
  }
  return false;
}

function intersectStates(left: DataflowState, right: DataflowState): DataflowState {
  const initialized: Record<string, TypedValue["type"]> = {};
  for (const [key, value] of Object.entries(left.initialized)) {
    if (right.initialized[key] === value) initialized[key] = value;
  }
  return { initialized };
}

function mergeReads(
  left: Readonly<Record<string, TypedValue["type"]>>,
  right: Readonly<Record<string, TypedValue["type"]>>,
): Readonly<Record<string, TypedValue["type"]>> | undefined {
  const merged: Record<string, TypedValue["type"]> = { ...left };
  for (const [name, type] of Object.entries(right)) {
    if (merged[name] !== undefined && merged[name] !== type) return undefined;
    merged[name] = type;
  }
  return merged;
}

function isTypedValue(value: unknown): value is TypedValue {
  if (!isRecord(value)) return false;
  if (Object.keys(value).sort().join(",") !== "type,value") return false;
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

function isMessageContent(value: unknown): value is MessageContentDefinition {
  return isRecord(value) && Object.keys(value).sort().join(",") === "contentVersionId,text" && isSafeIdentifier(value.contentVersionId) && typeof value.text === "string" && isSafeString(value.text);
}

function isTransitions(value: unknown): value is Readonly<Record<"requested" | "failed", string>> {
  return isRecord(value) && Object.keys(value).sort().join(",") === "failed,requested" && isSafeIdentifier(value.requested) && isSafeIdentifier(value.failed);
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

function isValueType(value: unknown): value is TypedValue["type"] {
  return value === "string" || value === "number" || value === "boolean" || value === "null";
}

function isCompareOperator(value: unknown): value is "eq" | "neq" | "gt" | "gte" | "lt" | "lte" {
  return value === "eq" || value === "neq" || value === "gt" || value === "gte" || value === "lt" || value === "lte";
}

function isSupportedStepType(value: unknown): value is StepHandlerManifest["stepType"] {
  return value === "set_variable" || value === "condition" || value === "send_message" || value === "end";
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && isSafeString(value) && !isReservedName(value);
}

function isSha256Id(value: unknown): value is string {
  return typeof value === "string" && isSafeString(value) && SHA256_HASH_PATTERN.test(value);
}

function isSafeUserVariable(value: unknown): value is string {
  return isSafeIdentifier(value);
}

function stepHandlers(): readonly StepHandlerManifest[] {
  return cloneAndFreeze([
    handler("set_variable", "ON_PERSIST", 0),
    handler("condition", "ON_PERSIST", 0),
    handler("send_message", "ON_EFFECT_TERMINAL", 1),
    handler("end", "ON_PERSIST", 0),
  ]);
}

function handler(stepType: StepHandlerManifest["stepType"], completionMode: StepHandlerManifest["completionMode"], blockingCommandCount: StepHandlerManifest["blockingCommandCount"]): StepHandlerManifest {
  const stepHandlerKey = `phase1.${stepType}`;
  return {
    stepType,
    stepHandlerKey,
    stepHandlerVersion: STEP_HANDLER_VERSION,
    implementationCompatibilityId: IMPLEMENTATION_COMPATIBILITY_ID,
    handlerHash: hashCanonical("handler", { stepHandlerKey, stepHandlerVersion: STEP_HANDLER_VERSION, implementationCompatibilityId: IMPLEMENTATION_COMPATIBILITY_ID }),
    completionMode,
    blockingCommandCount,
  };
}

function unionSet(base: ReadonlySet<string>, extra: readonly string[]): ReadonlySet<string> {
  return new Set([...base, ...extra]);
}

function error(code: CompileError["code"], path: string, details: Readonly<Record<string, string>>, stepId?: string): CompileError {
  return stepId === undefined ? { code, path, details } : { code, path, details, stepId };
}
