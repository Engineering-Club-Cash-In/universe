/**
 * Contrato de URL de «Solicitudes» (`/cobros/solicitudes`). Lo valida la ruta
 * y lo usan las redirecciones de las páginas viejas, la tarjeta de apagado de
 * la Ficha 360 y el Dashboard del supervisor.
 *
 *   ?tab=pendientes|historial                       (por defecto pendientes)
 *   ?tipo=todas|convenio|apagado|reactivacion|recuperacion|rebaja|juridico|
 *         documentos|por_ejecutar|contrapropuesta   (por defecto todas)
 *       En «Pendientes» es el chip; en «Historial», el filtro de tipo
 *       («por_ejecutar» no filtra el Historial y «contrapropuesta» solo
 *       existe en el Historial: en «Pendientes» se lee como «todas»).
 *   ?vista=todas|aprobadas|rechazadas|reasignaciones|bajas|reactivaciones
 *                                                   chips del Historial
 *       (los valores «traslados» y «ausencias», que agrupaban, se leen como
 *       «reasignaciones» y «bajas»)
 *   ?estado=aprobada|rechazada|cancelada|sin_efecto|realizada
 *                                                   estado en el Historial
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

/** `?tipo=`: el chip de la bandeja o, solo en el Historial, la contrapropuesta. */
export type TipoSolicitudesSearch = FiltroTipoSolicitud | "contrapropuesta";

const TIPOS_SEARCH: readonly TipoSolicitudesSearch[] = [
	...FILTROS_TIPO,
	"contrapropuesta",
];

export type SolicitudesSearch = {
	tab?: TabSolicitudes;
	tipo?: TipoSolicitudesSearch;
	vista?: VistaHistorial;
	estado?: EstadoFiltroHistorial;
};

/** Chips que agrupaban mientras la bitácora no separaba los eventos. */
const VISTA_ANTERIOR: Record<string, VistaHistorial> = {
	traslados: "reasignaciones",
	ausencias: "bajas",
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
	const tipo = de(TIPOS_SEARCH, search.tipo);
	const vista = de(
		VISTAS_HISTORIAL.map((v) => v.value),
		VISTA_ANTERIOR[String(search.vista)] ?? search.vista,
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
