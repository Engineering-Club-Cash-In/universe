import { cloneAndFreeze, deepClone } from "./canonical";
import type { AuthorizationDecision } from "./policy-engine";
import type { EffectResolution, EngineCommand } from "./types";

export type RecordedEffectState = "PENDING" | "DENIED" | "DISPATCHING" | "CONFIRMED" | "FAILED_PERMANENT" | "UNKNOWN" | "RECONCILING" | "MANUAL_REVIEW";

export interface RecordedEffectAttempt {
  readonly executionAttemptId: string;
  readonly observation: Readonly<Record<string, unknown>>;
}

export interface RecordedEffectEntry {
  readonly logicalEffectId: string;
  readonly payloadHash: string;
  readonly command: EngineCommand;
  readonly state: RecordedEffectState;
  readonly policyDecision?: AuthorizationDecision;
  readonly trustedClaimRepositoryGeneration?: string;
  readonly attempts: readonly RecordedEffectAttempt[];
  readonly resolution?: EffectResolution;
}

interface MutableEffectEntry {
  logicalEffectId: string;
  payloadHash: string;
  command: EngineCommand;
  state: RecordedEffectState;
  policyDecision?: AuthorizationDecision;
  trustedClaimRepositoryGeneration?: string;
  attempts: RecordedEffectAttempt[];
  resolution?: EffectResolution;
}

export class RecordingEffectSink {
  readonly capabilityMode = "SIMULATION" as const;
  readonly #recorded: EngineCommand[] = [];
  readonly #effects = new Map<string, MutableEffectEntry>();

  static isAuthentic(value: unknown): value is RecordingEffectSink {
    return typeof value === "object"
      && value !== null
      && #effects in value
      && Object.getPrototypeOf(value) === RecordingEffectSink.prototype;
  }

  constructor() {
    Object.freeze(this);
  }

  record(commands: readonly EngineCommand[]): readonly EngineCommand[] {
    const cloned = commands.map((command) => cloneCommand(command));
    this.#recorded.push(...cloned);
    return cloned.map((command) => cloneCommand(command));
  }

  entries(): readonly EngineCommand[] {
    return this.#recorded.map((command) => cloneCommand(command));
  }

  acceptEffect(command: EngineCommand): "INSERTED" | "EXISTING" | "PAYLOAD_HASH_CONFLICT" {
    const existing = this.#effects.get(command.logicalEffectId);
    if (existing !== undefined) return existing.payloadHash === command.payloadHash ? "EXISTING" : "PAYLOAD_HASH_CONFLICT";
    this.#effects.set(command.logicalEffectId, {
      logicalEffectId: command.logicalEffectId,
      payloadHash: command.payloadHash,
      command: cloneCommand(command),
      state: "PENDING",
      attempts: [],
    });
    return "INSERTED";
  }

  recordPolicy(logicalEffectId: string, decision: AuthorizationDecision, repositoryGeneration: string): void {
    const entry = this.requireEffect(logicalEffectId);
    if (entry.state !== "PENDING") throw new Error("Policy can only be recorded for PENDING effect");
    entry.policyDecision = cloneAndFreeze(deepClone(decision));
    entry.trustedClaimRepositoryGeneration = repositoryGeneration;
    entry.state = decision.decision === "ALLOW" ? "DISPATCHING" : "DENIED";
  }

  recordAttempt(logicalEffectId: string, attempt: RecordedEffectAttempt): void {
    const entry = this.requireEffect(logicalEffectId);
    if (entry.state !== "DISPATCHING") throw new Error("Attempt can only be recorded while DISPATCHING");
    entry.attempts.push(cloneAndFreeze(deepClone(attempt)));
  }

  recordResult(logicalEffectId: string, state: Exclude<RecordedEffectState, "PENDING" | "DISPATCHING">, resolution?: EffectResolution): void {
    const entry = this.requireEffect(logicalEffectId);
    if (entry.state !== "DISPATCHING" && !(entry.state === "DENIED" && state === "DENIED")) throw new Error("Invalid effect result transition");
    entry.state = state;
    if (resolution !== undefined) entry.resolution = cloneAndFreeze(deepClone(resolution));
  }

  effect(logicalEffectId: string): RecordedEffectEntry | undefined {
    const entry = this.#effects.get(logicalEffectId);
    return entry === undefined ? undefined : snapshot(entry);
  }

  effectEntries(): readonly RecordedEffectEntry[] {
    return [...this.#effects.values()].map(snapshot);
  }

  clear(): void {
    this.#recorded.length = 0;
    this.#effects.clear();
  }

  private requireEffect(logicalEffectId: string): MutableEffectEntry {
    const entry = this.#effects.get(logicalEffectId);
    if (entry === undefined) throw new Error(`Effect ${logicalEffectId} was not accepted`);
    return entry;
  }
}

function cloneCommand(command: EngineCommand): EngineCommand {
  return cloneAndFreeze(deepClone(command));
}

function snapshot(entry: MutableEffectEntry): RecordedEffectEntry {
  return cloneAndFreeze(deepClone(entry));
}
