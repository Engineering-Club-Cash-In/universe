import { describe, expect, test } from "bun:test";
import {
  FakeActionAdapter,
  FakeTrustedClaimRepository,
  NetworkDenySimulator,
  RecordingEffectSink,
  SimulationActionRegistry,
  VersionedPolicyEngine,
  compileDefinition,
  createActionDescriptor,
  createPolicyBundle,
  hashCanonical,
  resumeRun,
  startRun,
  type ActionDescriptor,
  type CompiledExecuteActionStep,
  type CompiledManifest,
  type EffectResolution,
  type ExecuteActionCommand,
  type FakeActionObservation,
  type FlowDefinition,
  type PolicyBundle,
  type TrustedClaim,
} from "./index";

type DeepMutable<T> = {
  -readonly [K in keyof T]: T[K] extends readonly (infer U)[]
    ? DeepMutable<U>[]
    : T[K] extends object
      ? DeepMutable<T[K]>
      : T[K];
};

const NOW = "2026-08-20T12:00:00.000Z";

function policy(overrides: Partial<Omit<PolicyBundle, "policyHash">> = {}): PolicyBundle {
  return createPolicyBundle({
    policyKey: "verified-customer-action",
    policyVersion: "1.0.0",
    flowGrantId: "grant-simulator",
    environment: "SIMULATION",
    requiredAssuranceLevel: "VERIFIED",
    allowedIssuers: [{ issuerKey: "fixture-issuer", issuerVersion: "1.0.0" }],
    ...overrides,
  });
}

function descriptor(bundle: PolicyBundle = policy(), overrides: Partial<Parameters<typeof createActionDescriptor>[0]> = {}): ActionDescriptor {
  return createActionDescriptor({
    actionKey: "customer.lookup",
    actionVersion: "1.0.0",
    inputSchema: {
      schemaVersion: "typed-record/v1",
      fields: [{ name: "customerId", type: "string", required: true }],
      additionalProperties: false,
    },
    outputSchema: {
      schemaVersion: "typed-record/v1",
      fields: [{ name: "found", type: "boolean", required: true }],
      additionalProperties: false,
    },
    sensitivity: "SENSITIVE",
    purpose: "customer_support",
    dataClasses: ["CUSTOMER_IDENTIFIER"],
    retryPolicy: { retryPolicyKey: "no-blind-retry", retryPolicyVersion: "1.0.0", maxAttempts: 1 },
    reconcileMode: "READ_ONLY",
    effectGuarantee: "RECONCILABLE",
    adapterKey: "fake.customer-directory",
    adapterVersion: "1.0.0",
    policy: { policyKey: bundle.policyKey, policyVersion: bundle.policyVersion, policyHash: bundle.policyHash },
    businessResultCodes: ["NOT_FOUND"],
    ...overrides,
  });
}

function definition(
  actionVersion = "1.0.0",
  input: Readonly<Record<string, import("./types").TypedValue>> = { customerId: { type: "string", value: "customer-7" } },
): FlowDefinition {
  return {
    schemaVersion: "conversational-flow/phase1",
    flowId: "execute-action-flow",
    flowVersion: "1",
    entryStepId: "lookup",
    steps: [
      {
        id: "lookup",
        type: "execute_action",
        actionKey: "customer.lookup",
        actionVersion,
        subjectId: "subject-7",
        conversationId: "conversation-7",
        input,
        transitions: { succeeded: "done", business_error: "done", technical_error: "done" },
      },
      { id: "done", type: "end" },
    ],
  };
}

function requireManifest(registry: SimulationActionRegistry, candidate: FlowDefinition = definition()): CompiledManifest {
  const result = compileDefinition(candidate, { actionRegistry: registry });
  if (!result.ok) throw new Error(result.errors.map((error) => error.code).join(","));
  return result.manifest;
}

function validClaim(overrides: Partial<TrustedClaim> = {}): TrustedClaim {
  return {
    claimType: "customer_identity",
    subjectId: "subject-7",
    assuranceLevel: "VERIFIED",
    issuerKey: "fixture-issuer",
    issuerVersion: "1.0.0",
    method: "fixture",
    evidenceRef: "fixture:evidence-7",
    issuedAt: "2026-08-20T10:00:00.000Z",
    expiresAt: "2026-08-20T14:00:00.000Z",
    ...overrides,
  };
}

function simulator(
  observation: FakeActionObservation,
  claims: readonly TrustedClaim[] = [validClaim()],
  bundle: PolicyBundle = policy(),
  actionDescriptor: ActionDescriptor = descriptor(bundle),
) {
  const registry = new SimulationActionRegistry([actionDescriptor]);
  const adapter = new FakeActionAdapter({
    adapterKey: actionDescriptor.adapter.adapterKey,
    adapterVersion: actionDescriptor.adapter.adapterVersion,
    implementationCompatibilityId: actionDescriptor.adapter.implementationCompatibilityId,
    adapterHash: actionDescriptor.adapter.adapterHash,
    fixtures: [{ actionKey: actionDescriptor.actionKey, actionVersion: actionDescriptor.actionVersion, observation }],
  });
  const sink = new RecordingEffectSink();
  const runtime = new NetworkDenySimulator({
    actionRegistry: registry,
    policyEngine: new VersionedPolicyEngine([bundle]),
    trustedClaimRepository: new FakeTrustedClaimRepository({ generation: "fixture-generation-1", claims }),
    actionAdapters: [adapter],
    effectSink: sink,
    flowGrantId: "grant-simulator",
    environment: "SIMULATION",
  });
  return { registry, adapter, sink, runtime };
}

function startAction(manifest: CompiledManifest, runId = "run-action", runtime?: NetworkDenySimulator) {
  const waiting = runtime === undefined
    ? startRun({ manifest, runId, transitionBudget: 10 })
    : runtime.start({ manifest, runId, transitionBudget: 10 });
  const command = waiting.commands[0];
  if (command?.kind !== "EXECUTE_ACTION") throw new Error("Expected EXECUTE_ACTION command");
  return { waiting, command };
}

describe("versioned Action Registry and compilation", () => {
  test("pins immutable action, schema, adapter, retry, reconcile, and policy dependencies with reproducible hashes", () => {
    const bundle = policy();
    const actionDescriptor = descriptor(bundle);
    const registry = new SimulationActionRegistry([actionDescriptor]);

    const first = requireManifest(registry);
    const second = requireManifest(registry, structuredClone(definition()));
    const step = first.steps[0] as CompiledExecuteActionStep;

    expect(first.manifestHash).toBe(second.manifestHash);
    expect(first.actionDescriptors).toHaveLength(1);
    expect(first.actionDescriptors[0]).toEqual(actionDescriptor);
    expect(step.actionRef).toEqual({
      actionKey: actionDescriptor.actionKey,
      actionVersion: actionDescriptor.actionVersion,
      actionHash: actionDescriptor.actionHash,
      adapter: actionDescriptor.adapter,
      policy: actionDescriptor.policy,
    });
    expect(Object.isFrozen(registry.resolve("customer.lookup", "1.0.0"))).toBe(true);
    expect(registry.resolve("customer.lookup", "latest")).toBeUndefined();
    expect(actionDescriptor.adapter.implementationCompatibilityId).toBe("fake-action-adapter/v1");
    expect(
      () => new FakeActionAdapter({ ...actionDescriptor.adapter, adapterHash: hashCanonical("forged-adapter", {}), fixtures: [] }),
    ).toThrow("compatibility identity");
  });

  test("fails closed when an exact action is absent or the input schema is incompatible", () => {
    const registry = new SimulationActionRegistry([descriptor()]);
    const missing = compileDefinition(definition("2.0.0"), { actionRegistry: registry });
    const incompatible = compileDefinition(
      definition("1.0.0", { customerId: { type: "number", value: 7 } }),
      { actionRegistry: registry },
    );

    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.map((error) => error.code)).toContain("ACTION_DEPENDENCY_NOT_FOUND");
    expect(incompatible.ok).toBe(false);
    if (!incompatible.ok) expect(incompatible.errors.map((error) => error.code)).toContain("ACTION_INPUT_SCHEMA_MISMATCH");
  });

  test("rejects descriptor conflicts for the same action key and version", () => {
    const first = descriptor();
    const conflicting = descriptor(policy(), { purpose: "collections" });

    expect(() => new SimulationActionRegistry([first, conflicting])).toThrow("immutable descriptor conflict");
  });
});

describe("execute_action manifest and pure engine", () => {
  test("rejects action, adapter, or policy adulteration and never switches an existing run to another version", () => {
    const registry = new SimulationActionRegistry([descriptor()]);
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest);

    for (const field of ["actionHash", "adapterHash", "policyHash"] as const) {
      const tampered = structuredClone(manifest) as DeepMutable<CompiledManifest>;
      const action = tampered.actionDescriptors[0];
      if (action === undefined) throw new Error("Missing action descriptor");
      if (field === "actionHash") action.actionHash = hashCanonical("tampered", field);
      if (field === "adapterHash") action.adapter.adapterHash = hashCanonical("tampered", field);
      if (field === "policyHash") action.policy.policyHash = hashCanonical("tampered", field);

      const result = startRun({ manifest: tampered as CompiledManifest, runId: "run-tampered", transitionBudget: 10 });
      expect(result.commands).toHaveLength(0);
      expect(result.errors.map((error) => error.code)).toContain("MANIFEST_INTEGRITY_FAILED");
    }

    const newerDescriptor = descriptor(policy(), { actionVersion: "2.0.0", adapterVersion: "2.0.0" });
    const expandedRegistry = new SimulationActionRegistry([descriptor(), newerDescriptor]);
    expect(requireManifest(expandedRegistry, definition("2.0.0")).manifestHash).not.toBe(manifest.manifestHash);
    expect(waiting.nextRunState.manifestHash).toBe(manifest.manifestHash);
    expect(command.actionRef.actionVersion).toBe("1.0.0");
    expect(command.actionRef.adapter.adapterVersion).toBe("1.0.0");
  });

  test("emits one deterministic command without trusted claims and remains WAITING_EFFECT", () => {
    const registry = new SimulationActionRegistry([descriptor()]);
    const manifest = requireManifest(registry);
    const first = startAction(manifest, "run-deterministic");
    const second = startAction(manifest, "run-deterministic");

    expect(first.waiting.nextRunState.status).toBe("WAITING_EFFECT");
    expect(first.waiting.commands).toHaveLength(1);
    expect(first.command).toEqual(second.command);
    expect(first.command.logicalEffectId).toBe(second.command.logicalEffectId);
    expect(first.command.effectContinuationId).toBe(second.command.effectContinuationId);
    expect("trustedClaims" in first.command).toBe(false);
    expect("trustedClaims" in first.command.payload).toBe(false);
    expect("trustedClaims" in (first.waiting.nextRunState.waitingContinuation ?? {})).toBe(false);
  });
});

describe("network-deny dispatcher, policy, adapter, and Effect Sink", () => {
  test("loads system-owned claims, records ALLOW evidence, calls the fake adapter, and resumes to end idempotently", () => {
    const { registry, adapter, sink, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-action", runtime);

    const dispatched = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });

    expect(dispatched.kind).toBe("TERMINAL");
    if (dispatched.kind !== "TERMINAL") throw new Error("Expected terminal dispatch");
    expect(dispatched.resolution.ledgerState).toBe("CONFIRMED");
    expect(adapter.attempts()).toHaveLength(1);
    const entry = sink.effectEntries()[0];
    expect(entry?.policyDecision?.decision).toBe("ALLOW");
    expect(entry?.policyDecision?.policyVersion).toBe("1.0.0");
    expect(entry?.policyDecision?.policyHash).toBe(policy().policyHash);
    expect(entry?.policyDecision?.decisionInputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(entry?.trustedClaimRepositoryGeneration).toBe("fixture-generation-1");

    const firstResume = runtime.resume({ manifest, runState: waiting.nextRunState, resolution: dispatched.resolution, transitionBudget: 10 });
    const secondResume = runtime.resume({ manifest, runState: firstResume.nextRunState, resolution: dispatched.resolution, transitionBudget: 10 });
    expect(firstResume.nextRunState.status).toBe("COMPLETED");
    expect(firstResume.nextRunState.consumedContinuations[command.effectContinuationId]?.outcome).toBe("succeeded");
    expect(secondResume.nextRunState).toEqual(firstResume.nextRunState);
    expect(secondResume.commands).toHaveLength(0);
    expect(runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW })).toEqual(dispatched);
    expect(adapter.attempts()).toHaveLength(1);
  });

  test.each([
    ["expired", validClaim({ expiresAt: "2026-08-20T11:59:59.999Z" })],
    ["revoked", validClaim({ revokedAt: "2026-08-20T11:00:00.000Z" })],
    ["other subject", validClaim({ subjectId: "subject-other" })],
    ["unapproved issuer", validClaim({ issuerKey: "forged-issuer" })],
  ])("DENY for %s claim is terminal and auditable without invoking the adapter", (_case, claim) => {
    const { registry, adapter, sink, runtime } = simulator(
      { state: "CONFIRMED", output: { found: { type: "boolean", value: true } } },
      [claim],
    );
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, `run-denied-${_case}`, runtime);

    const dispatched = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });

    expect(dispatched.kind).toBe("TERMINAL");
    if (dispatched.kind !== "TERMINAL") throw new Error("Expected terminal denial");
    expect(dispatched.resolution.ledgerState).toBe("DENIED");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()[0]?.policyDecision?.decision).toBe("DENY");
    expect(sink.effectEntries()[0]?.attempts).toHaveLength(0);
    const resumed = resumeRun({ manifest, runState: waiting.nextRunState, resolution: dispatched.resolution, transitionBudget: 10 });
    expect(resumed.nextRunState.status).toBe("COMPLETED");
    expect(resumed.nextRunState.consumedContinuations[command.effectContinuationId]?.outcome).toBe("technical_error");
  });

  test("rejects a forged command DTO carrying trustedClaims before policy or adapter", () => {
    const { registry, adapter, sink, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-action", runtime);
    const forged = { ...structuredClone(command), trustedClaims: [validClaim()] } as unknown as ExecuteActionCommand;

    const result = runtime.dispatch({ manifest, runState: waiting.nextRunState, command: forged, now: NOW });

    expect(result.kind).toBe("REJECTED");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()).toHaveLength(0);
  });

  test("rejects trustedClaims injected into payload or continuation", () => {
    const { registry, adapter, sink, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-nested-claims", runtime);
    const payload = { ...structuredClone(command.payload), trustedClaims: [validClaim()] };
    const forgedCommand = {
      ...structuredClone(command),
      payload,
      payloadHash: hashCanonical("payload", { kind: "EXECUTE_ACTION", payload }),
    } as unknown as ExecuteActionCommand;

    expect(runtime.dispatch({ manifest, runState: waiting.nextRunState, command: forgedCommand, now: NOW }).kind).toBe("REJECTED");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()).toHaveLength(0);

    const forgedState = structuredClone(waiting.nextRunState) as unknown as Record<string, unknown>;
    const continuation = forgedState.waitingContinuation as Record<string, unknown>;
    continuation.trustedClaims = [validClaim()];
    const resolution: EffectResolution = {
      effectContinuationId: command.effectContinuationId,
      logicalEffectId: command.logicalEffectId,
      payloadHash: command.payloadHash,
      ledgerState: "DENIED",
    };
    const resumed = resumeRun({ manifest, runState: forgedState as unknown as typeof waiting.nextRunState, resolution, transitionBudget: 10 });
    expect(resumed.errors.map((error) => error.code)).toContain("INVALID_RUN_STATE");
  });

  test.each([
    ["missing", []],
    ["insufficient assurance", [validClaim({ assuranceLevel: "PHONE_MATCHED" })]],
  ] as const)("DENY for %s trusted claims never invokes the adapter", (_case, claims) => {
    const { registry, adapter, sink, runtime } = simulator(
      { state: "CONFIRMED", output: { found: { type: "boolean", value: true } } },
      claims,
    );
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, `run-${_case}`, runtime);

    const result = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });

    expect(result.kind).toBe("TERMINAL");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()[0]?.policyDecision?.decision).toBe("DENY");
  });

  test("rejects command dependencies that diverge from the manifest before policy or adapter", () => {
    const { registry, adapter, sink, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-command-mismatch", runtime);
    const forged = {
      ...structuredClone(command),
      actionRef: {
        ...structuredClone(command.actionRef),
        policy: { ...structuredClone(command.actionRef.policy), policyHash: hashCanonical("forged-policy", {}) },
      },
    };

    const result = runtime.dispatch({ manifest, runState: waiting.nextRunState, command: forged, now: NOW });

    expect(result.kind).toBe("REJECTED");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()).toHaveLength(0);
  });

  test.each(["UNKNOWN", "RECONCILING", "MANUAL_REVIEW"] as const)("%s remains blocking and creates no resolution", (state) => {
    const { registry, adapter, sink, runtime } = simulator({ state, reason: "fixture-ambiguous" });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, `run-${state}`, runtime);

    const dispatched = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });

    expect(dispatched.kind).toBe("BLOCKED");
    expect(adapter.attempts()).toHaveLength(1);
    expect(sink.effectEntries()[0]?.state).toBe(state);
    expect(waiting.nextRunState.status).toBe("WAITING_EFFECT");
    expect("resolution" in dispatched).toBe(false);
  });

  test("permanent adapter failure records a terminal result and resumes through technical_error", () => {
    const { registry, runtime } = simulator({ state: "FAILED_PERMANENT", reason: "fixture-permanent" });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-permanent", runtime);
    const dispatched = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });
    if (dispatched.kind !== "TERMINAL") throw new Error("Expected terminal failure");

    const resumed = resumeRun({ manifest, runState: waiting.nextRunState, resolution: dispatched.resolution, transitionBudget: 10 });

    expect(dispatched.resolution.ledgerState).toBe("FAILED_PERMANENT");
    expect(resumed.nextRunState.status).toBe("COMPLETED");
    expect(resumed.nextRunState.consumedContinuations[command.effectContinuationId]?.outcome).toBe("technical_error");
  });

  test("confirmed business result uses the compiled business_error transition", () => {
    const { registry, runtime } = simulator({
      state: "CONFIRMED",
      businessResultCode: "NOT_FOUND",
      output: { found: { type: "boolean", value: false } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-business-error", runtime);
    const dispatched = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });
    if (dispatched.kind !== "TERMINAL") throw new Error("Expected terminal result");

    const resumed = resumeRun({ manifest, runState: waiting.nextRunState, resolution: dispatched.resolution, transitionBudget: 10 });

    expect(resumed.nextRunState.consumedContinuations[command.effectContinuationId]?.outcome).toBe("business_error");
  });

  test("dispatch replay is idempotent and a changed payload hash is a fatal conflict with no second attempt", () => {
    const { registry, adapter, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-replay", runtime);

    const first = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });
    const replay = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });
    const changedPayload = { ...command.payload, input: { customerId: { type: "string" as const, value: "changed" } } };
    const conflicting = {
      ...command,
      payload: changedPayload,
      payloadHash: hashCanonical("payload", { kind: "EXECUTE_ACTION", payload: changedPayload }),
    };
    const conflict = runtime.dispatch({ manifest, runState: waiting.nextRunState, command: conflicting, now: NOW });

    expect(first.kind).toBe("TERMINAL");
    expect(replay).toEqual(first);
    expect(conflict.kind).toBe("PAYLOAD_HASH_CONFLICT");
    expect(adapter.attempts()).toHaveLength(1);
  });

  test("invalid adapter output fails closed instead of resuming as success", () => {
    const { registry, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "string", value: "not-a-boolean" } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-invalid-output", runtime);

    const dispatched = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });

    expect(dispatched.kind).toBe("TERMINAL");
    if (dispatched.kind !== "TERMINAL") throw new Error("Expected terminal output validation failure");
    expect(dispatched.resolution.ledgerState).toBe("FAILED_PERMANENT");
  });

  test("composition root rejects non-simulation adapters and secret-bearing components", () => {
    const bundle = policy();
    const actionDescriptor = descriptor(bundle);
    const registry = new SimulationActionRegistry([actionDescriptor]);
    const productionShaped = {
      capabilityMode: "PRODUCTION",
      adapterKey: actionDescriptor.adapter.adapterKey,
      adapterVersion: actionDescriptor.adapter.adapterVersion,
      adapterHash: actionDescriptor.adapter.adapterHash,
      secretRef: "secret://must-not-load",
      execute: () => ({ state: "CONFIRMED", output: { found: { type: "boolean", value: true } } }),
    };

    expect(
      () =>
        new NetworkDenySimulator({
          actionRegistry: registry,
          policyEngine: new VersionedPolicyEngine([bundle]),
          trustedClaimRepository: new FakeTrustedClaimRepository({ generation: "fixture-generation-1", claims: [validClaim()] }),
          actionAdapters: [productionShaped as unknown as FakeActionAdapter],
          effectSink: new RecordingEffectSink(),
          flowGrantId: "grant-simulator",
          environment: "SIMULATION",
        }),
    ).toThrow("network-deny simulation dependency");
  });

  test("dispatcher rejects a valid-looking run state not issued by its simulation root", () => {
    const { registry, adapter, sink, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-forged-state");

    const result = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });

    expect(result.kind).toBe("REJECTED");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()).toHaveLength(0);
  });

  test("resume rejects an action resolution not recorded by the Effect Sink", () => {
    const { registry, adapter, sink, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-unrecorded-resolution", runtime);
    const forgedResolution: EffectResolution = {
      effectContinuationId: command.effectContinuationId,
      logicalEffectId: command.logicalEffectId,
      payloadHash: command.payloadHash,
      ledgerState: "CONFIRMED",
    };

    const result = runtime.resume({ manifest, runState: waiting.nextRunState, resolution: forgedResolution, transitionBudget: 10 });

    expect(result.nextRunState).toEqual(waiting.nextRunState);
    expect(result.errors.map((error) => error.code)).toContain("INVALID_RESOLUTION");
    expect(adapter.attempts()).toHaveLength(0);
    expect(sink.effectEntries()).toHaveLength(0);
  });

  test("composition root rejects a structurally forged system-owned claims repository", () => {
    const bundle = policy();
    const actionDescriptor = descriptor(bundle);
    const registry = new SimulationActionRegistry([actionDescriptor]);
    const adapter = new FakeActionAdapter({
      ...actionDescriptor.adapter,
      fixtures: [{
        actionKey: actionDescriptor.actionKey,
        actionVersion: actionDescriptor.actionVersion,
        observation: { state: "CONFIRMED", output: { found: { type: "boolean", value: true } } },
      }],
    });
    const impostor = {
      capabilityMode: "SIMULATION",
      ownership: "SYSTEM",
      loadForDispatch: () => ({ generation: "forged", claims: [validClaim()] }),
    };

    expect(
      () =>
        new NetworkDenySimulator({
          actionRegistry: registry,
          policyEngine: new VersionedPolicyEngine([bundle]),
          trustedClaimRepository: impostor as unknown as FakeTrustedClaimRepository,
          actionAdapters: [adapter],
          effectSink: new RecordingEffectSink(),
          flowGrantId: "grant-simulator",
          environment: "SIMULATION",
        }),
    ).toThrow("network-deny simulation dependency");
  });

  test("composition root rejects a fake repository subclass that overrides trusted claims", () => {
    class OverridingClaimRepository extends FakeTrustedClaimRepository {
      override loadForDispatch(_subjectId: string, _conversationId: string) {
        return { generation: "forged-subclass", claims: [validClaim()] };
      }
    }
    const bundle = policy();
    const actionDescriptor = descriptor(bundle);
    const registry = new SimulationActionRegistry([actionDescriptor]);
    const adapter = new FakeActionAdapter({ ...actionDescriptor.adapter, fixtures: [] });
    const repository = new OverridingClaimRepository({ generation: "base", claims: [] });

    expect(
      () => new NetworkDenySimulator({
        actionRegistry: registry,
        policyEngine: new VersionedPolicyEngine([bundle]),
        trustedClaimRepository: repository,
        actionAdapters: [adapter],
        effectSink: new RecordingEffectSink(),
        flowGrantId: "grant-simulator",
        environment: "SIMULATION",
      }),
    ).toThrow("network-deny simulation dependency");
  });

  test("composition root rejects an exact-prototype claims repository forgery", () => {
    const bundle = policy();
    const actionDescriptor = descriptor(bundle);
    const registry = new SimulationActionRegistry([actionDescriptor]);
    const adapter = new FakeActionAdapter({ ...actionDescriptor.adapter, fixtures: [] });
    const forged = Object.create(FakeTrustedClaimRepository.prototype) as Record<string, unknown>;
    forged.capabilityMode = "SIMULATION";
    forged.ownership = "SYSTEM";
    forged.generation = "forged-prototype";
    forged.claims = [validClaim()];

    expect(
      () => new NetworkDenySimulator({
        actionRegistry: registry,
        policyEngine: new VersionedPolicyEngine([bundle]),
        trustedClaimRepository: forged as unknown as FakeTrustedClaimRepository,
        actionAdapters: [adapter],
        effectSink: new RecordingEffectSink(),
        flowGrantId: "grant-simulator",
        environment: "SIMULATION",
      }),
    ).toThrow("network-deny simulation dependency");
  });

  test("mutable registry and adapter maps are not reflectively exposed", () => {
    const actionDescriptor = descriptor();
    const registry = new SimulationActionRegistry([actionDescriptor]);
    const adapter = new FakeActionAdapter({ ...actionDescriptor.adapter, fixtures: [] });

    expect("descriptors" in registry).toBe(false);
    expect("fixtures" in adapter).toBe(false);
  });

  test("missing fake adapter fixture becomes MANUAL_REVIEW without throwing or resuming", () => {
    const bundle = policy();
    const actionDescriptor = descriptor(bundle);
    const registry = new SimulationActionRegistry([actionDescriptor]);
    const adapter = new FakeActionAdapter({ ...actionDescriptor.adapter, fixtures: [] });
    const sink = new RecordingEffectSink();
    const runtime = new NetworkDenySimulator({
      actionRegistry: registry,
      policyEngine: new VersionedPolicyEngine([bundle]),
      trustedClaimRepository: new FakeTrustedClaimRepository({ generation: "fixture-generation-1", claims: [validClaim()] }),
      actionAdapters: [adapter],
      effectSink: sink,
      flowGrantId: "grant-simulator",
      environment: "SIMULATION",
    });
    const manifest = requireManifest(registry);
    const waiting = runtime.start({ manifest, runId: "run-missing-fixture", transitionBudget: 10 });
    const command = waiting.commands[0];
    if (command?.kind !== "EXECUTE_ACTION") throw new Error("Expected EXECUTE_ACTION command");

    expect(() => runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW })).not.toThrow();
    const result = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });
    expect(result).toEqual({ kind: "BLOCKED", ledgerState: "MANUAL_REVIEW" });
    expect(sink.effectEntries()[0]?.state).toBe("MANUAL_REVIEW");
    expect(sink.effectEntries()[0]?.attempts).toHaveLength(1);
  });

  test("fake adapter rejects malformed observations at composition time", () => {
    const actionDescriptor = descriptor();
    expect(
      () => new FakeActionAdapter({
        ...actionDescriptor.adapter,
        fixtures: [{
          actionKey: actionDescriptor.actionKey,
          actionVersion: actionDescriptor.actionVersion,
          observation: { state: "BOGUS" } as unknown as FakeActionObservation,
        }],
      }),
    ).toThrow("Invalid fake action observation");
  });

  test("network-deny simulation performs zero fetch calls", () => {
    const { registry, runtime } = simulator({
      state: "CONFIRMED",
      output: { found: { type: "boolean", value: true } },
    });
    const manifest = requireManifest(registry);
    const { waiting, command } = startAction(manifest, "run-network-deny", runtime);
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = ((() => {
      fetchCalls += 1;
      throw new Error("Network access denied in simulation");
    }) as unknown) as typeof globalThis.fetch;

    try {
      const result = runtime.dispatch({ manifest, runState: waiting.nextRunState, command, now: NOW });
      expect(result.kind).toBe("TERMINAL");
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
