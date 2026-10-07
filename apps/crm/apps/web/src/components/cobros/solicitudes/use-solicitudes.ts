/**
 * Consultas de /cobros/solicitudes (y de las solicitudes de un asesor). Las
 * llaves e inputs son los MISMOS que usan el Dashboard del supervisor y las
 * páginas anteriores, así que comparten caché: abrir la bandeja después del
 * Dashboard sale de memoria.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { orpc } from "@/utils/orpc";
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
		/** Hay más convenios por aprobar de los que entraron en la consulta. */
		conveniosFuera:
			totalConvenios > conveniosTraidos ? totalConvenios - conveniosTraidos : 0,
		cargando:
			convenios.isLoading ||
			recuperaciones.isLoading ||
			inmovilizaciones.isLoading,
		/** Fuentes que fallaron (las demás se muestran igual). */
		errores: [
			convenios.isError ? "convenios" : null,
			recuperaciones.isError ? "recuperaciones del vehículo" : null,
			inmovilizaciones.isError ? "apagados y reactivaciones" : null,
		].filter((e): e is string => e !== null),
		actualizando:
			convenios.isFetching ||
			recuperaciones.isFetching ||
			inmovilizaciones.isFetching,
		refetch: () => {
			void convenios.refetch();
			void recuperaciones.refetch();
			void inmovilizaciones.refetch();
		},
		refetchConvenios: () => void convenios.refetch(),
		/** Historial de recuperaciones (viene en la misma consulta). */
		historialRecuperaciones: (recuperaciones.data?.historial ??
			[]) as unknown as RecuperacionFuente[],
		recuperacionesQuery: recuperaciones,
	};
}

/** Fuera del hook: `combine` estable = TanStack solo lo recalcula si cambian los datos. */
function combinarInmovilizaciones(
	consultas: Array<{
		data?: { items?: unknown[]; total?: number } | undefined;
		isLoading: boolean;
		isError: boolean;
		refetch: () => Promise<unknown>;
	}>,
) {
	return {
		items: consultas.flatMap(
			(c) =>
				(c.data?.items ?? []) as unknown as InmovilizacionHistorialFuente[],
		),
		total: consultas[0]?.data?.total ?? null,
		cargando: consultas.some((c) => c.isLoading),
		error: consultas.some((c) => c.isError),
		refetch: () => {
			for (const c of consultas) void c.refetch();
		},
	};
}

/**
 * Historial de apagados y reactivaciones, de todos los estados, en páginas de
 * `INMOVILIZACIONES_POR_PAGINA` (las más recientes primero). `paginas` crece
 * con «Cargar más»: así se llega a todo el historial, como en la página de
 * antes, aunque se mezcle con otras fuentes.
 */
export function useHistorialInmovilizaciones(
	paginas: number,
	habilitado: boolean,
) {
	const r = useQueries({
		queries: Array.from({ length: Math.max(1, paginas) }, (_, i) => ({
			...orpc.getHistorialInmovilizaciones.queryOptions({
				input: { page: i + 1, perPage: INMOVILIZACIONES_POR_PAGINA },
			}),
			enabled: habilitado,
			refetchOnWindowFocus: false,
		})),
		combine: combinarInmovilizaciones,
	});
	return {
		...r,
		hayMas: r.total !== null && r.items.length < r.total,
	};
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
