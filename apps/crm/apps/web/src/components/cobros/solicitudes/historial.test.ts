import { describe, expect, test } from "bun:test";
import type { EntradaBitacora } from "server/src/lib/bitacora-supervision";
import {
	entradaDeBitacora,
	type FiltrosHistorial,
	fechaDeCorte,
	filtroServidorHistorial,
	recortarAlCorte,
} from "./historial";

const f = (fecha: string | null) => ({ fecha });

describe("fechaDeCorte", () => {
	test("sin fuentes incompletas no hay corte", () => {
		expect(fechaDeCorte([])).toBeNull();
	});

	test("una fuente incompleta sin filas cargadas no corta", () => {
		expect(fechaDeCorte([[]])).toBeNull();
		expect(fechaDeCorte([[f(null)]])).toBeNull();
	});

	test("es la más reciente de las fechas más viejas de cada fuente", () => {
		const corte = fechaDeCorte([
			// Trajo solo su última semana.
			[f("2026-10-12T10:00:00Z"), f("2026-10-06T10:00:00Z")],
			// Trajo meses.
			[f("2026-10-10T10:00:00Z"), f("2026-07-01T10:00:00Z")],
		]);
		expect(corte).toBe(new Date("2026-10-06T10:00:00Z").getTime());
	});

	test("ignora fechas inválidas", () => {
		expect(fechaDeCorte([[f("no es fecha"), f("2026-10-01T00:00:00Z")]])).toBe(
			new Date("2026-10-01T00:00:00Z").getTime(),
		);
	});
});

describe("recortarAlCorte", () => {
	const filas = [
		f("2026-10-12T10:00:00Z"),
		f("2026-10-06T10:00:00Z"),
		f("2026-09-01T10:00:00Z"),
		f(null),
	];

	test("sin corte deja todo", () => {
		expect(recortarAlCorte(filas, null)).toEqual(filas);
	});

	test("deja lo del corte en adelante (inclusive) y quita lo sin fecha", () => {
		const corte = new Date("2026-10-06T10:00:00Z").getTime();
		expect(recortarAlCorte(filas, corte)).toEqual([filas[0], filas[1]]);
	});

	test("conservar deja pasar filas viejas que se muestran siempre", () => {
		const corte = new Date("2026-10-06T10:00:00Z").getTime();
		expect(
			recortarAlCorte(
				filas,
				corte,
				(x) => x.fecha?.startsWith("2026-09") ?? false,
			),
		).toEqual([filas[0], filas[1], filas[2]]);
	});
});

const base: FiltrosHistorial = {
	vista: "todas",
	tipo: "todas",
	estado: "todos",
	busqueda: "",
	asesorId: null,
	desde: null,
	hasta: null,
};

describe("filtroServidorHistorial", () => {
	test("sin filtros no manda tipos ni decisiones", () => {
		expect(filtroServidorHistorial(base)).toEqual({ vacio: false });
	});

	test("chip y tipo se combinan; fechas y asesor pasan al servidor", () => {
		expect(
			filtroServidorHistorial({
				...base,
				vista: "aprobadas",
				tipo: "rebaja",
				asesorId: "u1",
				desde: "2026-10-01",
				hasta: "2026-10-14",
			}),
		).toEqual({
			tipos: ["rebaja"],
			decisiones: ["aprobada"],
			solicitanteId: "u1",
			desde: "2026-10-01",
			hasta: "2026-10-14",
			vacio: false,
		});
	});

	test("los chips de asesores separan bajas de traslados y ausencias de reactivaciones", () => {
		expect(
			filtroServidorHistorial({ ...base, vista: "reasignaciones" }),
		).toEqual({
			tipos: ["reasignacion", "traslado"],
			eventos: ["traslado"],
			vacio: false,
		});
		expect(filtroServidorHistorial({ ...base, vista: "bajas" })).toEqual({
			tipos: ["traslado", "cobertura", "ausencia_indefinida"],
			eventos: ["baja", "ausencia"],
			vacio: false,
		});
		expect(
			filtroServidorHistorial({ ...base, vista: "reactivaciones" }),
		).toEqual({
			tipos: ["cobertura", "ausencia_indefinida"],
			eventos: ["reactivacion"],
			vacio: false,
		});
	});

	test("combinaciones imposibles no consultan", () => {
		expect(
			filtroServidorHistorial({
				...base,
				vista: "aprobadas",
				estado: "rechazada",
			}).vacio,
		).toBe(true);
		expect(
			filtroServidorHistorial({ ...base, vista: "bajas", tipo: "convenio" })
				.vacio,
		).toBe(true);
		// Con asesor solo entran solicitudes: las bajas no tienen solicitante.
		expect(
			filtroServidorHistorial({ ...base, vista: "bajas", asesorId: "u1" })
				.vacio,
		).toBe(true);
		// Las reactivaciones de asesor no tienen crédito: no se pueden buscar.
		expect(
			filtroServidorHistorial({
				...base,
				vista: "reactivaciones",
				busqueda: "Ana",
			}).vacio,
		).toBe(true);
	});

	test("«Realizada» son las acciones del supervisor", () => {
		expect(filtroServidorHistorial({ ...base, estado: "realizada" })).toEqual({
			tipos: ["reasignacion", "traslado", "cobertura", "ausencia_indefinida"],
			vacio: false,
		});
	});

	test("documentos y contrapropuestas son tipos de la bitácora", () => {
		expect(
			filtroServidorHistorial({
				...base,
				tipo: "documentos",
				vista: "rechazadas",
			}),
		).toEqual({
			tipos: ["documento"],
			decisiones: ["rechazada"],
			vacio: false,
		});
		expect(
			filtroServidorHistorial({ ...base, tipo: "contrapropuesta" }),
		).toEqual({ tipos: ["contrapropuesta"], vacio: false });
		// Una contrapropuesta no es una solicitud: no tiene decisión.
		expect(
			filtroServidorHistorial({
				...base,
				tipo: "contrapropuesta",
				vista: "aprobadas",
			}).vacio,
		).toBe(true);
	});

	test("la búsqueda va al servidor y deja fuera lo que no tiene crédito", () => {
		const r = filtroServidorHistorial({ ...base, busqueda: "  María López " });
		expect(r.busqueda).toBe("María López");
		expect(r.tipos).not.toContain("traslado");
		expect(r.tipos).not.toContain("cobertura");
		expect(r.tipos).toContain("convenio");
		expect(r.tipos).toContain("reasignacion");
		expect(r.vacio).toBe(false);
	});
});

const entrada = (x: Partial<EntradaBitacora>): EntradaBitacora => ({
	id: "rebaja-1",
	tipo: "rebaja",
	fecha: "2026-10-14T15:00:00.000Z",
	decision: "aprobada",
	estado: "aplicada",
	solicitante: { userId: "u1", nombre: "Ana Díaz" },
	decididoPor: { userId: "u2", nombre: "Daniel Rodríguez" },
	credito: { sifco: "0101", cliente: "Roberto Cárcamo" },
	resumen: null,
	motivo: "Pagó lo vencido",
	nota: null,
	refId: "1",
	...x,
});

describe("entradaDeBitacora", () => {
	test("rebaja aplicada y con error al aplicar", () => {
		const e = entradaDeBitacora(entrada({}));
		expect(e.estado).toBe("aplicada");
		expect(e.tipoEtiqueta).toBe("Aprobación · Rebaja de mora");
		expect(e.objeto).toEqual({
			titulo: "Crédito #0101",
			detalle: "Roberto Cárcamo",
		});
		expect(e.asesor).toBe("Ana Díaz");
		expect(e.origen).toEqual({
			tipo: "rebaja",
			refId: "1",
			estado: "aplicada",
			solicitanteId: "u1",
		});
		const error = entradaDeBitacora(
			entrada({ estado: "error_aplicacion", nota: "Cartera no respondió" }),
		);
		expect(error.estado).toBe("error_aplicacion");
		expect(error.motivo).toBe("Cartera no respondió");
	});

	test("Jurídico muestra el motivo con su etiqueta", () => {
		const e = entradaDeBitacora(
			entrada({
				tipo: "juridico",
				estado: "aprobada",
				motivo: "no_quiere_pagar",
			}),
		);
		expect(e.estado).toBe("aplicando");
		expect(e.motivo).toBe("No quiere pagar");
	});

	test("apagado aprobado queda por ejecutar y abre la sección de la ficha", () => {
		const e = entradaDeBitacora(
			entrada({ tipo: "apagado", estado: "aprobada" }),
		);
		expect(e.estado).toBe("por_ejecutar");
		expect(e.ficha).toEqual({ id: "0101", seccion: "inmovilizacion" });
	});

	test("traslado por renuncia es una baja y trae el asesor de origen", () => {
		const e = entradaDeBitacora(
			entrada({
				tipo: "traslado",
				evento: "baja",
				decision: null,
				estado: "realizada",
				solicitante: null,
				credito: null,
				resumen: "31 cuentas (redistribucion)",
				motivo: "Renuncia: último día",
				refId: "op-1",
				asesorAfectado: { asesorId: 7, userId: null, nombre: "Diego Morales" },
				cuentas: { movidas: 31 },
			}),
		);
		expect(e.categoria).toBe("baja");
		expect(e.objeto).toEqual({
			titulo: "Diego Morales",
			detalle: "31 créditos trasladados",
		});
		const sinNombre = entradaDeBitacora(
			entrada({
				tipo: "traslado",
				evento: "traslado",
				decision: null,
				estado: "realizada",
				credito: null,
				motivo: "Redistribución",
				refId: "op-2",
				asesorAfectado: { asesorId: 9, userId: null, nombre: null },
			}),
		);
		expect(sinNombre.categoria).toBe("traslado");
		expect(sinNombre.objeto.titulo).toBe("Asesor #9");
	});

	test("rebaja con montos y Jurídico con nota y bucket en el detalle", () => {
		const rebaja = entradaDeBitacora(
			entrada({
				montos: { solicitado: "500", moraAlPedir: "800", aplicado: "500" },
			}),
		);
		const filas = rebaja.detalle.tipo === "filas" ? rebaja.detalle.filas : [];
		expect(filas.map((f) => f.etiqueta)).toEqual(
			expect.arrayContaining([
				"Monto pedido",
				"Mora al pedir",
				"Monto aplicado",
			]),
		);
		const jur = entradaDeBitacora(
			entrada({
				tipo: "juridico",
				estado: "aplicada",
				motivo: "no_contacto",
				bucket: 4,
				notaJuridico: "No contesta desde agosto.",
			}),
		);
		const filasJur = jur.detalle.tipo === "filas" ? jur.detalle.filas : [];
		expect(filasJur).toEqual(
			expect.arrayContaining([
				{ etiqueta: "Bucket al pedir", valor: "B4" },
				{ etiqueta: "Nota para Jurídico", valor: "No contesta desde agosto." },
			]),
		);
	});

	test("documento: aprobación con el documento en el motivo", () => {
		const e = entradaDeBitacora(
			entrada({
				tipo: "documento",
				estado: "aprobada",
				documento: "Contrato de crédito",
				motivo: "Lo pide el cliente",
				nota: "Enviado por correo",
			}),
		);
		expect(e.tipoSolicitud).toBe("documentos");
		expect(e.tipoEtiqueta).toBe("Aprobación · Documentos");
		expect(e.estado).toBe("aprobada");
		expect(e.motivo).toBe("Contrato de crédito · Enviado por correo");
	});

	test("contrapropuesta: retirada y aceptada", () => {
		const plan = {
			montoTotal: "12900",
			original: { numeroMeses: 6, cuotaMensual: "2150", primerPago: null },
			propuesto: {
				numeroMeses: 8,
				cuotaMensual: "1612.5",
				primerPago: "2026-11-05",
			},
			propuestaPor: { userId: "s1", nombre: "Daniel Rodríguez" },
			nota: "Ocho cuotas",
		};
		const retirada = entradaDeBitacora(
			entrada({
				tipo: "contrapropuesta",
				decision: null,
				estado: "retirada",
				solicitante: null,
				plan,
			}),
		);
		expect(retirada.categoria).toBe("contrapropuesta");
		expect(retirada.estado).toBe("retirada");
		expect(retirada.asesor).toBeNull();
		const aceptada = entradaDeBitacora(
			entrada({
				tipo: "contrapropuesta",
				decision: null,
				estado: "aceptada",
				solicitante: null,
				decididoPor: { userId: "u1", nombre: "Ana Díaz" },
				plan,
			}),
		);
		expect(aceptada.estado).toBe("aceptada");
		expect(aceptada.asesor).toBe("Ana Díaz");
	});

	test("ausencia indefinida y su reactivación", () => {
		const comun = {
			tipo: "ausencia_indefinida" as const,
			decision: null,
			solicitante: null,
			credito: null,
			motivo: "incidente",
			refId: "a1",
			asesorAfectado: { asesorId: 3, userId: "u3", nombre: "Caren López" },
			periodo: { desde: "2026-10-01", hasta: null },
		};
		const ausencia = entradaDeBitacora(
			entrada({
				...comun,
				evento: "ausencia",
				estado: "vigente",
				cuentas: { movidas: 54 },
			}),
		);
		expect(ausencia.categoria).toBe("ausencia");
		expect(ausencia.tipoEtiqueta).toBe("Ausencia indefinida");
		expect(ausencia.objeto).toEqual({
			titulo: "Caren López",
			detalle: "54 créditos repartidos al equipo",
		});
		const vuelta = entradaDeBitacora(
			entrada({
				...comun,
				evento: "reactivacion",
				estado: "reactivada",
				cuentas: { movidas: 54, devueltas: 53, retenidas: 1 },
			}),
		);
		expect(vuelta.categoria).toBe("reactivacion_asesor");
		expect(vuelta.objeto.detalle).toBe(
			"53 devueltos · 1 se quedó con otro asesor",
		);
	});

	test("cobertura: ausencia y reactivación del asesor", () => {
		const comun = {
			tipo: "cobertura" as const,
			decision: null,
			estado: "realizada",
			solicitante: null,
			credito: null,
			motivo: "vacaciones",
			refId: "c1",
		};
		const ausencia = entradaDeBitacora(
			entrada({
				...comun,
				evento: "ausencia",
				resumen: "Laura Gómez → Ana Díaz · 2026-10-02 al 2026-10-12",
			}),
		);
		expect(ausencia.categoria).toBe("ausencia");
		expect(ausencia.objeto).toEqual({
			titulo: "Laura Gómez",
			detalle: "Lo cubre Ana Díaz",
		});
		const reactivacion = entradaDeBitacora(
			entrada({
				...comun,
				evento: "reactivacion",
				resumen: "Laura Gómez · 2026-10-02 al 2026-10-12",
				nota: "Terminó el período de la cobertura",
			}),
		);
		expect(reactivacion.categoria).toBe("reactivacion_asesor");
		expect(reactivacion.soloDia).toBe(true);
	});
});
