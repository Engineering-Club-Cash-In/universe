import { describe, expect, it } from "bun:test";
import {
	type CatalogoJustificaciones,
	combinarChecklist,
	type EvidenciaGestion,
	esRecuperacionEfectiva,
	evaluarChecklist,
	inicioEpisodioMora,
	leerChecklistGuardado,
	motivoSolicitudSinEfecto,
	PASOS_CHECKLIST_RECUPERACION,
	type PasoEvaluado,
	type RespuestaPaso,
	resumenChecklist,
	textoAvisoDecisionRecuperacion,
	textoAvisoSolicitudRecuperacion,
} from "./recuperacion-solicitud";

const AHORA = new Date("2026-09-30T15:00:00Z");
const HACE_DIAS = (n: number) => new Date(AHORA.getTime() - n * 86_400_000);

function evidencia(extra: Partial<EvidenciaGestion> = {}): EvidenciaGestion {
	return {
		desde: HACE_DIAS(75),
		llamadas: { total: 0, contestadas: 0, ultima: null },
		mensajes: { total: 0, ultima: null },
		promesas: { total: 0, incumplidas: 0, ultima: null },
		convenios: { total: 0, ultima: null, sinDatos: false },
		referencias: { total: 0, gestionadas: 0, ultima: null },
		visitaResidencia: { total: 0, sinContacto: 0, ultima: null },
		visitaTrabajo: { total: 0, sinContacto: 0, ultima: null },
		tieneDatosLaborales: true,
		gps: { vinculado: true, consultas: 0, ultima: null },
		apagado: { estado: null, fecha: null },
		...extra,
	};
}

const paso = (pasos: PasoEvaluado[], clave: string) => {
	const p = pasos.find((x) => x.paso === clave);
	if (!p) throw new Error(`falta el paso ${clave}`);
	return p;
};

describe("estados de la solicitud", () => {
	it("solo lo aprobado (o sin aprobación de por medio) es una recuperación", () => {
		expect(esRecuperacionEfectiva(null)).toBe(true);
		expect(esRecuperacionEfectiva("aprobada")).toBe(true);
		for (const e of ["pendiente", "rechazada", "cancelada", "sin_efecto"]) {
			expect(esRecuperacionEfectiva(e)).toBe(false);
		}
	});

	it("una solicitud queda sin efecto si el crédito salió de B2–B3", () => {
		expect(motivoSolicitudSinEfecto(2)).toBeNull();
		expect(motivoSolicitudSinEfecto(3)).toBeNull();
		expect(motivoSolicitudSinEfecto(4, "B4")).toContain("ya está en B4");
		expect(motivoSolicitudSinEfecto(1)).toContain("B1");
		expect(motivoSolicitudSinEfecto(null)).toContain("salió del funnel");
	});
});

describe("evaluarChecklist", () => {
	it("sin gestión, todo pendiente y en el orden del catálogo", () => {
		const pasos = evaluarChecklist(evidencia());
		expect(pasos.map((p) => p.paso)).toEqual(
			PASOS_CHECKLIST_RECUPERACION.map((p) => p.clave),
		);
		expect(pasos.every((p) => p.estado === "pendiente")).toBe(true);
	});

	it("marca hecho lo que el CRM encontró, con la evidencia en una línea", () => {
		const pasos = evaluarChecklist(
			evidencia({
				llamadas: { total: 7, contestadas: 2, ultima: HACE_DIAS(2) },
				visitaResidencia: { total: 2, sinContacto: 1, ultima: HACE_DIAS(5) },
				apagado: { estado: "ejecutada", fecha: HACE_DIAS(10) },
			}),
		);
		expect(paso(pasos, "llamadas_cliente")).toMatchObject({ estado: "hecho" });
		expect(paso(pasos, "llamadas_cliente").evidencia).toContain(
			"7 llamadas (2 contestadas)",
		);
		expect(paso(pasos, "visita_residencia").evidencia).toContain(
			"1 sin encontrar al cliente",
		);
		expect(paso(pasos, "apagado_unidad").estado).toBe("hecho");
	});

	it("no pide lo que no depende de quien solicita: ni llamada del supervisor ni redes", () => {
		const claves = evaluarChecklist(evidencia()).map((p) => p.paso as string);
		expect(claves).not.toContain("llamada_supervisor");
		expect(claves).not.toContain("redes_sociales");
		expect(claves).toHaveLength(9);
	});

	it("convenio: como la promesa, basta con que se haya generado", () => {
		const hecho = evaluarChecklist(
			evidencia({
				convenios: { total: 1, ultima: HACE_DIAS(9), sinDatos: false },
			}),
		);
		expect(paso(hecho, "convenio_pago")).toMatchObject({ estado: "hecho" });
		expect(paso(hecho, "convenio_pago").evidencia).toContain(
			"1 convenio generado",
		);
		const sinCartera = evaluarChecklist(
			evidencia({ convenios: { total: 0, ultima: null, sinDatos: true } }),
		);
		expect(paso(sinCartera, "convenio_pago").estado).toBe("pendiente");
		expect(paso(sinCartera, "convenio_pago").evidencia).toContain(
			"No se pudo consultar cartera",
		);
	});

	it("referencias: parcial si faltan, hecho si se gestionaron todas", () => {
		const parcial = evaluarChecklist(
			evidencia({
				referencias: { total: 4, gestionadas: 2, ultima: HACE_DIAS(3) },
			}),
		);
		expect(paso(parcial, "referencias")).toMatchObject({ estado: "parcial" });
		expect(paso(parcial, "referencias").evidencia).toContain("2 de 4");
		const todas = evaluarChecklist(
			evidencia({
				referencias: { total: 3, gestionadas: 3, ultima: HACE_DIAS(3) },
			}),
		);
		expect(paso(todas, "referencias").estado).toBe("hecho");
	});

	it("sugiere la justificación cuando falta el dato para hacerlo", () => {
		const pasos = evaluarChecklist(
			evidencia({
				tieneDatosLaborales: false,
				gps: { vinculado: false, consultas: 0, ultima: null },
			}),
		);
		expect(paso(pasos, "visita_trabajo").sugerencia).toBe(
			"sin_datos_laborales",
		);
		expect(paso(pasos, "referencias").sugerencia).toBe("sin_referencias");
		expect(paso(pasos, "ubicacion_gps").sugerencia).toBe("sin_gps");
		expect(paso(pasos, "apagado_unidad").sugerencia).toBe("sin_gps");
	});

	it("un apagado pedido pero sin ejecutar (o rechazado) queda a medias", () => {
		for (const estado of [
			"pendiente_aprobacion",
			"aprobada",
			"rechazada",
		] as const) {
			const pasos = evaluarChecklist(
				evidencia({ apagado: { estado, fecha: HACE_DIAS(1) } }),
			);
			expect(paso(pasos, "apagado_unidad").estado).toBe("parcial");
			expect(paso(pasos, "apagado_unidad").sugerencia).toBe(
				estado === "rechazada" ? "apagado_rechazado" : "apagado_pendiente",
			);
		}
	});

	it("cada paso pregunta por qué no se hizo", () => {
		for (const def of PASOS_CHECKLIST_RECUPERACION) {
			expect(def.pregunta).toMatch(/^¿Por qué no .+\?$/);
		}
	});
});

describe("combinarChecklist", () => {
	const evaluados = () =>
		evaluarChecklist(
			evidencia({
				llamadas: { total: 3, contestadas: 0, ultima: HACE_DIAS(1) },
			}),
		);
	// Un catálogo de prueba: cada paso con su "otro" y una razón propia.
	const catalogo: CatalogoJustificaciones = Object.fromEntries(
		PASOS_CHECKLIST_RECUPERACION.map((d) => [
			d.clave,
			[
				{ clave: `propia_${d.clave}`, etiqueta: `Razón de ${d.titulo}` },
				{ clave: "otro", etiqueta: "Otro motivo" },
			],
		]),
	);
	const justificarTodo = (pasos: PasoEvaluado[]): RespuestaPaso[] =>
		pasos
			.filter((p) => p.estado !== "hecho")
			.map((p) => ({ paso: p.paso, justificacion: "otro" }));

	it("pide justificar cada paso que no está hecho", () => {
		const r = combinarChecklist(evaluados(), [], catalogo);
		expect("error" in r && r.error).toContain("Seleccione la justificación");
	});

	it("con todo justificado devuelve el checklist con la etiqueta elegida", () => {
		const pasos = evaluados();
		const r = combinarChecklist(pasos, justificarTodo(pasos), catalogo);
		if ("error" in r) throw new Error(r.error);
		expect(r.checklist).toHaveLength(PASOS_CHECKLIST_RECUPERACION.length);
		const llamadas = r.checklist.find((p) => p.paso === "llamadas_cliente");
		expect(llamadas).toMatchObject({
			estado: "hecho",
			justificacion: null,
			justificacionEtiqueta: null,
		});
		const mensajes = r.checklist.find((p) => p.paso === "mensajes");
		expect(mensajes).toMatchObject({
			justificacion: "otro",
			justificacionEtiqueta: "Otro motivo",
		});
		expect(resumenChecklist(r.checklist).texto).toBe("1 de 9 pasos hechos");
	});

	it("la nota es siempre opcional, también con «Otro motivo»", () => {
		const pasos = evaluados();
		const r = combinarChecklist(pasos, justificarTodo(pasos), catalogo);
		expect("checklist" in r).toBe(true);
	});

	it("cada paso solo acepta las razones de SU catálogo", () => {
		const pasos = evaluados();
		const respuestas = justificarTodo(pasos).map((r) =>
			r.paso === "mensajes"
				? { ...r, justificacion: "propia_promesa_pago" }
				: r,
		);
		const r = combinarChecklist(pasos, respuestas, catalogo);
		expect("error" in r && r.error).toContain("ya no está disponible");
		const propia = justificarTodo(pasos).map((x) =>
			x.paso === "mensajes" ? { ...x, justificacion: "propia_mensajes" } : x,
		);
		expect("checklist" in combinarChecklist(pasos, propia, catalogo)).toBe(
			true,
		);
	});

	it("un paso sin razones activas no se puede justificar", () => {
		const pasos = evaluados();
		const r = combinarChecklist(pasos, justificarTodo(pasos), {
			...catalogo,
			mensajes: [],
		});
		expect("error" in r && r.error).toContain("no tiene justificaciones");
	});

	it("la evidencia sale del servidor: un paso sin registro no se da por hecho con una nota", () => {
		const pasos = evaluados();
		const respuestas: RespuestaPaso[] = [
			...justificarTodo(pasos).filter((r) => r.paso !== "visita_residencia"),
			{ paso: "visita_residencia", nota: "Fui ayer, no quedó" },
		];
		const r = combinarChecklist(pasos, respuestas, catalogo);
		expect("error" in r && r.error).toContain("Visita a la residencia");
	});
});

describe("leerChecklistGuardado", () => {
	it("tolera basura y pasos que ya no están en el catálogo", () => {
		expect(leerChecklistGuardado(null)).toBeNull();
		expect(leerChecklistGuardado({})).toBeNull();
		const leido = leerChecklistGuardado([
			null,
			{ paso: "llamada_supervisor", estado: "hecho", evidencia: "x" },
			{ paso: "mensajes", estado: "raro" },
			{ paso: "promesa_pago", justificacion: "nadie_contesta" },
			{
				paso: "convenio_pago",
				justificacion: "cliente_rechaza",
				justificacionEtiqueta: "El cliente rechazó la propuesta de convenio",
			},
		]);
		expect(leido).toHaveLength(4);
		// Las de antes de la 0074 no traen etiqueta: sale del catálogo viejo.
		expect(leido?.[2]?.justificacionEtiqueta).toBe(
			"Nadie contesta en ningún número",
		);
		expect(leido?.[3]?.justificacionEtiqueta).toBe(
			"El cliente rechazó la propuesta de convenio",
		);
		expect(leido?.[0]).toMatchObject({
			titulo: "llamada_supervisor",
			estado: "hecho",
		});
		expect(leido?.[1]).toMatchObject({
			estado: "pendiente",
			justificacion: null,
			titulo: "WhatsApp, SMS o correo",
		});
	});
});

describe("inicioEpisodioMora", () => {
	it("es la última salida de B0, sin contar atrasos anteriores ya resueltos", () => {
		const eventos = [
			{ fecha: "2026-03-01T00:00:00Z", bucket_nuevo: 1 },
			{ fecha: "2026-04-01T00:00:00Z", bucket_nuevo: 0 },
			{ fecha: "2026-07-15T00:00:00Z", bucket_nuevo: 1 },
			{ fecha: "2026-08-15T00:00:00Z", bucket_nuevo: 2 },
			{ fecha: "2026-09-15T00:00:00Z", bucket_nuevo: 3 },
		];
		expect(inicioEpisodioMora(eventos, AHORA).toISOString()).toBe(
			"2026-07-15T00:00:00.000Z",
		);
	});

	it("sin historial mira los últimos 180 días", () => {
		expect(inicioEpisodioMora([], AHORA).getTime()).toBe(
			HACE_DIAS(180).getTime(),
		);
	});
});

describe("avisos", () => {
	it("la solicitud dice quién, dónde y cómo viene el checklist", () => {
		const { titulo, descripcion } = textoAvisoSolicitudRecuperacion({
			cliente: "Juan Pérez",
			numeroSifco: "01010214112180",
			bucket: 3,
			solicitante: "Carlos Asesor",
			resumen: "6 de 11 pasos hechos",
		});
		expect(titulo).toBe("Solicitud de recuperación del vehículo");
		expect(descripcion).toContain("Juan Pérez (01010214112180) (B3)");
		expect(descripcion).toContain("Carlos Asesor");
		expect(descripcion).toContain("6 de 11 pasos hechos");
	});

	it("el rechazo lleva el motivo", () => {
		const { titulo, descripcion } = textoAvisoDecisionRecuperacion({
			decision: "rechazada",
			cliente: null,
			numeroSifco: "123",
			decidioPor: "Ana",
			motivo: "Falta visitar el trabajo",
		});
		expect(titulo).toBe("Recuperación rechazada");
		expect(descripcion).toContain("El crédito 123");
		expect(descripcion).toContain("Falta visitar el trabajo");
	});
});
