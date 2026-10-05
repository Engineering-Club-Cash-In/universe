export type JsonRecalculationOperation =
  | "recalculate"
  | "process_pools"
  | "delete_credits"
  | "update_investor_installments";

interface JsonRecalculationTerminalInput {
  readonly operation: JsonRecalculationOperation;
  readonly processedCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly hasPersistedChanges: boolean;
}

const terminalEmittedErrors = new WeakSet<object>();

export async function runMirroredPersistence<T>(
  writePrimary: () => Promise<T | undefined>,
  writeMirror: () => Promise<unknown>,
  onPrimaryPersisted: () => void,
): Promise<T | undefined> {
  const primaryResult = await writePrimary();
  if (primaryResult !== undefined) onPrimaryPersisted();
  await writeMirror();
  return primaryResult;
}

export async function runPostPersistenceStep<T>(
  step: () => Promise<T> | T,
  onFailure: () => void,
): Promise<T> {
  try {
    return await step();
  } catch (error) {
    onFailure();
    if ((typeof error === "object" && error !== null) || typeof error === "function") {
      terminalEmittedErrors.add(error);
    }
    throw error;
  }
}

export function wasJsonTerminalEmitted(error: unknown): boolean {
  return ((typeof error === "object" && error !== null) || typeof error === "function")
    && terminalEmittedErrors.has(error);
}

const common = (input: JsonRecalculationTerminalInput) => ({
  operation: input.operation,
  processedCount: input.processedCount,
  succeededCount: input.succeededCount,
  failedCount: input.failedCount,
  skippedCount: input.skippedCount,
});

export function classifyJsonRecalculationTerminal(input: JsonRecalculationTerminalInput) {
  if (input.failedCount > 0 && input.hasPersistedChanges) {
    return {
      outcome: "partially_persisted" as const,
      ...common(input),
      manualActionRequired: true as const,
      errorCode: "persistence_failed" as const,
    };
  }
  if (input.failedCount > 0 && input.succeededCount > 0) {
    return {
      outcome: "partially_completed" as const,
      ...common(input),
      manualActionRequired: true as const,
      reasonCode: "item_failures" as const,
    };
  }
  if (input.failedCount > 0) {
    return {
      outcome: "failed" as const,
      ...common(input),
      manualActionRequired: false as const,
      errorCode: "unknown" as const,
    };
  }
  if (input.succeededCount === 0 && input.skippedCount > 0) {
    return {
      outcome: "rejected" as const,
      ...common(input),
      manualActionRequired: false as const,
      reasonCode: "no_actionable_items" as const,
    };
  }
  return {
    outcome: "completed" as const,
    ...common(input),
    manualActionRequired: false as const,
  };
}
