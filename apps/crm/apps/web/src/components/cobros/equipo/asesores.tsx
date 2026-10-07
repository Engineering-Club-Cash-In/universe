import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { hoyGT } from "@/components/cobros/supervision/formato";
import type { BucketAsesor } from "@/components/ds/card-asesor";
import { ROLES } from "@/lib/roles";
import { client, orpc, queryClient } from "@/utils/orpc";
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
	nivelAsesor,
	rangosContactabilidad,
	textoAusencia,
} from "./estado-asesor";
import {
	AsesorReactivadoDialog,
	type CoberturaReactivar,
	ConfirmarReactivarDialog,
} from "./reactivar-dialogs";
import type { GrupoEquipo } from "./search";

/**
 * Contenedor de «Mi equipo» › Asesores. Fuentes (todas ya existentes):
 *   - asesores activos con pool  → getAsesoresTraslados (asesor_id, userId, buckets)
 *   - créditos y barra por bucket → getCargaPorAsesorBucket().porAsesor
 *   - gestiones cumplidas         → getCumplimientoAgendaResumen (último cierre)
 *   - contactabilidad             → getHistorialAgendasResumen con usuarioIds:[userId]
 *                                   y roles:["cobros"], UNA llamada por asesor, en
 *                                   paralelo y con staleTime (no hay endpoint por
 *                                   asesor en lote; ver el informe de G4)
 *   - ausente                     → listarCoberturas de hoy (cobertura vigente)
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

type ResumenHistorial = { total: number; efectivos: number };

const BUCKETS_UI: BucketAsesor[] = ["B0", "B1", "B2", "B3", "B4", "B5"];

/** Catálogo del equipo: asesores activos con buckets en el pool de cartera. */
export function useEquipoActivo(habilitado: boolean) {
	const query = useQuery({
		...orpc.getAsesoresTraslados.queryOptions(),
		enabled: habilitado,
		staleTime: 5 * 60_000,
	});
	const activos = useMemo(
		() =>
			(query.data ?? [])
				.filter((a) => a.activo !== false && a.buckets.length > 0)
				.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
		[query.data],
	);
	return { query, activos };
}

/** «10 asesores · 6 Junior · 4 Senior», o null mientras carga. */
export function useResumenEquipo(habilitado: boolean): string | null {
	const { query, activos } = useEquipoActivo(habilitado);
	if (!query.data) return null;
	return resumenEquipo(activos.map((a) => nivelAsesor(a.buckets)));
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

	const { query: asesoresQuery, activos } = useEquipoActivo(habilitado);
	const cargaQuery = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	// Último día con agenda cerrada (la de hoy se cierra en la noche).
	const agendaQuery = useQuery({
		...orpc.getCumplimientoAgendaResumen.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	const coberturasQuery = useQuery({
		...orpc.listarCoberturas.queryOptions({
			input: { desde: hoy, hasta: hoy },
		}),
		enabled: habilitado,
	});

	// El tipo de getHistorialAgendasResumen llega truncado (TS7056): se lee a
	// mano, igual que el Dashboard del supervisor.
	const orpcSinTipo = orpc as unknown as {
		getHistorialAgendasResumen: typeof orpc.getCobrosDashboardStats;
	};
	const conUsuario = activos.filter((a) => a.userId);
	const contactabilidadQueries = useQueries({
		queries: conUsuario.map((a) => ({
			...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
				input: {
					...rango,
					usuarioIds: [a.userId],
					roles: [ROLES.COBROS],
				} as never,
			}),
			enabled: habilitado,
			staleTime: 5 * 60_000,
		})),
	});
	const contactabilidadPorUsuario = new Map<string, number | null>();
	conUsuario.forEach((a, i) => {
		const data = contactabilidadQueries[i]?.data as
			| ResumenHistorial
			| undefined;
		if (a.userId && data)
			contactabilidadPorUsuario.set(a.userId, contactabilidadDeResumen(data));
	});
	const errorContactabilidad = contactabilidadQueries.some((q) => q.isError);

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
				return {
					asesorId: a.asesor_id,
					nombre: a.nombre,
					nivel: nivelAsesor(a.buckets),
					estado: estadoAsesor({
						ausente: !!cobertura,
						cumplimiento: ag && ag.planificados > 0 ? ag.porcentaje : null,
						contactabilidad,
					}),
					creditos,
					distribucion,
					gestiones: ag
						? { atendidos: ag.atendidos, planificados: ag.planificados }
						: null,
					contactabilidad,
					ausencia: cobertura ? textoAusencia(cobertura) : null,
					destino: { to: `/cobros/equipo/${a.asesor_id}` },
				};
			})
			.sort(
				(x, y) =>
					Number(x.estado === "ausente") - Number(y.estado === "ausente") ||
					x.nombre.localeCompare(y.nombre, "es"),
			);
	})();

	/* ── Reactivar = cancelar la cobertura vigente ─────────────────────────── */

	const [porReactivar, setPorReactivar] = useState<{
		asesorId: number;
		coberturaId: string;
		datos: CoberturaReactivar;
	} | null>(null);
	const [reactivado, setReactivado] = useState<string | null>(null);

	const cancelar = useMutation({
		mutationFn: (id: string) => client.cancelarCobertura({ id }),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.listarCoberturas.key(),
			});
			setReactivado(porReactivar?.datos.nombre ?? null);
			setPorReactivar(null);
		},
		onError: (e: Error) => toast.error(e.message),
	});

	const pedirReactivar = (asesorId: number) => {
		const a = activos.find((x) => x.asesor_id === asesorId);
		const c = a ? coberturaVigente(coberturas, a.userId, hoy) : null;
		if (!a || !c) return;
		cancelar.reset();
		setPorReactivar({
			asesorId,
			coberturaId: c.id,
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
		coberturasQuery.isError
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
					coberturasQuery.isLoading
				}
				error={asesoresQuery.isError}
				onReintentar={() => void asesoresQuery.refetch()}
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
					porReactivar && cancelar.mutate(porReactivar.coberturaId)
				}
				onCerrar={() => setPorReactivar(null)}
			/>
			<AsesorReactivadoDialog
				nombre={reactivado}
				onCerrar={() => setReactivado(null)}
			/>
		</>
	);
}
