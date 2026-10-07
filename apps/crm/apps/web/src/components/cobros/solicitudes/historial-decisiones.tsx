/**
 * Pestaña «Historial» de /cobros/solicitudes (Figma 3602:5360): las decisiones
 * y acciones del supervisor, con chips, buscador, tipo y estado. Cada fila se
 * despliega con todo lo que mostraban las páginas de antes (quién decidió,
 * quién ejecutó, evidencia, ubicación, checklist…). Presentación pura.
 */
import { Link } from "@tanstack/react-router";
import { ChevronDown, ExternalLink, FileText, Info } from "lucide-react";
import * as React from "react";
import { resumenChecklist } from "server/src/lib/recuperacion-solicitud";
import { ESTADOS_VEHICULO } from "server/src/lib/recuperacion-vehiculo";
import { UbicacionGuardada } from "@/components/cobros/inmovilizacion-ubicacion";
import { ChecklistVista } from "@/components/cobros/recuperacion-checklist";
import {
	type Destino,
	EnlaceDestino,
} from "@/components/cobros/supervision/destino";
import { nombreCorto } from "@/components/cobros/supervision/formato";
import { FilterChip } from "@/components/ds/cartera-chips";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/ui/search-bar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { googleMapsUrl } from "@/routes/cobros/-gps-ficha";
import {
	type EntradaHistorial,
	ESTADO_HISTORIAL,
	ESTADOS_FILTRO_HISTORIAL,
	type EstadoFiltroHistorial,
	type FiltrosHistorial,
	filtrarHistorial,
	VISTAS_HISTORIAL,
} from "./historial";
import type {
	InmovilizacionHistorialFuente,
	RecuperacionFuente,
} from "./normalizar";
import {
	fechaCorta,
	fechaGT,
	fechaHoraCorta,
	quetzales,
	TextoDecision,
	TipoConPunto,
} from "./piezas";

const POR_PAGINA = 20;

/** Tipos de solicitud del filtro (mismo `tipo` de la URL que la bandeja). */
const TIPOS_FILTRO = [
	{ value: "todas", label: "Todos los tipos" },
	{ value: "apagado", label: "Apagado" },
	{ value: "reactivacion", label: "Reactivación de la unidad" },
	{ value: "recuperacion", label: "Recuperación del vehículo" },
	{ value: "por_ejecutar", label: "Aprobadas por ejecutar" },
	{ value: "convenio", label: "Convenio (pronto)" },
] as const;

export type HistorialDecisionesProps = {
	/** Todas las entradas cargadas, ya ordenadas (las más recientes primero). */
	entradas: EntradaHistorial[];
	filtros: FiltrosHistorial;
	onFiltros: (cambio: Partial<FiltrosHistorial>) => void;
	cargando: boolean;
	/** Fuentes que no se pudieron cargar. */
	errores: string[];
	onReintentar: () => void;
	/** Apagados y reactivaciones cargados de cuántos hay. */
	inmovilizaciones: { cargadas: number; total: number | null };
	onCargarMas?: () => void;
	cargandoMas?: boolean;
	/** Historial completo de reasignaciones, traslados y coberturas (Mi equipo). */
	historialEquipo?: Destino;
};

/* ── Detalle de cada fila ───────────────────────────────────────────────────── */

function Campo({
	etiqueta,
	children,
}: {
	etiqueta: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<span className="text-[11px] text-fg-tertiary leading-[1.26]">
				{etiqueta}
			</span>
			<div className="wrap-break-word min-w-0 text-[13px] text-fg leading-snug">
				{children}
			</div>
		</div>
	);
}

function PersonaFecha({
	nombre,
	fecha,
}: {
	nombre: string | null | undefined;
	fecha: string | Date | null | undefined;
}) {
	if (!nombre) return <span className="text-fg-tertiary">—</span>;
	return (
		<>
			<p>{nombre}</p>
			{fecha ? (
				<p className="text-fg-tertiary text-xs">{fechaGT(fecha)}</p>
			) : null}
		</>
	);
}

/** Lo que mostraba el historial de /cobros/inmovilizaciones. */
function DetalleInmovilizacion({ i }: { i: InmovilizacionHistorialFuente }) {
	return (
		<div className="grid @2xl:grid-cols-3 @md:grid-cols-2 grid-cols-1 gap-4">
			<Campo etiqueta="Solicitado por">
				<PersonaFecha nombre={i.solicitanteNombre} fecha={i.solicitadoAt} />
			</Campo>
			<Campo etiqueta="Decidido por">
				<PersonaFecha nombre={i.decididoPorNombre} fecha={i.decididoAt} />
			</Campo>
			<Campo etiqueta="Ejecutado por">
				{i.ejecutadoPorNombre ? (
					<div className="flex flex-col gap-1">
						<PersonaFecha nombre={i.ejecutadoPorNombre} fecha={i.ejecutadoAt} />
						{i.referenciaEjecucion ? (
							<p className="text-fg-tertiary text-xs">
								Ref: {i.referenciaEjecucion}
							</p>
						) : null}
						{i.evidenciaUrl ? (
							<a
								className="inline-flex w-fit items-center gap-1 text-brand text-xs hover:underline"
								href={i.evidenciaUrl}
								rel="noreferrer"
								target="_blank"
							>
								<FileText aria-hidden className="size-3.5" />
								{i.evidenciaNombreArchivo ?? "Confirmación"}
							</a>
						) : null}
						<UbicacionGuardada
							etiqueta="Ubicación al ejecutar"
							ubicacion={
								i.ubicacionEjecucion as React.ComponentProps<
									typeof UbicacionGuardada
								>["ubicacion"]
							}
						/>
					</div>
				) : (
					<span className="text-fg-tertiary">—</span>
				)}
			</Campo>
			<Campo etiqueta="Motivo de la solicitud">{i.motivo || "—"}</Campo>
			{i.estado === "rechazada" ? (
				<Campo etiqueta="Motivo del rechazo">{i.motivoRechazo || "—"}</Campo>
			) : null}
			{i.ubicacionSolicitud ? (
				<Campo etiqueta="Ubicación al solicitar">
					<UbicacionGuardada
						ubicacion={
							i.ubicacionSolicitud as React.ComponentProps<
								typeof UbicacionGuardada
							>["ubicacion"]
						}
					/>
				</Campo>
			) : null}
		</div>
	);
}

/** Lo que mostraba el historial de /cobros/recuperaciones (fila y «Detalle»). */
function DetalleRecuperacion({ r }: { r: RecuperacionFuente }) {
	const resumen = resumenChecklist(r.checklist ?? []);
	const lat = r.ubicacionLat != null ? Number(r.ubicacionLat) : undefined;
	const lng = r.ubicacionLng != null ? Number(r.ubicacionLng) : undefined;
	const mapa = r.ubicacionEnlace ?? googleMapsUrl(lat, lng);
	const estadoVehiculo = r.estadoVehiculo
		? ((ESTADOS_VEHICULO as Record<string, string>)[r.estadoVehiculo] ??
			r.estadoVehiculo)
		: "no se indicó";
	return (
		<div className="flex flex-col gap-3 text-[13px]">
			<p className="text-fg-secondary">
				{r.bucketOrigen != null ? `B${r.bucketOrigen} · ` : ""}
				{r.solicitante ?? "—"} · {fechaGT(r.solicitadoAt)}
			</p>
			{r.motivoDetalle ? <p>“{r.motivoDetalle}”</p> : null}
			<p className="text-fg-tertiary text-xs">
				{r.cuotasVencidas ?? "—"} cuotas vencidas ·{" "}
				{quetzales(r.totalParaPonerseAlDia)} para ponerse al día · checklist{" "}
				{resumen.hechos}/{resumen.total}
			</p>
			<p className="text-fg-tertiary text-xs">
				Saldo pendiente {quetzales(r.saldoPendiente)} · Vehículo:{" "}
				{estadoVehiculo}
				{r.ubicacionDireccion ? ` · ${r.ubicacionDireccion}` : ""}
				{mapa ? (
					<>
						{" · "}
						<a
							href={mapa}
							target="_blank"
							rel="noopener noreferrer"
							className="text-brand hover:underline"
						>
							Abrir en el mapa
						</a>
					</>
				) : null}
			</p>
			{r.observaciones ? (
				<p className="text-fg-tertiary text-xs">
					Observaciones: {r.observaciones}
				</p>
			) : null}
			<ChecklistVista pasos={r.checklist ?? []} />
			<p className="text-fg-secondary text-xs">
				{r.estadoSolicitud === "cancelada" ? "Cancelada por" : "Decidida por"}{" "}
				{r.decidioPor ?? "—"} el {fechaGT(r.decididoAt)}
				{r.motivoDecision ? `: ${r.motivoDecision}` : ""}
			</p>
		</div>
	);
}

function DetalleFilas({
	filas,
}: {
	filas: Array<{ etiqueta: string; valor: string }>;
}) {
	return (
		<dl className="grid @2xl:grid-cols-3 @md:grid-cols-2 grid-cols-1 gap-4">
			{filas.map((f) => (
				<Campo key={f.etiqueta} etiqueta={f.etiqueta}>
					<span className="break-all">{f.valor}</span>
				</Campo>
			))}
		</dl>
	);
}

/* ── Tabla ──────────────────────────────────────────────────────────────────── */

const CABECERA =
	"h-9 px-0 pr-4 font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26] first:pl-6";
const CELDA = "whitespace-normal py-3.5 pr-4 align-middle first:pl-6";

function FilaHistorial({ e }: { e: EntradaHistorial }) {
	const [abierta, setAbierta] = React.useState(false);
	const estado = ESTADO_HISTORIAL[e.estado];
	const detalleId = React.useId();
	const alternar = () => setAbierta((v) => !v);
	return (
		<>
			<TableRow
				className={cn(
					"cursor-pointer border-divider hover:bg-brand-subtle",
					abierta && "bg-brand-subtle",
				)}
				onClick={alternar}
			>
				<TableCell
					className={cn(
						CELDA,
						"whitespace-nowrap text-[13px] text-fg-secondary",
					)}
				>
					{e.soloDia ? fechaCorta(e.fecha) : fechaHoraCorta(e.fecha)}
				</TableCell>
				<TableCell className={CELDA}>
					<TipoConPunto
						clave={
							e.categoria === "solicitud"
								? (e.tipoSolicitud ?? "convenio")
								: e.categoria
						}
					>
						{e.tipoEtiqueta}
					</TipoConPunto>
				</TableCell>
				<TableCell className={CELDA}>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="wrap-break-word font-semibold text-[13px] text-fg leading-[1.26]">
							{e.objeto.titulo}
						</span>
						{e.objeto.detalle ? (
							<span className="wrap-break-word text-[11px] text-fg-tertiary leading-[1.26]">
								{e.objeto.detalle}
							</span>
						) : null}
					</div>
				</TableCell>
				<TableCell className={cn(CELDA, "text-[13px] text-fg-secondary")}>
					{e.asesor ? nombreCorto(e.asesor) : "—"}
				</TableCell>
				<TableCell className={CELDA}>
					<TextoDecision tono={estado.tono}>{estado.etiqueta}</TextoDecision>
				</TableCell>
				<TableCell
					className={cn(CELDA, "text-[13px] text-fg-secondary")}
					title={e.motivo ?? undefined}
				>
					<span className="wrap-break-word line-clamp-2">
						{e.motivo || "—"}
					</span>
				</TableCell>
				<TableCell className="w-12 py-3.5 pr-4 align-middle">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-expanded={abierta}
						aria-controls={detalleId}
						aria-label={abierta ? "Ocultar detalle" : "Ver detalle"}
						onClick={(ev) => {
							ev.stopPropagation();
							alternar();
						}}
					>
						<ChevronDown
							className={cn("transition-transform", abierta && "rotate-180")}
						/>
					</Button>
				</TableCell>
			</TableRow>
			{abierta ? (
				<TableRow className="border-divider hover:bg-transparent">
					<TableCell
						id={detalleId}
						colSpan={7}
						className="whitespace-normal bg-canvas px-6 py-4"
					>
						<div className="@container flex flex-col gap-3">
							{e.detalle.tipo === "inmovilizacion" ? (
								<DetalleInmovilizacion i={e.detalle.item} />
							) : e.detalle.tipo === "recuperacion" ? (
								<DetalleRecuperacion r={e.detalle.item} />
							) : (
								<DetalleFilas filas={e.detalle.filas} />
							)}
							{e.ficha ? (
								<Link
									to="/cobros/$id"
									params={{ id: e.ficha.id }}
									search={{
										tipo: "caso" as const,
										...(e.ficha.seccion ? { seccion: e.ficha.seccion } : {}),
									}}
									className="inline-flex w-fit items-center gap-1 rounded-sm font-medium text-[13px] text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								>
									Abrir Ficha 360
									<ExternalLink aria-hidden className="size-3.5" />
								</Link>
							) : null}
						</div>
					</TableCell>
				</TableRow>
			) : null}
		</>
	);
}

/* ── Pestaña ────────────────────────────────────────────────────────────────── */

export function HistorialDecisiones({
	entradas,
	filtros,
	onFiltros,
	cargando,
	errores,
	onReintentar,
	inmovilizaciones,
	onCargarMas,
	cargandoMas,
	historialEquipo,
}: HistorialDecisionesProps) {
	const [pagina, setPagina] = React.useState(1);
	const { vista, tipo, estado, busqueda } = filtros;
	const visibles = React.useMemo(
		() => filtrarHistorial(entradas, { vista, tipo, estado, busqueda }),
		[entradas, vista, tipo, estado, busqueda],
	);
	// Otro filtro: de vuelta a la primera página.
	// biome-ignore lint/correctness/useExhaustiveDependencies: se dispara al cambiar los filtros
	React.useEffect(() => setPagina(1), [vista, tipo, estado, busqueda]);
	const totalPaginas = Math.max(1, Math.ceil(visibles.length / POR_PAGINA));
	const paginaActual = Math.min(pagina, totalPaginas);
	const filas = visibles.slice(
		(paginaActual - 1) * POR_PAGINA,
		paginaActual * POR_PAGINA,
	);
	const pronto = filtros.tipo === "rebaja" || filtros.tipo === "documentos";
	const tipoValor = TIPOS_FILTRO.some((t) => t.value === filtros.tipo)
		? filtros.tipo
		: "todas";

	let cuerpo: React.ReactNode;
	if (cargando && entradas.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3 p-6" aria-hidden>
				{[0, 1, 2, 3, 4].map((i) => (
					<Skeleton key={i} className="h-10 w-full" />
				))}
			</div>
		);
	} else if (pronto) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="no-data"
				title="Pronto"
				description="Las decisiones de rebajas de mora y de documentos se verán aquí cuando esas solicitudes lleguen a la bandeja."
			/>
		);
	} else if (visibles.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant={errores.length > 0 ? "error" : "no-data"}
				title={
					entradas.length === 0
						? "No hay decisiones registradas"
						: "No hay registros con estos filtros"
				}
				description={
					entradas.length === 0
						? undefined
						: "Revise la búsqueda o cambie el tipo y el estado."
				}
				action={
					errores.length > 0 ? (
						<Button variant="outline" size="sm" onClick={onReintentar}>
							Reintentar
						</Button>
					) : undefined
				}
			/>
		);
	} else {
		cuerpo = (
			<div className="overflow-x-auto">
				<Table className="min-w-240 table-fixed text-fg">
					<TableHeader className="bg-canvas [&_tr]:border-b-0">
						<TableRow className="hover:bg-transparent">
							<TableHead className={cn(CABECERA, "w-28")}>Fecha</TableHead>
							<TableHead className={cn(CABECERA, "w-44")}>Tipo</TableHead>
							<TableHead className={cn(CABECERA, "w-52")}>
								Solicitud / objeto
							</TableHead>
							<TableHead className={cn(CABECERA, "w-24")}>Asesor</TableHead>
							<TableHead className={cn(CABECERA, "w-36")}>Decisión</TableHead>
							<TableHead className={CABECERA}>Motivo</TableHead>
							<TableHead className="w-12">
								<span className="sr-only">Detalle</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{filas.map((e) => (
							<FilaHistorial key={e.id} e={e} />
						))}
					</TableBody>
				</Table>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
				<legend className="sr-only">Filtrar el historial</legend>
				{VISTAS_HISTORIAL.map((v) => (
					<FilterChip
						key={v.value}
						seleccionado={filtros.vista === v.value}
						onClick={() => onFiltros({ vista: v.value })}
					>
						{v.label}
					</FilterChip>
				))}
			</fieldset>

			<div className="flex items-start gap-2 rounded-lg bg-info-subtle px-3 py-2.5 text-[13px] text-info-text leading-snug">
				<Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
				<div className="wrap-break-word min-w-0">
					Vista parcial: se combinan en su navegador los registros más recientes
					de cada fuente (apagados y reactivaciones:{" "}
					{inmovilizaciones.cargadas.toLocaleString("es-GT")}
					{inmovilizaciones.total !== null
						? ` de ${inmovilizaciones.total.toLocaleString("es-GT")}`
						: ""}{" "}
					cargados; las últimas 100 recuperaciones decididas; reasignaciones
					manuales y coberturas de los últimos 30 días; la última página de
					traslados). Las decisiones de convenios se consultan por crédito en la
					Ficha 360.
					{historialEquipo ? (
						<>
							{" "}
							<EnlaceDestino
								destino={historialEquipo}
								className="rounded-sm font-semibold underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								Historial completo de reasignaciones, traslados y coberturas
							</EnlaceDestino>
							.
						</>
					) : null}
				</div>
			</div>

			{errores.length > 0 && entradas.length > 0 ? (
				<div className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-subtle px-3 py-2 text-[13px] text-danger-text">
					<span className="min-w-0 flex-1">
						No se pudieron cargar: {errores.join(", ")}.
					</span>
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				</div>
			) : null}

			<div className="@container flex flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised contain-inline-size">
				<div className="flex flex-wrap items-center gap-3 px-4 py-3">
					<SearchBar
						containerClassName="w-full sm:w-[360px]"
						placeholder="Buscar por crédito, asesor, tipo o decisión…"
						aria-label="Buscar por crédito, asesor, tipo o decisión"
						value={filtros.busqueda}
						onChange={(ev) => onFiltros({ busqueda: ev.target.value })}
						onClear={() => onFiltros({ busqueda: "" })}
					/>
					<Select
						value={tipoValor}
						onValueChange={(v) => onFiltros({ tipo: v })}
					>
						<SelectTrigger
							size="sm"
							className="w-full sm:w-48"
							aria-label="Tipo de solicitud"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{TIPOS_FILTRO.map((t) => (
								<SelectItem key={t.value} value={t.value}>
									{t.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						value={filtros.estado}
						onValueChange={(v) =>
							onFiltros({ estado: v as EstadoFiltroHistorial })
						}
					>
						<SelectTrigger
							size="sm"
							className="w-full sm:w-48"
							aria-label="Filtrar por estado"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{ESTADOS_FILTRO_HISTORIAL.map((t) => (
								<SelectItem key={t.value} value={t.value}>
									{t.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="ml-auto flex items-center gap-2.5">
						<h3 className="font-semibold text-[15px] text-fg leading-[1.26]">
							Registros
						</h3>
						<span className="inline-flex shrink-0 items-center rounded-full bg-brand-subtle px-2 py-0.5 font-semibold text-[11px] text-brand tabular-nums leading-[1.26]">
							{cargando && entradas.length === 0
								? "…"
								: `${visibles.length.toLocaleString("es-GT")} ${visibles.length === 1 ? "registro" : "registros"}`}
						</span>
					</div>
				</div>
				{cuerpo}
				{!pronto && visibles.length > 0 ? (
					<Pagination
						className="rounded-none border-x-0 border-b-0"
						page={paginaActual}
						pageCount={totalPaginas}
						onPageChange={setPagina}
						totalItems={visibles.length}
						pageSize={POR_PAGINA}
					/>
				) : null}
				{onCargarMas ? (
					<div className="flex justify-center border-divider border-t px-4 py-3">
						<Button
							variant="ghost"
							size="sm"
							onClick={onCargarMas}
							loading={cargandoMas}
						>
							Cargar apagados y reactivaciones más antiguos
						</Button>
					</div>
				) : null}
			</div>
		</div>
	);
}
