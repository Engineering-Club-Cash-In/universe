/**
 * /cobros/solicitudes: la bandeja única de lo que espera la decisión del
 * supervisor (Pendientes) y el Historial de decisiones. Reemplaza a
 * /cobros/inmovilizaciones y /cobros/recuperaciones (que redirigen aquí); los
 * convenios por aprobar se deciden aquí y /cobros/convenios queda como
 * catálogo.
 *
 *  - `SolicitudesPaginaVista`: migas, título, subtítulo y pestañas.
 *  - `SolicitudesPagina`: el contenedor con las consultas.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import * as React from "react";
import { MAX_FILAS_BITACORA } from "server/src/lib/bitacora-supervision";
import { DecisionPorConfirmarBanner } from "@/components/cobros/decision-por-confirmar-banner";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";
import {
	BandejaSolicitudes,
	type FiltroTipoSolicitud,
} from "./bandeja-solicitudes";
import {
	EspacioAprobacion,
	useEspacioAprobacion,
	useIntentosConvenio,
} from "./espacio-aprobacion";
import {
	type EntradaBitacora,
	type EntradaHistorial,
	entradaDeBitacora,
	type FiltrosHistorial,
	filtroServidorHistorial,
} from "./historial";
import { HistorialDecisiones } from "./historial-decisiones";
import { DetalleHistorialConectado } from "./historial-detalle";
import type { SolicitudesSearch, TabSolicitudes } from "./search";
import {
	BITACORA_POR_PAGINA,
	MAX_PAGINAS_HISTORIAL,
	useBitacoraDecisiones,
	useSolicitudesPendientes,
} from "./use-solicitudes";

/* ── Vista ──────────────────────────────────────────────────────────────────── */

export function SolicitudesPaginaVista({
	tab,
	onTab,
	pendientes,
	children,
}: {
	tab: TabSolicitudes;
	onTab: (tab: TabSolicitudes) => void;
	/** Conteo de la pestaña Pendientes; null mientras carga. */
	pendientes: number | null;
	children: React.ReactNode;
}) {
	const esHistorial = tab === "historial";
	return (
		<div className="flex flex-col gap-4 px-4 py-6 sm:px-8 sm:py-7">
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink asChild>
							<Link to="/cobros">Dashboard</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>Solicitudes</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			<header className="flex flex-col gap-1">
				<h1 className="font-semibold text-[28px] text-fg leading-9">
					{esHistorial ? "Historial de decisiones" : "Solicitudes pendientes"}
				</h1>
				<p className="type-body-base text-fg-secondary">
					{esHistorial
						? "Aprobaciones y acciones del supervisor · las más recientes primero"
						: `${pendientes === null ? "…" : pendientes.toLocaleString("es-GT")} ${pendientes === 1 ? "solicitud" : "solicitudes"} · de sus asesores · las más recientes primero`}
				</p>
			</header>

			<Tabs value={tab} onValueChange={(v) => onTab(v as TabSolicitudes)}>
				<TabsList>
					<TabsTrigger value="pendientes" count={pendientes ?? undefined}>
						Pendientes
					</TabsTrigger>
					<TabsTrigger value="historial">Historial</TabsTrigger>
				</TabsList>
			</Tabs>

			{children}
		</div>
	);
}

/* ── Contenedor ─────────────────────────────────────────────────────────────── */

/** Aviso chico arriba de la tabla del Historial. */
function NotaHistorial({ children }: { children: React.ReactNode }) {
	return (
		<p className="type-caption flex items-start gap-2 text-fg-tertiary">
			<Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
			<span className="wrap-break-word min-w-0">{children}</span>
		</p>
	);
}

/** Espera tras la última tecla antes de buscar en el servidor. */
const ESPERA_BUSQUEDA_MS = 350;

/**
 * La pestaña Historial: la bitácora del servidor con sus filtros, su búsqueda
 * y su paginación. Solo se monta con la pestaña abierta.
 */
function HistorialConectado({
	search,
	onSearch,
}: {
	search: SolicitudesSearch;
	onSearch: (cambio: Partial<SolicitudesSearch>) => void;
}) {
	const [busqueda, setBusqueda] = React.useState("");
	// Lo que se manda al servidor: la búsqueda, cuando se deja de escribir.
	const [busquedaServidor, setBusquedaServidor] = React.useState("");
	React.useEffect(() => {
		const t = setTimeout(
			() => setBusquedaServidor(busqueda.trim()),
			ESPERA_BUSQUEDA_MS,
		);
		return () => clearTimeout(t);
	}, [busqueda]);
	const [asesorId, setAsesorId] = React.useState<string | null>(null);
	const [rango, setRango] = React.useState<{
		desde: string | null;
		hasta: string | null;
	}>({ desde: null, hasta: null });
	const [pagina, setPagina] = React.useState(1);

	const filtros: FiltrosHistorial = {
		vista: search.vista ?? "todas",
		tipo: search.tipo ?? "todas",
		estado: search.estado ?? "todos",
		busqueda,
		asesorId,
		desde: rango.desde,
		hasta: rango.hasta,
	};
	const servidor = filtroServidorHistorial({
		...filtros,
		busqueda: busquedaServidor,
	});
	const claveFiltros = JSON.stringify(servidor);
	// Otros filtros: de vuelta a la primera página.
	// biome-ignore lint/correctness/useExhaustiveDependencies: se dispara al cambiar los filtros del servidor
	React.useEffect(() => setPagina(1), [claveFiltros]);

	const bitacora = useBitacoraDecisiones(servidor, pagina, true);
	const usuarios = useQuery({
		...orpc.getUsuariosCobros.queryOptions(),
		staleTime: 5 * 60 * 1000,
	});

	const asesores = React.useMemo(
		() =>
			(usuarios.data ?? [])
				.map((u) => ({ value: u.id, label: u.name }))
				.sort((a, b) => a.label.localeCompare(b.label, "es")),
		[usuarios.data],
	);

	const datos = servidor.vacio ? null : bitacora.data;
	const entradas: EntradaHistorial[] = (
		(datos?.items ?? []) as EntradaBitacora[]
	).map(entradaDeBitacora);
	const total = servidor.vacio ? 0 : (datos?.total ?? null);
	const totalPaginas = Math.min(datos?.totalPages ?? 1, MAX_PAGINAS_HISTORIAL);
	// Mientras se escribe, la búsqueda todavía no llegó al servidor.
	const escribiendo = busqueda.trim() !== busquedaServidor;
	const avisos: React.ReactNode[] = [];
	if (busquedaServidor) {
		avisos.push(
			<NotaHistorial key="busqueda">
				La búsqueda mira el número de crédito y el nombre del cliente. Los
				traslados, las bajas, las ausencias y las reactivaciones de asesor no
				tienen crédito: no aparecen mientras busca.
			</NotaHistorial>,
		);
	}
	if (total !== null && total > MAX_FILAS_BITACORA) {
		avisos.push(
			<NotaHistorial key="limite">
				Se pueden recorrer las {MAX_FILAS_BITACORA.toLocaleString("es-GT")}{" "}
				entradas más recientes de cada consulta. Para ver las anteriores, acote
				el rango de fechas.
			</NotaHistorial>,
		);
	}

	return (
		<HistorialDecisiones
			entradas={entradas}
			total={total}
			pagina={Math.min(pagina, totalPaginas)}
			totalPaginas={totalPaginas}
			onPagina={setPagina}
			porPagina={BITACORA_POR_PAGINA}
			filtros={filtros}
			onFiltros={(cambio) => {
				if (cambio.busqueda !== undefined) setBusqueda(cambio.busqueda);
				if (cambio.asesorId !== undefined) setAsesorId(cambio.asesorId);
				if (cambio.desde !== undefined || cambio.hasta !== undefined) {
					setRango((r) => ({
						desde: cambio.desde !== undefined ? cambio.desde : r.desde,
						hasta: cambio.hasta !== undefined ? cambio.hasta : r.hasta,
					}));
				}
				const url: Partial<SolicitudesSearch> = {};
				if (cambio.vista !== undefined) url.vista = cambio.vista;
				if (cambio.estado !== undefined) url.estado = cambio.estado;
				if (cambio.tipo !== undefined)
					url.tipo = cambio.tipo as SolicitudesSearch["tipo"];
				if (Object.keys(url).length > 0) onSearch(url);
			}}
			asesores={asesores}
			cargando={!servidor.vacio && bitacora.isPending}
			actualizando={
				escribiendo || (bitacora.isPlaceholderData && bitacora.isFetching)
			}
			error={!servidor.vacio && bitacora.isError}
			onReintentar={() => void bitacora.refetch()}
			aviso={avisos.length > 0 ? avisos : null}
			DetalleExtra={DetalleHistorialConectado}
		/>
	);
}

export function SolicitudesPagina({
	search,
	onSearch,
}: {
	search: SolicitudesSearch;
	onSearch: (cambio: Partial<SolicitudesSearch>) => void;
}) {
	const { data: session } = authClient.useSession();
	const userId = session?.user?.id ?? null;
	const tab: TabSolicitudes = search.tab ?? "pendientes";
	// «contrapropuesta» solo filtra el Historial.
	const tipo: FiltroTipoSolicitud =
		search.tipo && search.tipo !== "contrapropuesta" ? search.tipo : "todas";
	const enHistorial = tab === "historial";

	const [busqueda, setBusqueda] = React.useState("");
	const [asesor, setAsesor] = React.useState<string | null>(null);

	/* Pendientes */
	const bandeja = useSolicitudesPendientes(!!session);
	const { intentos, bump } = useIntentosConvenio(userId);
	const espacio = useEspacioAprobacion({ alCerrar: bandeja.refetch });

	const avisosBandeja = (
		<>
			{userId && intentos.length > 0 ? (
				<DecisionPorConfirmarBanner
					userId={userId}
					intentos={intentos}
					onResuelto={() => {
						bump();
						bandeja.refetchConvenios();
					}}
				/>
			) : null}
			{bandeja.conveniosFuera > 0 &&
			(tipo === "todas" || tipo === "convenio") ? (
				<p className="type-caption flex items-start gap-2 text-fg-tertiary">
					<Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
					<span>
						Hay {bandeja.conveniosFuera.toLocaleString("es-GT")} convenios por
						aprobar más que no entran en esta bandeja.{" "}
						<Link
							to="/cobros/convenios"
							className="font-medium text-brand hover:underline"
						>
							Véalos en Convenios
						</Link>
						.
					</span>
				</p>
			) : null}
		</>
	);

	return (
		<>
			<SolicitudesPaginaVista
				tab={tab}
				onTab={(t) => onSearch({ tab: t })}
				pendientes={bandeja.cargando ? null : bandeja.pendientes.length}
			>
				{enHistorial ? (
					<HistorialConectado search={search} onSearch={onSearch} />
				) : (
					<BandejaSolicitudes
						pendientes={bandeja.pendientes}
						porEjecutar={bandeja.porEjecutar}
						tipo={tipo}
						onTipo={(t) => onSearch({ tipo: t })}
						busqueda={busqueda}
						onBusqueda={setBusqueda}
						asesor={asesor}
						onAsesor={setAsesor}
						cargando={bandeja.cargando}
						errores={bandeja.errores}
						onReintentar={bandeja.refetch}
						onAbrir={espacio.abrir}
						idAbierta={espacio.idAbierta}
						avisos={avisosBandeja}
					/>
				)}
			</SolicitudesPaginaVista>
			<EspacioAprobacion {...espacio.modal} />
		</>
	);
}
