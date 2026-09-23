import { TriangleAlert, Wifi, WifiOff } from "lucide-react";

/**
 * Helpers puros para la vista /admin/gps (panel de administración de la
 * integración GPS/Wialon). Prefijo `-` para quedar excluidos del route tree
 * de TanStack Router (ver src/routes/cobros/-mora-display.ts para el mismo patrón).
 */

export function formatLatency(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms)) return "—";
	return `${ms} ms`;
}

/** Fecha y hora cortas en es-GT ("22 sept 2026, 14:05"); "—" si no hay fecha. */
export function formatFechaHora(date: Date | null): string {
	if (!date || Number.isNaN(date.getTime())) return "—";
	return date.toLocaleString("es-GT", {
		day: "2-digit",
		month: "short",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export type EstadoConexion = "conectado" | "degradado" | "caido";

export const ESTADO_CONEXION_CONFIG: Record<
	EstadoConexion,
	{
		label: string;
		icon: typeof Wifi;
		cardClass: string;
		badgeClass: string;
		textClass: string;
	}
> = {
	conectado: {
		label: "Conectado",
		icon: Wifi,
		cardClass: "border-emerald-200 dark:border-emerald-900/50",
		badgeClass:
			"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
		textClass: "text-emerald-600 dark:text-emerald-400",
	},
	degradado: {
		label: "Degradado",
		icon: TriangleAlert,
		cardClass: "border-amber-200 dark:border-amber-900/50",
		badgeClass:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
		textClass: "text-amber-600 dark:text-amber-400",
	},
	caido: {
		label: "Caído",
		icon: WifiOff,
		cardClass: "border-red-200 dark:border-red-900/50",
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
		textClass: "text-red-600 dark:text-red-400",
	},
};

export interface DiagnosticoParaEstado {
	connected: boolean;
	latencyMs: number | null;
	unitCount: number | null;
}

/**
 * Deriva el estado visual de la conexión a partir del diagnóstico. "Degradado"
 * cubre casos donde Wialon responde pero algo no cuadra (latencia alta o flota
 * vacía) — útil para detectar problemas antes de que se conviertan en caída total.
 */
export function resolveEstado(d: DiagnosticoParaEstado): EstadoConexion {
	if (!d.connected) return "caido";
	if ((d.latencyMs != null && d.latencyMs > 5000) || d.unitCount === 0) {
		return "degradado";
	}
	return "conectado";
}
