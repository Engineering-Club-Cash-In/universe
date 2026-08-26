import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const scheduleFile = new URL("./schedule.ts", import.meta.url);
const manifestFile = new URL(
	"../../packages/structured-logger/references/ELEVENTH_SLICE_DISPOSITIONS.json",
	import.meta.url,
);

function sourceFile(): ts.SourceFile {
	return ts.createSourceFile(
		"schedule.ts",
		readFileSync(scheduleFile, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
}

function callNames(file: ts.SourceFile): string[] {
	const names: string[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) names.push(node.expression.getText(file));
		ts.forEachChild(node, visit);
	};
	visit(file);
	return names;
}

test("eleventh structured-log slice reconciles exactly 22 scheduler traces", () => {
	const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
		entries: Array<{
			disposition: string;
			event: string | null;
			outcome: string | null;
		}>;
	};
	expect(manifest.entries).toHaveLength(22);
	expect(
		manifest.entries.filter(({ disposition }) => disposition === "remove"),
	).toHaveLength(8);
	expect(
		manifest.entries.filter(({ disposition }) => disposition === "event"),
	).toHaveLength(14);
	expect(
		manifest.entries.filter(({ outcome }) => outcome === "completed"),
	).toHaveLength(7);
	expect(
		manifest.entries.filter(({ outcome }) => outcome === "failed"),
	).toHaveLength(7);
	expect(
		manifest.entries
			.filter(({ disposition }) => disposition === "event")
			.every(({ event }) => event === "job.execution"),
	).toBeTrue();
});

test("scheduler has zero executable console calls and delegates seven finite jobs", () => {
	const names = callNames(sourceFile());
	expect(names.filter((name) => name.startsWith("console."))).toHaveLength(0);
	expect(names.filter((name) => name === "runScheduledJob")).toHaveLength(6);
	expect(
		names.filter((name) => name === "runScheduledJobAttempts"),
	).toHaveLength(1);
	expect(names).not.toContain("carteraStructuredLogger.emit");
});

test("scheduler preserves cron rules, timezone, order, and snapshot offsets", () => {
	const source = readFileSync(scheduleFile, "utf8");
	const rules = [
		"59 23 * * *",
		"0 23 * * *",
		"0 0 * * *",
		"0 2 * * *",
		"*/15 8-19 * * *",
		"0 8-19 * * *",
		"0 1 * * *",
	];
	let previous = -1;
	for (const rule of rules) {
		const current = source.indexOf(`rule: '${rule}'`);
		expect(current).toBeGreaterThan(previous);
		previous = current;
	}
	expect(source.match(/tz: TZ_GUATEMALA/g)).toHaveLength(7);
	expect(source).toContain("for (const offset of [-1, -2, -3])");
	expect(source).toContain("const fecha = getFechaGuatemalaISO(offset)");
	expect(
		source.indexOf("const fecha = getFechaGuatemalaISO(offset)"),
	).toBeLessThan(
		source.indexOf("yield async () => generarSnapshotDiario(fecha)"),
	);
});

test("scheduler source does not expose forbidden business or error payloads", () => {
	const source = readFileSync(scheduleFile, "utf8");
	for (const forbidden of [
		"processed_count",
		"succeeded_count",
		"failed_count",
		"skipped_count",
		"error.message",
		"error.stack",
		"res.periodo",
		"res.filas",
		"res.escaneados",
		"res.vencidos",
		"res.creditosProcesados",
		"res.revisadas",
		"res.fallidas",
		"res.enviadas",
	]) {
		expect(source).not.toContain(forbidden);
	}
});
