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

// ── CB-121: bitácora técnica, salud y alertas ─────────────────────────────────

/** "42%" o "—" si no hay muestras suficientes (tasa null). */
export function formatPorcentaje(valor: number | null): string {
	if (valor == null || !Number.isFinite(valor)) return "—";
	return `${Math.round(valor * 100)}%`;
}

export type ResultadoIntento = "ok" | "error" | "reintentado" | "incierto";

export const RESULTADO_INTENTO_CONFIG: Record<
	ResultadoIntento,
	{ label: string; badgeClass: string }
> = {
	ok: {
		label: "OK",
		badgeClass:
			"bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
	},
	reintentado: {
		label: "Reintentado",
		badgeClass:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
	},
	error: {
		label: "Error",
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
	},
	incierto: {
		label: "Incierto",
		badgeClass:
			"bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
	},
};

export type SeveridadFalla = "info" | "warning" | "critical";

export const SEVERIDAD_CONFIG: Record<
	SeveridadFalla,
	{ label: string; badgeClass: string }
> = {
	info: {
		label: "Info",
		badgeClass:
			"bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
	},
	warning: {
		label: "Advertencia",
		badgeClass:
			"bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
	},
	critical: {
		label: "Crítica",
		badgeClass: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
	},
};

export type TipoAlertaGps =
	| "error_critico"
	| "tasa_error"
	| "fallos_consecutivos"
	| "latencia_sla";

export const TIPO_ALERTA_LABEL: Record<TipoAlertaGps, string> = {
	error_critico: "Error crítico",
	tasa_error: "Tasa de error alta",
	fallos_consecutivos: "Fallos consecutivos",
	latencia_sla: "Latencia fuera de SLA",
};

/** "5.2 s" para valores grandes, "480 ms" para chicos; "—" si no hay dato. */
export function formatDuracion(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms)) return "—";
	if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
	return `${ms} ms`;
}
