import type { CasoTracker } from "../../../crm/apps/server/src/routers/tracker";

export type Caso = CasoTracker;
export type EstadoCaso = CasoTracker["estado"];

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

/** Fecha en que el caso llegó a una etapa, o null si nunca la alcanzó. */
export function llegadaAPaso(caso: Caso, paso: number): string | null {
	return caso.historial.find((h) => h.paso === paso)?.fecha ?? null;
}

/** Ventana del mes en hora de Guatemala (UTC-6), igual que el servidor. */
export function ventanaDelMes(anio: number, mes: number) {
	return {
		inicio: Date.UTC(anio, mes - 1, 1, 6),
		fin: Date.UTC(anio, mes, 1, 6),
	};
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
