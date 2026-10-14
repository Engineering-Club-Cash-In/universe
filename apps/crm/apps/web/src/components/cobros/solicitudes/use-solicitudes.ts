/**
 * Consultas de /cobros/solicitudes (y de las solicitudes de un asesor). Las
 * llaves e inputs son los MISMOS que usan el Dashboard del supervisor y las
 * páginas anteriores, así que comparten caché: abrir la bandeja después del
 * Dashboard sale de memoria.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { MAX_FILAS_BITACORA } from "server/src/lib/bitacora-supervision";
import { orpc, orpcAparte } from "@/utils/orpc";
import type {
	DecisionConvenioFuente,
	ReasignacionFuente,
	TrasladoFuente,
} from "./historial";
import {
	type ConvenioFuente,
	type DocumentoFuente,
	type InmovilizacionFuente,
	type InmovilizacionHistorialFuente,
	ordenarPorAntiguedad,
	type RebajaFuente,
	type RecuperacionFuente,
	type Solicitud,
	solicitudDeDocumento,
	solicitudDeRebaja,
	solicitudesDeFuentes,
} from "./normalizar";

/** Convenios por aprobar que trae una consulta (mismo input que el Dashboard). */
export const CONVENIOS_POR_CONSULTA = 100;
/** Apagados y reactivaciones del historial por cada «Cargar más». */
export const INMOVILIZACIONES_POR_PAGINA = 50;

/**
 * La bandeja: convenios por aprobar, apagados y reactivaciones (pendientes y
 * por ejecutar) y recuperaciones del vehículo. Mismas opciones que las páginas
 * de antes: la cola de inmovilizaciones no se recarga al volver a la ventana
 * y la de recuperaciones sí.
 */
export function useSolicitudesPendientes(habilitado: boolean) {
	const convenios = useQuery({
		...orpc.getConveniosListado.queryOptions({
			input: { estado: "pending", page: 1, perPage: CONVENIOS_POR_CONSULTA },
		}),
		enabled: habilitado,
	});
	const recuperaciones = useQuery({
		...orpc.getSolicitudesRecuperacion.queryOptions(),
		enabled: habilitado,
		refetchOnWindowFocus: true,
	});
	const inmovilizaciones = useQuery({
		...orpc.getColaInmovilizaciones.queryOptions(),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});

	const rebajas = useQuery({
		...orpc.getSolicitudesRebajaMora.queryOptions({
			input: { estado: "pendiente" },
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const documentos = useQuery({
		...orpcAparte.getSolicitudesDocumentos.queryOptions({
			input: { estado: "pendiente" },
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const extras = useMemo(
		() =>
			ordenarPorAntiguedad([
				...((rebajas.data ?? []) as unknown as RebajaFuente[]).map(
					solicitudDeRebaja,
				),
				...((documentos.data ?? []) as unknown as DocumentoFuente[]).map(
					solicitudDeDocumento,
				),
			]),
		[rebajas.data, documentos.data],
	);

	const datos = useMemo(
		() =>
			solicitudesDeFuentes({
				convenios: (convenios.data?.items ?? []) as unknown as ConvenioFuente[],
				recuperaciones: (recuperaciones.data?.pendientes ??
					[]) as unknown as RecuperacionFuente[],
				inmovilizaciones: (inmovilizaciones.data ??
					[]) as unknown as InmovilizacionFuente[],
			}),
		[convenios.data, recuperaciones.data, inmovilizaciones.data],
	);

	const totalConvenios = convenios.data?.total ?? 0;
	const conveniosTraidos = convenios.data?.items?.length ?? 0;

	return {
		pendientes: datos.pendientes,
		porEjecutar: datos.porEjecutar,
		/** Rebajas de mora y documentos pendientes (filas sin Espacio de aprobación). */
		extras,
		/** Hay más convenios por aprobar de los que entraron en la consulta. */
		conveniosFuera:
			totalConvenios > conveniosTraidos ? totalConvenios - conveniosTraidos : 0,
		cargando:
			convenios.isLoading ||
			recuperaciones.isLoading ||
			inmovilizaciones.isLoading ||
			rebajas.isLoading ||
			documentos.isLoading,
		/** Fuentes que fallaron (las demás se muestran igual). */
		errores: [
			convenios.isError ? "convenios" : null,
			recuperaciones.isError ? "recuperaciones del vehículo" : null,
			inmovilizaciones.isError ? "apagados y reactivaciones" : null,
			rebajas.isError ? "rebajas de mora" : null,
			documentos.isError ? "solicitudes de documentos" : null,
		].filter((e): e is string => e !== null),
		actualizando:
			convenios.isFetching ||
			recuperaciones.isFetching ||
			inmovilizaciones.isFetching ||
			rebajas.isFetching ||
			documentos.isFetching,
		refetch: () => {
			void convenios.refetch();
			void recuperaciones.refetch();
			void inmovilizaciones.refetch();
			void rebajas.refetch();
			void documentos.refetch();
		},
		refetchConvenios: () => void convenios.refetch(),
		/** Historial de recuperaciones (viene en la misma consulta). */
		historialRecuperaciones: (recuperaciones.data?.historial ??
			[]) as unknown as RecuperacionFuente[],
		recuperacionesQuery: recuperaciones,
	};
}

/* ── Historiales paginados ─────────────────────────────────────────────────── */

/** Filas por página del historial de recuperaciones y de decisiones de convenio (M3). */
export const DECISIONES_POR_PAGINA = 50;
/** Reasignaciones manuales del historial por cada «Cargar más». */
export const REASIGNACIONES_POR_PAGINA = 100;
/** Traslados por página: cartera los devuelve de 20 en 20, sin total. */
export const TRASLADOS_POR_PAGINA = 20;
/** Convenios del asesor por cada «Cargar más» (máximo de `getConveniosListado`). */
export const CONVENIOS_ASESOR_POR_PAGINA = 100;
/** Páginas que la bitácora puede dar (`page × perPage` hasta su límite). */
const MAX_PAGINAS_BITACORA = Math.floor(
	MAX_FILAS_BITACORA / DECISIONES_POR_PAGINA,
);

/**
 * Páginas que vale la pena pedir: las que pidió «Cargar más», sin pasar de las
 * que tiene la fuente (según el total de la primera) ni del límite del
 * servidor. Una fuente que ya se agotó no vuelve a pedir páginas vacías.
 */
export function paginasAPedir(
	paginas: number,
	total: number | null | undefined,
	porPagina: number,
	max = Number.POSITIVE_INFINITY,
) {
	const existentes =
		total === null || total === undefined
			? 1
			: Math.max(1, Math.ceil(total / porPagina));
	return Math.max(1, Math.min(paginas, existentes, max));
}

type ConsultaPaginada = {
	data?: { items?: unknown[]; total?: number } | undefined;
	isLoading: boolean;
	isError: boolean;
	refetch: () => Promise<unknown>;
};

function combinarPaginas<T>(consultas: ConsultaPaginada[]) {
	return {
		items: consultas.flatMap((c) => (c.data?.items ?? []) as unknown as T[]),
		total: consultas[0]?.data?.total ?? null,
		cargando: consultas.some((c) => c.isLoading),
		error: consultas.some((c) => c.isError),
		refetch: () => {
			for (const c of consultas) void c.refetch();
		},
	};
}

// `combine` fuera del hook: estable, TanStack solo lo recalcula si cambian los datos.
const combinarInmovilizaciones = (c: ConsultaPaginada[]) =>
	combinarPaginas<InmovilizacionHistorialFuente>(c);
const combinarRecuperaciones = (c: ConsultaPaginada[]) =>
	combinarPaginas<RecuperacionFuente>(c);
const combinarDecisionesConvenio = (c: ConsultaPaginada[]) =>
	combinarPaginas<DecisionConvenioFuente>(c);
const combinarConvenios = (c: ConsultaPaginada[]) =>
	combinarPaginas<ConvenioFuente>(c);

/**
 * Hay más filas por traer: el servidor tiene más de las cargadas y todavía se
 * pueden pedir (no se llegó al límite de páginas).
 */
const quedanMas = (
	r: { total: number | null; items: unknown[] },
	pedidas: number,
	max = Number.POSITIVE_INFINITY,
) => r.total !== null && r.items.length < r.total && pedidas < max;

/**
 * Historial de apagados y reactivaciones, de todos los estados, en páginas de
 * `INMOVILIZACIONES_POR_PAGINA` (las más recientes primero). `paginas` crece
 * con «Cargar más»: así se llega a todo el historial, como en la página de
 * antes, aunque se mezcle con otras fuentes. Con `solicitanteId`, solo lo que
 * pidió ese usuario.
 */
export function useHistorialInmovilizaciones(
	paginas: number,
	habilitado: boolean,
	solicitanteId?: string | null,
) {
	const opciones = (page: number) => ({
		...orpc.getHistorialInmovilizaciones.queryOptions({
			input: {
				page,
				perPage: INMOVILIZACIONES_POR_PAGINA,
				...(solicitanteId ? { solicitanteId } : {}),
			},
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const primera = useQuery(opciones(1));
	const pedidas = paginasAPedir(
		paginas,
		primera.data?.total,
		INMOVILIZACIONES_POR_PAGINA,
	);
	const r = useQueries({
		queries: Array.from({ length: pedidas }, (_, i) => opciones(i + 1)),
		combine: combinarInmovilizaciones,
	});
	return { ...r, hayMas: quedanMas(r, pedidas) };
}

/**
 * Historial de recuperaciones decididas, paginado por el servidor (M3,
 * `getHistorialSolicitudesRecuperacion`): ya no tiene el tope de 100 de la
 * bandeja. `paginas` crece con «Cargar más».
 */
export function useHistorialRecuperaciones(
	paginas: number,
	habilitado: boolean,
	solicitanteId?: string | null,
) {
	const opciones = (page: number) => ({
		...orpc.getHistorialSolicitudesRecuperacion.queryOptions({
			input: {
				page,
				perPage: DECISIONES_POR_PAGINA,
				...(solicitanteId ? { solicitanteId } : {}),
			},
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const primera = useQuery(opciones(1));
	const pedidas = paginasAPedir(
		paginas,
		primera.data?.total,
		DECISIONES_POR_PAGINA,
	);
	const r = useQueries({
		queries: Array.from({ length: pedidas }, (_, i) => opciones(i + 1)),
		combine: combinarRecuperaciones,
	});
	return { ...r, hayMas: quedanMas(r, pedidas) };
}

/**
 * Decisiones de convenio (M3, `getHistorialDecisionesConvenio`), de todos los
 * créditos o filtradas por decisión y por quien armó el convenio. Cartera
 * borra el convenio al rechazarlo: esta es la única fuente de los rechazados.
 * La bitácora llega hasta `MAX_FILAS_BITACORA` entradas: más allá no se piden
 * páginas (el servidor las rechazaría).
 */
export function useHistorialDecisionesConvenio(
	paginas: number,
	habilitado: boolean,
	filtro?: { decision?: "aprobada" | "rechazada"; solicitanteId?: string },
) {
	const opciones = (page: number) => ({
		...orpcAparte.getHistorialDecisionesConvenio.queryOptions({
			input: {
				page,
				perPage: DECISIONES_POR_PAGINA,
				...(filtro?.decision ? { decision: filtro.decision } : {}),
				...(filtro?.solicitanteId
					? { solicitanteId: filtro.solicitanteId }
					: {}),
			},
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const primera = useQuery(opciones(1));
	const pedidas = paginasAPedir(
		paginas,
		primera.data?.total,
		DECISIONES_POR_PAGINA,
		MAX_PAGINAS_BITACORA,
	);
	const r = useQueries({
		queries: Array.from({ length: pedidas }, (_, i) => opciones(i + 1)),
		combine: combinarDecisionesConvenio,
	});
	return { ...r, hayMas: quedanMas(r, pedidas, MAX_PAGINAS_BITACORA) };
}

/** Fuera del hook: `combine` estable. Cartera responde `{ data, pagination }`. */
function combinarReasignaciones(
	consultas: Array<{
		data?:
			| { data?: unknown[]; pagination?: { total?: number } | null }
			| undefined;
		isLoading: boolean;
		isError: boolean;
		refetch: () => Promise<unknown>;
	}>,
) {
	return combinarPaginas<ReasignacionFuente>(
		consultas.map((c) => ({
			...c,
			data: c.data
				? { items: c.data.data ?? [], total: c.data.pagination?.total }
				: undefined,
		})),
	);
}

/**
 * Reasignaciones manuales (`getHistorialReasignaciones` con origen
 * `API_MANUAL`), todo el historial en páginas de `REASIGNACIONES_POR_PAGINA`.
 */
export function useHistorialReasignaciones(
	paginas: number,
	habilitado: boolean,
) {
	const opciones = (page: number) => ({
		...orpc.getHistorialReasignaciones.queryOptions({
			input: {
				origen: "API_MANUAL" as const,
				page,
				pageSize: REASIGNACIONES_POR_PAGINA,
			},
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const primera = useQuery(opciones(1));
	const pedidas = paginasAPedir(
		paginas,
		primera.data?.pagination?.total,
		REASIGNACIONES_POR_PAGINA,
	);
	const r = useQueries({
		queries: Array.from({ length: pedidas }, (_, i) => opciones(i + 1)),
		combine: combinarReasignaciones,
	});
	return { ...r, hayMas: quedanMas(r, pedidas) };
}

/** Fuera del hook: `combine` estable. `listarTraslados` no da total. */
function combinarTraslados(
	consultas: Array<{
		data?: unknown[] | undefined;
		isLoading: boolean;
		isError: boolean;
		refetch: () => Promise<unknown>;
	}>,
) {
	// Sin total: hay más mientras la última página cargada venga llena (o si
	// ya se pidieron páginas que todavía no llegan).
	let hayMas = false;
	for (let i = consultas.length - 1; i >= 0; i--) {
		const data = consultas[i].data;
		if (data === undefined) continue;
		hayMas = i < consultas.length - 1 || data.length >= TRASLADOS_POR_PAGINA;
		break;
	}
	return {
		items: consultas.flatMap(
			(c) => (c.data ?? []) as unknown as TrasladoFuente[],
		),
		cargando: consultas.some((c) => c.isLoading),
		error: consultas.some((c) => c.isError),
		hayMas,
		refetch: () => {
			for (const c of consultas) void c.refetch();
		},
	};
}

/**
 * Traslados de cartera (`listarTraslados`, de 20 en 20), todo el historial.
 * Sin total: si la fuente ya se agotó, «Cargar más» pide una página vacía
 * (barata) y `hayMas` sigue en false.
 */
export function useHistorialTraslados(paginas: number, habilitado: boolean) {
	return useQueries({
		queries: Array.from({ length: Math.max(1, paginas) }, (_, i) => ({
			...orpc.listarTraslados.queryOptions({ input: { page: i + 1 } }),
			enabled: habilitado,
			refetchOnWindowFocus: false,
		})),
		combine: combinarTraslados,
	});
}

/**
 * Convenios de un asesor en todos los estados (`getConveniosListado` con
 * `asesorId`), de la fecha del convenio más reciente a la más antigua.
 */
export function useConveniosDeAsesor(
	asesorId: number,
	paginas: number,
	habilitado: boolean,
) {
	const opciones = (page: number) => ({
		...orpc.getConveniosListado.queryOptions({
			input: {
				estado: "all" as const,
				asesorId,
				page,
				perPage: CONVENIOS_ASESOR_POR_PAGINA,
			},
		}),
		enabled: habilitado,
	});
	const primera = useQuery(opciones(1));
	const pedidas = paginasAPedir(
		paginas,
		primera.data?.total,
		CONVENIOS_ASESOR_POR_PAGINA,
	);
	const r = useQueries({
		queries: Array.from({ length: pedidas }, (_, i) => opciones(i + 1)),
		combine: combinarConvenios,
	});
	return { ...r, hayMas: quedanMas(r, pedidas) };
}

/** Nombre del usuario del CRM (para reconocer lo que pidió un asesor). */
export function useNombreUsuarioCrm(
	userId: string | null,
	habilitado: boolean,
) {
	const usuarios = useQuery({
		...orpc.getUsuariosCobros.queryOptions(),
		enabled: habilitado && !!userId,
		staleTime: 5 * 60 * 1000,
	});
	return {
		nombre: userId
			? (usuarios.data?.find((u) => u.id === userId)?.name ?? null)
			: null,
		cargando: usuarios.isLoading,
	};
}

export type { Solicitud };
