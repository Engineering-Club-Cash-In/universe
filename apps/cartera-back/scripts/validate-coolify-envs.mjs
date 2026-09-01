import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const isRecord = (value) =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function validateCoolifyEnvironment(environmentVariables, manifest) {
	if (!Array.isArray(environmentVariables)) {
		throw new Error("Coolify response: expected an array");
	}
	if (!isRecord(manifest) || !Array.isArray(manifest.required)) {
		throw new Error("Manifest: expected a required array");
	}

	const failures = [];

	for (const requirement of manifest.required) {
		if (!isRecord(requirement) || typeof requirement.key !== "string") {
			throw new Error("Manifest: every requirement must have a key");
		}

		const matching = environmentVariables.filter(
			(variable) => isRecord(variable) && variable.key === requirement.key,
		);
		const production = matching.filter(
			(variable) => variable.is_preview === false,
		);

		if (production.length === 0) {
			failures.push(
				`${requirement.key}:${
					matching.length > 0 ? "preview-only" : "missing"
				}`,
			);
			continue;
		}
		if (production.length > 1) {
			failures.push(`${requirement.key}:duplicate-production-entry`);
			continue;
		}
		if (requirement.runtime === true && production[0].is_runtime !== true) {
			failures.push(`${requirement.key}:runtime-disabled`);
		}
	}

	if (failures.length > 0) {
		throw new Error(failures.join(", "));
	}

	return { checked: manifest.required.length };
}

async function readStandardInput() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

async function main() {
	const manifestFlag = process.argv.indexOf("--manifest");
	const manifestPath = process.argv[manifestFlag + 1];
	if (manifestFlag === -1 || !manifestPath) {
		throw new Error("Usage: --manifest <path>");
	}

	const [manifestText, responseText] = await Promise.all([
		readFile(manifestPath, "utf8"),
		readStandardInput(),
	]);
	const result = validateCoolifyEnvironment(
		JSON.parse(responseText),
		JSON.parse(manifestText),
	);
	process.stdout.write(
		`Validated ${result.checked} production environment variables.\n`,
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((error) => {
		const message = error instanceof Error ? error.message : "unknown error";
		process.stderr.write(
			`Coolify production environment validation failed: ${message}\n`,
		);
		process.exitCode = 1;
	});
}
