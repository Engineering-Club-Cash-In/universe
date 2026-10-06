import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MassWhatsappModal } from "@/components/cobros/mass-whatsapp-modal";
import { PanelGestionRapida } from "@/components/cobros/panel-gestion-rapida";
import type { Bucket } from "@/components/ds/badges";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { usePersistedState } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";
import {
	bucketsParaRender,
	labelBucketConCodigo,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";
import {
	BUCKETS_CARTERA,
	bucketDeEstadoMora,
	ESTADO_POR_BUCKET,
	ETAPAS_MORA,
	ETIQUETA_LABELS,
	FILTROS_INICIALES,
	type FiltroGestion,
	type FiltrosCartera,
	fechasDelRango,
	GESTION_LABEL,
	ORDEN_INICIAL,
	type OrdenCartera,
	ordenarPagina,
	type PeriodoCartera,
	refinarPagina,
	TIME_POR_PERIODO,
} from "./filtros-cartera";
import {
	MiCarteraVista,
	type ResumenCartera,
	TAMANOS_PAGINA,
} from "./mi-cartera-vista";

/**
 * Contenedor de Mi Cartera (/cobros/cartera): consultas, estado y persistencia.
 * La presentación está en `mi-cartera-vista.tsx`.
 *
 * - Filtros, página, tamaño y orden en sessionStorage (`cobros/cartera/*`): volver
 *   de la Ficha 360 conserva todo.
 * - `?bucket`, `?gestion` y `?q` (links del Dashboard) mandan sobre lo guardado
 *   cuando vienen en la URL; la URL se mantiene al día con lo elegido para que
 *   "atrás" del navegador vuelva al mismo filtro.
 */

export type CarteraSearch = {
	bucket?: Bucket;
	gestion?: FiltroGestion;
	q?: string;
};

const K = (k: string) => `cobros/cartera/${k}`;

/**
 * Antes de que los `usePersistedState` lean sessionStorage: si la URL trae
 * filtros, se escriben ahí (así la primera consulta ya sale filtrada).
 */
function aplicarUrl(search: CarteraSearch) {
	if (
		search.bucket === undefined &&
		search.gestion === undefined &&
		search.q === undefined
	) {
		return;
	}
	try {
		const leer = (k: string) => {
			const v = sessionStorage.getItem(K(k));
			return v === null ? null : JSON.parse(v);
		};
		const etapa = search.bucket ? ESTADO_POR_BUCKET[search.bucket] : null;
		const gestion = search.gestion ?? null;
		const busqueda = search.q ?? "";
		const cambio =
			leer("etapa") !== etapa ||
			leer("gestion") !== gestion ||
			(leer("busqueda") ?? "") !== busqueda;
		if (!cambio) return;
		const escribir = (k: string, v: unknown) =>
			v === null
				? sessionStorage.removeItem(K(k))
				: sessionStorage.setItem(K(k), JSON.stringify(v));
		escribir("etapa", etapa);
		escribir("gestion", gestion);
		escribir("busqueda", busqueda);
		escribir("page", 1);
	} catch {
		// sessionStorage no disponible: se usan los valores por defecto.
	}
}

function useDebounced<T>(valor: T, ms: number, alCambiar?: () => void) {
	const [debounced, setDebounced] = useState(valor);
	useEffect(() => {
		if (Object.is(valor, debounced)) return;
		const t = setTimeout(() => {
			setDebounced(valor);
			alCambiar?.();
		}, ms);
		return () => clearTimeout(t);
	}, [valor, debounced, ms, alCambiar]);
	return debounced;
}

export function MiCartera({ search }: { search: CarteraSearch }) {
	// Debe ir antes que los usePersistedState (ver aplicarUrl).
	useState(() => {
		aplicarUrl(search);
		return true;
	});
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role ?? "";
	const emailCobrador = !PERMISSIONS.canAssignCobros(userRole)
		? session?.user?.email
		: undefined;

	/* ── Estado persistido ─────────────────────────────────────────────── */
	const [periodo, setPeriodo] = usePersistedState<PeriodoCartera>(
		K("periodo"),
		FILTROS_INICIALES.periodo,
	);
	const [rango, setRango] = usePersistedDateRange(K("rango"));
	const [etapa, setEtapa] = usePersistedState<string | null>(K("etapa"), null);
	const [etiquetas, setEtiquetas] = usePersistedState<string[]>(
		K("etiquetas"),
		[],
	);
	const [capitalMin, setCapitalMin] = usePersistedState<number | undefined>(
		K("capitalMin"),
		undefined,
	);
	const [capitalMax, setCapitalMax] = usePersistedState<number | undefined>(
		K("capitalMax"),
		undefined,
	);
	const [excluirPagados, setExcluirPagados] = usePersistedState<boolean>(
		K("excluirPagados"),
		false,
	);
	const [sifco, setSifco] = usePersistedState<string>(K("sifco"), "");
	const [gestion, setGestion] = usePersistedState<FiltroGestion | null>(
		K("gestion"),
		null,
	);
	const [busqueda, setBusqueda] = usePersistedState<string>(K("busqueda"), "");
	const [page, setPage] = usePersistedState<number>(K("page"), 1);
	const [pageSize, setPageSize] = usePersistedState<number>(K("pageSize"), 25);
	const [orden, setOrden] = usePersistedState<OrdenCartera>(
		K("orden"),
		ORDEN_INICIAL,
	);
	const [panel, setPanel] = useState<string | null>(null);

	const irAPrimera = useMemo(() => () => setPage(1), [setPage]);
	// Debounce de 1 s (como antes). La página vuelve a 1 solo si el texto cambió.
	const busquedaDeb = useDebounced(busqueda, 1000, irAPrimera);
	const sifcoDeb = useDebounced(sifco, 1000, irAPrimera);

	const filtros: FiltrosCartera = {
		periodo,
		rango,
		etapa,
		etiquetas,
		capitalMin,
		capitalMax,
		excluirPagados,
		sifco,
		gestion,
		busqueda,
	};

	const cambiar = (c: Partial<FiltrosCartera>) => {
		if ("periodo" in c && c.periodo) setPeriodo(c.periodo);
		if ("rango" in c) setRango(c.rango);
		if ("etapa" in c) setEtapa(c.etapa ?? null);
		if ("etiquetas" in c && c.etiquetas) setEtiquetas(c.etiquetas);
		if ("capitalMin" in c) setCapitalMin(c.capitalMin);
		if ("capitalMax" in c) setCapitalMax(c.capitalMax);
		if ("excluirPagados" in c) setExcluirPagados(!!c.excluirPagados);
		if ("gestion" in c) setGestion(c.gestion ?? null);
		// Búsqueda y SIFCO resetean la página al aplicarse (tras el debounce).
		if ("busqueda" in c) setBusqueda(c.busqueda ?? "");
		if ("sifco" in c) setSifco(c.sifco ?? "");
		const soloTexto = Object.keys(c).every(
			(k) => k === "busqueda" || k === "sifco",
		);
		if (!soloTexto) setPage(1);
	};

	const limpiar = () => cambiar(FILTROS_INICIALES);

	/* ── URL al día con bucket / gestión / búsqueda ────────────────────── */
	const bucketUrl = bucketDeEstadoMora(etapa) ?? undefined;
	useEffect(() => {
		const q = busquedaDeb || undefined;
		const g = gestion ?? undefined;
		if (search.bucket === bucketUrl && search.gestion === g && search.q === q) {
			return;
		}
		navigate({
			to: "/cobros/cartera",
			search: {
				...(bucketUrl ? { bucket: bucketUrl } : {}),
				...(g ? { gestion: g } : {}),
				...(q ? { q } : {}),
			},
			replace: true,
		});
	}, [bucketUrl, gestion, busquedaDeb, search, navigate]);

	/* ── Consultas ─────────────────────────────────────────────────────── */
	const perfilQ = useQuery({
		...orpc.getMiPerfilCobros.queryOptions(),
		enabled: !!session,
	});
	const perfil = perfilQ.data;
	const sinAsesor = !!perfil && perfil.sinAsesor && !perfil.esSupervision;

	const statsQ = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions({ input: { emailCobrador } }),
		enabled: !!session && !sinAsesor,
	});

	const colaQ = useQuery({
		...orpc.getColaDia.queryOptions({ input: { page: 1, perPage: 1 } }),
		enabled: !!session && !!perfil && !sinAsesor,
	});

	const bucketsCatalogo = useBucketsCatalogo();
	const etapas = useMemo(
		() =>
			bucketsParaRender(bucketsCatalogo.data, ETAPAS_MORA).map((b) => ({
				key: b.key,
				label: labelBucketConCodigo(b),
			})),
		[bucketsCatalogo.data],
	);

	// En el filtro "Etapa de mora" el asesor solo ve los buckets de su pool
	// (junior B0–B1, senior B2–B4) más las etapas que no son bucket (en
	// convenio, incobrable, pendiente de cancelación, completado). Supervisión
	// ve todas. La lista completa se sigue usando para las etiquetas.
	const etapasFiltro = useMemo(() => {
		if (!perfil || perfil.esSupervision || perfil.buckets.length === 0)
			return etapas;
		const propias = new Set(
			perfil.buckets.map(
				(n) => ESTADO_POR_BUCKET[BUCKETS_CARTERA[n] ?? "B0"] ?? "",
			),
		);
		const deBucket = new Set(Object.values(ESTADO_POR_BUCKET));
		return etapas.filter((e) => !deBucket.has(e.key) || propias.has(e.key));
	}, [etapas, perfil]);

	const { fechaDesde, fechaHasta } = fechasDelRango(rango);
	const time = fechaDesde || fechaHasta ? undefined : TIME_POR_PERIODO[periodo];
	const etiquetasInput = etiquetas.length > 0 ? etiquetas : undefined;

	const creditosQ = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				limit: pageSize,
				offset: (page - 1) * pageSize,
				estadoMora: etapa || undefined,
				searchTerm: busquedaDeb || undefined,
				numeroSifco: sifcoDeb || undefined,
				time,
				emailCobrador,
				fechaDesde,
				fechaHasta,
				etiquetas: etiquetasInput,
				capitalMin,
				capitalMax,
				excluirPagadosMes: excluirPagados || undefined,
				filtroGestion: gestion ?? undefined,
			},
		}),
		enabled: !!session && !sinAsesor,
		placeholderData: keepPreviousData,
	});

	const total = creditosQ.data?.total ?? 0;
	const totalPaginas = creditosQ.data?.totalPages || 1;

	// Si los filtros achican el total, no quedarse en una página que ya no existe.
	useEffect(() => {
		if (creditosQ.data && page > totalPaginas) setPage(totalPaginas);
	}, [creditosQ.data, page, totalPaginas, setPage]);

	const filas = useMemo(
		() =>
			ordenarPagina(
				refinarPagina(creditosQ.data?.data ?? [], { periodo, etapa }),
				orden,
			),
		[creditosQ.data, periodo, etapa, orden],
	);

	/* ── Resumen operativo ─────────────────────────────────────────────── */
	const stats = statsQ.data;
	const porBucket: Partial<Record<Bucket, number>> = {};
	for (const s of stats?.estatusStats ?? []) {
		const b = bucketDeEstadoMora(s.estadoMora);
		if (b) porBucket[b] = s.totalCases;
	}
	const efectividad = stats ? Number(stats.efectividad) : Number.NaN;
	const resumen: ResumenCartera = {
		asignados: stats ? stats.totalCasosAsignados : null,
		atencionHoy: colaQ.data && !colaQ.data.sinAsesor ? colaQ.data.total : null,
		alDia: Number.isFinite(efectividad) ? efectividad : null,
		cargando: statsQ.isLoading || (!!perfil && !sinAsesor && colaQ.isLoading),
		parcial: stats?.fuente != null && stats.fuente !== "cartera-back",
		porBucket,
	};

	/* ── WhatsApp masivo (mismos filtros/props que antes) ──────────────── */
	const botonWhatsapp = (disabled?: boolean) => (
		<ToolbarButton icon={MessageCircle} disabled={disabled}>
			Enviar WhatsApp masivo
		</ToolbarButton>
	);
	// El envío masivo filtra en el servidor con los filtros de siempre y no
	// conoce los chips de gestión ni el rango de capital: mandarlo así llegaría a
	// más clientes de los que se ven. Se bloquea (el envío masivo va de salida;
	// lo importante es que nunca escriba a quien no corresponde).
	const filtroNoSoportado = gestion
		? `«${GESTION_LABEL[gestion]}»`
		: capitalMin !== undefined || capitalMax !== undefined
			? "el rango de capital"
			: null;
	const accionMasiva = filtroNoSoportado ? (
		<Tooltip>
			<TooltipTrigger asChild>
				<span>{botonWhatsapp(true)}</span>
			</TooltipTrigger>
			<TooltipContent>
				El envío masivo no aplica {filtroNoSoportado}. Quite ese filtro para
				enviar.
			</TooltipContent>
		</Tooltip>
	) : (
		<MassWhatsappModal
			filtros={{
				estadoMora: etapa || undefined,
				searchTerm: busquedaDeb || undefined,
				numeroSifco: sifcoDeb || undefined,
				time,
				etiquetas: etiquetasInput,
				fechaDesde,
				fechaHasta,
				excluirPagadosMes: excluirPagados || undefined,
			}}
			etiquetaLabels={ETIQUETA_LABELS}
			totalDestinatarios={total}
		>
			{botonWhatsapp()}
		</MassWhatsappModal>
	);

	const error = creditosQ.isError
		? creditosQ.error instanceof Error && creditosQ.error.message
			? creditosQ.error.message
			: "Intente de nuevo en unos minutos."
		: null;

	return (
		<>
			<MiCarteraVista
				perfil={
					perfil
						? {
								esSupervision: perfil.esSupervision,
								sinAsesor: perfil.sinAsesor,
								buckets: perfil.buckets,
							}
						: perfilQ.isError
							? // Sin perfil no se sabe el bucket: se muestra la cartera igual.
								{
									esSupervision: PERMISSIONS.canAssignCobros(userRole),
									sinAsesor: false,
									buckets: [],
								}
							: undefined
				}
				resumen={resumen}
				filtros={filtros}
				onCambiarFiltros={cambiar}
				onLimpiarFiltros={limpiar}
				etapas={etapas}
				etapasFiltro={etapasFiltro}
				filas={filas}
				total={total}
				cargando={creditosQ.isLoading}
				actualizando={creditosQ.isPlaceholderData}
				error={error}
				onReintentar={() => creditosQ.refetch()}
				pagina={Math.min(page, totalPaginas)}
				totalPaginas={totalPaginas}
				tamanoPagina={TAMANOS_PAGINA.includes(pageSize) ? pageSize : 25}
				onPagina={setPage}
				onTamanoPagina={(t) => {
					setPageSize(t);
					setPage(1);
				}}
				orden={orden}
				onOrden={setOrden}
				accionMasiva={accionMasiva}
				onVistaRapida={setPanel}
			/>
			<PanelGestionRapida
				creditoId={panel}
				open={!!panel}
				onClose={() => setPanel(null)}
			/>
		</>
	);
}
