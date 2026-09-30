import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * Guardas estructurales de dos arreglos del ledger de mora pagada que ninguna
 * prueba de comportamiento puede ver sin una base real.
 */
const latefee = readFileSync(new URL("./latefee.ts", import.meta.url), "utf8");
const cuerpo = (firma: string) => {
	const i = latefee.indexOf(firma);
	return latefee.slice(i, latefee.indexOf("\nexport ", i + 1));
};

describe("un solo criterio de «cuota ya pagada» para el cron y el ledger", () => {
	test("la subconsulta vive en un solo módulo", () => {
		// Si reaparece una copia en latefee.ts, el cron y el reparto pueden divergir.
		expect(latefee).not.toContain("pc.cuota_id = ${cuotas_credito.cuota_id}");
	});
	test("procesarMoras y cuotasParaPendienteDeCreditos usan el mismo helper", () => {
		expect(cuerpo("export async function procesarMoras")).toContain("hasPaidPayment: hasPaidPaymentSql()");
		expect(cuerpo("export async function cuotasParaPendienteDeCreditos")).toContain("hasPaidPayment: hasPaidPaymentSql()");
	});
});

describe("la condonación masiva trabaja con las moras vigentes DESPUÉS del candado", () => {
	const masiva = cuerpo("export async function condonarTodasLasMoras");
	test("bloquea créditos, re-lee moras activas y recién ahí las pone en cero", () => {
		const candado = masiva.indexOf('.for("update"');
		const relectura = masiva.indexOf("const vigentes = await tx");
		const puestaEnCero = masiva.indexOf(".update(moras_credito)");
		expect(candado).toBeGreaterThan(-1);
		expect(relectura).toBeGreaterThan(candado);
		expect(puestaEnCero).toBeGreaterThan(relectura);
		expect(masiva.slice(relectura, puestaEnCero)).toContain("eq(moras_credito.activa, true)");
	});
	test("el UPDATE solo toca filas todavía activas", () => {
		const i = masiva.indexOf(".update(moras_credito)");
		const where = masiva.slice(i, masiva.indexOf(";", i));
		expect(where).toContain("eq(moras_credito.activa, true)");
	});
	test("todo lo que se escribe sale de la re-lectura, no del SELECT de afuera", () => {
		const i = masiva.indexOf("const vigentes = await tx");
		const dentro = masiva.slice(i);
		expect(dentro).toMatch(/const conMoraActiva = vigentes;/);
		// Antes de la re-lectura no se escribe nada.
		expect(masiva.slice(0, i)).not.toContain(".update(moras_credito)");
		expect(masiva.slice(0, i)).not.toContain(".insert(moras_condonaciones)");
	});
});

describe("una mora activa en Q0 (todo abonado, cuotas aún vencidas) no se condona", () => {
	test("la masiva solo re-lee moras con monto > 0", () => {
		const masiva = cuerpo("export async function condonarTodasLasMoras");
		const i = masiva.indexOf("const vigentes = await tx");
		expect(masiva.slice(i, masiva.indexOf(";", i))).toContain('gt(moras_credito.monto_mora, "0")');
	});
	test("la individual corta por monto ≤ 0 antes de tocar la mora", () => {
		const individual = cuerpo("export async function condonarMora(");
		const corte = individual.search(/new Big\(monto\)\.lte\(0\)/);
		expect(corte).toBeGreaterThan(-1);
		expect(corte).toBeLessThan(individual.indexOf(".update(moras_credito)"));
	});
});

describe("el cargador trae solo cuotas impagas desde SQL", () => {
	test("cuotasParaPendienteDeCreditos filtra pagado = false en la consulta", () => {
		expect(cuerpo("export async function cuotasParaPendienteDeCreditos")).toContain("eq(cuotas_credito.pagado, false)");
	});
});
