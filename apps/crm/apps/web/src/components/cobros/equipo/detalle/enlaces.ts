import type { Destino } from "@/components/cobros/supervision/destino";

/**
 * Contrato de URL del Detalle del asesor (`/cobros/equipo/$asesorId`) y los
 * enlaces que salen de él. Funciones puras: las usan la ruta, el contenedor,
 * la presentación y el showcase.
 *
 *   ?tab=resumen|agenda|actividad|solicitudes   (por defecto `resumen`)
 *   ?fecha=YYYY-MM-DD                           (día de la pestaña Agenda)
 *
 * `$asesorId` es el `asesor_id` de cartera (número).
 */

export const TABS_DETALLE = [
	"resumen",
	"agenda",
	"actividad",
	"solicitudes",
] as const;
export type TabDetalle = (typeof TABS_DETALLE)[number];

export const ETIQUETA_TAB: Record<TabDetalle, string> = {
	resumen: "Resumen",
	agenda: "Agenda",
	actividad: "Actividad",
	solicitudes: "Solicitudes",
};

export type DetalleAsesorSearch = {
	tab?: TabDetalle;
	fecha?: string;
};

function esFechaISO(v: unknown): v is string {
	if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const [y, m, d] = v.split("-").map(Number);
	const f = new Date(Date.UTC(y, m - 1, d));
	return f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

export function leerSearchDetalle(
	search: Record<string, unknown>,
): DetalleAsesorSearch {
	const tab = (TABS_DETALLE as readonly string[]).includes(search.tab as string)
		? (search.tab as TabDetalle)
		: undefined;
	return {
		...(tab && tab !== "resumen" ? { tab } : {}),
		...(esFechaISO(search.fecha) ? { fecha: search.fecha } : {}),
	};
}

/** `$asesorId` válido (entero positivo) o `null`. */
export function asesorIdDeParam(param: string): number | null {
	const n = Number(param);
	return Number.isInteger(n) && n > 0 ? n : null;
}

const CARTERA = "/cobros/cartera";
const EQUIPO = "/cobros/equipo";

/**
 * Enlaces del encabezado. «Trasladar cartera» y «Marcar ausente» abren el
 * formulario de Mi equipo › Carga y asignación con el asesor ya elegido
 * (`?accion=…&asesor=<asesor_id>`, contrato de Mi equipo).
 */
export function enlacesAsesor(asesorId: number) {
	const asesor = String(asesorId);
	return {
		dashboard: { to: "/cobros" } satisfies Destino,
		equipo: { to: EQUIPO } satisfies Destino,
		trasladar: {
			to: EQUIPO,
			search: { tab: "asignacion", accion: "trasladar", asesor },
		} satisfies Destino,
		ausente: {
			to: EQUIPO,
			search: { tab: "asignacion", accion: "ausente", asesor },
		} satisfies Destino,
		/** «Ver sus casos» y «Ver cartera completa →». */
		casos: { to: CARTERA, search: { asesor } } satisfies Destino,
	};
}

/**
 * Casos críticos → Cartera general con el asesor y el filtro que corresponde
 * (contrato de `/cobros/cartera` y de `cartera-general/segmentos.ts`).
 */
export function enlacesCriticos(asesorId: number) {
	const asesor = String(asesorId);
	return {
		convenios: {
			to: CARTERA,
			search: { asesor, gestion: "convenio_pendiente" },
		} satisfies Destino,
		promesas: {
			to: CARTERA,
			search: { asesor, promesa: "vencida" },
		} satisfies Destino,
		sinGestion: {
			to: CARTERA,
			search: { asesor, gestion: "sin_gestion_48h" },
		} satisfies Destino,
	};
}
