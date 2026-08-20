# Conversational Platform — Phase 1 vertical slice

This app is a pure TypeScript/Bun package for the first Phase 1 vertical of the conversational-flow platform spec. It is intentionally small: it proves deterministic compilation and pure run progression for a constrained step subset, without adapters, storage, HTTP, UI, or external services.

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
- Reproducible in-memory manifest with pinned handler versions/hashes, content hashes, expression hashes, canonical codec identity, expression executor identity, and outcome mapping identity.
- Manifest integrity validation on start/resume: schema/version constants, recomputed manifest hash, handler/content/expression/codec/executor/outcome hashes, handler-step consistency, IDs, and transitions.
- Pure engine for exactly these step types:
  - `set_variable`;
  - `condition`;
  - `send_message`;
  - `end`.
- Deterministic `logicalEffectId` and `effectContinuationId` derived from logical identity (`runId`, `stepId`, `activationOrdinal`, command kind/ordinal), not attempts or timestamps.
- `send_message` emits exactly one blocking command and leaves the run in `WAITING_EFFECT` with a durable continuation represented as pure data.
- Ambiguous/non-consumable effect states (`UNKNOWN`, `RECONCILING`, `MANUAL_REVIEW`, `NOT_APPLIED`, `CANCELLED_BEFORE_DISPATCH`) do not resume.
- Terminal resolutions resume once logically; a second resume is idempotent only when continuation ID, logical effect ID, payload hash, ledger state, and mapped outcome all match.
- Transition budget and run-state validation guard against unsafe budgets, malformed snapshots, unsafe activation ordinals, and loops.
- SHA-256 hashes over UTF-8 canonical JSON with explicit hash domains for definition, manifest, handlers, content, expressions, outcome mapping, payloads, logical effects, and continuations.
- Defensive deep cloning/freezing of public manifests, run snapshots, continuations, command payloads, and sink entries.
- `RecordingEffectSink`, an in-memory simulation sink that records commands without I/O.

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

This package does **not** implement HTTP, Elysia, Postgres, Drizzle, migrations, Meta, Chatwoot, R2, secrets, network calls, UI, persistence, jobs, inbox, ledger storage, policy runtime, real adapters, media, handoff, or business actions.

It also does not implement the full v1 catalog. The compiler rejects unimplemented step types such as `collect_input`, `present_options`, `receive_media`, `execute_action`, `wait`, and `human_handoff` instead of pretending support.

The canonical encoder is `jcs-rfc8785-subset-v1`: it implements the JSON Canonicalization Scheme behavior needed by this slice for accepted JSON values (UTF-16 key ordering, JSON string escaping, ECMAScript/JCS number serialization, UTF-8 SHA-256 hashing) and rejects non-canonical/non-JSON inputs such as NaN/Infinity, `undefined`, sparse arrays, non-plain objects, symbols/functions/BigInt, lone Unicode surrogates, and dangerous prototype keys.

This slice checks integrity and reproducibility, not authenticity: signed manifests/trusted storage remain deferred to later platform layers.
