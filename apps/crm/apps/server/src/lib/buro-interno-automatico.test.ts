import { describe, expect, test } from "bun:test";
import {
	agregarObjetivoPersonaGuardada,
	cambioFuenteCartera,
	cambioPersonaAutomatica,
	candidatosIdentidadCoincidentesConFuente,
	crearColaSerial,
	type DatosPersonaAutomaticaComparables,
	decidirPersistenciaAutomatica,
	EvaluacionBuroInternoInestableError,
	esFichaAutomaticaReconciliable,
	esFichaManual,
	esFichaManualActiva,
	evaluarConHuellaEstable,
	fuentesCoincidentesPorUsuario,
	indexarRelacionesLeadPorSifco,
	personaGuardadaFiguraEnCliente,
	reintentarSinTurno,
	SinTurnoBuroInternoError,
	usuariosParaSincronizacionAutomatica,
} from "./buro-interno-automatico";

describe("personaGuardadaFiguraEnCliente", () => {
	const clienteVacio = {
		nombresCompletos: [] as string[],
		leadIds: [] as string[],
		dpis: [] as Array<string | null>,
		nits: [] as Array<string | null>,
	};
	const personaBase = {
		nombres: "Juan",
		apellidos: "Pérez",
		leadId: null,
		dpi: null,
		nit: null,
	};

	test("false cuando la persona guardada ya no figura en el cliente", () => {
		expect(
			personaGuardadaFiguraEnCliente(
				{
					nombres: "María",
					apellidos: "López",
					leadId: null,
					dpi: null,
					nit: null,
				},
				{ ...clienteVacio, nombresCompletos: ["Juan Pérez"] },
			),
		).toBe(false);
	});

	test("true por nombre, ignorando tildes, mayúsculas y espacios", () => {
		expect(
			personaGuardadaFiguraEnCliente(personaBase, {
				...clienteVacio,
				nombresCompletos: ["JUAN  PEREZ"],
			}),
		).toBe(true);
	});

	test("true por NIT aunque el nombre sea distinto", () => {
		expect(
			personaGuardadaFiguraEnCliente(
				{
					nombres: "María",
					apellidos: "López",
					leadId: null,
					dpi: null,
					nit: "123-4",
				},
				{ ...clienteVacio, nits: ["1234"] },
			),
		).toBe(true);
	});

	test("true por lead aunque el nombre sea distinto", () => {
		expect(
			personaGuardadaFiguraEnCliente(
				{
					nombres: "María",
					apellidos: "López",
					leadId: "L1",
					dpi: null,
					nit: null,
				},
				{ ...clienteVacio, leadIds: ["L1"] },
			),
		).toBe(true);
	});
});

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

describe("crearColaSerial", () => {
	test("ejecuta las tareas de una en una", async () => {
		const cola = crearColaSerial();
		const eventos: string[] = [];
		const tarea = (n: number) => async () => {
			eventos.push(`inicio-${n}`);
			await new Promise((r) => setTimeout(r, 5));
			eventos.push(`fin-${n}`);
		};
		await Promise.all([cola(tarea(1)), cola(tarea(2))]);
		expect(eventos).toEqual(["inicio-1", "fin-1", "inicio-2", "fin-2"]);
	});

	test("continúa después de una tarea fallida", async () => {
		const cola = crearColaSerial();
		const p1 = cola(async () => {
			throw new Error("fallo");
		});
		const p2 = cola(async () => 42);
		await expect(p1).rejects.toThrow();
		expect(await p2).toBe(42);
	});
});

describe("reintentarSinTurno", () => {
	const reloj = () => {
		let t = 0;
		return {
			ahora: () => t,
			esperar: async (ms: number) => {
				t += ms;
			},
		};
	};

	test("reintenta hasta obtener turno", async () => {
		const { ahora, esperar } = reloj();
		let llamadas = 0;
		const resultado = await reintentarSinTurno(
			async () => {
				llamadas += 1;
				if (llamadas < 3) throw new SinTurnoBuroInternoError();
				return "ok";
			},
			{ ahora, esperar },
		);
		expect(resultado).toBe("ok");
		expect(llamadas).toBe(3);
	});

	test("propaga otros errores sin reintentar", async () => {
		const { ahora, esperar } = reloj();
		let llamadas = 0;
		await expect(
			reintentarSinTurno(
				async () => {
					llamadas += 1;
					throw new Error("x");
				},
				{ ahora, esperar },
			),
		).rejects.toThrow("x");
		expect(llamadas).toBe(1);
	});

	test("falla tras el tiempo máximo", async () => {
		const { ahora, esperar } = reloj();
		await expect(
			reintentarSinTurno(
				async () => {
					throw new SinTurnoBuroInternoError();
				},
				{ maxMs: 1_000, ahora, esperar },
			),
		).rejects.toThrow("ocupado");
	});
});
