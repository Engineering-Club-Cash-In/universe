import { describe, expect, test } from "bun:test";
import { computeManifestHash, validateManifestIntegrity } from "./compiler";
import {
  compileDefinition,
  hashCanonical,
  resumeRun,
  startRun,
  type CompiledConditionStep,
  type CompiledManifest,
  type CompiledSendMessageStep,
  type EffectResolution,
  type EngineErrorCode,
  type FlowDefinition,
  type RunStateSnapshot,
} from "./index";

type DeepMutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? DeepMutable<U>[] : T[K] extends object ? DeepMutable<T[K]> : T[K] };
type MutableManifest = DeepMutable<CompiledManifest>;
type MutableRunState = DeepMutable<RunStateSnapshot>;

function definitionWithExtraStep(): FlowDefinition {
  return {
    schemaVersion: "conversational-flow/phase1",
    flowId: "final-flow",
    flowVersion: "1",
    entryStepId: "set-score",
    steps: [
      { id: "set-score", type: "set_variable", variable: "score", value: { type: "number", value: 7 }, next: "check" },
      {
        id: "check",
        type: "condition",
        branches: [
          {
            outcome: "high",
            when: {
              kind: "compare",
              operator: "gte",
              left: { kind: "variable", name: "score", valueType: "number" },
              right: { kind: "literal", value: { type: "number", value: 5 } },
            },
            next: "send",
          },
        ],
      },
      { id: "send", type: "send_message", content: { contentVersionId: "v1", text: "hola" }, transitions: { requested: "done", failed: "done" } },
      { id: "evil", type: "set_variable", variable: "jumped", value: { type: "boolean", value: true }, next: "done" },
      { id: "done", type: "end" },
    ],
  };
}

function requireManifest(definition: FlowDefinition = definitionWithExtraStep()): CompiledManifest {
  const result = compileDefinition(definition);
  if (!result.ok) throw new Error(result.errors.map((error) => error.code).join(","));
  return result.manifest;
}

function waitingRun(manifest = requireManifest()) {
  const waiting = startRun({ manifest, runId: "run-final", transitionBudget: 10 });
  const command = waiting.commands[0];
  if (command === undefined) throw new Error("expected command");
  const resolution: EffectResolution = {
    effectContinuationId: command.effectContinuationId,
    logicalEffectId: command.logicalEffectId,
    payloadHash: command.payloadHash,
    ledgerState: "CONFIRMED",
  };
  return { waiting, command, resolution };
}

function mutableManifest(manifest = requireManifest()): MutableManifest {
  return structuredClone(manifest) as MutableManifest;
}

function rehashManifest(draft: MutableManifest): CompiledManifest {
  const withoutHash = {
    schemaVersion: draft.schemaVersion,
    flowId: draft.flowId,
    flowVersion: draft.flowVersion,
    entryStepId: draft.entryStepId,
    definitionHash: draft.definitionHash,
    canonicalCodecVersion: draft.canonicalCodecVersion,
    canonicalCodecHash: draft.canonicalCodecHash,
    expressionLanguageVersion: draft.expressionLanguageVersion,
    expressionExecutorCompatibilityId: draft.expressionExecutorCompatibilityId,
    expressionExecutorHash: draft.expressionExecutorHash,
    outcomeMappingVersion: draft.outcomeMappingVersion,
    outcomeMappingHash: draft.outcomeMappingHash,
    actionDescriptors: draft.actionDescriptors,
    stepHandlers: draft.stepHandlers,
    steps: draft.steps,
  };
  return { ...draft, manifestHash: computeManifestHash(withoutHash as Omit<CompiledManifest, "manifestHash">) } as CompiledManifest;
}

function expectInvalidResume(manifest: CompiledManifest, runState: RunStateSnapshot, resolution: EffectResolution) {
  const result = resumeRun({ manifest, runState, resolution, transitionBudget: 10 });
  expect(result.commands).toHaveLength(0);
  expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  return result;
}

function compileErrorCodes(definition: FlowDefinition): readonly string[] {
  const result = compileDefinition(definition);
  if (result.ok) throw new Error("expected compile failure");
  return result.errors.map((compileError) => compileError.code);
}

function expectInvalidManifestAtStart(manifest: CompiledManifest): void {
  expect(validateManifestIntegrity(manifest).ok).toBe(false);
  expect(() => startRun({ manifest, runId: "run-invalid-manifest", transitionBudget: 10 })).not.toThrow();
  const result = startRun({ manifest, runId: "run-invalid-manifest", transitionBudget: 10 });
  expect(result.commands).toHaveLength(0);
  expect(result.errors.map((engineError) => engineError.code)).toContain("MANIFEST_INTEGRITY_FAILED");
}

function validDefinitionsForInvariant(): FlowDefinition[] {
  return [
    {
      schemaVersion: "conversational-flow/phase1",
      flowId: "valid-end-only",
      flowVersion: "1",
      entryStepId: "done",
      steps: [{ id: "done", type: "end" }],
    },
    {
      schemaVersion: "conversational-flow/phase1",
      flowId: "valid-set-end",
      flowVersion: "1",
      entryStepId: "set-name",
      steps: [
        { id: "set-name", type: "set_variable", variable: "name", value: { type: "string", value: "Cashin" }, next: "done" },
        { id: "done", type: "end" },
      ],
    },
    definitionWithExtraStep(),
  ];
}

describe("final WAITING_EFFECT binding", () => {
  test("rejects forged terminalOutcomeTransitions that jump to an existing step", () => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const forged = structuredClone(waiting.nextRunState) as MutableRunState;
    if (forged.waitingContinuation === undefined) throw new Error("missing continuation");
    Object.defineProperty(forged.waitingContinuation.terminalOutcomeTransitions, "requested", { value: "evil", enumerable: true, configurable: true, writable: true });

    const result = expectInvalidResume(manifest, forged as RunStateSnapshot, resolution);

    expect(result.nextRunState).toEqual(forged);
    expect(result.nextRunState.variables.jumped).toBeUndefined();
  });

  test.each([
    ["effectContinuationId", "sha256:bad-continuation"],
    ["awaitedLogicalEffectId", "sha256:bad-logical"],
    ["expectedPayloadHash", "sha256:bad-payload"],
    ["outcomeMappingHash", "sha256:bad-mapping"],
  ])("rejects forged continuation %s", (field, value) => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const forged = structuredClone(waiting.nextRunState) as MutableRunState;
    if (forged.waitingContinuation === undefined) throw new Error("missing continuation");
    Object.defineProperty(forged.waitingContinuation, field, { value, enumerable: true, configurable: true, writable: true });

    expectInvalidResume(manifest, forged as RunStateSnapshot, resolution);
  });

  test("rejects WAITING_EFFECT whose currentStepId is not a send_message step", () => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const forged = structuredClone(waiting.nextRunState) as MutableRunState;
    forged.currentStepId = "evil";

    expectInvalidResume(manifest, forged as RunStateSnapshot, resolution);
  });

  test("rejects extra fields in continuation and terminal transitions", () => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const extraContinuation = structuredClone(waiting.nextRunState) as MutableRunState;
    if (extraContinuation.waitingContinuation === undefined) throw new Error("missing continuation");
    Object.defineProperty(extraContinuation.waitingContinuation, "extra", { value: true, enumerable: true });
    expectInvalidResume(manifest, extraContinuation as RunStateSnapshot, resolution);

    const extraTransitions = structuredClone(waiting.nextRunState) as MutableRunState;
    if (extraTransitions.waitingContinuation === undefined) throw new Error("missing continuation");
    Object.defineProperty(extraTransitions.waitingContinuation.terminalOutcomeTransitions, "extra", { value: "done", enumerable: true });
    expectInvalidResume(manifest, extraTransitions as RunStateSnapshot, resolution);
  });
});

describe("final manifest structural validator", () => {
  test("rejects bogus AST even when expression and manifest hashes are recomputed", () => {
    const draft = mutableManifest();
    const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep> | undefined;
    if (condition === undefined) throw new Error("missing condition");
    condition.branches[0]!.when = { kind: "bogus" } as unknown as typeof condition.branches[0]["when"];
    condition.branches[0]!.expressionHash = hashCanonical("expression", condition.branches[0]!.when);
    const manifest = rehashManifest(draft);

    expect(validateManifestIntegrity(manifest).ok).toBe(false);
    const result = startRun({ manifest, runId: "run-bogus", transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
  });

  test("rejects impossible AST types even when hashes are recomputed", () => {
    const draft = mutableManifest();
    const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep> | undefined;
    if (condition === undefined) throw new Error("missing condition");
    condition.branches[0]!.when = {
      kind: "compare",
      operator: "gt",
      left: { kind: "literal", value: { type: "string", value: "a" } },
      right: { kind: "literal", value: { type: "string", value: "b" } },
    };
    condition.branches[0]!.expressionHash = hashCanonical("expression", condition.branches[0]!.when);
    const manifest = rehashManifest(draft);

    expect(validateManifestIntegrity(manifest).ok).toBe(false);
  });

  test.each([
    ["root", (draft: MutableManifest) => Object.defineProperty(draft, "unrecognizedTopLevel", { value: true, enumerable: true })],
    ["handler", (draft: MutableManifest) => Object.defineProperty(draft.stepHandlers[0]!, "extra", { value: true, enumerable: true })],
    ["step", (draft: MutableManifest) => Object.defineProperty(draft.steps[0]!, "extra", { value: true, enumerable: true })],
    ["branch", (draft: MutableManifest) => {
      const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep>;
      Object.defineProperty(condition.branches[0]!, "extra", { value: true, enumerable: true });
    }],
    ["ast", (draft: MutableManifest) => {
      const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep>;
      Object.defineProperty(condition.branches[0]!.when, "extra", { value: true, enumerable: true });
      condition.branches[0]!.expressionHash = hashCanonical("expression", condition.branches[0]!.when);
    }],
    ["typed value", (draft: MutableManifest) => {
      const set = draft.steps.find((step) => step.type === "set_variable");
      if (set !== undefined && set.type === "set_variable") Object.defineProperty(set.value, "extra", { value: true, enumerable: true });
    }],
    ["content", (draft: MutableManifest) => {
      const send = draft.steps.find((step) => step.type === "send_message") as DeepMutable<CompiledSendMessageStep>;
      Object.defineProperty(send.content, "extra", { value: true, enumerable: true });
      send.contentHash = hashCanonical("content", send.content);
    }],
    ["transitions", (draft: MutableManifest) => {
      const send = draft.steps.find((step) => step.type === "send_message") as DeepMutable<CompiledSendMessageStep>;
      Object.defineProperty(send.transitions, "extra", { value: "done", enumerable: true });
    }],
  ])("rejects extra field in %s even with internally consistent hash", (_name, mutate) => {
    const draft = mutableManifest();
    mutate(draft);
    const manifest = rehashManifest(draft);

    expect(validateManifestIntegrity(manifest).ok).toBe(false);
    const result = startRun({ manifest, runId: "run-extra", transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
  });

  test.each([
    ["missing branches", undefined],
    ["non-array branches", "not-array"],
    ["empty branches", []],
  ])("invalid condition branches do not throw: %s", (_name, branches) => {
    const draft = mutableManifest();
    const condition = draft.steps.find((step) => step.type === "condition") as Record<string, unknown> | undefined;
    if (condition === undefined) throw new Error("missing condition");
    if (branches === undefined) delete condition.branches;
    else condition.branches = branches;
    const manifest = rehashManifest(draft);

    expect(() => validateManifestIntegrity(manifest)).not.toThrow();
    expect(validateManifestIntegrity(manifest).ok).toBe(false);
  });
});

describe("final P2 manifest semantics", () => {
  test.each([
    ["empty flowId", (draft: MutableManifest) => { draft.flowId = ""; }],
    ["empty flowVersion", (draft: MutableManifest) => { draft.flowVersion = ""; }],
    ["empty entryStepId", (draft: MutableManifest) => { draft.entryStepId = ""; }],
    ["empty step id", (draft: MutableManifest) => { draft.steps[0]!.id = ""; draft.entryStepId = ""; }],
    ["lone surrogate step id", (draft: MutableManifest) => { draft.steps[0]!.id = "bad\uD800"; draft.entryStepId = "bad\uD800"; }],
    ["reserved step id", (draft: MutableManifest) => { draft.steps[0]!.id = "__proto__"; draft.entryStepId = "__proto__"; }],
    ["lone surrogate branch outcome", (draft: MutableManifest) => {
      const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep>;
      condition.branches[0]!.outcome = "bad\uD800";
    }],
    ["reserved branch outcome", (draft: MutableManifest) => {
      const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep>;
      condition.branches[0]!.outcome = "constructor";
    }],
    ["lone surrogate transition target", (draft: MutableManifest) => {
      const send = draft.steps.find((step) => step.type === "send_message") as DeepMutable<CompiledSendMessageStep>;
      send.transitions.requested = "bad\uD800";
    }],
    ["reserved transition target", (draft: MutableManifest) => {
      const send = draft.steps.find((step) => step.type === "send_message") as DeepMutable<CompiledSendMessageStep>;
      send.transitions.requested = "prototype";
    }],
  ])("rejects semantically invalid manifest identity: %s", (name, mutate) => {
    const draft = mutableManifest();
    mutate(draft);
    const manifest = name.includes("lone surrogate") ? draft as CompiledManifest : rehashManifest(draft);
    expectInvalidManifestAtStart(manifest);
  });

  test.each([
    ["definitionHash", (draft: MutableManifest) => { draft.definitionHash = "sha256:x"; }],
    ["contentHash", (draft: MutableManifest) => {
      const send = draft.steps.find((step) => step.type === "send_message") as DeepMutable<CompiledSendMessageStep>;
      send.contentHash = "sha256:x";
    }],
    ["expressionHash", (draft: MutableManifest) => {
      const condition = draft.steps.find((step) => step.type === "condition") as DeepMutable<CompiledConditionStep>;
      condition.branches[0]!.expressionHash = "sha256:x";
    }],
    ["handlerHash", (draft: MutableManifest) => { draft.stepHandlers[0]!.handlerHash = "sha256:x"; }],
    ["outcomeMappingHash", (draft: MutableManifest) => { draft.outcomeMappingHash = "sha256:x"; }],
    ["step outcomeMappingHash", (draft: MutableManifest) => {
      const send = draft.steps.find((step) => step.type === "send_message") as DeepMutable<CompiledSendMessageStep>;
      send.outcomeMappingHash = "sha256:x";
    }],
  ])("rejects malformed or non-constant hash fields: %s", (_name, mutate) => {
    const draft = mutableManifest();
    mutate(draft);
    expectInvalidManifestAtStart(rehashManifest(draft));
  });

  test("rejects an adulterated manifest with an unreachable cycle and recomputed hashes", () => {
    const draft = mutableManifest(requireManifest({
      schemaVersion: "conversational-flow/phase1",
      flowId: "acyclic-unreachable-base",
      flowVersion: "1",
      entryStepId: "done",
      steps: [
        { id: "done", type: "end" },
        { id: "side", type: "set_variable", variable: "side", value: { type: "boolean", value: true }, next: "done" },
      ],
    }));
    const side = draft.steps.find((step) => step.id === "side");
    if (side === undefined || side.type !== "set_variable") throw new Error("missing side step");
    side.next = "side";

    expectInvalidManifestAtStart(rehashManifest(draft));
  });
});

describe("final compiler consistency invariants", () => {
  test("compile rejects duplicate condition branch outcomes with a stable error", () => {
    const definition = definitionWithExtraStep();
    definition.steps = definition.steps.map((step) =>
      step.id === "check"
        ? {
            ...step,
            branches: [
              { outcome: "c", when: { kind: "literal", value: { type: "boolean", value: false } }, next: "done" },
              { outcome: "c", when: { kind: "literal", value: { type: "boolean", value: true } }, next: "send" },
            ],
          }
        : step,
    );

    expect(compileErrorCodes(definition)).toContain("DUPLICATE_BRANCH_OUTCOME");
  });

  test.each(validDefinitionsForInvariant())("compiled valid manifest validates immediately: %s", (definition) => {
    const result = compileDefinition(definition);

    expect(result.ok).toBe(true);
    if (result.ok) expect(validateManifestIntegrity(result.manifest).ok).toBe(true);
  });

  test("compile rejects an unreachable self-cycle while preserving reachable-end policy", () => {
    const definition: FlowDefinition = {
      schemaVersion: "conversational-flow/phase1",
      flowId: "unreachable-self-cycle",
      flowVersion: "1",
      entryStepId: "done",
      steps: [
        { id: "done", type: "end" },
        { id: "loop", type: "set_variable", variable: "x", value: { type: "number", value: 1 }, next: "loop" },
      ],
    };

    expect(compileErrorCodes(definition)).toContain("CYCLE_NOT_SUPPORTED");
  });

  test("compile rejects an unreachable two-node cycle", () => {
    const definition: FlowDefinition = {
      schemaVersion: "conversational-flow/phase1",
      flowId: "unreachable-two-cycle",
      flowVersion: "1",
      entryStepId: "done",
      steps: [
        { id: "done", type: "end" },
        { id: "loop-a", type: "set_variable", variable: "a", value: { type: "number", value: 1 }, next: "loop-b" },
        { id: "loop-b", type: "set_variable", variable: "b", value: { type: "number", value: 2 }, next: "loop-a" },
      ],
    };

    expect(compileErrorCodes(definition)).toContain("CYCLE_NOT_SUPPORTED");
  });
});

describe("final AST conflict validation", () => {
  test("compile rejects conflicting valueType reads for the same variable inside one AST", () => {
    const definition: FlowDefinition = {
      schemaVersion: "conversational-flow/phase1",
      flowId: "type-conflict",
      flowVersion: "1",
      entryStepId: "set-x",
      steps: [
        { id: "set-x", type: "set_variable", variable: "x", value: { type: "string", value: "s" }, next: "check" },
        {
          id: "check",
          type: "condition",
          branches: [
            {
              outcome: "bad",
              when: {
                kind: "and",
                expressions: [
                  { kind: "compare", operator: "eq", left: { kind: "variable", name: "x", valueType: "number" }, right: { kind: "literal", value: { type: "number", value: 1 } } },
                  { kind: "compare", operator: "eq", left: { kind: "variable", name: "x", valueType: "string" }, right: { kind: "literal", value: { type: "string", value: "s" } } },
                ],
              },
              next: "done",
            },
          ],
        },
        { id: "done", type: "end" },
      ],
    };

    const result = compileDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.code)).toContain("EXPRESSION_TYPE_ERROR");
  });

  test("compile rejects unknown fields in AST nodes", () => {
    const definition = definitionWithExtraStep();
    definition.steps = definition.steps.map((step) =>
      step.id === "check"
        ? {
            ...step,
            branches: [{ outcome: "bad", when: { kind: "literal", value: { type: "boolean", value: true }, extra: "ignored" }, next: "done" }],
          }
        : step,
    );

    const result = compileDefinition(definition);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((error) => error.code)).toContain("EXPRESSION_TYPE_ERROR");
  });
});

describe("final runtime boundaries fail closed", () => {
  test.each([
    ["NaN ordinal", Number.NaN],
    ["Infinity ordinal", Number.POSITIVE_INFINITY],
    ["fraction ordinal", 1.5],
    ["negative ordinal", -1],
    ["MAX_SAFE ordinal", Number.MAX_SAFE_INTEGER],
    ["runtime string ordinal", "3"],
  ])("resume does not throw for invalid activationOrdinal: %s", (_name, activationOrdinal) => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const forged = structuredClone(waiting.nextRunState) as unknown as Record<string, unknown>;
    forged.activationOrdinal = activationOrdinal;

    expect(() => resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 })).not.toThrow();
    const result = resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });

  test.each([
    ["lone surrogate runId", (state: Record<string, unknown>) => { state.runId = "bad\uD800"; }],
    ["lone surrogate variable", (state: Record<string, unknown>) => { state.variables = { x: { type: "string", value: "bad\uD800" } }; }],
    ["lone surrogate continuation", (state: Record<string, unknown>) => {
      const waitingContinuation = (state.waitingContinuation ?? {}) as Record<string, unknown>;
      waitingContinuation.effectContinuationId = "bad\uD800";
      state.waitingContinuation = waitingContinuation;
    }],
    ["lone surrogate consumed", (state: Record<string, unknown>) => {
      state.consumedContinuations = { "bad\uD800": { outcome: "requested", ledgerState: "CONFIRMED", logicalEffectId: "sha256:x", payloadHash: "sha256:y" } };
    }],
    ["null state", () => null],
    ["array state", () => []],
  ])("resume does not throw for invalid snapshot: %s", (_name, mutate) => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const candidate = structuredClone(waiting.nextRunState) as unknown as Record<string, unknown>;
    const mutated = mutate(candidate);
    const maybeState = mutated === undefined ? candidate : mutated;

    expect(() => resumeRun({ manifest, runState: maybeState as unknown as RunStateSnapshot, resolution, transitionBudget: 10 })).not.toThrow();
    const result = resumeRun({ manifest, runState: maybeState as unknown as RunStateSnapshot, resolution, transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });

  test("startRun and resumeRun do not throw for invalid manifest or resolution", () => {
    const manifest = requireManifest();
    const { waiting } = waitingRun(manifest);
    const invalidManifest = { ...structuredClone(manifest), flowId: "bad\uD800" } as CompiledManifest;
    const invalidResolution = { effectContinuationId: "bad\uD800", logicalEffectId: "sha256:x", payloadHash: "sha256:y", ledgerState: "CONFIRMED" } as EffectResolution;

    expect(() => startRun({ manifest: invalidManifest, runId: "run", transitionBudget: 10 })).not.toThrow();
    expect(startRun({ manifest: invalidManifest, runId: "run", transitionBudget: 10 }).errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
    expect(() => resumeRun({ manifest, runState: waiting.nextRunState, resolution: invalidResolution, transitionBudget: 10 })).not.toThrow();
    expect(resumeRun({ manifest, runState: waiting.nextRunState, resolution: invalidResolution, transitionBudget: 10 }).errors.map((error) => error.code)).toContain("INVALID_RESOLUTION");
  });

  test.each([
    ["null manifest", null],
    ["array manifest", []],
    ["string manifest", "not-a-manifest"],
  ])("startRun and resumeRun do not throw for non-object manifest: %s", (_name, manifestValue) => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const invalidManifest = manifestValue as unknown as CompiledManifest;

    expect(() => startRun({ manifest: invalidManifest, runId: "run", transitionBudget: 10 })).not.toThrow();
    expect(startRun({ manifest: invalidManifest, runId: "run", transitionBudget: 10 }).errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
    expect(() => resumeRun({ manifest: invalidManifest, runState: waiting.nextRunState, resolution, transitionBudget: 10 })).not.toThrow();
    expect(resumeRun({ manifest: invalidManifest, runState: waiting.nextRunState, resolution, transitionBudget: 10 }).errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
  });

  test("startRun rejects TypedValue extras before clone without throwing", () => {
    const manifest = requireManifest();
    const initialVariables = { x: { type: "string", value: "ok", extra: undefined } } as unknown as Record<string, { readonly type: "string"; readonly value: string }>;

    expect(() => startRun({ manifest, runId: "run", initialVariables, transitionBudget: 10 })).not.toThrow();
    const result = startRun({ manifest, runId: "run", initialVariables, transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });

  test("resumeRun rejects runState variable TypedValue extras before clone without throwing", () => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const forged = structuredClone(waiting.nextRunState) as unknown as Record<string, unknown>;
    forged.variables = { x: { type: "string", value: "ok", extra: undefined } };

    expect(() => resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 })).not.toThrow();
    const result = resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });

  test.each([
    ["extra consumed field", (consumed: Record<string, unknown>) => { consumed.extra = "nope"; }],
    ["lone surrogate consumed key", (_consumed: Record<string, unknown>, state: Record<string, unknown>, effectContinuationId: string) => {
      const record = state.consumedContinuations as Record<string, unknown>;
      record[`bad\uD800${effectContinuationId}`] = record[effectContinuationId];
      delete record[effectContinuationId];
    }],
    ["empty consumed key", (_consumed: Record<string, unknown>, state: Record<string, unknown>, effectContinuationId: string) => {
      const record = state.consumedContinuations as Record<string, unknown>;
      record[""] = record[effectContinuationId];
      delete record[effectContinuationId];
    }],
    ["bad logical hash", (consumed: Record<string, unknown>) => { consumed.logicalEffectId = "sha256:not-hex"; }],
    ["bad payload hash", (consumed: Record<string, unknown>) => { consumed.payloadHash = "payload"; }],
  ])("resumeRun rejects invalid consumed continuation shape: %s", (_name, mutate) => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const completed = resumeRun({ manifest, runState: waiting.nextRunState, resolution, transitionBudget: 10 });
    const forged = structuredClone(completed.nextRunState) as unknown as Record<string, unknown>;
    const consumedRecord = forged.consumedContinuations as Record<string, unknown>;
    const consumed = consumedRecord[resolution.effectContinuationId] as Record<string, unknown>;
    mutate(consumed, forged, resolution.effectContinuationId);

    expect(() => resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 })).not.toThrow();
    const result = resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });

  test.each([
    ["RUNNING with lastErrorCode", (state: Record<string, unknown>) => {
      delete state.waitingContinuation;
      state.status = "RUNNING";
      state.currentStepId = "send";
      state.lastErrorCode = "STEP_NOT_FOUND" satisfies EngineErrorCode;
    }],
    ["RUNNING with waitingContinuation", (state: Record<string, unknown>) => {
      state.status = "RUNNING";
    }],
    ["COMPLETED with lastErrorCode", (state: Record<string, unknown>) => {
      delete state.waitingContinuation;
      state.status = "COMPLETED";
      state.currentStepId = null;
      state.lastErrorCode = "STEP_NOT_FOUND" satisfies EngineErrorCode;
    }],
    ["COMPLETED with waitingContinuation", (state: Record<string, unknown>) => {
      state.status = "COMPLETED";
      state.currentStepId = null;
    }],
    ["WAITING_EFFECT with lastErrorCode", (state: Record<string, unknown>) => {
      state.lastErrorCode = "STEP_NOT_FOUND" satisfies EngineErrorCode;
    }],
    ["FAILED with invalid lastErrorCode", (state: Record<string, unknown>) => {
      delete state.waitingContinuation;
      state.status = "FAILED";
      state.currentStepId = null;
      state.lastErrorCode = "NOT_A_CODE";
    }],
  ])("resumeRun rejects status-incompatible fields: %s", (_name, mutate) => {
    const manifest = requireManifest();
    const { waiting, resolution } = waitingRun(manifest);
    const forged = structuredClone(waiting.nextRunState) as unknown as Record<string, unknown>;
    mutate(forged);

    expect(() => resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 })).not.toThrow();
    const result = resumeRun({ manifest, runState: forged as unknown as RunStateSnapshot, resolution, transitionBudget: 10 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });
});
