import { describe, expect, test } from "bun:test";
import {
	agregarObjetivoPersonaGuardada,
	cambioFuenteCartera,
	cambioPersonaAutomatica,
	candidatosIdentidadCoincidentesConFuente,
	type DatosPersonaAutomaticaComparables,
	decidirPersistenciaAutomatica,
	EvaluacionBuroInternoInestableError,
	esFichaAutomaticaReconciliable,
	esFichaManual,
	esFichaManualActiva,
	evaluarConHuellaEstable,
	fuentesCoincidentesPorUsuario,
	indexarRelacionesLeadPorSifco,
	usuariosParaSincronizacionAutomatica,
} from "./buro-interno-automatico";

const persona: DatosPersonaAutomaticaComparables = {
	activo: true,
	leadId: "lead-1",
	numeroCreditoSifco: "SIFCO-1",
	nombres: "Ana",
	apellidos: "López",
	dpi: "123",
	nit: "456",
	telefono: "5555",
	direccion: "Guatemala",
	categoria: "mala_paga",
	motivo: "Crédito moroso",
	desactivadoPor: null,
	desactivadoAt: null,
	motivoDesactivacion: null,
};

describe("sincronización de fichas automáticas", () => {
	test("una sincronización idéntica no toca updated_at", () => {
		expect(cambioPersonaAutomatica(persona, { ...persona })).toBe(false);
	});

	test("detecta un cambio real o una reactivación", () => {
		expect(
			cambioPersonaAutomatica(persona, {
				...persona,
				categoria: "fraude",
			}),
		).toBe(true);
		expect(
			cambioPersonaAutomatica(
				{
					...persona,
					activo: false,
					desactivadoAt: new Date("2026-10-01T00:00:00Z"),
				},
				persona,
			),
		).toBe(true);
	});

	test("identifica la ficha manual activa en la misma guarda usada por el servicio", () => {
		expect(esFichaManualActiva({ activo: true, origen: "manual" })).toBe(true);
		expect(esFichaManualActiva({ activo: false, origen: "manual" })).toBe(
			false,
		);
		expect(
			esFichaManualActiva({ activo: true, origen: "automatico_cartera" }),
		).toBe(false);
	});

	test("una ficha manual retirada conserva la precedencia de Cobros", () => {
		expect(esFichaManual({ origen: "manual" })).toBe(true);
		expect(esFichaManual({ origen: "automatico_cartera" })).toBe(false);
	});

	test("reconcilia una baja automática pero respeta un retiro humano", () => {
		expect(
			esFichaAutomaticaReconciliable({
				origen: "automatico_cartera",
				desactivadoPor: null,
			}),
		).toBe(true);
		expect(
			esFichaAutomaticaReconciliable({
				origen: "automatico_cartera",
				desactivadoPor: "usuario-cobros",
			}),
		).toBe(false);
	});

	test("reactiva únicamente cuando no hay ficha manual activa", () => {
		expect(
			decidirPersistenciaAutomatica({
				automatica: { activo: false },
			}),
		).toBe("reactivar");
	});

	test("no actualiza una fuente idéntica y detecta cambios reales", () => {
		const fuente = {
			personaId: "persona-1",
			numeroCreditoSifco: "SIFCO-1",
			estadoCredito: "MOROSO",
			categoria: "mala_paga",
			motivo: "Mora vigente",
			evidencia: { riesgos: [{ categoria: "mala_paga" }], cuotas: 2 },
		};
		expect(
			cambioFuenteCartera(fuente, {
				...fuente,
				evidencia: { cuotas: 2, riesgos: [{ categoria: "mala_paga" }] },
			}),
		).toBe(false);
		expect(
			cambioFuenteCartera(fuente, {
				...fuente,
				estadoCredito: "INCOBRABLE",
			}),
		).toBe(true);
	});

	test("sincroniza solo coincidencias actuales y fichas relacionadas", () => {
		expect(
			usuariosParaSincronizacionAutomatica({
				usuariosCoincidentes: [30],
				personasCoincidentes: ["persona-relacionada"],
				usuariosPorPersona: new Map([
					["persona-relacionada", [20, 21]],
					["persona-ajena", [99]],
				]),
				usuariosConRiesgo: [20, 30, 99],
			}),
		).toEqual([20, 30]);
	});

	test("conserva cada identidad coincidente de un mismo usuario de Cartera", () => {
		expect(
			fuentesCoincidentesPorUsuario({
				coincidencias: [
					{ registroId: "usuario-20-persona-1" },
					{ registroId: "usuario-20-persona-2" },
					{ registroId: "usuario-20-persona-1" },
				],
				usuarioPorFuente: new Map([
					["usuario-20-persona-1", 20],
					["usuario-20-persona-2", 20],
				]),
			}),
		).toEqual(
			new Map([[20, ["usuario-20-persona-1", "usuario-20-persona-2"]]]),
		);
	});

	test("usa al candidato para precedencia manual solo por identidad", () => {
		const titular = {
			origen: "titular",
			etiqueta: "Titular",
			nombres: "Pedro Fernando",
			apellidos: "Morales Estrada",
		};
		const codeudor = {
			origen: "codeudor",
			etiqueta: "Codeudor: Ana López",
			nombres: "Ana",
			apellidos: "López Pérez",
		};
		expect(
			candidatosIdentidadCoincidentesConFuente({
				candidatos: [titular, codeudor],
				coincidencias: [
					{
						registroId: "cartera-persona-jose",
						origen: "titular",
						etiqueta: "Titular",
						reglas: [{ clave: "mismos_apellidos" }],
					},
					{
						registroId: "cartera-persona-jose",
						origen: "codeudor",
						etiqueta: "Codeudor: Ana López",
						reglas: [{ clave: "nombre_completo_igual" }],
					},
				],
				fuenteId: "cartera-persona-jose",
			}),
		).toEqual([codeudor]);
	});

	test("agrega cada ficha guardada aunque ya exista un objetivo del usuario", () => {
		type Objetivo = {
			clave: string;
			personaAutomatica: { id: string } | null;
		};
		const objetivoCrudo: Objetivo = {
			clave: "identidad-actual",
			personaAutomatica: null,
		};
		const objetivoGuardado: Objetivo = {
			clave: "identidad-historica",
			personaAutomatica: { id: "persona-juan" },
		};
		const objetivos = agregarObjetivoPersonaGuardada(
			[objetivoCrudo],
			objetivoGuardado,
		);
		expect(objetivos).toEqual([objetivoCrudo, objetivoGuardado]);
		expect(agregarObjetivoPersonaGuardada(objetivos, objetivoGuardado)).toEqual(
			objetivos,
		);
	});

	test("enriquece leads por SIFCO directo o por referencia", () => {
		const directo = {
			id: "lead-directo",
			sifcoDirecto: "SIFCO-1",
			sifcoReferencia: null,
		};
		const referencia = {
			id: "lead-referencia",
			sifcoDirecto: null,
			sifcoReferencia: "SIFCO-2",
		};
		const relaciones = indexarRelacionesLeadPorSifco(
			[directo, referencia],
			["SIFCO-1", "SIFCO-2"],
		);

		expect(relaciones.get("SIFCO-1")?.map((lead) => lead.id)).toEqual([
			"lead-directo",
		]);
		expect(relaciones.get("SIFCO-2")?.map((lead) => lead.id)).toEqual([
			"lead-referencia",
		]);

		const segundaRelacion = {
			id: "lead-segundo",
			sifcoDirecto: "SIFCO-1",
			sifcoReferencia: null,
		};
		expect(
			indexarRelacionesLeadPorSifco([directo, segundaRelacion], ["SIFCO-1"])
				.get("SIFCO-1")
				?.map((lead) => lead.id),
		).toEqual(["lead-directo", "lead-segundo"]);
	});
});

describe("huella estable para aprobar análisis", () => {
	test("aprueba con una sola evaluación cuando la sincronización no cambia nada", async () => {
		let evaluaciones = 0;
		const resultado = await evaluarConHuellaEstable({
			huellaInicial: "h1",
			obtenerHuella: async () => "h1",
			evaluar: async () => ({ bloquea: false, numero: ++evaluaciones }),
		});

		expect(resultado).toEqual({
			evaluacion: { bloquea: false, numero: 1 },
			huella: "h1",
			intentos: 1,
		});
	});

	test("reevalúa después de que la primera pasada crea la ficha automática", async () => {
		let huella = "antes";
		let evaluaciones = 0;
		const resultado = await evaluarConHuellaEstable({
			huellaInicial: huella,
			obtenerHuella: async () => huella,
			evaluar: async () => {
				evaluaciones += 1;
				if (evaluaciones === 1) huella = "sincronizada";
				return { bloquea: false, numero: evaluaciones };
			},
		});

		expect(resultado).toEqual({
			evaluacion: { bloquea: false, numero: 2 },
			huella: "sincronizada",
			intentos: 2,
		});
	});

	test("falla de forma controlada si el catálogo nunca se estabiliza", async () => {
		let version = 0;
		await expect(
			evaluarConHuellaEstable({
				huellaInicial: "h0",
				obtenerHuella: async () => `h${version}`,
				evaluar: async () => {
					version += 1;
					return version;
				},
				maxIntentos: 2,
			}),
		).rejects.toBeInstanceOf(EvaluacionBuroInternoInestableError);
	});
});
