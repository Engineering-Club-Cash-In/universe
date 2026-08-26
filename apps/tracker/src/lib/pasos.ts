import type { CasoTracker } from "../../../crm/apps/server/src/routers/tracker";

export type Caso = CasoTracker;
export type EstadoCaso = CasoTracker["estado"];
export type Ventana = { inicio: number; fin: number };

export const PASOS = [
	{ etiqueta: "Solicitud recibida", desde: 0, hasta: 20 },
	{ etiqueta: "Documentos y análisis", desde: 30, hasta: 40 },
	{ etiqueta: "Aprobado", desde: 50, hasta: 80 },
	{ etiqueta: "Firma de contratos", desde: 85, hasta: 90 },
	{ etiqueta: "Desembolsado", desde: 100, hasta: 100 },
] as const;


export function rangoDePaso(paso: number): string {
	const p = PASOS[paso - 1];
	if (!p) return "";
	return p.desde === p.hasta ? `${p.hasta}%` : `${p.desde}–${p.hasta}%`;
}

/** Ventana del mes en hora de Guatemala (UTC-6), igual que el servidor. */
export function ventanaDelMes(anio: number, mes: number): Ventana {
	return {
		inicio: Date.UTC(anio, mes - 1, 1, 6),
		fin: Date.UTC(anio, mes, 1, 6),
	};
}


export function anioEnGuatemala(fecha: Date | string): number {
	const t = typeof fecha === "string" ? new Date(fecha).getTime() : fecha.getTime();
	return new Date(t - 6 * 60 * 60 * 1000).getUTCFullYear();
}

function dentroDeVentana(fecha: string, ventana: Ventana) {
	const t = new Date(fecha).getTime();
	return t >= ventana.inicio && t < ventana.fin;
}

/**
 * Entradas del historial de una etapa, de la más antigua a la más reciente.
 *
 * El servidor las ordena por porcentaje, no por fecha, así que un caso que
 * retrocedió dentro de la etapa trae primero la entrada más nueva. Reordenar
 * por fecha es lo que hace que "primera llegada" signifique eso de verdad.
 */
function entradasDePaso(caso: Caso, paso: number) {
	return caso.historial
		.filter((h) => h.paso === paso)
		.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export type Coincidencia = { porcentaje: number; fecha: string };

/**
 * Cómo cuenta un caso en una etapa. Vacío si no cuenta.
 *
 * Sin período: cuenta solo en la etapa donde está hoy, con su avance actual.
 * Con período: devuelve **todas** las llegadas de esa etapa dentro del mes. Un
 * caso puede alcanzar dos porcentajes de la misma etapa en un mismo mes —30% y
 * luego 40%—, y ambos son avances reales que el filtro por porcentaje exacto
 * debe poder encontrar.
 */
export function coincidenciasEnPaso(
	caso: Caso,
	paso: number,
	ventana: Ventana | null,
): Coincidencia[] {
	if (!ventana) {
		if (caso.pasoActual !== paso) return [];
		return [
			{
				porcentaje: caso.porcentaje,
				fecha: entradasDePaso(caso, paso)[0]?.fecha ?? caso.actualizadoAt,
			},
		];
	}

	return entradasDePaso(caso, paso)
		.filter((h) => dentroDeVentana(h.fecha, ventana))
		.map((h) => ({ porcentaje: h.porcentaje, fecha: h.fecha }));
}

/** La llegada que representa al caso: la del porcentaje filtrado, o la primera. */
export function coincidenciaPrincipal(
	coincidencias: Coincidencia[],
	porcentaje: number | null,
): Coincidencia | null {
	if (coincidencias.length === 0) return null;
	if (porcentaje === null) return coincidencias[0];
	return coincidencias.find((c) => c.porcentaje === porcentaje) ?? coincidencias[0];
}

/**
 * La llegada dentro del período, sin importar la etapa.
 *
 * Sin filtro de etapa, un caso entra al listado por `tuvoAvanceEn`, que mira
 * todo su historial. La tarjeta debe mostrar esa llegada y no la de su etapa
 * actual, que puede ser de otro mes.
 */
export function llegadaEnVentana(
	caso: Caso,
	ventana: Ventana,
): Coincidencia | null {
	const entrada = [...caso.historial]
		.sort((a, b) => a.fecha.localeCompare(b.fecha))
		.find((h) => dentroDeVentana(h.fecha, ventana));
	return entrada
		? { porcentaje: entrada.porcentaje, fecha: entrada.fecha }
		: null;
}

/** ¿El caso registró algún avance dentro del período? */
export function tuvoAvanceEn(caso: Caso, ventana: Ventana): boolean {
	return caso.historial.some((h) => dentroDeVentana(h.fecha, ventana));
}

export const ESTADOS: Record<
	EstadoCaso,
	{ etiqueta: string; clase: string; punto: string }
> = {
	en_proceso: {
		etiqueta: "En proceso",
		clase: "bg-blue-50 text-blue-700 ring-blue-600/20",
		punto: "bg-blue-500",
	},
	en_pausa: {
		etiqueta: "En pausa",
		clase: "bg-amber-50 text-amber-700 ring-amber-600/20",
		punto: "bg-amber-500",
	},
	rechazado: {
		etiqueta: "No aprobado",
		clase: "bg-rose-50 text-rose-700 ring-rose-600/20",
		punto: "bg-rose-500",
	},
	desembolsado: {
		etiqueta: "Desembolsado",
		clase: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
		punto: "bg-emerald-500",
	},
};

export function etiquetaDeEtapa(paso: number, estado: EstadoCaso): string {
	if (paso === 5 && estado !== "desembolsado") {
		
		return estado === "en_proceso"
			? "En trámite de desembolso"
			: ESTADOS[estado].etiqueta;
	}
	return PASOS[paso - 1].etiqueta;
}

export function formatearMonto(monto: number | null): string {
	if (monto === null) return "Sin monto";
	return new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
		maximumFractionDigits: 0,
	}).format(monto);
}

export function formatearFecha(iso: string): string {
	return new Intl.DateTimeFormat("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		timeZone: "America/Guatemala",
	}).format(new Date(iso));
}
