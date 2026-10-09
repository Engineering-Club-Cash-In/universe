import { describe, expect, test } from "bun:test";
import { errorBuroVigenteParaAnalisis } from "./buro-vigente-para-analisis";

const vigente = {
	buro: { estado: "aprobado" },
	buroVigente: true,
	buroDesactualizado: false,
};

describe("Buró previo al aprobar análisis", () => {
	test("acepta resultados vigentes aunque el Buró rechace o no tenga registro", () => {
		for (const estadoBuro of ["aprobado", "rechazado", "sin_registro"]) {
			expect(
				errorBuroVigenteParaAnalisis({
					...vigente,
					buro: { estado: estadoBuro },
					cofirmantes: [{ ...vigente, nombre: "QA" }],
				}),
			).toBeNull();
		}
	});

	test("bloquea al titular sin resultado, con error, vencido o de otro DPI", () => {
		for (const cambio of [
			{ buro: null },
			{ buro: { estado: "error" } },
			{ buroVigente: false },
			{ buroDesactualizado: true },
		]) {
			expect(
				errorBuroVigenteParaAnalisis({
					...vigente,
					...cambio,
					cofirmantes: [],
				}),
			).toContain("El titular");
		}
	});

	test("bloquea si un cofirmante no tiene Buró vigente", () => {
		expect(
			errorBuroVigenteParaAnalisis({
				...vigente,
				cofirmantes: [
					{ ...vigente, nombre: "Válido" },
					{ ...vigente, nombre: "DPI inválido", buro: { estado: "error" } },
				],
			}),
		).toContain("cofirmante DPI inválido");
	});

	test("la exención del bot cubre al titular y a sus cofirmantes", () => {
		expect(
			errorBuroVigenteParaAnalisis({
				...vigente,
				exento: true,
				buro: null,
				cofirmantes: [{ ...vigente, nombre: "Pendiente", buro: null }],
			}),
		).toBeNull();
	});

	test("al entrar al 30% indica que el error se resuelve al 20%", () => {
		expect(
			errorBuroVigenteParaAnalisis(
				{ ...vigente, buro: { estado: "error" }, cofirmantes: [] },
				"entrar_analisis",
			),
		).toContain("antes de pasar al 30%");
	});

	test("al revalidar dentro del 30% indica reconsulta o validación manual ahí", () => {
		expect(
			errorBuroVigenteParaAnalisis(
				{ ...vigente, buro: { estado: "error" }, cofirmantes: [] },
				"revalidar_en_analisis",
			),
		).toContain("en el 30%");
	});
});
