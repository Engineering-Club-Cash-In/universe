# Conversational Platform — Phase 1 vertical slice

This app is a pure TypeScript/Bun package for the first Phase 1 verticals of the conversational-flow platform spec. It proves deterministic compilation, pure run progression, and an in-memory network-deny action simulation without storage, HTTP, UI, secrets, or external services.

## Implemented in this slice

- Declarative versioned definitions with `schemaVersion: "conversational-flow/phase1"`.
- Compiler validation for:
  - unique step IDs;
  - existing entry step;
  - transitions pointing to existing steps;
  - supported step types only;
  - typed condition ASTs instead of executable strings;
  - static expression typing and definite variable initialization;
  - no reachable cycles in this supported subset;
  - reachable graph with at least one reachable `end`.
- Reproducible in-memory manifest with pinned handler versions/hashes, content hashes, expression hashes, canonical codec identity, expression executor identity, outcome mapping identity, and exact action descriptor/action/adapter/policy versions and hashes.
- Manifest integrity validation on start/resume: schema/version constants, recomputed manifest hash, handler/content/expression/codec/executor/outcome/action hashes, handler-step consistency, IDs, and transitions.
- Pure engine for exactly these step types:
  - `set_variable`;
  - `condition`;
  - `send_message`;
  - `execute_action`;
  - `end`.
- Deterministic `logicalEffectId` and `effectContinuationId` derived from logical identity (`runId`, `stepId`, `activationOrdinal`, command kind/ordinal), not attempts or timestamps.
- `send_message` emits exactly one blocking command and leaves the run in `WAITING_EFFECT` with a durable continuation represented as pure data.
- Ambiguous/non-consumable effect states (`UNKNOWN`, `RECONCILING`, `MANUAL_REVIEW`, `NOT_APPLIED`, `CANCELLED_BEFORE_DISPATCH`) do not resume.
- Terminal resolutions resume once logically; a second resume is idempotent only when continuation ID, logical effect ID, payload hash, ledger state, and mapped outcome all match.
- Transition budget and run-state validation guard against unsafe budgets, malformed snapshots, unsafe activation ordinals, and loops.
- SHA-256 hashes over UTF-8 canonical JSON with explicit hash domains for definition, manifest, handlers, content, expressions, outcome mapping, payloads, logical effects, and continuations.
- Defensive deep cloning/freezing of public manifests, run snapshots, continuations, command payloads, and sink entries.
- `RecordingEffectSink`, an in-memory simulation sink that records commands without I/O.
- Immutable `SimulationActionRegistry` descriptors with exact action versions, typed input/output schemas, sensitivity, purpose, data classes, retry/reconcile metadata, effect guarantee, adapter reference, policy reference, and business result codes. There is no `latest` resolution.
- `execute_action` compilation fails closed when the exact descriptor is missing or its input is incompatible.
- `EXECUTE_ACTION` commands carry only opaque subject/conversation IDs and compiled action data. Trusted claims are excluded from definitions, variables, commands, payloads, continuations, and accepted DTO shapes.
- A network-deny simulation composition root that accepts only the nominal in-memory fake implementations, rejects production-mode/secret-bearing impostors, and dispatches only transitions issued through its own `start`/`resume` methods.
- A system-owned fake trusted-claim repository and versioned policy engine. Policy runs immediately before dispatch and validates grant, environment, issuer/version, subject, assurance, issuance, expiry, and revocation.
- A zero-network, zero-secret fake action adapter with in-memory attempts and confirmed, permanent-failure, and ambiguous observations.
- An in-memory effect ledger that records policy evidence, repository generation, attempts and outcomes; replay with the same logical ID/hash is idempotent, while a changed payload hash is a fatal conflict with no second attempt.
- `DENIED` and permanent failure produce auditable terminal resolutions; `UNKNOWN`, `RECONCILING`, and `MANUAL_REVIEW` remain blocking and do not resume the run.

## Minimal example

```ts
import { compileDefinition, resumeRun, startRun } from "@cci/conversational-platform";

const compiled = compileDefinition({
  schemaVersion: "conversational-flow/phase1",
  flowId: "hello-flow",
  flowVersion: "1",
  entryStepId: "set-name",
  steps: [
    {
      id: "set-name",
      type: "set_variable",
      variable: "eligible",
      value: { type: "boolean", value: true },
      next: "check",
    },
    {
      id: "check",
      type: "condition",
      branches: [
        {
          outcome: "yes",
          when: { kind: "variable", name: "eligible", valueType: "boolean" },
          next: "message",
        },
      ],
    },
    {
      id: "message",
      type: "send_message",
      content: { contentVersionId: "hello-v1", text: "Hola" },
      transitions: { requested: "done", failed: "done" },
    },
    { id: "done", type: "end" },
  ],
});

if (compiled.ok) {
  const waiting = startRun({ manifest: compiled.manifest, runId: "run-1", transitionBudget: 20 });
  const command = waiting.commands[0];

  if (command) {
    const completed = resumeRun({
      manifest: compiled.manifest,
      runState: waiting.nextRunState,
      transitionBudget: 20,
      resolution: {
        effectContinuationId: command.effectContinuationId,
        logicalEffectId: command.logicalEffectId,
        payloadHash: command.payloadHash,
        ledgerState: "CONFIRMED",
      },
    });

    console.log(completed.nextRunState.status); // COMPLETED
  }
}
```

## Commands

From `apps/conversational-platform`:

```bash
bun test
bun run typecheck
```

## Explicitly out of scope / deferred

This package does **not** implement HTTP, Elysia, Postgres, Drizzle, migrations, Meta, Chatwoot, R2, secrets, network calls, UI, persistence, jobs, inbox, durable ledger storage, real adapters, media, handoff, or production business actions.

It also does not implement the full v1 catalog. The compiler rejects unimplemented step types such as `collect_input`, `present_options`, `receive_media`, `wait`, and `human_handoff` instead of pretending support.

The in-memory simulator demonstrates logical idempotence and payload-conflict detection only. Retry policy and reconcile mode are pinned metadata but are not executed by this slice. It does not provide cross-process concurrency control, crash recovery, exactly-once delivery, durable retry/reconciliation, or production issuer verification.

The canonical encoder is `jcs-rfc8785-subset-v1`: it implements the JSON Canonicalization Scheme behavior needed by this slice for accepted JSON values (UTF-16 key ordering, JSON string escaping, ECMAScript/JCS number serialization, UTF-8 SHA-256 hashing) and rejects non-canonical/non-JSON inputs such as NaN/Infinity, `undefined`, sparse arrays, non-plain objects, symbols/functions/BigInt, lone Unicode surrogates, and dangerous prototype keys.

This slice checks integrity and reproducibility, not authenticity: signed manifests/trusted storage remain deferred to later platform layers.
