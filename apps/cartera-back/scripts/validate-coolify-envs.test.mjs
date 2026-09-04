import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

/**
 * Las dos pruebas de abajo no miran al validador: miran al MANIFIESTO real.
 *
 * El gate de `deploy-prod.yaml` solo comprueba lo que el manifiesto lista, así
 * que una variable que el código lee pero el manifiesto no nombra pasa el
 * deploy en verde y revienta en caliente. Eso ya pasó con el provisionamiento
 * del portal: `portalProvisioning.ts` lee AUTH_GOOGLE_URL y
 * PORTAL_PROVISIONING_SECRET, ninguna estaba en el manifiesto, y sin ellas cada
 * alta responde `provisionamiento_no_configurado`.
 *
 * Se comprueba contra el FUENTE, no contra una lista escrita a mano: así la
 * próxima variable que alguien lea desde ese servicio también queda cubierta.
 */
const manifiestoProduccion = JSON.parse(
	readFileSync(new URL("../required-env.production.json", import.meta.url), "utf8"),
);

const leidasPorElServicio = (rutaRelativa) => {
	const fuente = readFileSync(new URL(rutaRelativa, import.meta.url), "utf8");
	return [...fuente.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
};

test("el manifiesto de producción declara toda variable que lee el provisionamiento del portal", () => {
	const declaradas = new Map(
		manifiestoProduccion.required.map((e) => [e.key, e.runtime]),
	);

	for (const clave of leidasPorElServicio("../src/services/portalProvisioning.ts")) {
		assert.ok(
			declaradas.has(clave),
			`${clave} se lee en portalProvisioning.ts pero no está en required-env.production.json: el deploy pasaría en verde sin ella`,
		);
		assert.equal(
			declaradas.get(clave),
			true,
			`${clave} tiene que ser runtime: se lee de process.env al atender la petición, no al buildear`,
		);
	}
});

test("el manifiesto de producción no repite claves", () => {
	const claves = manifiestoProduccion.required.map((e) => e.key);
	assert.equal(new Set(claves).size, claves.length);
});
