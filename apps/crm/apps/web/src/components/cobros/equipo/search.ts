/**
 * Contrato de URL de «Mi equipo» (`/cobros/equipo`). Lo valida la ruta y lo
 * usan las redirecciones de las páginas viejas, el Dashboard del supervisor y
 * el Detalle del asesor para abrir cada pestaña, vista o formulario.
 *
 *   ?tab=asesores|dia|asignacion                (por defecto asesores)
 *   ?grupo=todos|junior|senior|especial|atencion  chips de la pestaña Asesores
 *   ?vista=apertura|cierre|gestiones            pestaña Día (por defecto apertura)
 *   ?seccion=reasignaciones|traslados|coberturas
 *                                               historial de Carga y asignación
 *   ?accion=trasladar|ausente&asesor=<asesor_id de cartera>
 *                                               abre «Trasladar cartera» o
 *                                               «Marcar ausente» con el asesor elegido
 *
 * Los valores por defecto no se escriben en la URL.
 */

export const TABS_EQUIPO = ["asesores", "dia", "asignacion"] as const;
export type TabEquipo = (typeof TABS_EQUIPO)[number];

export const GRUPOS_EQUIPO = [
	"todos",
	"junior",
	"senior",
	"especial",
	"atencion",
] as const;
export type GrupoEquipo = (typeof GRUPOS_EQUIPO)[number];

export const VISTAS_DIA = ["apertura", "cierre", "gestiones"] as const;
export type VistaDia = (typeof VISTAS_DIA)[number];

export const SECCIONES_HISTORIAL = [
	"reasignaciones",
	"traslados",
	"coberturas",
] as const;
export type SeccionHistorial = (typeof SECCIONES_HISTORIAL)[number];

export const ACCIONES_EQUIPO = ["trasladar", "ausente"] as const;
export type AccionEquipo = (typeof ACCIONES_EQUIPO)[number];

export type EquipoSearch = {
	tab?: TabEquipo;
	grupo?: GrupoEquipo;
	vista?: VistaDia;
	seccion?: SeccionHistorial;
	accion?: AccionEquipo;
	asesor?: number;
};

function de<T extends string>(
	lista: readonly T[],
	valor: unknown,
): T | undefined {
	return lista.includes(valor as T) ? (valor as T) : undefined;
}

export function leerEquipoSearch(
	search: Record<string, unknown>,
): EquipoSearch {
	const asesor = Number(search.asesor);
	const tab = de(TABS_EQUIPO, search.tab);
	const grupo = de(GRUPOS_EQUIPO, search.grupo);
	const vista = de(VISTAS_DIA, search.vista);
	const seccion = de(SECCIONES_HISTORIAL, search.seccion);
	const accion = de(ACCIONES_EQUIPO, search.accion);
	return {
		...(tab && tab !== "asesores" ? { tab } : {}),
		...(grupo && grupo !== "todos" ? { grupo } : {}),
		...(vista && vista !== "apertura" ? { vista } : {}),
		...(seccion && seccion !== "reasignaciones" ? { seccion } : {}),
		...(accion ? { accion } : {}),
		...(Number.isInteger(asesor) && asesor > 0 ? { asesor } : {}),
	};
}
