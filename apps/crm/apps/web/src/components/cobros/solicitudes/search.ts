/**
 * Contrato de URL de «Solicitudes» (`/cobros/solicitudes`). Lo valida la ruta
 * y lo usan las redirecciones de las páginas viejas, la tarjeta de apagado de
 * la Ficha 360 y el Dashboard del supervisor.
 *
 *   ?tab=pendientes|historial                       (por defecto pendientes)
 *   ?tipo=todas|convenio|apagado|reactivacion|recuperacion|por_ejecutar|
 *         rebaja|documentos                         (por defecto todas)
 *       En «Pendientes» es el chip; en «Historial», el filtro de tipo.
 *   ?vista=todas|aprobadas|rechazadas|reasignaciones|bajas|reactivaciones
 *                                                   chips del Historial
 *   ?estado=pendiente|aprobada|por_ejecutar|ejecutada|rechazada|cancelada|
 *           sin_efecto|realizada                    estado en el Historial
 *
 * Rutas viejas: /cobros/inmovilizaciones → ?tipo=apagado y
 * /cobros/recuperaciones → ?tipo=recuperacion. Los valores por defecto no se
 * escriben en la URL.
 */
import { FILTROS_TIPO, type FiltroTipoSolicitud } from "./bandeja-solicitudes";
import {
	ESTADOS_FILTRO_HISTORIAL,
	type EstadoFiltroHistorial,
	VISTAS_HISTORIAL,
	type VistaHistorial,
} from "./historial";

export const TABS_SOLICITUDES = ["pendientes", "historial"] as const;
export type TabSolicitudes = (typeof TABS_SOLICITUDES)[number];

export type SolicitudesSearch = {
	tab?: TabSolicitudes;
	tipo?: FiltroTipoSolicitud;
	vista?: VistaHistorial;
	estado?: EstadoFiltroHistorial;
};

function de<T extends string>(
	lista: readonly T[],
	valor: unknown,
): T | undefined {
	return lista.includes(valor as T) ? (valor as T) : undefined;
}

export function leerSolicitudesSearch(
	search: Record<string, unknown>,
): SolicitudesSearch {
	const tab = de(TABS_SOLICITUDES, search.tab);
	const tipo = de(FILTROS_TIPO, search.tipo);
	const vista = de(
		VISTAS_HISTORIAL.map((v) => v.value),
		search.vista,
	);
	const estado = de(
		ESTADOS_FILTRO_HISTORIAL.map((e) => e.value),
		search.estado,
	);
	return {
		...(tab && tab !== "pendientes" ? { tab } : {}),
		...(tipo && tipo !== "todas" ? { tipo } : {}),
		...(vista && vista !== "todas" ? { vista } : {}),
		...(estado && estado !== "todos" ? { estado } : {}),
	};
}
