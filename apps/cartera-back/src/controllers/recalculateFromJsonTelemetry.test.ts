import { describe, expect, test } from "bun:test";
import {
  classifyJsonRecalculationTerminal,
  runMirroredPersistence,
  runPostPersistenceStep,
  wasJsonTerminalEmitted,
} from "./recalculateFromJsonTelemetry";

describe("JSON recalculation terminal classification", () => {
  test("classifies a clean batch as completed", () => {
    expect(classifyJsonRecalculationTerminal({
      operation: "recalculate",
      processedCount: 3,
      succeededCount: 3,
      failedCount: 0,
      skippedCount: 0,
      hasPersistedChanges: true,
    })).toEqual({
      outcome: "completed",
      operation: "recalculate",
      processedCount: 3,
      succeededCount: 3,
      failedCount: 0,
      skippedCount: 0,
      manualActionRequired: false,
    });
  });

  test("classifies mixed durable item failures as partially persisted", () => {
    expect(classifyJsonRecalculationTerminal({
      operation: "delete_credits",
      processedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      skippedCount: 0,
      hasPersistedChanges: true,
    })).toMatchObject({
      outcome: "partially_persisted",
      operation: "delete_credits",
      manualActionRequired: true,
      errorCode: "persistence_failed",
    });
  });

  test("classifies an all-skipped batch without inventing success", () => {
    expect(classifyJsonRecalculationTerminal({
      operation: "update_investor_installments",
      processedCount: 2,
      succeededCount: 0,
      failedCount: 0,
      skippedCount: 2,
      hasPersistedChanges: false,
    })).toMatchObject({
      outcome: "rejected",
      manualActionRequired: false,
      reasonCode: "no_actionable_items",
    });
  });

  test("classifies a pre-persistence failure as failed", () => {
    expect(classifyJsonRecalculationTerminal({
      operation: "process_pools",
      processedCount: 1,
      succeededCount: 0,
      failedCount: 1,
      skippedCount: 0,
      hasPersistedChanges: false,
    })).toMatchObject({
      outcome: "failed",
      manualActionRequired: false,
      errorCode: "unknown",
    });
  });

  test("retains primary-write evidence when the mirror write fails", async () => {
    let persisted = false;
    const failure = new Error("mirror unavailable");

    await expect(runMirroredPersistence(
      async () => ({ id: 7 }),
      async () => { throw failure; },
      () => { persisted = true; },
    )).rejects.toBe(failure);
    expect(persisted).toBeTrue();
  });

  test("emits one partial-persistence terminal when post-write JSON parsing fails", async () => {
    const terminals: ReturnType<typeof classifyJsonRecalculationTerminal>[] = [];
    let persisted = false;
    const failure = new SyntaxError("invalid JSON");

    await runMirroredPersistence(
      async () => ({ id: 8 }),
      async () => undefined,
      () => { persisted = true; },
    );

    await expect(runPostPersistenceStep(
      async () => { throw failure; },
      () => terminals.push(classifyJsonRecalculationTerminal({
        operation: "process_pools",
        processedCount: 2,
        succeededCount: 1,
        failedCount: 1,
        skippedCount: 0,
        hasPersistedChanges: persisted,
      })),
    )).rejects.toBe(failure);

    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      outcome: "partially_persisted",
      processedCount: 2,
      succeededCount: 1,
      failedCount: 1,
      skippedCount: 0,
      manualActionRequired: true,
      errorCode: "persistence_failed",
    });
    expect(wasJsonTerminalEmitted(failure)).toBeTrue();
  });
});
