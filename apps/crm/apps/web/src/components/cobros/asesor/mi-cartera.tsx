import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Clock, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ReasignarBloqueDialog } from "@/components/cobros/cartera-general/reasignar-bloque";
import {
	etiquetaSegmento,
	mismoSegmento,
	type SearchSegmento,
	type Segmento,
	searchDeSegmento,
	segmentoDeSearch,
} from "@/components/cobros/cartera-general/segmentos";
import {
	useAsesoresCartera,
	useCarteraGeneral,
} from "@/components/cobros/cartera-general/use-cartera-general";
import type { SupervisionCartera } from "@/components/cobros/cartera-general/vista-supervision";
import { ConfigurarSlaModal } from "@/components/cobros/configurar-sla-modal";
import { MassWhatsappModal } from "@/components/cobros/mass-whatsapp-modal";
import { PanelGestionRapida } from "@/components/cobros/panel-gestion-rapida";
import {
	useWorkspaceCasos,
	WorkspaceModal,
} from "@/components/cobros/workspace/workspace-modal";
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
import { destinoFicha, type FilaCartera } from "./fila-cartera";
import {
	BUCKETS_CARTERA,
	bucketDeEstadoMora,
	contarFiltrosActivos,
	ESTADO_POR_BUCKET,
	ETAPAS_MORA,
	ETIQUETA_LABELS,
	FILTROS_INICIALES,
	type FiltroGestionCartera,
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
 * - Supervisión y admin (`canAssignCobros`, los dos por igual) ven la «Cartera
 *   general» (Figma 2262:12): además `?asesor=<asesor_id de cartera>` y un
 *   segmento `?cola=` / `?promesa=` / `?convenio=` (la Cola del día y las Alertas
 *   de promesas y de convenios, que dejaron de ser páginas sueltas), selección
 *   múltiple con «Reasignar en bloque» y «Configurar SLA». Para el asesor esos
 *   parámetros se ignoran y la pantalla no cambia.
 */

export type CarteraSearch = {
	bucket?: Bucket;
	gestion?: FiltroGestionCartera;
	q?: string;
	/** Solo supervisión: asesor_id de cartera. */
	asesor?: number;
} & SearchSegmento;

const K = (k: string) => `cobros/cartera/${k}`;

/**
 * Antes de que los `usePersistedState` lean sessionStorage: si la URL trae
 * filtros, se escriben ahí (así la primera consulta ya sale filtrada).
 */
function aplicarUrl(search: CarteraSearch) {
	const segmento = segmentoDeSearch(search);
	if (
		search.bucket === undefined &&
		search.gestion === undefined &&
		search.q === undefined &&
		search.asesor === undefined &&
		segmento === null
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
		const asesor = search.asesor ?? null;
		const cambio =
			leer("etapa") !== etapa ||
			leer("gestion") !== gestion ||
			(leer("busqueda") ?? "") !== busqueda ||
			leer("asesor") !== asesor ||
			!mismoSegmento(leer("segmento"), segmento);
		if (!cambio) return;
		const escribir = (k: string, v: unknown) =>
			v === null
				? sessionStorage.removeItem(K(k))
				: sessionStorage.setItem(K(k), JSON.stringify(v));
		escribir("etapa", etapa);
		escribir("gestion", gestion);
		escribir("busqueda", busqueda);
		escribir("asesor", asesor);
		escribir("segmento", segmento);
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
	// Supervisión y admin: Cartera general (los dos roles por igual).
	const esSup = PERMISSIONS.canAssignCobros(userRole);
	const emailCobrador = !esSup ? session?.user?.email : undefined;

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
	const [gestionGuardada, setGestion] =
		usePersistedState<FiltroGestionCartera | null>(K("gestion"), null);
	// «Sin acuerdo» es solo de supervisión: el asesor no lo tiene.
	const gestion =
		!esSup && gestionGuardada === "sin_acuerdo" ? null : gestionGuardada;
	// Solo supervisión (para el asesor se ignoran).
	const [asesorGuardado, setAsesorId] = usePersistedState<number | null>(
		K("asesor"),
		null,
	);
	const [segmentoGuardado, setSegmento] = usePersistedState<Segmento | null>(
		K("segmento"),
		null,
	);
	const asesorId = esSup ? asesorGuardado : null;
	const segmento = esSup ? segmentoGuardado : null;
	const [busqueda, setBusqueda] = usePersistedState<string>(K("busqueda"), "");
	const [page, setPage] = usePersistedState<number>(K("page"), 1);
	const [pageSize, setPageSize] = usePersistedState<number>(K("pageSize"), 25);
	const [orden, setOrden] = usePersistedState<OrdenCartera>(
		K("orden"),
		ORDEN_INICIAL,
	);
	const [panel, setPanel] = useState<string | null>(null);

	// Workspace: al cerrarlo se refresca la página de la cartera (y la cola del
	// resumen) para que la tabla refleje las gestiones nuevas.
	const queryClient = useQueryClient();
	const refrescarCartera = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: orpc.getTodosLosCreditos.key(),
		});
		void queryClient.invalidateQueries({ queryKey: orpc.getColaDia.key() });
	}, [queryClient]);
	const workspace = useWorkspaceCasos({ alCerrar: refrescarCartera });

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
		if ("gestion" in c) {
			setGestion(c.gestion ?? null);
			// Gestión y segmento son excluyentes.
			if (c.gestion) setSegmento(null);
		}
		// Búsqueda y SIFCO resetean la página al aplicarse (tras el debounce).
		if ("busqueda" in c) setBusqueda(c.busqueda ?? "");
		if ("sifco" in c) setSifco(c.sifco ?? "");
		const soloTexto = Object.keys(c).every(
			(k) => k === "busqueda" || k === "sifco",
		);
		if (!soloTexto) setPage(1);
	};

	const limpiar = () => {
		cambiar(FILTROS_INICIALES);
		setSegmento(null);
		setAsesorId(null);
	};

	const cambiarSegmento = (s: Segmento | null) => {
		setSegmento(s);
		if (s) setGestion(null);
		setPage(1);
	};
	const cambiarAsesor = (id: number | null) => {
		setAsesorId(id);
		setPage(1);
	};

	/* ── URL al día con bucket / gestión / búsqueda (y asesor / segmento) ─ */
	const bucketUrl = bucketDeEstadoMora(etapa) ?? undefined;
	const conSesion = !!session;
	useEffect(() => {
		// Sin sesión todavía no se sabe el rol: no tocar ?asesor ni el segmento.
		if (!conSesion) return;
		const q = busquedaDeb || undefined;
		const g = gestion ?? undefined;
		const a = asesorId ?? undefined;
		const seg = searchDeSegmento(segmento);
		if (
			search.bucket === bucketUrl &&
			search.gestion === g &&
			search.q === q &&
			search.asesor === a &&
			search.cola === seg.cola &&
			search.promesa === seg.promesa &&
			search.convenio === seg.convenio
		) {
			return;
		}
		navigate({
			to: "/cobros/cartera",
			search: {
				...(bucketUrl ? { bucket: bucketUrl } : {}),
				...(g ? { gestion: g } : {}),
				...(q ? { q } : {}),
				...(a ? { asesor: a } : {}),
				...seg,
			},
			replace: true,
		});
	}, [
		conSesion,
		bucketUrl,
		gestion,
		busquedaDeb,
		asesorId,
		segmento,
		search,
		navigate,
	]);

	/* ── Asesores (Cartera general) ────────────────────────────────────── */
	const asesoresCartera = useAsesoresCartera(!!session && esSup);
	const asesorElegido =
		asesorId === null
			? undefined
			: asesoresCartera.todos.find((a) => a.asesorId === asesorId);
	// Con ?asesor= las consultas esperan a tener el correo de ese asesor, porque
	// sin él `emailCobrador` queda vacío y el server devuelve todo el equipo.
	// Si el catálogo falla o el asesor no aparece, se falla cerrado: sin
	// consultas, sin filas y con error, nunca la cartera completa con el filtro.
	const asesorResuelto = asesorId === null || !!asesorElegido?.email;
	const asesorSinResolver =
		asesorId !== null && asesoresCartera.listo && !asesorElegido?.email;
	const emailConsulta = esSup
		? (asesorElegido?.email ?? undefined)
		: emailCobrador;

	/* ── Consultas ─────────────────────────────────────────────────────── */
	const perfilQ = useQuery({
		...orpc.getMiPerfilCobros.queryOptions(),
		enabled: !!session,
	});
	const perfil = perfilQ.data;
	const sinAsesor = !!perfil && perfil.sinAsesor && !perfil.esSupervision;

	const statsQ = useQuery({
		...orpc.getCobrosDashboardStats.queryOptions({
			input: { emailCobrador: emailConsulta },
		}),
		enabled: !!session && !sinAsesor && asesorResuelto,
	});

	// Total de la cola (y, en supervisión, los conteos por categoría para el
	// selector de segmentos, del asesor elegido si hay uno).
	const colaQ = useQuery({
		...orpc.getColaDia.queryOptions({
			input: { page: 1, perPage: 1, asesorId: asesorId ?? undefined },
		}),
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

	const filtrosCreditos = {
		estadoMora: etapa || undefined,
		searchTerm: busquedaDeb || undefined,
		numeroSifco: sifcoDeb || undefined,
		time,
		fechaDesde,
		fechaHasta,
		etiquetas: etiquetasInput,
		capitalMin,
		capitalMax,
		excluirPagadosMes: excluirPagados || undefined,
	};

	// Cartera general con un segmento: la tabla sale de la fuente del segmento
	// (ver use-cartera-general.ts). Sin segmento, la consulta de siempre.
	const general = useCarteraGeneral({
		habilitado: !!session && esSup && asesorResuelto,
		asesorId,
		asesor: asesorElegido,
		segmento,
		filtros: filtrosCreditos,
		periodo,
		etapa,
		orden,
		page,
		pageSize,
		hayOtrosFiltros:
			contarFiltrosActivos({
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
			}) > 0,
	});
	const seg = general.resultado;

	// «Sin acuerdo» (Figma) todavía no lo filtra el servidor (tarea S5): se
	// pide la cartera sin él y se filtra la página.
	const gestionServidor =
		gestion && gestion !== "sin_acuerdo" ? gestion : undefined;
	const creditosQ = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				...filtrosCreditos,
				limit: pageSize,
				offset: (page - 1) * pageSize,
				emailCobrador: emailConsulta,
				filtroGestion: gestionServidor,
			},
		}),
		enabled: !!session && !sinAsesor && !segmento && asesorResuelto,
		placeholderData: keepPreviousData,
	});

	const total = asesorSinResolver
		? 0
		: seg
			? seg.total
			: (creditosQ.data?.total ?? 0);
	const totalPaginas = seg ? seg.totalPaginas : creditosQ.data?.totalPages || 1;
	const datosListos = seg ? !seg.cargando : !!creditosQ.data;

	// Si los filtros achican el total, no quedarse en una página que ya no existe.
	useEffect(() => {
		if (datosListos && page > totalPaginas) setPage(totalPaginas);
	}, [datosListos, page, totalPaginas, setPage]);

	const filasBase = useMemo(() => {
		const refinadas = refinarPagina(creditosQ.data?.data ?? [], {
			periodo,
			etapa,
		});
		return ordenarPagina(
			gestion === "sin_acuerdo"
				? refinadas.filter((f) => f.estadoGestion === "sin_acuerdo")
				: refinadas,
			orden,
		);
	}, [creditosQ.data, periodo, etapa, orden, gestion]);
	const filas = asesorSinResolver ? [] : seg ? seg.filas : filasBase;

	/* ── Selección múltiple y reasignación en bloque ───────────────────── */
	const [seleccion, setSeleccion] = useState<Map<string, FilaCartera>>(
		() => new Map(),
	);
	const [reasignarAbierto, setReasignarAbierto] = useState(false);
	const [slaAbierto, setSlaAbierto] = useState(false);
	const seleccionar = (ids: string[], marcar: boolean) =>
		setSeleccion((previa) => {
			const nueva = new Map(previa);
			for (const id of ids) {
				const fila = filas.find((f) => f.contratoId === id);
				if (marcar && fila) nueva.set(id, fila);
				else nueva.delete(id);
			}
			return nueva;
		});

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
	// Tampoco conoce el asesor elegido ni los segmentos de la Cartera general.
	const filtroNoSoportado = segmento
		? `«${etiquetaSegmento(segmento)}»`
		: asesorId !== null
			? "el filtro por asesor"
			: gestion
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

	const error = asesorSinResolver
		? asesoresCartera.fallo
			? "No se pudo cargar la lista de asesores, así que la cartera no se puede filtrar por el asesor elegido."
			: "El asesor elegido no aparece en cartera o no tiene correo de Cash-In: la cartera no se puede filtrar por él. Elija otro asesor o quite el filtro."
		: seg
			? seg.error
			: creditosQ.isError
				? creditosQ.error instanceof Error && creditosQ.error.message
					? creditosQ.error.message
					: "Intente de nuevo en unos minutos."
				: null;

	/* ── Cartera general (supervisión y admin) ─────────────────────────── */
	const datosCola = colaQ.data as
		| {
				total?: number;
				conteos?: Record<string, number>;
				conteosExtra?: Record<string, number>;
		  }
		| undefined;
	const avisos = [...(seg?.avisos ?? [])];
	if (!seg && gestion === "sin_acuerdo") {
		avisos.push(
			"«Sin acuerdo» se aplica sobre la página visible: el total y las demás páginas todavía no lo descuentan.",
		);
	}
	const supervision: SupervisionCartera | undefined = esSup
		? {
				asesores: asesoresCartera.activos,
				asesoresCargando: asesoresCartera.cargando,
				asesorId,
				onAsesor: cambiarAsesor,
				segmento,
				onSegmento: cambiarSegmento,
				conteos: {
					cola: datosCola
						? {
								todas: datosCola.total,
								...datosCola.conteos,
								...datosCola.conteosExtra,
							}
						: {},
					...general.conteos,
				},
				detalles: seg?.detalles,
				avisos,
				sinFila: seg?.sinFila,
				seleccion: new Set(seleccion.keys()),
				onSeleccionar: seleccionar,
				onLimpiarSeleccion: () => setSeleccion(new Map()),
				onReasignar: () => {
					if (asesorSinResolver) return;
					if (seleccion.size === 0) {
						toast.info(
							"Seleccione en la tabla los créditos que desea reasignar.",
						);
						return;
					}
					setReasignarAbierto(true);
				},
				herramientas: (
					<ToolbarButton icon={Clock} onClick={() => setSlaAbierto(true)}>
						Configurar SLA
					</ToolbarButton>
				),
				onAtencionHoy: () => cambiarSegmento({ tipo: "cola", valor: "todas" }),
			}
		: undefined;

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
				cargando={
					asesorSinResolver
						? false
						: seg
							? seg.cargando
							: creditosQ.isLoading || !asesorResuelto
				}
				actualizando={seg ? seg.actualizando : creditosQ.isPlaceholderData}
				error={error}
				onReintentar={() =>
					asesorSinResolver
						? asesoresCartera.refetch()
						: seg
							? seg.refetch()
							: creditosQ.refetch()
				}
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
				// El Workspace navega la página visible, en el orden de la tabla.
				onAbrir={(i) =>
					workspace.abrir(
						filas.map((f) => ({
							...destinoFicha(f),
							nombre: f.clienteNombre ?? undefined,
						})),
						i,
					)
				}
				supervision={supervision}
			/>
			<PanelGestionRapida
				creditoId={panel}
				open={!!panel}
				onClose={() => setPanel(null)}
			/>
			<WorkspaceModal {...workspace.modal} />
			{esSup ? (
				<>
					<ReasignarBloqueDialog
						open={reasignarAbierto}
						onOpenChange={setReasignarAbierto}
						filas={[...seleccion.values()]}
						asesores={asesoresCartera.activos}
						onTerminado={() => setSeleccion(new Map())}
					/>
					{/* Vivía en la Cola del día; ahora en la barra de la cartera. */}
					<ConfigurarSlaModal
						open={slaAbierto}
						onOpenChange={setSlaAbierto}
						catalogo={bucketsCatalogo.data}
					/>
				</>
			) : null}
		</>
	);
}
