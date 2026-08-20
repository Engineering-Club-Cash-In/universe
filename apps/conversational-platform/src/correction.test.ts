import { describe, expect, test } from "bun:test";
import {
  canonicalizeForHash,
  compileDefinition,
  hashCanonical,
  resumeRun,
  startRun,
  type CompiledManifest,
  type CompiledSendMessageStep,
  type EffectResolution,
  type FlowDefinition,
  type RunStateSnapshot,
} from "./index";

function validDefinition(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    schemaVersion: "conversational-flow/phase1",
    flowId: "flow-correction",
    flowVersion: "2026-08-06.2",
    entryStepId: "set-score",
    steps: [
      {
        id: "set-score",
        type: "set_variable",
        variable: "score",
        value: { type: "number", value: 7 },
        next: "check-score",
      },
      {
        id: "check-score",
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
            next: "send-welcome",
          },
        ],
      },
      {
        id: "send-welcome",
        type: "send_message",
        content: { contentVersionId: "welcome-copy-v1", text: "Bienvenido." },
        transitions: { requested: "done", failed: "done" },
      },
      { id: "done", type: "end" },
    ],
    ...overrides,
  };
}

function requireManifest(definition: unknown = validDefinition()): CompiledManifest {
  const result = compileDefinition(definition);
  if (!result.ok) {
    throw new Error(`Expected compile success: ${result.errors.map((error) => error.code).join(",")}`);
  }
  return result.manifest;
}

function compileCodes(definition: unknown): readonly string[] {
  const result = compileDefinition(definition);
  if (result.ok) {
    throw new Error("Expected compile failure");
  }
  return result.errors.map((error) => error.code);
}

function waitingRun(manifest: CompiledManifest = requireManifest()) {
  const transition = startRun({ manifest, runId: "run-correction", transitionBudget: 10 });
  const command = transition.commands[0];
  if (command === undefined) {
    throw new Error("Expected command");
  }
  const resolution: EffectResolution = {
    effectContinuationId: command.effectContinuationId,
    logicalEffectId: command.logicalEffectId,
    payloadHash: command.payloadHash,
    ledgerState: "CONFIRMED",
  };
  return { transition, command, resolution };
}

function tamperManifest(manifest: CompiledManifest, mutate: (draft: MutableManifest) => void): CompiledManifest {
  const draft = structuredClone(manifest) as MutableManifest;
  mutate(draft);
  return draft as CompiledManifest;
}

type MutableManifest = DeepWritable<CompiledManifest>;

type DeepWritable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? DeepWritable<U>[] : T[K] extends object ? DeepWritable<T[K]> : T[K] };

type Writable<T> = { -readonly [K in keyof T]: T[K] };

describe("corrective manifest pinning and integrity", () => {
  test("resume rejects a run created by another manifest", () => {
    const manifestA = requireManifest();
    const manifestB = requireManifest(
      validDefinition({ flowVersion: "2026-08-06.3", steps: validDefinition().steps.map((step) => (step.id === "done" ? step : step)) }),
    );
    const { transition, resolution } = waitingRun(manifestA);

    const result = resumeRun({ manifest: manifestB, runState: transition.nextRunState, resolution, transitionBudget: 10 });

    expect(result.nextRunState).toEqual(transition.nextRunState);
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("MANIFEST_MISMATCH");
  });

  test("start and resume reject a tampered manifest that preserves the old hash", () => {
    const manifest = requireManifest();
    const tampered = tamperManifest(manifest, (draft) => {
      const send = draft.steps.find((step) => step.type === "send_message") as Writable<CompiledSendMessageStep> | undefined;
      if (send) {
        send.content = { ...send.content, text: "Tampered copy" };
      }
    });

    const start = startRun({ manifest: tampered, runId: "run-tampered", transitionBudget: 10 });
    expect(start.commands).toHaveLength(0);
    expect(start.errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");

    const { transition, resolution } = waitingRun(manifest);
    const resumed = resumeRun({ manifest: tampered, runState: transition.nextRunState, resolution, transitionBudget: 10 });
    expect(resumed.nextRunState).toEqual(transition.nextRunState);
    expect(resumed.commands).toHaveLength(0);
    expect(resumed.errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
  });

  test("outcome mapper version/hash is resolved from the manifest and fails closed when absent or tampered", () => {
    const manifest = requireManifest();
    const { transition, resolution } = waitingRun(manifest);
    const badVersion = tamperManifest(manifest, (draft) => {
      draft.outcomeMappingVersion = "missing-mapper-v1" as "send-message-terminal-v1";
    });
    const badHash = tamperManifest(manifest, (draft) => {
      draft.outcomeMappingHash = hashCanonical("outcome-mapping", { key: "wrong" });
    });

    for (const tampered of [badVersion, badHash]) {
      const result = resumeRun({ manifest: tampered, runState: transition.nextRunState, resolution, transitionBudget: 10 });
      expect(result.nextRunState).toEqual(transition.nextRunState);
      expect(result.commands).toHaveLength(0);
      expect(result.errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
    }
  });
});

describe("corrective continuation idempotence", () => {
  test.each([
    ["logicalEffectId", { logicalEffectId: "sha256:0000" }],
    ["payloadHash", { payloadHash: "sha256:1111" }],
    ["ledgerState", { ledgerState: "FAILED_PERMANENT" as const }],
    ["effectContinuationId", { effectContinuationId: "sha256:2222" }],
  ])("consumed continuation conflict when %s changes", (_field, patch) => {
    const manifest = requireManifest();
    const { transition, resolution } = waitingRun(manifest);
    const first = resumeRun({ manifest, runState: transition.nextRunState, resolution, transitionBudget: 10 });
    const conflicting = { ...resolution, ...patch };

    const second = resumeRun({ manifest, runState: first.nextRunState, resolution: conflicting, transitionBudget: 10 });

    expect(second.nextRunState).toEqual(first.nextRunState);
    expect(second.commands).toHaveLength(0);
    expect(second.auditFacts.map((fact) => fact.type)).not.toContain("CONTINUATION_ALREADY_CONSUMED");
    expect(second.errors.map((error) => error.code)).toContain(
      "effectContinuationId" in patch ? "CONTINUATION_MISMATCH" : "CONSUMED_CONTINUATION_CONFLICT",
    );
  });
});

describe("corrective SHA-256 and JCS canonicalization", () => {
  test("uses SHA-256 over UTF-8 with domain separation", () => {
    expect(canonicalizeForHash({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashCanonical("test-domain", { b: 2, a: 1 })).toBe(
      "sha256:3a38bb0831c5bda28521916d241489ae8dd2901c0df5d195cdf32515aeeb08ca",
    );
    expect(hashCanonical("other-domain", { b: 2, a: 1 })).not.toBe(hashCanonical("test-domain", { b: 2, a: 1 }));
  });

  test("canonicalizes strings, unicode, key order, -0, and exponents according to the accepted JCS subset", () => {
    expect(canonicalizeForHash({ "é": "cash\n💬", z: -0, n: 1e30, small: 0.000001 })).toBe(
      '{"n":1e+30,"small":0.000001,"z":0,"é":"cash\\n💬"}',
    );
  });

  test.each([
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["undefined", { value: undefined }],
    ["function", { value: () => "x" }],
    ["symbol", { value: Symbol("x") }],
    ["bigint", { value: BigInt(1) }],
    ["lone surrogate value", { value: "\uD800" }],
    ["lone surrogate key", { "\uD800": "x" }],
    ["sparse array", { value: [, 1] }],
  ])("rejects non-canonical JSON input: %s", (_name, value) => {
    expect(() => canonicalizeForHash(value)).toThrow();
  });

  test("does not prototype-pollute when cloning dangerous keys", () => {
    const result = compileDefinition({
      schemaVersion: "conversational-flow/phase1",
      flowId: "flow-danger",
      flowVersion: "1",
      entryStepId: "set-danger",
      steps: [
        { id: "set-danger", type: "set_variable", variable: "__proto__", value: { type: "string", value: "x" }, next: "done" },
        { id: "done", type: "end" },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toContain("RESERVED_NAME");
    }
  });
});

describe("corrective snapshot isolation and budgets", () => {
  test("public snapshots are deep-frozen and do not alias manifest transitions", () => {
    const manifest = requireManifest();
    const { transition, command } = waitingRun(manifest);
    const send = manifest.steps.find((step) => step.type === "send_message") as CompiledSendMessageStep | undefined;

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(transition.nextRunState)).toBe(true);
    expect(transition.nextRunState.waitingContinuation?.terminalOutcomeTransitions).not.toBe(send?.transitions);
    expect(transition.nextRunState.waitingContinuation?.effectContinuationId).toBe(command.effectContinuationId);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, -1, Number.MAX_SAFE_INTEGER])(
    "invalid transitionBudget %p fails before executing",
    (transitionBudget) => {
      const result = startRun({ manifest: requireManifest(), runId: "run-budget", transitionBudget });
      expect(result.commands).toHaveLength(0);
      expect(result.errors.map((error) => error.code)).toContain("INVALID_TRANSITION_BUDGET");
      expect(result.auditFacts.map((fact) => fact.type)).not.toContain("STEP_ACTIVATED");
    },
  );

  test("valid acyclic definition with insufficient budget fails without legitimizing cycles", () => {
    const result = startRun({ manifest: requireManifest(), runId: "run-low-budget", transitionBudget: 2 });
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("TRANSITION_BUDGET_EXCEEDED");
  });

  test("resume validates run state shape and safe activation ordinals", () => {
    const manifest = requireManifest();
    const { transition, resolution } = waitingRun(manifest);
    const invalidState: RunStateSnapshot = { ...transition.nextRunState, activationOrdinal: Number.MAX_SAFE_INTEGER };

    const result = resumeRun({ manifest, runState: invalidState, resolution, transitionBudget: 10 });

    expect(result.nextRunState).toEqual(invalidState);
    expect(result.commands).toHaveLength(0);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });
});

describe("corrective compiler fail-closed and dataflow", () => {
  test("compileDefinition accepts unknown malformed inputs without throwing", () => {
    for (const malformed of [null, undefined, 42, {}, { schemaVersion: "conversational-flow/phase1", steps: "nope" }]) {
      expect(() => compileDefinition(malformed)).not.toThrow();
      expect(compileDefinition(malformed).ok).toBe(false);
    }
  });

  test("rejects cycles in the supported subset", () => {
    const cyclic = validDefinition({
      entryStepId: "loop",
      steps: [
        { id: "loop", type: "condition", branches: [{ outcome: "again", when: { kind: "literal", value: { type: "boolean", value: true } }, next: "loop" }] },
        { id: "done", type: "end" },
      ],
    });
    expect(compileCodes(cyclic)).toContain("CYCLE_NOT_SUPPORTED");
  });

  test.each([
    ["literal number condition", { kind: "literal", value: { type: "number", value: 1 } }],
    ["ordered compare strings", { kind: "compare", operator: "gt", left: { kind: "literal", value: { type: "string", value: "a" } }, right: { kind: "literal", value: { type: "string", value: "b" } } }],
    ["empty and", { kind: "and", expressions: [] }],
  ])("rejects invalid AST: %s", (_name, when) => {
    const definition = validDefinition();
    definition.steps = definition.steps.map((step) =>
      step.id === "check-score" ? { ...step, branches: [{ outcome: "bad", when, next: "send-welcome" }] } : step,
    );
    expect(compileCodes(definition)).toContain("EXPRESSION_TYPE_ERROR");
  });

  test("rejects variable reads not definitely initialized on all paths", () => {
    const definition: FlowDefinition = {
      schemaVersion: "conversational-flow/phase1",
      flowId: "flow-dataflow",
      flowVersion: "1",
      entryStepId: "check",
      steps: [
        {
          id: "check",
          type: "condition",
          branches: [
            { outcome: "bad", when: { kind: "variable", name: "missing", valueType: "boolean" }, next: "done" },
          ],
        },
        { id: "done", type: "end" },
      ],
    };
    expect(compileCodes(definition)).toContain("VARIABLE_NOT_INITIALIZED");
  });

  test("rejects unsupported extra fields", () => {
    expect(compileCodes({ ...validDefinition(), extra: true })).toContain("UNSUPPORTED_FIELD");
  });
});

describe("corrective outcome states", () => {
  test("DENIED maps to failed while NOT_APPLIED and CANCELLED_BEFORE_DISPATCH do not resume", () => {
    const manifest = requireManifest();
    const { transition, command, resolution } = waitingRun(manifest);

    const denied = resumeRun({ manifest, runState: transition.nextRunState, resolution: { ...resolution, ledgerState: "DENIED" }, transitionBudget: 10 });
    expect(denied.nextRunState.status).toBe("COMPLETED");
    expect(denied.nextRunState.consumedContinuations[command.effectContinuationId]?.outcome).toBe("failed");

    for (const ledgerState of ["NOT_APPLIED", "CANCELLED_BEFORE_DISPATCH"] as const) {
      const result = resumeRun({ manifest, runState: transition.nextRunState, resolution: { ...resolution, ledgerState }, transitionBudget: 10 });
      expect(result.nextRunState.status).toBe("WAITING_EFFECT");
      expect(result.commands).toHaveLength(0);
      expect(result.errors.map((error) => error.code)).toContain("NON_CONSUMABLE_EFFECT_STATE");
    }
  });
});
