import assert from "node:assert/strict";
import test from "node:test";
import { validateCoolifyEnvironment } from "./validate-coolify-envs.mjs";

const manifest = {
	required: [
		{ key: "EMAIL_DOMAIN", runtime: true },
		{ key: "RESEND_API_KEY", runtime: true },
	],
};

const production = (key, overrides = {}) => ({
	key,
	is_preview: false,
	is_runtime: true,
	value: "must-never-appear",
	...overrides,
});

test("accepts complete production-scoped runtime metadata", () => {
	assert.deepEqual(
		validateCoolifyEnvironment(
			[production("EMAIL_DOMAIN"), production("RESEND_API_KEY")],
			manifest,
		),
		{ checked: 2 },
	);
});

test("rejects a preview-only variable without exposing its value", () => {
	assert.throws(
		() =>
			validateCoolifyEnvironment(
				[
					production("EMAIL_DOMAIN", { is_preview: true }),
					production("RESEND_API_KEY"),
				],
				manifest,
			),
		(error) => {
			assert.match(error.message, /EMAIL_DOMAIN.*preview-only/);
			assert.doesNotMatch(error.message, /must-never-appear/);
			return true;
		},
	);
});

test("rejects a production variable that is not injected at runtime", () => {
	assert.throws(
		() =>
			validateCoolifyEnvironment(
				[
					production("EMAIL_DOMAIN", { is_runtime: false }),
					production("RESEND_API_KEY"),
				],
				manifest,
			),
		/EMAIL_DOMAIN.*runtime-disabled/,
	);
});

test("rejects duplicate production entries", () => {
	assert.throws(
		() =>
			validateCoolifyEnvironment(
				[
					production("EMAIL_DOMAIN"),
					production("EMAIL_DOMAIN"),
					production("RESEND_API_KEY"),
				],
				manifest,
			),
		/EMAIL_DOMAIN.*duplicate-production-entry/,
	);
});

test("fails closed on malformed Coolify responses", () => {
	assert.throws(
		() => validateCoolifyEnvironment({ envs: [] }, manifest),
		/expected an array/,
	);
});
