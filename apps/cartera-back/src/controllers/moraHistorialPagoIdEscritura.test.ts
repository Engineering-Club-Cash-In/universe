/**
 * PAGO_ID EN MORAS_HISTORIAL
 *
 * Verifica que el pago_id se escribe correctamente en moras_historial en tres casos:
 *
 * 1. En el DECREMENTO: cuando se estampa el pago en el decremento de mora
 * 2. En la RESTITUCIÓN de reversePayment: cuando se restituye mora por reversar un pago
 * 3. En la RESTITUCIÓN de anularPagoMora: cuando se restituye mora por anular un pago
 *
 * Usa verificación estructural (sin tocar la BD) sobre el texto del código.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

describe("pago_id en moras_historial - verificación estructural", () => {
	describe("(a) estampador de decremento: estamparPagoEnDecremento", () => {
		it("el UPDATE contiene pago_id además del motivo", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "moraDecrementoDePago.ts"),
				"utf-8",
			);

			// Verificar que el UPDATE en estamparPagoEnDecremento setea pago_id
			const funcionMatch = archivo.match(
				/export async function estamparPagoEnDecremento[\s\S]*?\.set\(\s*\{([\s\S]*?)\}\s*\)/,
			);
			expect(funcionMatch).toBeDefined();
			const setBlock = funcionMatch![1];

			// Debe contener motivo
			expect(setBlock).toContain("motivo");
			// Debe contener pago_id con COALESCE para no pisar existentes
			expect(setBlock).toContain("pago_id");
			expect(setBlock).toContain("COALESCE");
		});
	});

	describe("(b) restitución: restitucionMoraDePago", () => {
		it("la función retorna un objeto con pago_id", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "../utils/restitucionMoraDePago.ts"),
				"utf-8",
			);

			// Verificar que RestitucionMora incluye pago_id
			const tipoMatch = archivo.match(
				/export type RestitucionMora = \{([\s\S]*?)\}/,
			);
			expect(tipoMatch).toBeDefined();
			expect(tipoMatch![1]).toContain("pago_id");

			// Verificar que la función retorna pago_id
			const returnMatch = archivo.match(
				/return \{\s*monto_cambio[\s\S]*?\}/,
			);
			expect(returnMatch).toBeDefined();
			expect(returnMatch![0]).toContain("pago_id");
		});
	});

	describe("(c) updateMora: pasa pago_id a registrarHistorialMora", () => {
		it("la firma de updateMora incluye pago_id", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "latefee.ts"),
				"utf-8",
			);

			// Verificar que updateMora tiene pago_id en los parámetros
			expect(archivo).toContain("pago_id?: number | string | null;");
		});

		it("updateMora pasa pago_id a registrarHistorialMora", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "latefee.ts"),
				"utf-8",
			);

			// Verificar que registrarHistorialMora se llama con pago_id
			expect(archivo).toContain("pago_id: pago_id !== null && pago_id !== undefined ? Number(pago_id) : null,");
		});
	});

	describe("(d) reversePayment: pasa pago_id en la restitución", () => {
		it("restitucionMoraDePago se llama con pago_id", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "reversePayment.ts"),
				"utf-8",
			);

			// Verificar la llamada a restitucionMoraDePago
			expect(archivo).toContain("const restitucion = restitucionMoraDePago(");
			expect(archivo).toContain("pago_id,");
		});

		it("updateMora recibe la restitución con pago_id via spread", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "reversePayment.ts"),
				"utf-8",
			);

			// Verificar que updateMora se llama con ...restitucion
			expect(archivo).toContain("...restitucion,");
		});
	});

	describe("(e) anularPagoMora: pasa pago_id en la restitución", () => {
		it("restitucionMoraDePago se llama con pago_id", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "anularPagoMora.ts"),
				"utf-8",
			);

			// Verificar la llamada a restitucionMoraDePago
			expect(archivo).toContain("const restitucionMora = restitucionMoraDePago(");
			expect(archivo).toContain("pago_id,");
		});

		it("updateMora recibe la restitución con pago_id via spread", () => {
			const archivo = readFileSync(
				join(import.meta.dir, "anularPagoMora.ts"),
				"utf-8",
			);

			// Verificar que updateMora se llama con ...restitucionMora
			expect(archivo).toContain("...restitucionMora,");
		});
	});
});
