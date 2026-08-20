import { describe, expect, test } from "bun:test";
import {
  RecordingEffectSink,
  compileDefinition,
  resumeRun,
  startRun,
  type CompiledManifest,
  type EffectResolution,
  type FlowDefinition,
} from "./index";

function validDefinition(): FlowDefinition {
  return {
    schemaVersion: "conversational-flow/phase1",
    flowId: "flow-onboarding",
    flowVersion: "2026-08-06.1",
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
          {
            outcome: "low",
            when: { kind: "literal", value: { type: "boolean", value: true } },
            next: "done",
          },
        ],
      },
      {
        id: "send-welcome",
        type: "send_message",
        content: {
          contentVersionId: "welcome-copy-v1",
          text: "Bienvenido a Cashin.",
        },
        transitions: { requested: "done", failed: "done" },
      },
      { id: "done", type: "end" },
    ],
  };
}

function requireManifest(definition: FlowDefinition = validDefinition()): CompiledManifest {
  const result = compileDefinition(definition);
  if (!result.ok) {
    throw new Error(`Expected compilation to pass, got ${result.errors.map((error) => error.code).join(",")}`);
  }
  return result.manifest;
}

function compileCodes(definition: FlowDefinition): readonly string[] {
  const result = compileDefinition(definition);
  if (result.ok) {
    throw new Error("Expected compilation to fail");
  }
  return result.errors.map((error) => error.code);
}

function terminalResolution(manifest: CompiledManifest): EffectResolution {
  const first = startRun({ manifest, runId: "run-1", transitionBudget: 10 });
  const command = first.commands[0];
  if (command === undefined) {
    throw new Error("Expected a blocking command");
  }

  return {
    effectContinuationId: command.effectContinuationId,
    logicalEffectId: command.logicalEffectId,
    payloadHash: command.payloadHash,
    ledgerState: "CONFIRMED",
  };
}

describe("conversational-platform phase 1 compiler", () => {
  test("compiles a valid versioned definition with a reproducible manifest hash", () => {
    const first = requireManifest();
    const second = requireManifest(structuredClone(validDefinition()));

    expect(first.schemaVersion).toBe("compiled-manifest/phase1");
    expect(first.definitionHash).toBe(second.definitionHash);
    expect(first.manifestHash).toBe(second.manifestHash);
    expect(first.canonicalCodecVersion).toBe("jcs-rfc8785-subset-v1");
    expect(first.expressionExecutorCompatibilityId).toBe("typed-expression-phase1-v1");
    expect(first.outcomeMappingVersion).toBe("send-message-terminal-v1");
    expect(first.stepHandlers.map((handler) => handler.stepType).sort()).toEqual([
      "condition",
      "end",
      "send_message",
      "set_variable",
    ]);
  });

  test("rejects duplicate step ids, missing entry, missing transitions, unsupported types, and graphs without a reachable end", () => {
    const duplicateIds = validDefinition();
    duplicateIds.steps = [duplicateIds.steps[0]!, { ...duplicateIds.steps[0]! }, ...duplicateIds.steps.slice(1)];
    expect(compileCodes(duplicateIds)).toContain("DUPLICATE_STEP_ID");

    const missingEntry = validDefinition();
    missingEntry.entryStepId = "missing";
    expect(compileCodes(missingEntry)).toContain("ENTRY_STEP_NOT_FOUND");

    const missingTransition = validDefinition();
    missingTransition.steps = missingTransition.steps.map((step) =>
      step.id === "send-welcome" && step.type === "send_message"
        ? { ...step, transitions: { requested: "missing", failed: "done" } }
        : step,
    );
    expect(compileCodes(missingTransition)).toContain("TRANSITION_TARGET_NOT_FOUND");

    const unsupported = validDefinition();
    unsupported.steps = [
      { id: "collect", type: "collect_input", next: "done" },
      { id: "done", type: "end" },
    ];
    unsupported.entryStepId = "collect";
    expect(compileCodes(unsupported)).toContain("UNSUPPORTED_STEP_TYPE");

    const noReachableEnd: FlowDefinition = {
      schemaVersion: "conversational-flow/phase1",
      flowId: "flow-loop",
      flowVersion: "2026-08-06.1",
      entryStepId: "loop",
      steps: [{ id: "loop", type: "set_variable", variable: "x", value: { type: "number", value: 1 }, next: "loop" }],
    };
    expect(compileCodes(noReachableEnd)).toContain("NO_REACHABLE_END");
  });

  test("rejects string expressions instead of typed condition AST", () => {
    const unsafe = validDefinition();
    unsafe.steps = unsafe.steps.map((step) =>
      step.id === "check-score" && step.type === "condition"
        ? {
            ...step,
            branches: [{ outcome: "unsafe", when: "score >= 5", next: "send-welcome" }],
          }
        : step,
    );

    expect(compileCodes(unsafe)).toContain("INVALID_EXPRESSION_AST");
  });

  test("manifest proves no supported step can emit two blocking commands in this slice", () => {
    const manifest = requireManifest();

    expect(manifest.stepHandlers.every((handler) => handler.blockingCommandCount <= 1)).toBe(true);
    expect(manifest.steps.every((step) => step.blockingCommandCount <= 1)).toBe(true);
  });
});

describe("conversational-platform phase 1 pure engine", () => {
  test("evaluates conditions deterministically and never mutates caller variables", () => {
    const manifest = requireManifest();
    const callerVariables = { score: { type: "number" as const, value: 1 } };

    const transition = startRun({ manifest, runId: "run-1", initialVariables: callerVariables, transitionBudget: 10 });

    expect(callerVariables.score.value).toBe(1);
    expect(transition.nextRunState.variables.score).toEqual({ type: "number", value: 7 });
    expect(transition.nextRunState.status).toBe("WAITING_EFFECT");
    expect(transition.commands).toHaveLength(1);
  });

  test("produces stable command, logicalEffectId, and effectContinuationId when recomputed", () => {
    const manifest = requireManifest();

    const first = startRun({ manifest, runId: "run-stable", transitionBudget: 10 });
    const second = startRun({ manifest, runId: "run-stable", transitionBudget: 10 });

    expect(first.commands).toHaveLength(1);
    expect(second.commands).toHaveLength(1);
    expect(first.commands[0]).toEqual(second.commands[0]);
    expect(first.nextRunState.waitingContinuation?.effectContinuationId).toBe(first.commands[0]?.effectContinuationId);
    expect(first.commands[0]?.logicalEffectId).not.toContain("attempt");
  });

  test("leaves the run WAITING_EFFECT, then resumes a terminal resolution to COMPLETED", () => {
    const manifest = requireManifest();
    const waiting = startRun({ manifest, runId: "run-resume", transitionBudget: 10 });
    const command = waiting.commands[0];
    if (command === undefined) {
      throw new Error("Expected command");
    }

    expect(waiting.nextRunState.status).toBe("WAITING_EFFECT");
    expect(waiting.nextRunState.waitingContinuation).toEqual({
      effectContinuationId: command.effectContinuationId,
      awaitedLogicalEffectId: command.logicalEffectId,
      expectedPayloadHash: command.payloadHash,
      outcomeMappingVersion: "send-message-terminal-v1",
      outcomeMappingHash: command.outcomeMappingHash,
      state: "WAITING",
      terminalOutcomeTransitions: { requested: "done", failed: "done" },
    });

    const resumed = resumeRun({
      manifest,
      runState: waiting.nextRunState,
      resolution: {
        effectContinuationId: command.effectContinuationId,
        logicalEffectId: command.logicalEffectId,
        payloadHash: command.payloadHash,
        ledgerState: "CONFIRMED",
      },
      transitionBudget: 10,
    });

    expect(resumed.commands).toHaveLength(0);
    expect(resumed.nextRunState.status).toBe("COMPLETED");
    expect(resumed.nextRunState.consumedContinuations[command.effectContinuationId]?.outcome).toBe("requested");
  });

  test("does not consume ambiguous outcomes", () => {
    const manifest = requireManifest();
    const waiting = startRun({ manifest, runId: "run-ambiguous", transitionBudget: 10 });
    const command = waiting.commands[0];
    if (command === undefined) {
      throw new Error("Expected command");
    }

    for (const ledgerState of ["UNKNOWN", "RECONCILING", "MANUAL_REVIEW"] as const) {
      const resumed = resumeRun({
        manifest,
        runState: waiting.nextRunState,
        resolution: {
          effectContinuationId: command.effectContinuationId,
          logicalEffectId: command.logicalEffectId,
          payloadHash: command.payloadHash,
          ledgerState,
        },
        transitionBudget: 10,
      });

      expect(resumed.nextRunState.status).toBe("WAITING_EFFECT");
      expect(resumed.commands).toHaveLength(0);
      expect(resumed.errors.map((error) => error.code)).toContain("NON_CONSUMABLE_EFFECT_STATE");
    }
  });

  test("double resume is idempotent and does not duplicate activations or commands", () => {
    const manifest = requireManifest();
    const waiting = startRun({ manifest, runId: "run-double-resume", transitionBudget: 10 });
    const command = waiting.commands[0];
    if (command === undefined) {
      throw new Error("Expected command");
    }
    const resolution: EffectResolution = {
      effectContinuationId: command.effectContinuationId,
      logicalEffectId: command.logicalEffectId,
      payloadHash: command.payloadHash,
      ledgerState: "CONFIRMED",
    };

    const first = resumeRun({ manifest, runState: waiting.nextRunState, resolution, transitionBudget: 10 });
    const second = resumeRun({ manifest, runState: first.nextRunState, resolution, transitionBudget: 10 });

    expect(second.nextRunState).toEqual(first.nextRunState);
    expect(second.commands).toHaveLength(0);
    expect(second.auditFacts.map((fact) => fact.type)).toContain("CONTINUATION_ALREADY_CONSUMED");
  });

  test("transition budget blocks a valid acyclic run when the budget is insufficient", () => {
    const manifest = requireManifest();

    const transition = startRun({ manifest, runId: "run-budget", transitionBudget: 2 });

    expect(transition.nextRunState.status).toBe("FAILED");
    expect(transition.errors.map((error) => error.code)).toContain("TRANSITION_BUDGET_EXCEEDED");
    expect(transition.commands).toHaveLength(0);
  });

  test("RecordingEffectSink records commands in memory without mutating inputs", () => {
    const manifest = requireManifest();
    const transition = startRun({ manifest, runId: "run-sink", transitionBudget: 10 });
    const sink = new RecordingEffectSink();

    const recorded = sink.record(transition.commands);

    expect(recorded).toEqual(transition.commands);
    expect(sink.entries()).toEqual(transition.commands);
    expect(sink.entries()).not.toBe(transition.commands);
  });

  test("terminal send_message failed resolution follows the compiled mapping", () => {
    const manifest = requireManifest();
    const resolution = terminalResolution(manifest);

    const waiting = startRun({ manifest, runId: "run-1", transitionBudget: 10 });
    const failed = resumeRun({
      manifest,
      runState: waiting.nextRunState,
      resolution: { ...resolution, ledgerState: "FAILED_PERMANENT" },
      transitionBudget: 10,
    });

    expect(failed.nextRunState.status).toBe("COMPLETED");
    expect(failed.nextRunState.consumedContinuations[resolution.effectContinuationId]?.outcome).toBe("failed");
  });

  test("send_message rejects action-only business result codes", () => {
    const manifest = requireManifest();
    const waiting = startRun({ manifest, runId: "run-message-business-code", transitionBudget: 10 });
    const command = waiting.commands[0];
    if (command === undefined) throw new Error("Expected command");

    const result = resumeRun({
      manifest,
      runState: waiting.nextRunState,
      resolution: {
        effectContinuationId: command.effectContinuationId,
        logicalEffectId: command.logicalEffectId,
        payloadHash: command.payloadHash,
        ledgerState: "CONFIRMED",
        businessResultCode: "NOT_APPLICABLE",
      },
      transitionBudget: 10,
    });

    expect(result.nextRunState).toEqual(waiting.nextRunState);
    expect(result.errors.map((error) => error.code)).toContain("NON_CONSUMABLE_EFFECT_STATE");
  });
});
