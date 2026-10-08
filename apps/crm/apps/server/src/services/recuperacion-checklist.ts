/**
 * CB-043 · La evidencia del checklist de la solicitud de recuperación: qué
 * gestión tiene registrada el caso desde que el crédito entró en mora.
 *
 * Lo arma SIEMPRE el servidor —al mostrar el formulario y otra vez al guardar—
 * y no se le cree al cliente: lo que lee el supervisor tiene que ser lo que el
 * CRM encontró, no lo que el asesor dijo que encontró. Las reglas de qué cuenta
 * como hecho viven en lib/recuperacion-solicitud.ts.
 *
 * Sin autorización acá: el llamador ya exigió el acceso al caso.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
} from "../db/schema/cobros";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import { inmovilizacionesUnidad } from "../db/schema/inmovilizacion-unidad";
import { vehicles } from "../db/schema/vehicles";
import { visitasCobros } from "../db/schema/visitas-cobros";
import {
	solicitudLaboralTitular,
	trabajoEfectivo,
} from "../lib/direcciones-caso";
import {
	PREFIJO_PREMORA_AUTO,
	PREFIJO_WSP_MASIVO,
} from "../lib/gestion-temprana-b1";
import {
	type EvidenciaGestion,
	evaluarChecklist,
	inicioEpisodioMora,
	type PasoEvaluado,
} from "../lib/recuperacion-solicitud";
import { carteraBackClient } from "./cartera-back-client";
import {
	cargarReferencias,
	resolverContextoCaso,
} from "./referencias-cobros-datos";

/** Un envío que no prueba respuesta ni ausencia de respuesta. */
const ESTADOS_SIN_RESPUESTA = [
	"no_contesta",
	"numero_equivocado",
	"mensaje_enviado",
] as const;
const METODOS_MENSAJE = ["whatsapp", "sms", "email"] as const;

const masReciente = (a: Date | null, b: Date | null) =>
	!a ? b : !b ? a : a.getTime() >= b.getTime() ? a : b;

/**
 * Desde cuándo se mira la gestión: la salida de B0 más reciente, leída del
 * historial de buckets de cartera. Si cartera no responde se usan los últimos
 * 180 días: el checklist sigue sirviendo, solo mira un poco más atrás.
 */
async function inicioDelEpisodio(
	creditoId: number | null,
	ahora: Date,
): Promise<Date> {
	if (creditoId === null) return inicioEpisodioMora([], ahora);
	try {
		const eventos =
			await carteraBackClient.getBucketsHistorialCredito(creditoId);
		return inicioEpisodioMora(eventos, ahora);
	} catch (error) {
		console.error(
			`[recuperacion-checklist] No se pudo leer el historial de buckets del crédito ${creditoId}:`,
			error,
		);
		return inicioEpisodioMora([], ahora);
	}
}

async function leerContactos(casoCobroId: string, desde: Date) {
	const filas = await db
		.select({
			metodo: contactosCobros.metodoContacto,
			estado: contactosCobros.estadoContacto,
			estadoPromesa: contactosCobros.estadoPromesa,
			fecha: contactosCobros.fechaContacto,
			comentarios: contactosCobros.comentarios,
		})
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.casoCobroId, casoCobroId),
				gte(contactosCobros.fechaContacto, desde),
			),
		)
		.orderBy(desc(contactosCobros.fechaContacto));

	// Los envíos automáticos (premora, masivos) no son gestión de nadie: no
	// cuentan como "se le escribió al cliente".
	const humanos = filas.filter(
		(f) =>
			!f.comentarios.startsWith(PREFIJO_PREMORA_AUTO) &&
			!f.comentarios.startsWith(PREFIJO_WSP_MASIVO),
	);
	const llamadas = humanos.filter((f) => f.metodo === "llamada");
	const mensajes = humanos.filter((f) =>
		(METODOS_MENSAJE as readonly string[]).includes(f.metodo),
	);
	const promesas = humanos.filter(
		(f) => f.estado === "promesa_pago" || f.estado === "acuerdo_parcial",
	);
	// Ordenadas de la más nueva a la más vieja: la primera es la última.
	return {
		llamadas: {
			total: llamadas.length,
			contestadas: llamadas.filter(
				(f) => !(ESTADOS_SIN_RESPUESTA as readonly string[]).includes(f.estado),
			).length,
			ultima: llamadas[0]?.fecha ?? null,
		},
		mensajes: { total: mensajes.length, ultima: mensajes[0]?.fecha ?? null },
		promesas: {
			total: promesas.length,
			incumplidas: promesas.filter((f) => f.estadoPromesa === "incumplida")
				.length,
			ultima: promesas[0]?.fecha ?? null,
		},
	};
}

/**
 * Convenios generados para el crédito desde `desde`, con o sin aprobación:
 * como la promesa, lo que cuenta es que se le ofreció una salida. Cartera
 * devuelve los vigentes, completados, pendientes y deshechos; los RECHAZADOS
 * borran su fila y solo quedan en el historial de decisiones, así que se
 * suman de ahí. Si cartera no responde, `sinDatos`: el paso lo dice en vez de
 * afirmar que no hubo convenio.
 */
async function leerConvenios(
	creditoId: number | null,
	desde: Date,
): Promise<EvidenciaGestion["convenios"]> {
	if (creditoId === null) return { total: 0, ultima: null, sinDatos: true };
	try {
		const [convenios, decisiones] = await Promise.all([
			carteraBackClient.getConveniosPorCredito(creditoId, "all"),
			carteraBackClient.getDecisionesConvenio(creditoId),
		]);
		const fechas = new Map<number, Date>();
		for (const c of convenios) {
			const f = c.fecha_convenio ?? c.created_at;
			if (f) fechas.set(c.convenio_id, new Date(f));
		}
		for (const d of decisiones) {
			if (d.decision === "rechazado" && !fechas.has(d.convenioId)) {
				fechas.set(d.convenioId, new Date(d.decididoEn));
			}
		}
		const delEpisodio = [...fechas.values()].filter((f) => f >= desde);
		return {
			total: delEpisodio.length,
			ultima: delEpisodio.reduce<Date | null>(masReciente, null),
			sinDatos: false,
		};
	} catch (error) {
		console.error(
			`[recuperacion-checklist] No se pudieron leer los convenios del crédito ${creditoId}:`,
			error,
		);
		return { total: 0, ultima: null, sinDatos: true };
	}
}

async function leerReferencias(casoCobroId: string, desde: Date) {
	try {
		const ctx = await resolverContextoCaso(casoCobroId);
		const { referencias } = await cargarReferencias(ctx);
		let gestionadas = 0;
		let ultima: Date | null = null;
		for (const r of referencias) {
			const fecha = r.ultimoContacto?.fechaContacto
				? new Date(r.ultimoContacto.fechaContacto)
				: null;
			if (fecha && fecha >= desde) {
				gestionadas++;
				ultima = masReciente(ultima, fecha);
			}
		}
		return { total: referencias.length, gestionadas, ultima };
	} catch (error) {
		console.error(
			`[recuperacion-checklist] No se pudieron leer las referencias del caso ${casoCobroId}:`,
			error,
		);
		return { total: 0, gestionadas: 0, ultima: null };
	}
}

async function leerVisitas(casoCobroId: string, desde: Date) {
	const filas = await db
		.select({
			tipo: visitasCobros.tipo,
			fecha: visitasCobros.fechaVisita,
			resultado: visitasCobros.resultado,
		})
		.from(visitasCobros)
		.where(
			and(
				eq(visitasCobros.casoCobroId, casoCobroId),
				eq(visitasCobros.estado, "realizada"),
				gte(visitasCobros.fechaVisita, desde),
			),
		)
		.orderBy(desc(visitasCobros.fechaVisita));
	const resumen = (tipo: string) => {
		const deTipo = filas.filter((f) => f.tipo === tipo);
		return {
			total: deTipo.length,
			sinContacto: deTipo.filter((f) => f.resultado === "sin_contacto").length,
			ultima: deTipo[0]?.fecha ?? null,
		};
	};
	return {
		visitaResidencia: resumen("residencia"),
		visitaTrabajo: resumen("trabajo"),
	};
}

/**
 * ¿Hay dónde trabaja? La solicitud de crédito o lo corregido desde la ficha
 * (F8): lo que usa la visita al trabajo.
 */
async function tieneDatosLaborales(casoCobroId: string): Promise<boolean> {
	try {
		const [ctx, [corregido]] = await Promise.all([
			resolverContextoCaso(casoCobroId),
			db
				.select({
					empresa: casosCobros.empresaTrabajoCobros,
					direccion: casosCobros.direccionTrabajoCobros,
				})
				.from(casosCobros)
				.where(eq(casosCobros.id, casoCobroId))
				.limit(1),
		]);
		const trabajo = trabajoEfectivo(
			await solicitudLaboralTitular(ctx.opportunityId),
			corregido ?? { empresa: null, direccion: null },
		);
		return !!(trabajo?.empresa || trabajo?.direccion);
	} catch {
		return false;
	}
}

async function leerVehiculoYGps(casoCobroId: string, desde: Date) {
	const [caso] = await db
		.select({
			vehicleId: vehicles.id,
			wialonUnitId: vehicles.wialonUnitId,
		})
		.from(casosCobros)
		.leftJoin(
			contratosFinanciamiento,
			eq(casosCobros.contratoId, contratosFinanciamiento.id),
		)
		.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	const vehicleId = caso?.vehicleId ?? null;
	if (!vehicleId) {
		return { vinculado: false, consultas: 0, ultima: null };
	}
	const [consultas] = await db
		.select({
			total: sql<number>`count(*)::int`,
			ultima: sql<Date | null>`max(${gpsConsultaLogs.createdAt})`,
		})
		.from(gpsConsultaLogs)
		.where(
			and(
				eq(gpsConsultaLogs.vehicleId, vehicleId),
				gte(gpsConsultaLogs.createdAt, desde),
			),
		);
	return {
		vinculado: caso?.wialonUnitId != null,
		consultas: consultas?.total ?? 0,
		ultima: consultas?.ultima ? new Date(consultas.ultima) : null,
	};
}

async function leerApagado(
	casoCobroId: string,
	desde: Date,
): Promise<EvidenciaGestion["apagado"]> {
	const [ultima] = await db
		.select({
			estado: inmovilizacionesUnidad.estado,
			solicitadoAt: inmovilizacionesUnidad.solicitadoAt,
			ejecutadoAt: inmovilizacionesUnidad.ejecutadoAt,
		})
		.from(inmovilizacionesUnidad)
		.where(
			and(
				eq(inmovilizacionesUnidad.casoCobroId, casoCobroId),
				eq(inmovilizacionesUnidad.accion, "apagado"),
				gte(inmovilizacionesUnidad.solicitadoAt, desde),
				inArray(inmovilizacionesUnidad.estado, [
					"pendiente_aprobacion",
					"aprobada",
					"rechazada",
					"ejecutada",
				]),
			),
		)
		.orderBy(desc(inmovilizacionesUnidad.solicitadoAt))
		.limit(1);
	if (!ultima) return { estado: null, fecha: null };
	return {
		estado: ultima.estado ?? null,
		fecha: ultima.ejecutadoAt ?? ultima.solicitadoAt,
	};
}

export async function leerEvidenciaGestion(params: {
	casoCobroId: string;
	creditoId: number | null;
	ahora?: Date;
}): Promise<EvidenciaGestion> {
	const ahora = params.ahora ?? new Date();
	const desde = await inicioDelEpisodio(params.creditoId, ahora);
	const [contactos, convenios, referencias, visitas, laborales, gps, apagado] =
		await Promise.all([
			leerContactos(params.casoCobroId, desde),
			leerConvenios(params.creditoId, desde),
			leerReferencias(params.casoCobroId, desde),
			leerVisitas(params.casoCobroId, desde),
			tieneDatosLaborales(params.casoCobroId),
			leerVehiculoYGps(params.casoCobroId, desde),
			leerApagado(params.casoCobroId, desde),
		]);
	return {
		desde,
		...contactos,
		convenios,
		referencias,
		...visitas,
		tieneDatosLaborales: laborales,
		gps,
		apagado,
	};
}

/** El checklist evaluado del caso, listo para el formulario o para guardar. */
export async function checklistDelCaso(params: {
	casoCobroId: string;
	creditoId: number | null;
}): Promise<{ desde: Date; pasos: PasoEvaluado[] }> {
	const evidencia = await leerEvidenciaGestion(params);
	return { desde: evidencia.desde, pasos: evaluarChecklist(evidencia) };
}
