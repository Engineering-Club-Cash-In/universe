/**
 * Consultas de /cobros/solicitudes (y de las solicitudes de un asesor). Las
 * llaves e inputs son los MISMOS que usan el Dashboard del supervisor y las
 * páginas anteriores, así que comparten caché: abrir la bandeja después del
 * Dashboard sale de memoria.
 */
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	type EntradaBitacora,
	MAX_FILAS_BITACORA,
	type TipoBitacora,
} from "server/src/lib/bitacora-supervision";
import { orpc, orpcAparte } from "@/utils/orpc";
import type {
	DecisionConvenioFuente,
	FiltroServidorHistorial,
} from "./historial";
import {
	type ConvenioFuente,
	type InmovilizacionFuente,
	type InmovilizacionHistorialFuente,
	type RecuperacionFuente,
	type Solicitud,
	solicitudesDeFuentes,
} from "./normalizar";

/** Convenios por aprobar que trae una consulta (mismo input que el Dashboard). */
export const CONVENIOS_POR_CONSULTA = 100;
/**
 * Rebajas y escalados a Jurídico por consulta. El servidor ordena las abiertas
 * primero, así que el límite solo deja fuera las ya resueltas. Mismo input que
 * el Dashboard del supervisor (comparten caché).
 */
export const SOLICITUDES_APLICACION_POR_CONSULTA = 200;
/** Apagados y reactivaciones del historial por cada «Cargar más». */
export const INMOVILIZACIONES_POR_PAGINA = 50;

/**
 * La bandeja: convenios por aprobar, apagados y reactivaciones (pendientes y
 * por ejecutar), recuperaciones del vehículo, rebajas de mora, escalados a
 * Jurídico y solicitudes de documentos. Mismas opciones que las páginas de
 * antes: la cola de inmovilizaciones no se recarga al volver a la ventana y
 * la de recuperaciones sí.
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
		// Sin filtro de estado: las abiertas van primero, y una que falló al
		// aplicarse (`error_aplicacion`) sigue esperando al supervisor.
		...orpc.getSolicitudesRebajaMora.queryOptions({
			input: { limite: SOLICITUDES_APLICACION_POR_CONSULTA },
		}),
		enabled: habilitado,
		refetchOnWindowFocus: false,
	});
	const juridico = useQuery({
		...orpc.getSolicitudesJuridico.queryOptions({
			input: { limite: SOLICITUDES_APLICACION_POR_CONSULTA },
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

	const datos = useMemo(
		() =>
			solicitudesDeFuentes({
				convenios: (convenios.data?.items ?? []) as unknown as ConvenioFuente[],
				recuperaciones: (recuperaciones.data?.pendientes ??
					[]) as unknown as RecuperacionFuente[],
				inmovilizaciones: (inmovilizaciones.data ??
					[]) as unknown as InmovilizacionFuente[],
				rebajas: rebajas.data,
				juridico: juridico.data,
				documentos: documentos.data,
			}),
		[
			convenios.data,
			recuperaciones.data,
			inmovilizaciones.data,
			rebajas.data,
			juridico.data,
			documentos.data,
		],
	);

	const totalConvenios = convenios.data?.total ?? 0;
	const conveniosTraidos = convenios.data?.items?.length ?? 0;

	const consultas = [
		convenios,
		recuperaciones,
		inmovilizaciones,
		rebajas,
		juridico,
		documentos,
	];

	return {
		/** Todo lo que espera la decisión del supervisor, las más recientes primero. */
		pendientes: datos.pendientes,
		porEjecutar: datos.porEjecutar,
		/** Hay más convenios por aprobar de los que entraron en la consulta. */
		conveniosFuera:
			totalConvenios > conveniosTraidos ? totalConvenios - conveniosTraidos : 0,
		cargando: consultas.some((c) => c.isLoading),
		/** Fuentes que fallaron (las demás se muestran igual). */
		errores: [
			convenios.isError ? "convenios" : null,
			recuperaciones.isError ? "recuperaciones del vehículo" : null,
			inmovilizaciones.isError ? "apagados y reactivaciones" : null,
			rebajas.isError ? "rebajas de mora" : null,
			juridico.isError ? "escalados a Jurídico" : null,
			documentos.isError ? "solicitudes de documentos" : null,
		].filter((e): e is string => e !== null),
		actualizando: consultas.some((c) => c.isFetching),
		refetch: () => {
			for (const c of consultas) void c.refetch();
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

/* ── Historial de decisiones (bitácora del servidor, M3) ───────────────────── */

/** Filas por página del Historial (el servidor admite hasta 50). */
export const BITACORA_POR_PAGINA = 20;
/** Páginas que la bitácora puede dar con `BITACORA_POR_PAGINA`. */
export const MAX_PAGINAS_HISTORIAL = Math.floor(
	MAX_FILAS_BITACORA / BITACORA_POR_PAGINA,
);

/**
 * Una página de la bitácora (`getBitacoraDecisiones`) con los filtros ya
 * traducidos (`filtroServidorHistorial`), búsqueda incluida. Mientras llega
 * otra página o cambian los filtros se sigue viendo la anterior
 * (`actualizando`).
 */
export function useBitacoraDecisiones(
	filtro: FiltroServidorHistorial,
	pagina: number,
	habilitado: boolean,
) {
	return useQuery({
		...orpcAparte.getBitacoraDecisiones.queryOptions({
			input: {
				page: Math.min(Math.max(1, pagina), MAX_PAGINAS_HISTORIAL),
				perPage: BITACORA_POR_PAGINA,
				...(filtro.tipos ? { tipos: filtro.tipos } : {}),
				...(filtro.decisiones ? { decisiones: filtro.decisiones } : {}),
				...(filtro.solicitanteId
					? { solicitanteId: filtro.solicitanteId }
					: {}),
				...(filtro.desde ? { desde: filtro.desde } : {}),
				...(filtro.hasta ? { hasta: filtro.hasta } : {}),
				...(filtro.eventos ? { eventos: filtro.eventos } : {}),
				...(filtro.busqueda ? { busqueda: filtro.busqueda } : {}),
			},
		}),
		enabled: habilitado && !filtro.vacio,
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
	});
}

const combinarBitacora = (c: ConsultaPaginada[]) =>
	combinarPaginas<EntradaBitacora>(c);

/**
 * Rebajas de mora, Jurídico y documentos que pidió un asesor y ya se
 * decidieron (bitácora filtrada por quien los pidió), en páginas de
 * `DECISIONES_POR_PAGINA`. Las que esperan decisión vienen de la bandeja.
 * `paginas` crece con «Cargar más».
 */
export function useBitacoraDelAsesor(
	userId: string | null,
	paginas: number,
	habilitado: boolean,
) {
	const opciones = (page: number) => ({
		...orpcAparte.getBitacoraDecisiones.queryOptions({
			input: {
				page,
				perPage: DECISIONES_POR_PAGINA,
				tipos: ["rebaja", "juridico", "documento"] as TipoBitacora[],
				solicitanteId: userId ?? "",
			},
		}),
		enabled: habilitado && !!userId,
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
		combine: combinarBitacora,
	});
	return { ...r, hayMas: quedanMas(r, pedidas, MAX_PAGINAS_BITACORA) };
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
