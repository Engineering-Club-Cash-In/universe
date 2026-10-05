import { describe, expect, test } from "bun:test";
import { runScheduledJob, runScheduledJobAttempts } from "./scheduledJobRunner";
import { createCarteraStructuredLogger } from "./src/utils/structuredLogger";

function numericClock(...values: number[]): () => number {
	let index = 0;
	return () => values[index++] ?? values.at(-1) ?? 0;
}

function recordingLogger(lines: string[]) {
	return createCarteraStructuredLogger({
		environment: "local",
		clock: () => new Date("2026-08-26T12:00:00.000Z"),
		sink: (line) => {
			lines.push(line);
		},
	});
}

describe("scheduled job runner", () => {
	test("emits one completed terminal after a successful attempt", async () => {
		const lines: string[] = [];
		let attempts = 0;

		await runScheduledJob(
			"process_late_fees",
			async () => {
				attempts += 1;
			},
			{
				clock: numericClock(100, 142),
				logger: recordingLogger(lines),
			},
		);

		expect(attempts).toBe(1);
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "")).toMatchObject({
			event: "job.execution",
			outcome: "completed",
			job_name: "process_late_fees",
			duration_ms: 42,
		});
	});

	test("swallows task failure and emits one finite failed terminal", async () => {
		const lines: string[] = [];

		await expect(
			runScheduledJob(
				"verify_sat_invoices",
				async () => {
					throw new Error("private failure detail");
				},
				{
					clock: numericClock(200, 210),
					logger: recordingLogger(lines),
				},
			),
		).resolves.toBeUndefined();

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "")).toMatchObject({
			event: "job.execution",
			outcome: "failed",
			job_name: "verify_sat_invoices",
			duration_ms: 10,
			error_code: "unknown",
		});
		expect(lines[0]).not.toContain("private failure detail");
	});

	test("logger and clock failures never alter task control flow", async () => {
		let taskCompleted = false;
		const logger = createCarteraStructuredLogger({
			environment: "local",
			clock: () => new Date("2026-08-26T12:00:00.000Z"),
			sink: () => {
				throw new Error("sink unavailable");
			},
		});

		await expect(
			runScheduledJob(
				"generate_monthly_close",
				async () => {
					taskCompleted = true;
				},
				{
					clock: () => {
						throw new Error("clock unavailable");
					},
					logger,
				},
			),
		).resolves.toBeUndefined();

		expect(taskCompleted).toBeTrue();
	});

	test("preserves iterator failures outside per-task error handling", async () => {
		const lines: string[] = [];
		const tasks: Iterable<() => Promise<void>> = {
			*[Symbol.iterator]() {
				yield async () => {};
				throw new Error("attempt preparation failed");
			},
		};

		await expect(
			runScheduledJobAttempts("generate_daily_invoice_snapshot", tasks, {
				clock: numericClock(0, 1),
				logger: recordingLogger(lines),
			}),
		).rejects.toThrow("attempt preparation failed");

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "").outcome).toBe("completed");
	});

	test("runs all snapshot attempts sequentially with one terminal each", async () => {
		const lines: string[] = [];
		const order: string[] = [];
		const tasks = ["first", "second", "third"].map((label) => async () => {
			order.push(`${label}:start`);
			await Promise.resolve();
			order.push(`${label}:end`);
			if (label === "second") throw new Error("not logged");
		});

		await runScheduledJobAttempts("generate_daily_invoice_snapshot", tasks, {
			clock: numericClock(0, 1, 2, 3, 4, 5),
			logger: recordingLogger(lines),
		});

		expect(order).toEqual([
			"first:start",
			"first:end",
			"second:start",
			"second:end",
			"third:start",
			"third:end",
		]);
		expect(lines).toHaveLength(3);
		expect(lines.map((line) => JSON.parse(line).outcome)).toEqual([
			"completed",
			"failed",
			"completed",
		]);
		expect(
			lines.every(
				(line) =>
					JSON.parse(line).job_name === "generate_daily_invoice_snapshot",
			),
		).toBeTrue();
	});
});
