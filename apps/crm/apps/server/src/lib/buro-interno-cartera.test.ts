import { describe, expect, test } from "bun:test";
import type { CreditoBuroInterno } from "../types/cartera-back";
import {
	categoriaRiesgoPrioritaria,
	clasificarMotivoExplicito,
	evidenciaRiesgoCredito,
	idsFuentesObsoletas,
	normalizarMotivoRiesgo,
	planificarVigenciaPersonaAutomatica,
	resumirFuentesRiesgo,
	validarPaginaCreditosBuroInterno,
} from "./buro-interno-cartera";

function credito(
	statusCredit: CreditoBuroInterno["creditos"]["statusCredit"],
	parcial: Partial<CreditoBuroInterno> = {},
): CreditoBuroInterno {
	return {
		creditos: {
			credito_id: 1,
			usuario_id: 2,
			numero_credito_sifco: "SIFCO-1",
			statusCredit,
		},
		usuarios: {
			usuario_id: 2,
			nombre: "Ana López",
			nit: "123",
			direccion: null,
		},
		cancelacion: null,
		incobrable: null,
		caido: null,
		...parcial,
	};
}

describe("clasificación de evidencia de Cartera", () => {
	test("clasifica incobrable con su categoría propia", () => {
		expect(
			clasificarMotivoExplicito("Cuenta declarada incobrable")?.categoria,
		).toBe("incobrable");
	});

	test.each([
		"demora administrativa",
		"Cliente Morales",
		"Familia Morataya",
	])("no confunde palabras que contienen mora: %s", (texto) =>
		expect(clasificarMotivoExplicito(texto)).toBeNull());

	test.each([
		"Cancelación anticipada, sin mora",
		"No presenta mora",
		"Libre de mora",
		"No hubo fraude",
		"No es incobrable",
		"Se descartó fraude",
		"Sin atrasos ni mora",
		"No hubo mora ni incumplimiento",
		"Nunca tuvo mora",
		"No presenta falta de pago",
		"No se detectó evidencia de fraude",
		"Sin indicios de fraude",
		"No existe evidencia de fraude",
		"No presenta evidencia de fraude",
		"No hay evidencia alguna de fraude",
		"No cuenta con reportes de fraude",
		"No cuenta con mora",
		"No se detectó fraude",
		"No se encontró mora",
		"No tiene antecedentes de mora",
		"No existen antecedentes de fraude",
		"Mora condonada",
		"Se condonó la mora",
		"Cliente al día, sin problemas de mora",
		"No se le cobró mora",
		"No aplica mora",
		"Descuento de mora autorizado",
		"Canceló pagando la mora pendiente",
		"Cliente víctima de estafa",
	])("ignora evidencia explícitamente negada: %s", (texto) => {
		expect(clasificarMotivoExplicito(texto)).toBeNull();
	});

	test.each([
		["Vehículo reposeído", "vehiculo_recuperado"],
		["Carro recuperado", "vehiculo_recuperado"],
		["Cliente moroso", "mala_paga"],
		["Morosidad reiterada", "mala_paga"],
		["Fraudes detectados", "fraude"],
		["Créditos incobrables", "incobrable"],
		["Incumplimientos de pago", "mala_paga"],
	] as const)("reconoce variantes explícitas: %s", (texto, categoria) => {
		expect(clasificarMotivoExplicito(texto)?.categoria).toBe(categoria);
	});

	test("conserva expresiones afirmativas con la palabra no", () => {
		expect(clasificarMotivoExplicito("El cliente no pagó")?.categoria).toBe(
			"mala_paga",
		);
	});

	test("conserva evidencia afirmativa aunque exista una negación previa", () => {
		expect(
			clasificarMotivoExplicito(
				"No se detectó evidencia de fraude inicialmente; luego se confirmó fraude",
			)?.categoria,
		).toBe("fraude");
	});

	test("normaliza tildes y espacios antes de clasificar", () => {
		expect(normalizarMotivoRiesgo("  Recuperación   de vehículo  ")).toBe(
			"recuperacion de vehiculo",
		);
		expect(
			clasificarMotivoExplicito("  Recuperación   de vehículo  ")?.categoria,
		).toBe("vehiculo_recuperado");
	});

	test("mantiene el estado MOROSO como mala paga", () => {
		expect(evidenciaRiesgoCredito(credito("MOROSO"))).toContainEqual({
			categoria: "mala_paga",
			texto: "Crédito con estado MOROSO vigente",
		});
	});

	test("considera evidencia explícita aunque el estado actual sea ACTIVO", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("ACTIVO", {
				caido: { motivo: "Fraude confirmado", observaciones: null },
			}),
		);
		expect(riesgos.map((riesgo) => riesgo.categoria)).toContain("fraude");
	});

	test("considera evidencia histórica de incobrabilidad aunque el crédito vuelva a ACTIVO", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("ACTIVO", {
				incobrable: {
					motivo: "Fraude confirmado",
					observaciones: null,
				},
			}),
		);
		expect(riesgos).toContainEqual({
			categoria: "fraude",
			texto: "Fraude confirmado",
		});
	});

	test("no interpreta cuotas restantes de una cancelación como mora", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("CANCELADO", {
				cancelacion: {
					cuotas_atrasadas: 12,
					motivo: "Cancelación anticipada",
					observaciones: "Cliente al día, sin problemas de mora",
				},
			}),
		);
		expect(riesgos).toEqual([]);
	});

	test("prioriza fraude explícito en el motivo de un crédito INCOBRABLE", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("INCOBRABLE", {
				incobrable: {
					motivo: "Incobrable por fraude confirmado",
					observaciones: null,
				},
			}),
		);
		expect(riesgos.map((riesgo) => riesgo.categoria)).toContain("fraude");
		expect(
			categoriaRiesgoPrioritaria(riesgos.map((riesgo) => riesgo.categoria)),
		).toBe("fraude");
		expect(riesgos).toContainEqual({
			categoria: "incobrable",
			texto: "Crédito con estado INCOBRABLE",
		});
		expect(riesgos).toHaveLength(2);
	});

	test("no repite el mismo motivo de un crédito INCOBRABLE", () => {
		const riesgos = evidenciaRiesgoCredito(
			credito("INCOBRABLE", {
				incobrable: {
					motivo: "Crédito incobrable",
					observaciones: "Seguimiento de cobros",
				},
			}),
		);
		expect(
			riesgos.filter((riesgo) => riesgo.texto === "Crédito incobrable"),
		).toHaveLength(1);
		expect(riesgos).toContainEqual({
			categoria: "incobrable",
			texto: "Seguimiento de cobros",
		});
	});
});

describe("reconciliación de fuentes automáticas", () => {
	test("identifica las fuentes que ya no tienen evidencia vigente", () => {
		expect(idsFuentesObsoletas([10, 11, 12, 12], [10, 12])).toEqual([11]);
	});

	test("resume varias fuentes con orden estable y la categoría más crítica", () => {
		expect(
			resumirFuentesRiesgo([
				{
					numeroCreditoSifco: "B-2",
					categoria: "mala_paga",
					motivo: "Mora vigente",
				},
				{
					numeroCreditoSifco: "A-1",
					categoria: "fraude",
					motivo: "Fraude confirmado",
				},
			]),
		).toEqual({
			categoria: "fraude",
			motivo:
				"Registro automático desde Cartera. Evidencia: A-1: Fraude confirmado; B-2: Mora vigente",
		});
		expect(categoriaRiesgoPrioritaria([])).toBe("otro");
	});

	test("conserva la ficha si uno de varios usuarios vinculados sigue en riesgo", () => {
		expect(planificarVigenciaPersonaAutomatica([20, 21], [21])).toEqual({
			desactivar: false,
			usuariosSinRiesgo: [20],
		});
	});

	test("retira la ficha cuando ninguno de sus usuarios conserva riesgo", () => {
		expect(planificarVigenciaPersonaAutomatica([20, 21], [])).toEqual({
			desactivar: true,
			usuariosSinRiesgo: [20, 21],
		});
	});
});

describe("contrato de la página de Cartera", () => {
	test("acepta una página válida", () => {
		const pagina = {
			data: [credito("ACTIVO")],
			hasMore: false,
			nextCursor: null,
			snapshotMaxCreditoId: 1,
		};
		expect(() => validarPaginaCreditosBuroInterno(pagina)).not.toThrow();
	});

	test("rechaza un 200 con créditos incompletos", () => {
		expect(() =>
			validarPaginaCreditosBuroInterno({
				data: [{}],
				hasMore: false,
				nextCursor: null,
				snapshotMaxCreditoId: 1,
			}),
		).toThrow("crédito inválido");
	});

	test("rechaza evidencia anidada inválida", () => {
		const invalido = credito("CANCELADO", {
			cancelacion: {
				motivo: "Mora",
				observaciones: null,
				cuotas_atrasadas: -1,
			},
		});
		expect(() =>
			validarPaginaCreditosBuroInterno({
				data: [invalido],
				hasMore: false,
				nextCursor: null,
				snapshotMaxCreditoId: 1,
			}),
		).toThrow("crédito inválido");
	});
});
