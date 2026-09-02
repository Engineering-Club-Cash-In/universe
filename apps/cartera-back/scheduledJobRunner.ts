import {
	type CarteraStructuredLogger,
	type ScheduledJobName,
	carteraStructuredLogger,
	emitJobExecution,
} from "./src/utils/structuredLogger";

type ScheduledTask = () => unknown | Promise<unknown>;

interface ScheduledJobDependencies {
	readonly clock?: () => number;
	readonly logger?: CarteraStructuredLogger;
}

function safeNow(clock: () => number): number {
	try {
		const value = clock();
		return Number.isFinite(value) ? value : 0;
	} catch {
		return 0;
	}
}

function elapsedMilliseconds(startedAt: number, clock: () => number): number {
	const elapsed = Math.round(safeNow(clock) - startedAt);
	return Math.max(0, Math.min(86_400_000, elapsed));
}

export async function runScheduledJob(
	jobName: ScheduledJobName,
	task: ScheduledTask,
	dependencies: ScheduledJobDependencies = {},
): Promise<void> {
	const clock = dependencies.clock ?? Date.now;
	const logger = dependencies.logger ?? carteraStructuredLogger;
	const startedAt = safeNow(clock);
	try {
		await task();
		emitJobExecution(
			{
				outcome: "completed",
				jobName,
				durationMs: elapsedMilliseconds(startedAt, clock),
			},
			logger,
		);
	} catch {
		emitJobExecution(
			{
				outcome: "failed",
				jobName,
				durationMs: elapsedMilliseconds(startedAt, clock),
				errorCode: "unknown",
			},
			logger,
		);
	}
}

export async function runScheduledJobAttempts(
	jobName: ScheduledJobName,
	tasks: Iterable<ScheduledTask>,
	dependencies: ScheduledJobDependencies = {},
): Promise<void> {
	for (const task of tasks) {
		await runScheduledJob(jobName, task, dependencies);
	}
}
