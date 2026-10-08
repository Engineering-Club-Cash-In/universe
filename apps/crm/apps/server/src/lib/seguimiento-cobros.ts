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
 *                        Promesa por vencer / Cuota vence hoy / Gestionar (SLA) /
 *                        Confirmar pago
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
	/** B8: hora del próximo contacto ("HH:MM" o "HH:MM:SS", hora GT); null = sin hora. */
	horaProximoContacto?: string | null;
	comentarios: string | null;
	/** A quién se contactó; null/ausente = titular. */
	participanteTipo?: "titular" | "codeudor" | "referencia" | null;
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
	/**
	 * Próxima llamada agendada (hoy o futuro) de la última gestión que no es
	 * promesa. Con hora si el asesor la puso (B8); si no, medianoche GT del día.
	 */
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

/**
 * El día de `fecha` (GT) a la hora `hora` ("HH:MM[:SS]", hora GT). Sin hora
 * válida devuelve `fecha` tal cual (medianoche GT, como se guarda el día).
 */
export function conHoraGT(fecha: Date, hora: string | null | undefined): Date {
	const m = hora ? /^(\d{2}):(\d{2})/.exec(hora) : null;
	if (!m) return fecha;
	const horas = Number(m[1]);
	const minutos = Number(m[2]);
	if (horas > 23 || minutos > 59) return fecha;
	return new Date(
		gtDateStrToDate(toDateStrGT(fecha)).getTime() +
			(horas * 60 + minutos) * 60 * 1000,
	);
}

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
		// La racha es «al titular»: un contacto a un codeudor o a una referencia
		// ni la suma ni la corta.
		if (f.participanteTipo && f.participanteTipo !== "titular") continue;
		if (ESTADOS_LOGRADO.has(f.estadoContacto)) break;
		if (ESTADOS_SIN_CONTACTO.has(f.estadoContacto)) intentosSinContacto++;
	}

	const deHoy = manuales.filter((f) => toDateStrGT(f.fechaContacto) === hoyStr);
	const ultimaNoPromesa = manuales.find(
		(f) => f.estadoContacto !== "promesa_pago",
	);
	// "Hoy o futuro" se decide por el DÍA guardado; la hora solo afina la fecha
	// que se muestra ("Llamar · hoy 3:00 PM"). Una llamada de hoy a las 9:00
	// sigue pendiente a las 15:00.
	const proximaLlamadaEn =
		ultimaNoPromesa?.fechaProximoContacto &&
		ultimaNoPromesa.fechaProximoContacto.getTime() >= inicioHoy.getTime()
			? conHoraGT(
					ultimaNoPromesa.fechaProximoContacto,
					ultimaNoPromesa.horaProximoContacto,
				)
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
	/** Boleta del bot esperando revisión del asesor (B6, ver `pagoPorConfirmar`). */
	| "confirmar_pago";

export interface AccionPendiente {
	tipo: TipoAccionPendiente;
	/** Fecha de referencia (llamada agendada, promesa, límite SLA). */
	fecha: Date | null;
}

/**
 * La acción más urgente del caso, en el mismo orden de prioridad de la Cola
 * del día (SLA → promesa hoy → vence hoy → vencida → próxima), con la llamada
 * agendada para hoy después de la promesa de hoy. Un pago por confirmar va
 * justo después del SLA: el cliente ya pagó y su boleta espera al asesor.
 */
export function accionPendienteDe(
	seguimiento: SeguimientoCaso,
	extras: {
		slaHoy?: boolean;
		fechaLimiteSla?: Date | null;
		venceHoy?: boolean;
		/** B6: hay boleta del bot en revisión manual o por verificar. */
		pagoPorConfirmar?: boolean;
	} = {},
	ahora: Date = new Date(),
): AccionPendiente | null {
	const hoyStr = toDateStrGT(ahora);
	const esHoy = (d: Date | null) => !!d && toDateStrGT(d) === hoyStr;
	if (extras.slaHoy)
		return { tipo: "gestionar_sla", fecha: extras.fechaLimiteSla ?? null };
	if (extras.pagoPorConfirmar) return { tipo: "confirmar_pago", fecha: null };
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
 * Con `realizadoPor` solo se leen las gestiones de esos usuarios (seguimiento
 * «propio» del asesor, más el de quien cubre); sin él, las de todos. Con `sinTopeDeVentana` se lee
 * todo el historial: la racha de intentos sin contacto no tiene tope de días
 * (3 intentos hace 70, 35 y 1 días siguen siendo 3).
 */
export async function cargarSeguimientoPorCaso(
	casoIds: string[],
	ahora: Date = new Date(),
	opciones: { realizadoPor?: string[]; sinTopeDeVentana?: boolean } = {},
): Promise<Map<string, SeguimientoCaso>> {
	const { realizadoPor, sinTopeDeVentana = false } = opciones;
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
			horaProximoContacto: contactosCobros.horaProximoContacto,
			comentarios: contactosCobros.comentarios,
			participanteTipo: contactosCobros.participanteTipo,
		})
		.from(contactosCobros)
		.where(
			and(
				inArray(contactosCobros.casoCobroId, casoIds),
				realizadoPor
					? inArray(contactosCobros.realizadoPor, realizadoPor)
					: undefined,
				ne(contactosCobros.estadoContacto, "link_pago_generado"),
				sinTopeDeVentana
					? undefined
					: or(
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
