import type { CasoTracker } from "../../../crm/apps/server/src/routers/tracker";

export type Caso = CasoTracker;
export type EstadoCaso = CasoTracker["estado"];
export type Ventana = { inicio: number; fin: number };

export const PASOS = [
	{ etiqueta: "0–20%", desde: 0, hasta: 20 },
	{ etiqueta: "30–40%", desde: 30, hasta: 40 },
	{ etiqueta: "50–80%", desde: 50, hasta: 80 },
	{ etiqueta: "85–90%", desde: 85, hasta: 90 },
	{ etiqueta: "100%", desde: 100, hasta: 100 },
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

/** Mes 1-indexado (enero = 1) en hora de Guatemala (UTC-6), igual que anioEnGuatemala. */
export function mesEnGuatemala(fecha: Date | string): number {
	const t = typeof fecha === "string" ? new Date(fecha).getTime() : fecha.getTime();
	return new Date(t - 6 * 60 * 60 * 1000).getUTCMonth() + 1;
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
 * La llegada al estado ACTUAL del caso (su `porcentaje` de hoy), si ocurrió
 * dentro de la ventana. Es la única fuente de "cuándo" que se usa en toda
 * esta vista: no importa por cuántas etapas o porcentajes pasó el caso ese
 * mes, solo si el que tiene hoy lo alcanzó en ese período.
 */
function llegoAEsteEstadoEn(caso: Caso, ventana: Ventana): Coincidencia | null {
	const entrada = caso.historial.find((h) => h.porcentaje === caso.porcentaje);
	if (!entrada || !dentroDeVentana(entrada.fecha, ventana)) return null;
	return { porcentaje: entrada.porcentaje, fecha: entrada.fecha };
}

/**
 * Cómo cuenta un caso en una etapa. Vacío si no cuenta.
 *
 * Un caso solo cuenta en su etapa actual — nunca en una que ya dejó atrás,
 * aunque haya pasado por ella este mismo mes. Sin período, con su avance
 * actual. Con período, solo si llegó a ese avance dentro del mes.
 */
export function coincidenciasEnPaso(
	caso: Caso,
	paso: number,
	ventana: Ventana | null,
): Coincidencia[] {
	if (caso.pasoActual !== paso) return [];

	if (!ventana) {
		return [
			{
				porcentaje: caso.porcentaje,
				fecha: entradasDePaso(caso, paso)[0]?.fecha ?? caso.actualizadoAt,
			},
		];
	}

	const llegada = llegoAEsteEstadoEn(caso, ventana);
	return llegada ? [llegada] : [];
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
 * La llegada del caso al período, sin filtro de etapa: cuándo llegó a su
 * estado actual, si fue dentro de ese mes.
 */
export function llegadaEnVentana(
	caso: Caso,
	ventana: Ventana,
): Coincidencia | null {
	return llegoAEsteEstadoEn(caso, ventana);
}

/** ¿El caso llegó a su estado actual dentro del período? */
export function tuvoAvanceEn(caso: Caso, ventana: Ventana): boolean {
	return llegoAEsteEstadoEn(caso, ventana) !== null;
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
	aprobado: {
		etiqueta: "Aprobado",
		clase: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
		punto: "bg-indigo-500",
	},
	desembolsado: {
		etiqueta: "Finalizada",
		clase: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
		punto: "bg-emerald-500",
	},
};

export function etiquetaDeEtapa(paso: number, estado: EstadoCaso): string {
	if (estado === "rechazado") return "No aprobado";
	if (paso === 5 && estado === "desembolsado") return "Finalizada";
	if (paso === 5 && estado === "aprobado") return "Aprobado";
	return rangoDePaso(paso);
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
