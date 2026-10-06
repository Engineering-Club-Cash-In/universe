import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { MisPendientesInmovilizacion } from "@/components/cobros/mis-pendientes-inmovilizacion";
import { PanelGestionRapida } from "@/components/cobros/panel-gestion-rapida";
import type { Bucket } from "@/components/ds/badges";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import {
	type ClaveContador,
	type ClaveFiltro,
	type DiaProximo,
	etiquetaContador,
	type SeguimientoProgramado,
} from "./agenda-hoy";
import type { FilaAtencion } from "./casos-atencion";
import { DashboardAsesorVista, saludoPorHora } from "./dashboard-asesor-vista";
import type { BucketDistribucion } from "./dashboard-distribucion";
import type { FilaCartera, FilaCola, PerfilCobros } from "./fila-cartera";
import type {
	DesempenoVista,
	MetaMoraVista,
	Periodo,
	RecuperacionVista,
} from "./mi-desempeno";

/**
 * Contenedor del Dashboard del asesor (rol `cobros`): hace las consultas y arma
 * las props de `DashboardAsesorVista`. Unifica el Dashboard de Cobros anterior y
 * "Mi día". Cada bloque carga por su cuenta (Skeleton por bloque).
 */

const PER_PAGE = 20;
const PER_PAGE_AGENDA = 200;
const DIAS_PROXIMOS = [1, 2, 3, 4, 5] as const;
const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];
const ESTADO_POR_BUCKET: Record<Bucket, string> = {
	B0: "al_dia",
	B1: "mora_30",
	B2: "mora_60",
	B3: "mora_90",
	B4: "mora_120",
	B5: "mora_120_plus",
};
/** Fuera de la mora de la cartera (mismo criterio que "Monto total en mora"). */
const NO_MORA = new Set(["al_dia", "completado", "incobrable"]);

/** Categorías de getColaDia (input `filtro`). El resto va por `filtroExtra`. */
const CATEGORIAS_COLA = new Set<ClaveFiltro>([
	"sla_hoy",
	"promesa_hoy",
	"vence_hoy",
	"incumplida",
	"promesa_proxima",
	"sin_contacto",
]);

type ColaRespuesta = {
	sinAsesor: boolean;
	ausente?: boolean;
	items: FilaCola[];
	total: number;
	totalPages: number;
	conteos?: Record<string, number>;
	conteosExtra?: { llamada_hoy: number; sin_intento_hoy: number };
};

type AgendaDiaRespuesta = {
	items: DiaProximo["items"];
	total: number;
	sinAsesor: boolean;
	ausente?: boolean;
};

type EstatusStat = {
	estadoMora: string;
	totalCases: number;
	montoTotal: string;
	sumaCapital: string;
	porcentaje: string;
};

type MetaMora = {
	id: number | string;
	categoria: string;
	valorObjetivo: string;
};

const ETIQUETA_META: Record<string, string> = {
	mora_total: "Mora total",
	mora_30: "Mora 30",
	mora_60: "Mora 60",
	mora_90: "Mora 90",
	mora_120: "Mora 120+",
};
const ORDEN_META = ["mora_total", "mora_30", "mora_60", "mora_90", "mora_120"];
/** Lo que el dashboard anterior mostraba al rol `cobros`. */
const METAS_VISIBLES_ASESOR = new Set(ORDEN_META);

/**
 * Metas de mora del mes con el % real de la cartera (lógica del dashboard
 * anterior). "mora_120" suma B4 y B5; "mora_total" suma las moras activas.
 */
export function calcularMetasMora(
	metas: MetaMora[],
	stats: EstatusStat[],
): MetaMoraVista[] {
	return metas
		.filter((m) => METAS_VISIBLES_ASESOR.has(m.categoria))
		.sort(
			(a, b) =>
				ORDEN_META.indexOf(a.categoria) - ORDEN_META.indexOf(b.categoria),
		)
		.map((meta) => {
			let actual: number | undefined;
			if (meta.categoria === "mora_total") {
				actual = stats
					.filter((s) => !NO_MORA.has(s.estadoMora))
					.reduce((t, s) => t + Number.parseFloat(s.porcentaje || "0"), 0);
			} else if (meta.categoria === "mora_120") {
				const b120 = stats.filter(
					(s) =>
						s.estadoMora === "mora_120" || s.estadoMora === "mora_120_plus",
				);
				actual = b120.length
					? b120.reduce((t, s) => t + Number.parseFloat(s.porcentaje || "0"), 0)
					: undefined;
			} else {
				const s = stats.find((x) => x.estadoMora === meta.categoria);
				actual = s ? Number.parseFloat(s.porcentaje) : undefined;
			}
			return {
				categoria: meta.categoria,
				etiqueta: ETIQUETA_META[meta.categoria] ?? meta.categoria,
				actual,
				objetivo: Number.parseFloat(meta.valorObjetivo),
			};
		});
}

/** Reparto por bucket del asesor: sus buckets + cualquiera con créditos. */
export function calcularDistribucion(
	buckets: number[],
	stats: EstatusStat[],
): BucketDistribucion[] {
	const porEstado = new Map(stats.map((s) => [s.estadoMora, s]));
	const visibles = BUCKETS.filter(
		(b, i) =>
			buckets.includes(i) ||
			(porEstado.get(ESTADO_POR_BUCKET[b])?.totalCases ?? 0) > 0,
	);
	const filas = visibles.map((bucket) => {
		const s = porEstado.get(ESTADO_POR_BUCKET[bucket]);
		return {
			bucket,
			cantidad: s?.totalCases ?? 0,
			capital: Number(s?.sumaCapital ?? 0),
			mora: bucket === "B0" ? 0 : Number(s?.montoTotal ?? 0),
			porcentaje: 0,
		};
	});
	const total = filas.reduce((t, f) => t + f.cantidad, 0);
	for (const f of filas) {
		f.porcentaje = total > 0 ? (f.cantidad / total) * 100 : 0;
	}
	return filas;
}

export function DashboardAsesor() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const conSesion = !!session;

	const [periodo, setPeriodo] = useState<Periodo>("dia");
	const [filtro, setFiltro] = useState<ClaveFiltro | null>(null);
	const [page, setPage] = useState(1);
	const [agendaAbierta, setAgendaAbierta] = useState(false);
	const [vistaRapida, setVistaRapida] = useState<string | null>(null);

	/* ── Consultas ─────────────────────────────────────────────────────────── */

	const perfilQuery = useQuery({
		...orpc.getMiPerfilCobros.queryOptions(),
		enabled: conSesion,
	});
	const perfil = perfilQuery.data as PerfilCobros | undefined;

	const desempenoQuery = useQuery({
		...orpc.getMiDesempeno.queryOptions({ input: { periodo } }),
		enabled: conSesion,
		placeholderData: keepPreviousData,
	});

	const pendientesQuery = useQuery({
		...orpc.getMiAgendaContadoresPendientes.queryOptions(),
		enabled: conSesion,
	});
	// Hoy el server los tipa como `null` (los llena José): se leen como number | null.
	const pendientes = pendientesQuery.data as
		| {
				pagosPorConfirmar: number | null;
				referenciasPorContactar: number | null;
		  }
		| undefined;

	const statsQuery = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions({
			input: { emailCobrador: session?.user?.email },
		}),
		enabled: conSesion,
	});

	const ahora = new Date();
	const metasQuery = useQuery({
		...orpc.getMetasMora.queryOptions({
			input: { mes: ahora.getMonth() + 1, anio: ahora.getFullYear() },
		}),
		enabled: conSesion,
	});

	// Progreso "X de Y tareas realizadas hoy": todas las páginas de la agenda.
	const agendaHoyQuery = useQuery({
		...orpc.getMiAgendaHoy.queryOptions({
			input: { page: 1, perPage: PER_PAGE_AGENDA },
		}),
		enabled: conSesion,
		refetchInterval: 60_000,
	});
	const paginasExtraAgenda = Math.max(
		0,
		(agendaHoyQuery.data?.totalPages ?? 1) - 1,
	);
	const agendaHoyResto = useQueries({
		queries: Array.from({ length: paginasExtraAgenda }, (_, i) => ({
			...orpc.getMiAgendaHoy.queryOptions({
				input: { page: i + 2, perPage: PER_PAGE_AGENDA },
			}),
			enabled: conSesion,
			refetchInterval: 60_000,
		})),
	});

	const filtroCategoria =
		filtro && CATEGORIAS_COLA.has(filtro) ? filtro : undefined;
	const filtroExtra =
		filtro === "llamada_hoy" || filtro === "sin_intento_hoy"
			? filtro
			: undefined;
	const colaQuery = useQuery({
		...orpc.getColaDia.queryOptions({
			input: {
				// Cast: ver mi-dia.tsx (union de 6 miembros vs. el problema de ORPC).
				filtro: filtroCategoria as never,
				filtroExtra,
				page,
				perPage: PER_PAGE,
			},
		}),
		enabled: conSesion,
		placeholderData: keepPreviousData,
		// Cobertura y gestiones pueden cambiar desde otra sesión.
		refetchInterval: 60_000,
	});
	const cola = colaQuery.data as ColaRespuesta | undefined;
	const itemsCola = cola?.items ?? [];
	const sifcos = itemsCola.map((i) => i.numeroCreditoSifco);

	// Completa cada página con la fila de cartera (deuda vencida, cuota, fecha…).
	const carteraQuery = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: { numerosSifco: sifcos, limit: 200 },
		}),
		enabled: conSesion && sifcos.length > 0,
		placeholderData: keepPreviousData,
		refetchInterval: 60_000,
	});

	const proximosQueries = useQueries({
		queries: DIAS_PROXIMOS.map((dia) => ({
			...orpc.getAgendaDia.queryOptions({
				input: { dia, page: 1, perPage: PER_PAGE_AGENDA },
			}),
			enabled: conSesion && agendaAbierta,
			refetchInterval: 60_000,
		})),
	});

	const seguimientosQuery = useQuery({
		...orpc.getCasosCobros.queryOptions({ input: { limit: 100, offset: 0 } }),
		enabled: conSesion && agendaAbierta,
	});

	// La cola puede achicarse (cobertura que termina, casos atendidos).
	const totalPages = cola?.totalPages ?? 1;
	useEffect(() => {
		if (page > totalPages) setPage(totalPages);
	}, [page, totalPages]);

	/* ── Derivados ─────────────────────────────────────────────────────────── */

	const stats = (statsQuery.data?.estatusStats ?? []) as EstatusStat[];

	const progreso = useMemo(() => {
		if (!agendaHoyQuery.data) return undefined;
		const paginas = [agendaHoyQuery.data, ...agendaHoyResto.map((q) => q.data)];
		const hechas = paginas.reduce(
			(t, p) => t + (p?.items.filter((i) => i.atendido).length ?? 0),
			0,
		);
		return { hechas, total: agendaHoyQuery.data.total };
	}, [agendaHoyQuery.data, agendaHoyResto]);

	const valores: Partial<Record<ClaveContador, number | null>> = {
		llamada_hoy: cola?.conteosExtra?.llamada_hoy,
		sin_intento_hoy: cola?.conteosExtra?.sin_intento_hoy,
		promesa_hoy: cola?.conteos?.promesa_hoy,
		incumplida: cola?.conteos?.incumplida,
		sin_contacto: cola?.conteos?.sin_contacto,
		sla_hoy: cola?.conteos?.sla_hoy,
		vence_hoy: cola?.conteos?.vence_hoy,
		promesa_proxima: cola?.conteos?.promesa_proxima,
		pagos_por_confirmar: pendientes ? pendientes.pagosPorConfirmar : undefined,
		referencias: pendientes ? pendientes.referenciasPorContactar : undefined,
	};

	const proximosDias = DIAS_PROXIMOS.map((dia, i) => {
		const data = proximosQueries[i]?.data as AgendaDiaRespuesta | undefined;
		return { dia, total: data?.total ?? 0, items: data?.items ?? [], data };
	});

	const seguimientos: SeguimientoProgramado[] = useMemo(() => {
		const hoy = new Date();
		hoy.setHours(0, 0, 0, 0);
		const en7 = new Date(hoy);
		en7.setDate(en7.getDate() + 7);
		return (seguimientosQuery.data ?? [])
			.filter((c) => c.proximoContacto && new Date(c.proximoContacto) <= en7)
			.map((c) => ({
				id: c.id,
				idFicha: c.contratoId || c.id,
				cliente: c.clienteNombre || "Sin nombre",
				vehiculo: [c.vehiculoMarca, c.vehiculoModelo, c.vehiculoYear]
					.filter(Boolean)
					.join(" "),
				fecha: new Date(c.proximoContacto as string | Date),
			}))
			.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
	}, [seguimientosQuery.data]);

	const porSifco = useMemo(() => {
		const m = new Map<string, FilaCartera>();
		for (const f of (carteraQuery.data?.data ?? []) as FilaCartera[]) {
			if (f.numeroCredito) m.set(f.numeroCredito, f);
		}
		return m;
	}, [carteraQuery.data]);

	// Mientras la página de cartera de ESTOS SIFCOs carga, la tabla muestra el
	// skeleton (evita pintar filas incompletas que luego cambian).
	const carteraLista =
		sifcos.length === 0 ||
		carteraQuery.isError ||
		(!!carteraQuery.data && !carteraQuery.isPlaceholderData);
	const filas: FilaAtencion[] = itemsCola.map((c) => ({
		cola: c,
		credito: porSifco.get(c.numeroCreditoSifco) ?? null,
	}));

	const estadoCasos = (() => {
		if (colaQuery.isError && !cola) return "error" as const;
		if (!cola || !carteraLista) return "cargando" as const;
		if (cola.sinAsesor) return "sinAsesor" as const;
		if (cola.ausente) return "ausente" as const;
		return "listo" as const;
	})();

	const moraCartera = statsQuery.data
		? stats
				.filter((s) => !NO_MORA.has(s.estadoMora))
				.reduce((t, s) => t + Number(s.montoTotal || 0), 0)
		: undefined;

	const desempenoData = desempenoQuery.data as
		| (Omit<DesempenoVista, "recuperacion"> & {
				recuperacion: RecuperacionVista | null;
		  })
		| undefined;

	const primerNombre =
		(session?.user?.name ?? perfil?.nombre ?? "").trim().split(/\s+/)[0] ?? "";

	const irACartera = (search?: Record<string, string>) =>
		navigate({ to: "/cobros/cartera", search });

	const abrirFicha = (id: string, tipo: "caso" | "contrato") =>
		navigate({ to: "/cobros/$id", params: { id }, search: { tipo } });

	return (
		<DashboardAsesorVista
			encabezado={{
				saludo: saludoPorHora(),
				primerNombre,
				datosParciales:
					statsQuery.data?.fuente != null &&
					statsQuery.data.fuente !== "cartera-back",
			}}
			pendientes={
				<MisPendientesInmovilizacion
					onVerCaso={(sifco) =>
						navigate({
							to: "/cobros/$id",
							params: { id: sifco },
							search: { tipo: "caso", seccion: "inmovilizacion" },
						})
					}
				/>
			}
			agenda={{
				progreso,
				valores,
				cargandoConteos: colaQuery.isPending || pendientesQuery.isPending,
				filtroActivo: filtro,
				onFiltro: (clave) => {
					setFiltro((prev) => (prev === clave ? null : clave));
					setPage(1);
				},
				expandida: agendaAbierta,
				onExpandida: setAgendaAbierta,
				proximos: {
					cargando: proximosQueries.some((q) => q.isPending),
					error: proximosQueries.some((q) => q.isError),
					sinAsesor: proximosDias.some((d) => d.data?.sinAsesor),
					ausente: proximosDias.some((d) => d.data?.ausente),
					dias: proximosDias.map(({ dia, total, items }) => ({
						dia,
						total,
						items,
					})),
				},
				seguimientos: {
					cargando: seguimientosQuery.isPending,
					items: seguimientos,
				},
				onAbrirFicha: abrirFicha,
			}}
			desempeno={{
				periodo,
				onPeriodo: setPeriodo,
				desempeno: desempenoData,
				cargando: desempenoQuery.isPending,
				error: desempenoQuery.isError,
				onReintentar: () => desempenoQuery.refetch(),
				moraCartera,
				cargandoMora: statsQuery.isPending,
				metas: calcularMetasMora((metasQuery.data ?? []) as MetaMora[], stats),
				mesMetas: ahora.toLocaleDateString("es-GT", {
					month: "long",
					year: "numeric",
				}),
			}}
			distribucion={{
				items: statsQuery.data
					? calcularDistribucion(perfil?.buckets ?? [], stats)
					: [],
				resumen: statsQuery.data
					? {
							asignados: statsQuery.data.totalCasosAsignados ?? 0,
							alDia: statsQuery.data.efectividad
								? Number.parseFloat(statsQuery.data.efectividad)
								: null,
							capital: stats.reduce(
								(t, s) => t + Number(s.sumaCapital || 0),
								0,
							),
							contactosHoy: statsQuery.data.contactosHoy ?? 0,
						}
					: undefined,
				cargando: statsQuery.isPending,
				error: statsQuery.isError,
				onReintentar: () => statsQuery.refetch(),
				sinCartera: !!perfil?.sinAsesor,
				onBucket: (bucket) => irACartera({ bucket }),
			}}
			casos={{
				estado: estadoCasos,
				filas,
				total: cola?.total ?? 0,
				page,
				perPage: PER_PAGE,
				totalPages,
				onPage: setPage,
				actualizando: colaQuery.isFetching && colaQuery.isPlaceholderData,
				filtro: filtro ? etiquetaContador(filtro) : null,
				onQuitarFiltro: () => {
					setFiltro(null);
					setPage(1);
				},
				onReintentar: () => colaQuery.refetch(),
				onVerCartera: () => irACartera(),
				onVistaRapida: setVistaRapida,
			}}
			panel={
				<PanelGestionRapida
					creditoId={vistaRapida}
					open={!!vistaRapida}
					onClose={() => setVistaRapida(null)}
				/>
			}
		/>
	);
}
