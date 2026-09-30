import { describe, expect, it } from "bun:test";
import {
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
		expect(paso(pasos, "visita_trabajo").sugerencia).toBe("sin_datos");
		expect(paso(pasos, "referencias").sugerencia).toBe("sin_datos");
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
	const justificarTodo = (pasos: PasoEvaluado[]): RespuestaPaso[] =>
		pasos
			.filter((p) => p.estado !== "hecho")
			.map((p) => ({ paso: p.paso, justificacion: "no_aplica" }));

	it("pide justificar cada paso que no está hecho", () => {
		const r = combinarChecklist(evaluados(), []);
		expect("error" in r && r.error).toContain("Justificá");
	});

	it("con todo justificado devuelve el checklist para guardar", () => {
		const pasos = evaluados();
		const r = combinarChecklist(pasos, justificarTodo(pasos));
		if ("error" in r) throw new Error(r.error);
		expect(r.checklist).toHaveLength(PASOS_CHECKLIST_RECUPERACION.length);
		const llamadas = r.checklist.find((p) => p.paso === "llamadas_cliente");
		expect(llamadas).toMatchObject({ estado: "hecho", justificacion: null });
		expect(resumenChecklist(r.checklist).texto).toBe("1 de 9 pasos hechos");
	});

	it("«Otro» y «se hizo fuera del CRM» necesitan nota", () => {
		const pasos = evaluados();
		const respuestas = justificarTodo(pasos).map((r) =>
			r.paso === "mensajes"
				? { ...r, justificacion: "hecho_fuera_del_crm" as const }
				: r,
		);
		const r = combinarChecklist(pasos, respuestas);
		expect("error" in r && r.error).toContain("nota");
		const conNota = respuestas.map((x) =>
			x.paso === "mensajes" ? { ...x, nota: "Le escribí desde mi celular" } : x,
		);
		expect("checklist" in combinarChecklist(pasos, conNota)).toBe(true);
	});

	it("la evidencia sale del servidor: un paso sin registro no se da por hecho con una nota", () => {
		const pasos = evaluados();
		const respuestas: RespuestaPaso[] = [
			...justificarTodo(pasos).filter((r) => r.paso !== "visita_residencia"),
			{ paso: "visita_residencia", nota: "Fui ayer, no quedó" },
		];
		const r = combinarChecklist(pasos, respuestas);
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
			{ paso: "mensajes", estado: "raro", justificacion: "inventada" },
		]);
		expect(leido).toHaveLength(2);
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
		expect(titulo).toBe("Solicitud de recuperación de vehículo");
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
