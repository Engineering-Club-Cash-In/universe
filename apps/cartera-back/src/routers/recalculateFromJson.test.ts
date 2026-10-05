import { expect, test } from "bun:test";
import { createCarteraStructuredLogger } from "../utils/structuredLogger";
import { emitRouterFailure } from "./recalculateFromJsonTelemetry";

test("unexpected router failures emit exactly one accepted terminal event", () => {
  const lines: string[] = [];
  const logger = createCarteraStructuredLogger({
    environment: "local",
    clock: () => new Date("2026-08-25T12:00:00.000Z"),
    sink: (line) => { lines.push(line); },
  });

  emitRouterFailure("recalculate", logger);

  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    event: "credit.schedule_recalculation",
    outcome: "failed",
    recalculation_strategy: "from_json",
    recalculation_operation: "recalculate",
    processed_count: 1,
    succeeded_count: 0,
    failed_count: 1,
    skipped_count: 0,
    manual_action_required: false,
    error_code: "unknown",
  });
});
