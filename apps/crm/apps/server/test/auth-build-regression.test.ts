import { describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertBoundPredicate,
	type QueryRecord,
} from "./auth-sql-predicate-assertions";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const crmRoot = fileURLToPath(new URL("../../..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../..", import.meta.url));
const dockerfilePath = new URL("../Dockerfile", import.meta.url);
const webDockerfilePath = new URL("../../../Dockerfile", import.meta.url);
const deployWorkflowPath = new URL(
	"../../../../../.github/workflows/deploy-prod.yaml",
	import.meta.url,
);
const deployScriptPath = new URL("../../../deploy.sh", import.meta.url);
const crmPackagePath = new URL("../../../package.json", import.meta.url);
const serverPackagePath = new URL("../package.json", import.meta.url);
const crmLockPath = new URL("../../../bun.lock", import.meta.url);
const harnessPath = new URL("./compiled-auth-sql-harness.ts", import.meta.url);

function copyIntoFixture(source: string, destination: string) {
	mkdirSync(dirname(destination), { recursive: true });
	cpSync(source, destination, { recursive: true });
}

function readInputArray(script: string, name: string) {
	const block = script.match(new RegExp(`${name}=\\(([\\s\\S]*?)\\n\\)`));
	expect(block, `${name} must be declared`).not.toBeNull();
	return [...(block?.[1].matchAll(/"([^"]+)"/g) ?? [])].map(
		(match) => match[1],
	);
}

function readDockerCopySources(dockerfile: string) {
	const instructions: string[] = [];
	let current = "";

	for (const rawLine of dockerfile.split("\n")) {
		const trimmed = rawLine.trim();
		if (!current && (!trimmed || trimmed.startsWith("#"))) {
			continue;
		}
		const continued = /\\\s*$/.test(trimmed);
		current += `${current ? " " : ""}${trimmed.replace(/\\\s*$/, "")}`;
		if (!continued) {
			instructions.push(current.trim());
			current = "";
		}
	}
	if (current) {
		instructions.push(current.trim());
	}

	return instructions.flatMap((instruction) => {
		if (!/^COPY\s/i.test(instruction)) {
			return [];
		}
		let payload = instruction.replace(/^COPY\s+/i, "").trim();
		while (payload.startsWith("--")) {
			const flag = payload.match(/^(--\S+)(?:\s+|$)/)?.[1];
			if (!flag) {
				break;
			}
			if (flag === "--from" || flag.startsWith("--from=")) {
				return [];
			}
			payload = payload.slice(flag.length).trimStart();
		}

		if (payload.startsWith("[")) {
			const paths = JSON.parse(payload) as string[];
			return paths.slice(0, -1);
		}

		const paths = [...payload.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
			(match) => match[1] ?? match[2] ?? match[3],
		);
		return paths.slice(0, -1);
	});
}

function pathspecCovers(pathspec: string, source: string) {
	const normalized = pathspec.replace(/^:\(top\)/, "");
	if (!normalized.endsWith("/")) {
		return source === normalized;
	}
	return source === normalized.slice(0, -1) || source.startsWith(normalized);
}

function expectInputsCoverSources(inputs: string[], sources: string[]) {
	for (const source of sources) {
		expect(
			inputs.some((pathspec) => pathspecCovers(pathspec, source)),
			`missing deploy input for ${source}`,
		).toBe(true);
	}
}

function readWorkflowFilter(workflow: string, name: string) {
	const block = workflow.match(
		new RegExp(`^ {12}${name}:\\n((?: {14}- '[^']+'\\n)+)`, "m"),
	);
	expect(block, `${name} workflow filter must be declared`).not.toBeNull();
	return [...(block?.[1].matchAll(/- '([^']+)'/g) ?? [])].map(
		(match) => match[1],
	);
}

function readWorkflowPushPaths(workflow: string) {
	const block = workflow.match(/^ {4}paths:\n((?: {6}- "[^"]+"\n)+)/m);
	expect(block, "push.paths must be declared").not.toBeNull();
	return [...(block?.[1].matchAll(/- "([^"]+)"/g) ?? [])].map(
		(match) => match[1],
	);
}

function workflowFilterCovers(filter: string, source: string) {
	if (!filter.endsWith("/**")) {
		return filter === source;
	}
	const directory = filter.slice(0, -3);
	return source === directory || source.startsWith(`${directory}/`);
}

function expectWorkflowFilterCovers(filters: string[], sources: string[]) {
	for (const source of sources) {
		expect(
			filters.some((filter) => workflowFilterCovers(filter, source)),
			`missing workflow filter for ${source}`,
		).toBe(true);
	}
}

function createLockedCrmFixture(tempDir: string) {
	const appRoot = join(tempDir, "usr/src/app");
	const fixtureCrmRoot = join(appRoot, "apps/crm");
	const fixtureServerRoot = join(fixtureCrmRoot, "apps/server");

	copyIntoFixture(
		join(crmRoot, "package.json"),
		join(fixtureCrmRoot, "package.json"),
	);
	copyIntoFixture(join(crmRoot, "bun.lock"), join(fixtureCrmRoot, "bun.lock"));
	copyIntoFixture(
		join(serverRoot, "package.json"),
		join(fixtureServerRoot, "package.json"),
	);
	copyIntoFixture(
		join(crmRoot, "apps/web/package.json"),
		join(fixtureCrmRoot, "apps/web/package.json"),
	);

	for (const packageName of ["infornet", "sms", "simpletech", "email"]) {
		copyIntoFixture(
			join(repoRoot, `packages/${packageName}/package.json`),
			join(appRoot, `packages/${packageName}/package.json`),
		);
	}

	copyIntoFixture(
		join(serverRoot, "src/db/schema/auth.ts"),
		join(fixtureServerRoot, "src/db/schema/auth.ts"),
	);
	copyIntoFixture(
		join(serverRoot, "test/auth-sql-predicate-assertions.ts"),
		join(fixtureServerRoot, "test/auth-sql-predicate-assertions.ts"),
	);
	copyIntoFixture(
		join(serverRoot, "test/compiled-auth-sql-harness.ts"),
		join(fixtureServerRoot, "test/compiled-auth-sql-harness.ts"),
	);

	return { fixtureCrmRoot, fixtureServerRoot };
}

describe("CRM API production auth build", () => {
	it("installs the CRM workspace from the committed lockfile with the known-working Bun runtime", async () => {
		const dockerfile = await readFile(dockerfilePath, "utf8");
		const crmPackage = JSON.parse(await readFile(crmPackagePath, "utf8")) as {
			packageManager?: string;
		};
		const crmLock = await readFile(crmLockPath, "utf8");

		expect(crmPackage.packageManager).toBe("bun@1.3.14");
		expect(dockerfile).toContain("FROM docker.io/oven/bun:1.3.14 AS base");
		expect(dockerfile).not.toContain("oven/bun:latest");
		expect(dockerfile).toContain(
			"COPY apps/crm/package.json apps/crm/bun.lock ./apps/crm/",
		);
		expect(dockerfile).toContain("RUN bun install --frozen-lockfile");
		expect(dockerfile).not.toMatch(
			/WORKDIR \/usr\/src\/app\/apps\/crm\/apps\/server\s*\nRUN bun install(?! --frozen-lockfile)/,
		);
		expect(crmLock).toContain('"better-auth": ["better-auth@1.4.18"');
		expect(crmLock).toContain('"drizzle-orm": ["drizzle-orm@0.44.7"');
	});

	it("pins the CRM backend auth implementation to the verified release", async () => {
		const serverPackage = JSON.parse(
			await readFile(serverPackagePath, "utf8"),
		) as {
			dependencies?: Record<string, string>;
		};
		const crmLock = await readFile(crmLockPath, "utf8");

		expect(serverPackage.dependencies?.["better-auth"]).toBe("1.4.18");
		expect(
			serverPackage.dependencies?.["@better-auth/drizzle-adapter"],
		).toBeUndefined();
		expect(crmLock).toContain('"better-auth": "1.4.18"');
		expect(crmLock).not.toContain('"@better-auth/drizzle-adapter"');
	});

	it("parses shell, multiline, JSON and flagged Docker COPY instructions", () => {
		const dockerfile = String.raw`
COPY one two /dest/
COPY three \
     four \
     /dest/
COPY ["json-one", "json two", "/dest/"]
COPY --chown=1000:1000 --chmod=755 flagged /dest/
COPY --from=builder /compiled /dest/
`;

		expect(readDockerCopySources(dockerfile)).toEqual([
			"one",
			"two",
			"three",
			"four",
			"json-one",
			"json two",
			"flagged",
		]);
	});

	it("detects Git-ignored untracked files that remain in the Docker context", () => {
		const probe = join(serverRoot, ".deploy-untracked-probe.log");
		try {
			writeFileSync(probe, "probe");
			const ignoredByGit = Bun.spawnSync({
				cmd: ["git", "check-ignore", probe],
				cwd: crmRoot,
				stderr: "pipe",
				stdout: "pipe",
			});
			expect(ignoredByGit.exitCode).toBe(0);

			const result = Bun.spawnSync({
				cmd: [
					"git",
					"ls-files",
					"--others",
					`--exclude-from=${join(repoRoot, ".dockerignore")}`,
					"--",
					":(top)apps/crm/apps/server/",
				],
				cwd: crmRoot,
				stderr: "pipe",
				stdout: "pipe",
			});
			expect(result.exitCode).toBe(0);
			expect(new TextDecoder().decode(result.stdout)).toContain(
				"apps/server/.deploy-untracked-probe.log",
			);
		} finally {
			rmSync(probe, { force: true });
		}
	});

	it("uses the monorepo root context in every legacy CRM deploy build", async () => {
		const deployScript = await readFile(deployScriptPath, "utf8");

		expect(deployScript).toContain(
			'podman build -t cci/crm-api -f "$SCRIPT_DIR/apps/server/Dockerfile" "$MONOREPO_ROOT"',
		);
		expect(deployScript).toContain(
			'podman build --no-cache -t cci/crm-web -f "$SCRIPT_DIR/Dockerfile" "$MONOREPO_ROOT"',
		);
		expect(deployScript).not.toMatch(
			/cd apps\/server\s*\n\s*podman build -t cci\/crm-api \./,
		);
	});

	it("tracks every build-context input consumed by the CRM images", async () => {
		const [deployScript, serverDockerfile, webDockerfile] = await Promise.all([
			readFile(deployScriptPath, "utf8"),
			readFile(dockerfilePath, "utf8"),
			readFile(webDockerfilePath, "utf8"),
		]);
		const serverInputs = readInputArray(deployScript, "SERVER_BUILD_INPUTS");
		const webInputs = readInputArray(deployScript, "WEB_BUILD_INPUTS");

		expect(deployScript).toContain(
			'git ls-files --others --exclude-from="$MONOREPO_ROOT/.dockerignore" -- "$@"',
		);

		expectInputsCoverSources(serverInputs, [
			...readDockerCopySources(serverDockerfile),
			"apps/crm/apps/server/Dockerfile",
			".dockerignore",
		]);
		expectInputsCoverSources(webInputs, [
			...readDockerCopySources(webDockerfile),
			"apps/crm/Dockerfile",
			".dockerignore",
		]);

		for (const name of ["SERVER_BUILD_INPUTS", "WEB_BUILD_INPUTS"]) {
			expect(deployScript).toContain(
				`git diff --quiet HEAD -- "\${${name}[@]}"`,
			);
			expect(deployScript).toContain(
				`git diff --quiet --cached -- "\${${name}[@]}"`,
			);
			expect(deployScript).toContain(
				`git diff --quiet "$COMPARE_MODE" HEAD -- "\${${name}[@]}"`,
			);
			expect(deployScript).toContain(`has_untracked_inputs "\${${name}[@]}"`);
		}
	});

	it("keeps production workflow filters aligned with both CRM Dockerfiles", async () => {
		const [workflow, serverDockerfile, webDockerfile] = await Promise.all([
			readFile(deployWorkflowPath, "utf8"),
			readFile(dockerfilePath, "utf8"),
			readFile(webDockerfilePath, "utf8"),
		]);
		const serverFilter = readWorkflowFilter(workflow, "crm-api");
		const webFilter = readWorkflowFilter(workflow, "crm-web");
		const pushPaths = readWorkflowPushPaths(workflow);

		expect(pushPaths).toContain(".dockerignore");

		expectWorkflowFilterCovers(serverFilter, [
			...readDockerCopySources(serverDockerfile),
			"apps/crm/apps/server/Dockerfile",
			".dockerignore",
		]);
		expectWorkflowFilterCovers(webFilter, [
			...readDockerCopySources(webDockerfile),
			"apps/crm/Dockerfile",
			".dockerignore",
		]);
	});

	it("gates the production server image on the compiled auth SQL smoke during docker build", async () => {
		const dockerfile = await readFile(dockerfilePath, "utf8");

		expect(dockerfile).toContain("FROM deps AS auth-sql-smoke");
		expect(dockerfile).toContain(
			"COPY apps/crm/apps/server/test/auth-sql-predicate-assertions.ts ./apps/crm/apps/server/test/auth-sql-predicate-assertions.ts",
		);
		expect(dockerfile).toContain(
			"COPY apps/crm/apps/server/test/compiled-auth-sql-harness.ts ./apps/crm/apps/server/test/compiled-auth-sql-harness.ts",
		);
		expect(dockerfile).toMatch(
			/RUN bun build[\s\S]*--compile[\s\S]*--outfile \/tmp\/crm-auth-sql-smoke[\s\S]*test\/compiled-auth-sql-harness\.ts/,
		);
		expect(dockerfile).toContain("RUN /tmp/crm-auth-sql-smoke");
		expect(dockerfile).toContain("FROM auth-sql-smoke AS builder");
		expect(dockerfile).toContain(
			"COPY --from=builder /usr/src/app/apps/crm/apps/server/server .",
		);
		expect(dockerfile).not.toContain(
			"COPY --from=auth-sql-smoke /tmp/crm-auth-sql-smoke",
		);
	});

	it("makes the compiled harness fail on missing or malformed auth predicates", async () => {
		const harness = await readFile(harnessPath, "utf8");

		expect(harness).toMatch(/assertBoundPredicate\(\s*userEmailQuery/);
		expect(harness).toMatch(/assertBoundPredicate\(\s*credentialAccountQuery/);
		expect(harness).toMatch(/assertBoundPredicate\(\s*googleAccountQuery/);
		expect(harness).toContain("assertNoMalformedEquality(");
	});

	it("keeps compiled auth adapter SQL predicates for credential and OAuth lookups", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "crm-auth-sql-"));
		const { fixtureCrmRoot, fixtureServerRoot } =
			createLockedCrmFixture(tempDir);
		const executable = join(tempDir, "auth-sql-regression");

		try {
			const install = Bun.spawnSync({
				cmd: [process.execPath, "install", "--frozen-lockfile"],
				cwd: fixtureCrmRoot,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(install.exitCode, new TextDecoder().decode(install.stderr)).toBe(
				0,
			);

			const build = Bun.spawnSync({
				cmd: [
					process.execPath,
					"build",
					"--compile",
					"--minify-whitespace",
					"--minify-syntax",
					"--target",
					"bun",
					"--outfile",
					executable,
					"test/compiled-auth-sql-harness.ts",
				],
				cwd: fixtureServerRoot,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(build.exitCode, new TextDecoder().decode(build.stderr)).toBe(0);

			const run = Bun.spawnSync({
				cmd: [executable],
				cwd: fixtureServerRoot,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(run.exitCode, new TextDecoder().decode(run.stderr)).toBe(0);

			const output = new TextDecoder().decode(run.stdout).trim();
			const sql = JSON.parse(output) as {
				userEmailQuery: QueryRecord;
				credentialAccountQuery: QueryRecord;
				googleAccountQuery: QueryRecord;
			};

			expect(sql.userEmailQuery.text).toContain('from "user"');
			assertBoundPredicate(
				sql.userEmailQuery,
				'"user"."email"',
				"agent-test@clubcashin.test",
				"user email lookup",
			);
			assertBoundPredicate(
				sql.credentialAccountQuery,
				'"account"."provider_id"',
				"credential",
				"credential provider lookup",
			);
			assertBoundPredicate(
				sql.credentialAccountQuery,
				'"account"."account_id"',
				"user-id-1",
				"credential account lookup",
			);
			assertBoundPredicate(
				sql.googleAccountQuery,
				'"account"."provider_id"',
				"google",
				"google provider lookup",
			);
			assertBoundPredicate(
				sql.googleAccountQuery,
				'"account"."account_id"',
				"google-account-1",
				"google account lookup",
			);
			expect(sql.userEmailQuery.text).not.toContain("( =");
			expect(sql.credentialAccountQuery.text).not.toContain("( =");
			expect(sql.googleAccountQuery.text).not.toContain("( =");
		} finally {
			rmSync(tempDir, { force: true, recursive: true });
		}
	}, 30_000);
});
