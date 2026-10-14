import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { hoyGT } from "@/components/cobros/supervision/formato";
import type { BucketAsesor } from "@/components/ds/card-asesor";
import { ROLES } from "@/lib/roles";
import { client, orpc, orpcAparte, queryClient } from "@/utils/orpc";
import {
	AsesoresVista,
	type FilaAsesorEquipo,
	resumenEquipo,
} from "./asesores-vista";
import {
	coberturaVigente,
	contactabilidadDeResumen,
	DIAS_CONTACTABILIDAD,
	estadoAsesor,
	filtrarEquipoActivo,
	rangosContactabilidad,
	textoAusencia,
	textoAusenciaIndefinida,
} from "./estado-asesor";
import {
	AsesorReactivadoDialog,
	type CoberturaReactivar,
	ConfirmarReactivarDialog,
	type ResultadoReactivacion,
} from "./reactivar-dialogs";
import { resultadoRecuperacion } from "./recuperacion";
import type { GrupoEquipo } from "./search";

/**
 * Contenedor de «Mi equipo» › Asesores. Fuentes (todas ya existentes):
 *   - asesores activos con pool  → getAsesoresTraslados (asesor_id, userId, buckets)
 *   - créditos y barra por bucket → getCargaPorAsesorBucket().porAsesor
 *   - gestiones cumplidas         → getCumplimientoAgendaResumen (último cierre)
 *   - contactabilidad             → getContactabilidadPorAsesor (M7): UNA llamada en
 *                                   lote con usuarioIds y roles:["cobros"]
 *   - recuperación y meta         → getRecuperacionAsesores (M1), del mes
 *   - nivel                       → `nivel` de getAsesoresTraslados (M6)
 *   - ausente                     → listarCoberturas de hoy (cobertura vigente) o
 *                                   listarAusencias (M5, ausencia indefinida)
 */

type Cobertura = {
	id: string;
	titularId: string;
	suplenteId: string;
	motivo: string;
	desde: string;
	hasta: string;
	canceladaEn: unknown;
};

type AgendaItem = {
	asesorId: string;
	planificados: number;
	atendidos: number;
	porcentaje: number;
};

const BUCKETS_UI: BucketAsesor[] = ["B0", "B1", "B2", "B3", "B4", "B5"];

/** M5: ausencias indefinidas vigentes (con la cartera repartida al equipo). */
function useAusenciasIndefinidas(habilitado: boolean) {
	return useQuery({
		...orpcAparte.listarAusencias.queryOptions({
			input: { soloVigentes: true },
		}),
		enabled: habilitado,
	});
}

/**
 * Catálogo del equipo: asesores activos con buckets en el pool de cartera. Un
 * asesor con ausencia indefinida se queda aunque no tenga buckets: cartera le
 * apaga el pool al repartirle la cartera, y sin su tarjeta no habría cómo
 * reactivarlo.
 */
export function useEquipoActivo(habilitado: boolean) {
	const query = useQuery({
		...orpc.getAsesoresTraslados.queryOptions(),
		enabled: habilitado,
		staleTime: 5 * 60_000,
	});
	const ausenciasQuery = useAusenciasIndefinidas(habilitado);
	const activos = useMemo(() => {
		const ausentes = new Set(
			(ausenciasQuery.data ?? []).map((x) => x.asesorId),
		);
		return filtrarEquipoActivo(query.data ?? [], ausentes).sort((a, b) =>
			a.nombre.localeCompare(b.nombre, "es"),
		);
	}, [query.data, ausenciasQuery.data]);
	return { query, activos, ausenciasQuery };
}

/** «10 asesores · 6 Junior · 4 Senior», o null mientras carga. */
export function useResumenEquipo(habilitado: boolean): string | null {
	const { query, activos } = useEquipoActivo(habilitado);
	if (!query.data) return null;
	return resumenEquipo(activos.map((a) => a.nivel));
}

export function MiEquipoAsesores({
	habilitado,
	grupo,
	onGrupo,
}: {
	habilitado: boolean;
	grupo: GrupoEquipo;
	onGrupo: (grupo: GrupoEquipo) => void;
}) {
	const hoy = hoyGT();
	const rango = rangosContactabilidad(hoy).actual;

	const {
		query: asesoresQuery,
		activos,
		ausenciasQuery: ausenciasEquipo,
	} = useEquipoActivo(habilitado);
	const cargaQuery = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	// Último día con agenda cerrada (la de hoy se cierra en la noche).
	const agendaQuery = useQuery({
		...orpc.getCumplimientoAgendaResumen.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	// M1: recuperación del mes de cada asesor, con su meta.
	const recuperacionQuery = useQuery({
		...orpcAparte.getRecuperacionAsesores.queryOptions({
			input: { periodo: "mes" },
		}),
		enabled: habilitado,
		staleTime: 5 * 60_000,
	});
	const coberturasQuery = useQuery({
		...orpc.listarCoberturas.queryOptions({
			input: { desde: hoy, hasta: hoy },
		}),
		enabled: habilitado,
	});

	// M5: ausencias indefinidas vigentes (con la cartera repartida al equipo).
	const ausenciasQuery = useAusenciasIndefinidas(habilitado);
	const ausencias = ausenciasQuery.data ?? [];

	// M7: una sola llamada para todo el equipo (antes, una por asesor).
	const conUsuario = activos.filter((a) => a.userId);
	const contactabilidadQuery = useQuery({
		...orpcAparte.getContactabilidadPorAsesor.queryOptions({
			input: {
				...rango,
				usuarioIds: conUsuario.flatMap((a) => (a.userId ? [a.userId] : [])),
				roles: [ROLES.COBROS],
			},
		}),
		enabled: habilitado && conUsuario.length > 0,
		staleTime: 5 * 60_000,
	});
	const contactabilidadPorUsuario = new Map<string, number | null>();
	for (const c of contactabilidadQuery.data?.asesores ?? [])
		contactabilidadPorUsuario.set(c.userId, contactabilidadDeResumen(c));
	const errorContactabilidad = contactabilidadQuery.isError;

	const recuperacionPorAsesor = new Map(
		(recuperacionQuery.data ?? []).map((r) => [r.asesorId, r.recuperacion]),
	);

	const coberturas = (coberturasQuery.data ?? []) as unknown as Cobertura[];
	const nombrePorUsuario = new Map(
		(asesoresQuery.data ?? []).flatMap((a) =>
			a.userId ? [[a.userId, a.nombre] as const] : [],
		),
	);

	// Sin useMemo: depende del resultado de N queries de contactabilidad que
	// cambian por separado; el cálculo es barato (decenas de asesores).
	const filas = ((): FilaAsesorEquipo[] => {
		const carga = cargaQuery.data?.porAsesor ?? [];
		const agenda = (agendaQuery.data?.items ?? []) as unknown as AgendaItem[];
		return activos
			.map((a): FilaAsesorEquipo => {
				const c = carga.find((x) => x.asesor_id === a.asesor_id);
				const porBucket = new Map<number, number>();
				for (const d of c?.porBucket ?? [])
					porBucket.set(d.bucket, (porBucket.get(d.bucket) ?? 0) + d.cuentas);
				const distribucion = BUCKETS_UI.map((bucket, numero) => ({
					bucket,
					cantidad: porBucket.get(numero) ?? 0,
				})).filter(
					(d) => d.cantidad > 0 || a.buckets.includes(Number(d.bucket[1])),
				);
				const creditos = c
					? c.porBucket.reduce((t, d) => t + d.cuentas, 0)
					: cargaQuery.data
						? 0
						: null;
				const ag = a.userId
					? agenda.find((x) => x.asesorId === a.userId)
					: undefined;
				const contactabilidad = a.userId
					? (contactabilidadPorUsuario.get(a.userId) ?? null)
					: null;
				const cobertura = coberturaVigente(coberturas, a.userId, hoy);
				const indefinida = ausencias.find((x) => x.asesorId === a.asesor_id);
				return {
					asesorId: a.asesor_id,
					nombre: a.nombre,
					nivel: a.nivel,
					estado: estadoAsesor({
						ausente: !!cobertura || !!indefinida,
						cumplimiento: ag && ag.planificados > 0 ? ag.porcentaje : null,
						contactabilidad,
					}),
					creditos,
					distribucion,
					gestiones: ag
						? { atendidos: ag.atendidos, planificados: ag.planificados }
						: null,
					contactabilidad,
					recuperacion: resultadoRecuperacion(
						recuperacionPorAsesor.get(a.asesor_id),
					),
					ausencia: indefinida
						? textoAusenciaIndefinida(indefinida)
						: cobertura
							? textoAusencia(cobertura)
							: null,
					destino: { to: `/cobros/equipo/${a.asesor_id}` },
				};
			})
			.sort(
				(x, y) =>
					Number(x.estado === "ausente") - Number(y.estado === "ausente") ||
					x.nombre.localeCompare(y.nombre, "es"),
			);
	})();

	/* ── Reactivar = cancelar la cobertura o reactivar la ausencia indefinida ── */

	const [porReactivar, setPorReactivar] = useState<{
		asesorId: number;
		/** Cobertura (`cancelarCobertura`) o ausencia indefinida (`reactivarAsesor`). */
		id: string;
		indefinida: boolean;
		datos: CoberturaReactivar;
	} | null>(null);
	const [reactivado, setReactivado] = useState<string | null>(null);
	const [resultado, setResultado] = useState<ResultadoReactivacion | null>(
		null,
	);

	const cancelar = useMutation({
		mutationFn: async (r: { id: string; indefinida: boolean }) => {
			if (!r.indefinida) {
				await client.cancelarCobertura({ id: r.id });
				return null;
			}
			const res = await orpcAparte.reactivarAsesor.call({ id: r.id });
			return {
				devueltas: res.devueltas,
				retenidas: res.retenidas as { motivo: string }[],
			} satisfies ResultadoReactivacion;
		},
		onSuccess: (res) => {
			void queryClient.invalidateQueries({
				queryKey: orpc.listarCoberturas.key(),
			});
			void queryClient.invalidateQueries({
				queryKey: orpcAparte.listarAusencias.key(),
			});
			void queryClient.invalidateQueries({
				queryKey: orpc.getCargaPorAsesorBucket.key(),
			});
			// El pool vuelve: el catálogo cacheado trae al asesor sin buckets.
			void queryClient.invalidateQueries({
				queryKey: orpc.getAsesoresTraslados.key(),
			});
			setResultado(res);
			setReactivado(porReactivar?.datos.nombre ?? null);
			setPorReactivar(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const pedirReactivar = (asesorId: number) => {
		const a = activos.find((x) => x.asesor_id === asesorId);
		cancelar.reset();
		const indefinida = ausencias.find((x) => x.asesorId === asesorId);
		if (a && indefinida) {
			setPorReactivar({
				asesorId,
				id: indefinida.id,
				indefinida: true,
				datos: {
					nombre: a.nombre,
					motivo: indefinida.motivo,
					desde: "",
					hasta: "",
					suplente: "",
					indefinida: { aMedias: !!indefinida.reactivacionIniciadaAt },
				},
			});
			return;
		}
		const c = a ? coberturaVigente(coberturas, a.userId, hoy) : null;
		if (!a || !c) return;
		setPorReactivar({
			asesorId,
			id: c.id,
			indefinida: false,
			datos: {
				nombre: a.nombre,
				motivo: c.motivo,
				desde: c.desde,
				hasta: c.hasta,
				suplente: nombrePorUsuario.get(c.suplenteId) ?? "el suplente",
			},
		});
	};

	const avisos = [
		cargaQuery.isError
			? "No se pudo cargar la carga de cuentas; los créditos asignados quedan en 0."
			: null,
		agendaQuery.isError ? "No se pudo cargar el cumplimiento de agenda." : null,
		errorContactabilidad
			? "No se pudo cargar la contactabilidad de algunos asesores."
			: null,
		recuperacionQuery.isError
			? "No se pudo cargar la recuperación de los asesores."
			: null,
		coberturasQuery.isError || ausenciasQuery.isError
			? "No se pudieron cargar las ausencias de hoy."
			: null,
	].filter((a): a is string => a !== null);

	return (
		<>
			<AsesoresVista
				filas={filas}
				grupo={grupo}
				onGrupo={onGrupo}
				cargando={
					asesoresQuery.isLoading ||
					cargaQuery.isLoading ||
					coberturasQuery.isLoading ||
					ausenciasQuery.isLoading
				}
				// Sin las ausencias no se sabe quién sigue en el equipo con el pool
				// pausado: se trata como error de la página y el reintento relee ambas.
				error={asesoresQuery.isError || ausenciasEquipo.isError}
				onReintentar={() => {
					void asesoresQuery.refetch();
					void ausenciasEquipo.refetch();
				}}
				onReactivar={pedirReactivar}
				reactivandoId={cancelar.isPending ? porReactivar?.asesorId : null}
				fechaAgenda={
					agendaQuery.data?.fecha
						? new Date(`${agendaQuery.data.fecha}T12:00:00`).toLocaleDateString(
								"es-GT",
							)
						: null
				}
				diasContactabilidad={DIAS_CONTACTABILIDAD}
				avisos={avisos}
			/>
			<ConfirmarReactivarDialog
				cobertura={porReactivar?.datos ?? null}
				pendiente={cancelar.isPending}
				onConfirmar={() =>
					porReactivar &&
					cancelar.mutate({
						id: porReactivar.id,
						indefinida: porReactivar.indefinida,
					})
				}
				onCerrar={() => setPorReactivar(null)}
			/>
			<AsesorReactivadoDialog
				nombre={reactivado}
				resultado={resultado}
				onCerrar={() => {
					setReactivado(null);
					setResultado(null);
				}}
			/>
		</>
	);
}
