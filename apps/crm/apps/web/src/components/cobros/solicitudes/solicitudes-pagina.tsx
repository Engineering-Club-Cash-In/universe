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
import { DecisionPorConfirmarBanner } from "@/components/cobros/decision-por-confirmar-banner";
import { hoyGT } from "@/components/cobros/supervision/formato";
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
	type CoberturaFuente,
	type EntradaHistorial,
	entradaDeDecisionConvenio,
	entradaDeInmovilizacion,
	entradaDeReasignacion,
	entradaDeRecuperacion,
	entradaDeTraslado,
	entradasDeCobertura,
	fechaDeCorte,
	ordenarHistorial,
	recortarAlCorte,
} from "./historial";
import { HistorialDecisiones } from "./historial-decisiones";
import type { SolicitudesSearch, TabSolicitudes } from "./search";
import {
	useHistorialDecisionesConvenio,
	useHistorialInmovilizaciones,
	useHistorialReasignaciones,
	useHistorialRecuperaciones,
	useHistorialTraslados,
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
						: `${pendientes === null ? "…" : pendientes.toLocaleString("es-GT")} ${pendientes === 1 ? "solicitud" : "solicitudes"} · de sus asesores · ordenadas por antigüedad`}
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

type AsesorPool = {
	asesor_id: number;
	nombre: string;
	userId: string | null;
};

function sumarDias(fecha: string, dias: number) {
	const [y, m, d] = fecha.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Desde cuándo se traen las coberturas: `listarCoberturas` no pagina y son
 * pocas (una por ausencia), así que el historial las trae todas.
 */
const COBERTURAS_DESDE = "2020-01-01";

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
	const tipo: FiltroTipoSolicitud = search.tipo ?? "todas";
	const enHistorial = tab === "historial";

	const [busqueda, setBusqueda] = React.useState("");
	const [asesor, setAsesor] = React.useState<string | null>(null);
	const [busquedaHistorial, setBusquedaHistorial] = React.useState("");
	/** Páginas cargadas de cada fuente del historial («Cargar más»). */
	const [paginas, setPaginas] = React.useState(1);

	/* Pendientes */
	const bandeja = useSolicitudesPendientes(!!session);
	const { intentos, bump } = useIntentosConvenio(userId);
	const espacio = useEspacioAprobacion({ alCerrar: bandeja.refetch });

	/* Historial (solo se consulta con la pestaña abierta) */
	const hoy = hoyGT();
	const inmov = useHistorialInmovilizaciones(paginas, enHistorial);
	const recuperacionesHist = useHistorialRecuperaciones(paginas, enHistorial);
	const conveniosHist = useHistorialDecisionesConvenio(paginas, enHistorial);
	const reasignaciones = useHistorialReasignaciones(paginas, enHistorial);
	const traslados = useHistorialTraslados(paginas, enHistorial);
	const coberturas = useQuery({
		...orpc.listarCoberturas.queryOptions({
			// Las registradas hace poco pueden ser de fechas futuras.
			input: { desde: COBERTURAS_DESDE, hasta: sumarDias(hoy, 365) },
		}),
		enabled: enHistorial,
	});
	const asesores = useQuery({
		...orpc.getAsesoresTraslados.queryOptions(),
		enabled: enHistorial,
	});
	const usuarios = useQuery({
		...orpc.getUsuariosCobros.queryOptions(),
		enabled: enHistorial,
		staleTime: 5 * 60 * 1000,
	});

	const entradas = React.useMemo((): EntradaHistorial[] => {
		if (!enHistorial) return [];
		const pool = (asesores.data ?? []) as unknown as AsesorPool[];
		const nombreAsesor = (id: number) =>
			pool.find((a) => a.asesor_id === id)?.nombre ?? null;
		const nombreUsuario = (id: string) =>
			pool.find((a) => a.userId === id)?.nombre ??
			usuarios.data?.find((u) => u.id === id)?.name ??
			null;
		// Fuentes paginadas: cada una con sus entradas y si le quedan páginas.
		const paginadas = [
			{
				entradas: inmov.items.map(entradaDeInmovilizacion),
				hayMas: inmov.hayMas,
			},
			{
				entradas: recuperacionesHist.items.map(entradaDeRecuperacion),
				hayMas: recuperacionesHist.hayMas,
			},
			{
				entradas: conveniosHist.items.map(entradaDeDecisionConvenio),
				hayMas: conveniosHist.hayMas,
			},
			{
				entradas: reasignaciones.items.map(entradaDeReasignacion),
				hayMas: reasignaciones.hayMas,
			},
			{
				entradas: traslados.items.map((t) =>
					entradaDeTraslado(t, nombreAsesor),
				),
				hayMas: traslados.hayMas,
			},
		];
		const corte = fechaDeCorte(
			paginadas.filter((p) => p.hayMas).map((p) => p.entradas),
		);
		return recortarAlCorte(
			ordenarHistorial([
				...paginadas.flatMap((p) => p.entradas),
				...((coberturas.data ?? []) as unknown as CoberturaFuente[]).flatMap(
					(c) => entradasDeCobertura(c, nombreUsuario, hoy),
				),
			]),
			corte,
		);
	}, [
		enHistorial,
		inmov.items,
		inmov.hayMas,
		recuperacionesHist.items,
		recuperacionesHist.hayMas,
		conveniosHist.items,
		conveniosHist.hayMas,
		reasignaciones.items,
		reasignaciones.hayMas,
		traslados.items,
		traslados.hayMas,
		coberturas.data,
		asesores.data,
		usuarios.data,
		hoy,
	]);

	const erroresHistorial = [
		inmov.error ? "apagados y reactivaciones" : null,
		recuperacionesHist.error ? "recuperaciones del vehículo" : null,
		conveniosHist.error ? "decisiones de convenios" : null,
		reasignaciones.error ? "reasignaciones" : null,
		traslados.error ? "traslados" : null,
		coberturas.isError ? "coberturas" : null,
	].filter((e): e is string => e !== null);

	const hayMasHistorial =
		inmov.hayMas ||
		recuperacionesHist.hayMas ||
		conveniosHist.hayMas ||
		reasignaciones.hayMas ||
		traslados.hayMas;
	const cargandoPaginas =
		inmov.cargando ||
		recuperacionesHist.cargando ||
		conveniosHist.cargando ||
		reasignaciones.cargando ||
		traslados.cargando;

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
					<HistorialDecisiones
						entradas={entradas}
						filtros={{
							vista: search.vista ?? "todas",
							tipo,
							estado: search.estado ?? "todos",
							busqueda: busquedaHistorial,
						}}
						onFiltros={(cambio) => {
							if (cambio.busqueda !== undefined)
								setBusquedaHistorial(cambio.busqueda);
							const { busqueda: _b, tipo: t, ...resto } = cambio;
							if (Object.keys(resto).length > 0 || t !== undefined) {
								onSearch({
									...resto,
									...(t !== undefined
										? { tipo: t as FiltroTipoSolicitud }
										: {}),
								});
							}
						}}
						cargando={
							inmov.cargando ||
							recuperacionesHist.cargando ||
							conveniosHist.cargando ||
							reasignaciones.cargando ||
							traslados.cargando ||
							coberturas.isLoading
						}
						errores={erroresHistorial}
						onReintentar={() => {
							inmov.refetch();
							recuperacionesHist.refetch();
							conveniosHist.refetch();
							reasignaciones.refetch();
							traslados.refetch();
							void coberturas.refetch();
						}}
						inmovilizaciones={{
							cargadas: inmov.items.length,
							total: inmov.total,
						}}
						onCargarMas={
							hayMasHistorial ? () => setPaginas((p) => p + 1) : undefined
						}
						cargandoMas={cargandoPaginas && paginas > 1}
						historialEquipo={{
							to: "/cobros/equipo",
							search: { tab: "asignacion" },
						}}
					/>
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
