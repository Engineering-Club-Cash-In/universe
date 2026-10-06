/**
 * Seguimiento de un caso de cobro para las tablas del rediseño (Dashboard del
 * asesor y Mi Cartera, Figma «CRM Ventas» › Asesor Junior/Senior).
 *
 * Columnas de Figma que salen de acá:
 *  · Seguimiento      → "3 intentos sin contacto · Último intento: 11 ago" /
 *                       "Sin intento hoy"
 *  · Estado de gestión → Sin acuerdo / Promesa vigente / Promesa incumplida /
 *                        Convenio vigente
 *  · Acción pendiente  → Llamar / Promesa vence hoy / Promesa vencida /
 *                        Promesa por vencer / Cuota vence hoy / Gestionar (SLA)
 *
 * La parte pura (`resumirSeguimiento`, `estadoGestionDe`, `accionPendienteDe`)
 * se prueba sin DB; `cargarSeguimientoPorCaso` solo trae las filas en lote.
 *
 * Criterios (mismos que el resto de cobros):
 *  · Contacto LOGRADO: el cliente contestó — contactado, acuerdo_parcial,
 *    rechaza_pagar, promesa_pago o pago_registrado.
 *  · Intento SIN contacto: no_contesta, numero_equivocado o mensaje_enviado
 *    (igual que `esSinContacto` de historial-agendas).
 *  · Solo cuentan gestiones MANUALES: los envíos automáticos (premora, WhatsApp
 *    masivo, recordatorio de convenio) no son intentos del asesor.
 *  · `link_pago_generado` no es gestión (se excluye en la query).
 */

import { and, desc, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "../db";
import { contactosCobros } from "../db/schema/cobros";
import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";
import { origenDeComentario } from "./historial-agendas";

const ESTADOS_LOGRADO = new Set([
	"contactado",
	"acuerdo_parcial",
	"rechaza_pagar",
	"promesa_pago",
	"pago_registrado",
]);
const ESTADOS_SIN_CONTACTO = new Set([
	"no_contesta",
	"numero_equivocado",
	"mensaje_enviado",
]);

/** Ventana para contar intentos: más atrás no cambia la gestión de hoy. */
export const DIAS_VENTANA_SEGUIMIENTO = 60;
/** Una promesa incumplida más vieja que esto ya no define el estado de gestión. */
export const DIAS_PROMESA_INCUMPLIDA_RELEVANTE = 30;
/** "Promesa por vencer": vigente y vence dentro de estos días (sin contar hoy). */
export const DIAS_PROMESA_POR_VENCER = 3;

export interface FilaContactoSeguimiento {
	casoCobroId: string;
	fechaContacto: Date;
	estadoContacto: string;
	estadoPromesa: "pendiente" | "cumplida" | "incumplida" | null;
	fechaProximoContacto: Date | null;
	comentarios: string | null;
}

export type EstadoGestion =
	| "sin_acuerdo"
	| "promesa_vigente"
	| "promesa_incumplida"
	| "convenio_vigente";

export interface SeguimientoCaso {
	/** Último intento manual (logrado o no). */
	ultimoIntentoEn: Date | null;
	/** Intentos sin contacto seguidos desde el último contacto logrado. */
	intentosSinContacto: number;
	/** Hubo al menos un intento manual hoy (día GT). */
	intentadoHoy: boolean;
	/** Hubo contacto logrado hoy (día GT). */
	contactadoHoy: boolean;
	/** Próxima llamada agendada (día; hoy o futuro) de la última gestión que no es promesa. */
	proximaLlamadaEn: Date | null;
	/** Promesa vigente más próxima (pendiente, fecha ≥ hoy). */
	promesaVigenteEn: Date | null;
	/** La promesa más reciente fracasó (incumplida o pendiente ya vencida) hace ≤ 30 días. */
	promesaIncumplida: boolean;
	/** Fecha prometida de esa promesa incumplida. */
	promesaIncumplidaEn: Date | null;
}

const SEGUIMIENTO_VACIO: SeguimientoCaso = {
	ultimoIntentoEn: null,
	intentosSinContacto: 0,
	intentadoHoy: false,
	contactadoHoy: false,
	proximaLlamadaEn: null,
	promesaVigenteEn: null,
	promesaIncumplida: false,
	promesaIncumplidaEn: null,
};

const MS_DIA = 24 * 60 * 60 * 1000;

/** Resume las gestiones de UN caso. `filas` en cualquier orden. */
export function resumirSeguimiento(
	filas: FilaContactoSeguimiento[],
	ahora: Date = new Date(),
): SeguimientoCaso {
	if (filas.length === 0) return { ...SEGUIMIENTO_VACIO };
	const hoyStr = toDateStrGT(ahora);
	const inicioHoy = gtDateStrToDate(hoyStr);
	const manuales = filas
		.filter((f) => origenDeComentario(f.comentarios) === "manual")
		.sort((a, b) => b.fechaContacto.getTime() - a.fechaContacto.getTime());

	let intentosSinContacto = 0;
	for (const f of manuales) {
		if (ESTADOS_LOGRADO.has(f.estadoContacto)) break;
		if (ESTADOS_SIN_CONTACTO.has(f.estadoContacto)) intentosSinContacto++;
	}

	const deHoy = manuales.filter((f) => toDateStrGT(f.fechaContacto) === hoyStr);
	const ultimaNoPromesa = manuales.find(
		(f) => f.estadoContacto !== "promesa_pago",
	);
	const proximaLlamadaEn =
		ultimaNoPromesa?.fechaProximoContacto &&
		ultimaNoPromesa.fechaProximoContacto.getTime() >= inicioHoy.getTime()
			? ultimaNoPromesa.fechaProximoContacto
			: null;

	// Promesas: todas (también las registradas por envíos automáticos no
	// existen — una promesa siempre es manual, pero no se filtra por las dudas).
	const promesas = filas
		.filter(
			(f) => f.estadoContacto === "promesa_pago" && f.fechaProximoContacto,
		)
		.sort((a, b) => b.fechaContacto.getTime() - a.fechaContacto.getTime());
	const vigentes = promesas
		.filter(
			(p) =>
				(p.estadoPromesa === "pendiente" || p.estadoPromesa === null) &&
				(p.fechaProximoContacto as Date).getTime() >= inicioHoy.getTime(),
		)
		.map((p) => p.fechaProximoContacto as Date)
		.sort((a, b) => a.getTime() - b.getTime());
	const masReciente = promesas[0];
	const fracaso =
		masReciente &&
		(masReciente.estadoPromesa === "incumplida" ||
			((masReciente.estadoPromesa === "pendiente" ||
				masReciente.estadoPromesa === null) &&
				(masReciente.fechaProximoContacto as Date).getTime() <
					inicioHoy.getTime()));
	const promesaIncumplida =
		!!fracaso &&
		inicioHoy.getTime() -
			(masReciente.fechaProximoContacto as Date).getTime() <=
			DIAS_PROMESA_INCUMPLIDA_RELEVANTE * MS_DIA;

	return {
		ultimoIntentoEn: manuales[0]?.fechaContacto ?? null,
		intentosSinContacto,
		intentadoHoy: deHoy.length > 0,
		contactadoHoy: deHoy.some((f) => ESTADOS_LOGRADO.has(f.estadoContacto)),
		proximaLlamadaEn,
		promesaVigenteEn: vigentes[0] ?? null,
		promesaIncumplida,
		promesaIncumplidaEn: promesaIncumplida
			? (masReciente.fechaProximoContacto as Date)
			: null,
	};
}

/** Estado de gestión de Figma. El convenio lo dice cartera (EN_CONVENIO). */
export function estadoGestionDe(
	seguimiento: SeguimientoCaso,
	enConvenio: boolean,
): EstadoGestion {
	if (enConvenio) return "convenio_vigente";
	if (seguimiento.promesaVigenteEn) return "promesa_vigente";
	if (seguimiento.promesaIncumplida) return "promesa_incumplida";
	return "sin_acuerdo";
}

export type TipoAccionPendiente =
	| "gestionar_sla"
	| "promesa_hoy"
	| "llamar"
	| "cuota_vence_hoy"
	| "promesa_vencida"
	| "promesa_por_vencer"
	/** Depende de "pagos por confirmar" (pendiente de backend, ver docs). */
	| "confirmar_pago";

export interface AccionPendiente {
	tipo: TipoAccionPendiente;
	/** Fecha de referencia (llamada agendada, promesa, límite SLA). */
	fecha: Date | null;
}

/**
 * La acción más urgente del caso, en el mismo orden de prioridad de la Cola
 * del día (SLA → promesa hoy → vence hoy → vencida → próxima), con la llamada
 * agendada para hoy después de la promesa de hoy.
 */
export function accionPendienteDe(
	seguimiento: SeguimientoCaso,
	extras: {
		slaHoy?: boolean;
		fechaLimiteSla?: Date | null;
		venceHoy?: boolean;
	} = {},
	ahora: Date = new Date(),
): AccionPendiente | null {
	const hoyStr = toDateStrGT(ahora);
	const esHoy = (d: Date | null) => !!d && toDateStrGT(d) === hoyStr;
	if (extras.slaHoy)
		return { tipo: "gestionar_sla", fecha: extras.fechaLimiteSla ?? null };
	if (esHoy(seguimiento.promesaVigenteEn))
		return { tipo: "promesa_hoy", fecha: seguimiento.promesaVigenteEn };
	if (esHoy(seguimiento.proximaLlamadaEn))
		return { tipo: "llamar", fecha: seguimiento.proximaLlamadaEn };
	if (extras.venceHoy) return { tipo: "cuota_vence_hoy", fecha: null };
	if (seguimiento.promesaIncumplida)
		return {
			tipo: "promesa_vencida",
			fecha: seguimiento.promesaIncumplidaEn,
		};
	if (seguimiento.promesaVigenteEn) {
		const inicioHoy = gtDateStrToDate(hoyStr).getTime();
		const dias = Math.round(
			(gtDateStrToDate(toDateStrGT(seguimiento.promesaVigenteEn)).getTime() -
				inicioHoy) /
				MS_DIA,
		);
		if (dias <= DIAS_PROMESA_POR_VENCER)
			return {
				tipo: "promesa_por_vencer",
				fecha: seguimiento.promesaVigenteEn,
			};
	}
	if (seguimiento.proximaLlamadaEn)
		return { tipo: "llamar", fecha: seguimiento.proximaLlamadaEn };
	return null;
}

/**
 * Trae en lote las gestiones de los casos y devuelve el seguimiento de cada
 * uno. Dos cortes para no leer el historial completo: los últimos
 * DIAS_VENTANA_SEGUIMIENTO días, más las promesas abiertas de cualquier fecha.
 */
export async function cargarSeguimientoPorCaso(
	casoIds: string[],
	ahora: Date = new Date(),
): Promise<Map<string, SeguimientoCaso>> {
	const resultado = new Map<string, SeguimientoCaso>();
	if (casoIds.length === 0) return resultado;
	const desde = new Date(ahora.getTime() - DIAS_VENTANA_SEGUIMIENTO * MS_DIA);
	const filas = await db
		.select({
			casoCobroId: contactosCobros.casoCobroId,
			fechaContacto: contactosCobros.fechaContacto,
			estadoContacto: contactosCobros.estadoContacto,
			estadoPromesa: contactosCobros.estadoPromesa,
			fechaProximoContacto: contactosCobros.fechaProximoContacto,
			comentarios: contactosCobros.comentarios,
		})
		.from(contactosCobros)
		.where(
			and(
				inArray(contactosCobros.casoCobroId, casoIds),
				ne(contactosCobros.estadoContacto, "link_pago_generado"),
				or(
					gte(contactosCobros.fechaContacto, desde),
					and(
						inArray(contactosCobros.estadoContacto, ["promesa_pago"]),
						or(
							inArray(contactosCobros.estadoPromesa, [
								"pendiente",
								"incumplida",
							]),
							isNull(contactosCobros.estadoPromesa),
						),
					),
				),
			),
		)
		.orderBy(desc(contactosCobros.fechaContacto));
	const porCaso = new Map<string, FilaContactoSeguimiento[]>();
	for (const f of filas) {
		const lista = porCaso.get(f.casoCobroId) ?? [];
		lista.push(f);
		porCaso.set(f.casoCobroId, lista);
	}
	for (const casoId of casoIds) {
		resultado.set(casoId, resumirSeguimiento(porCaso.get(casoId) ?? [], ahora));
	}
	return resultado;
}

/** Para casos sin `casos_cobros` (nunca gestionados). */
export function seguimientoVacio(): SeguimientoCaso {
	return { ...SEGUIMIENTO_VACIO };
}
