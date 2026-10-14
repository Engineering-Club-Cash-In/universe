/**
 * Pestaña «Historial» de /cobros/solicitudes (Figma 3602:5360): las decisiones
 * y acciones del supervisor. La bitácora del servidor (`getBitacoraDecisiones`)
 * ya trae todo mezclado y paginado: los chips, el tipo, el estado, el asesor,
 * las fechas y la búsqueda (crédito o cliente) se resuelven en el servidor.
 * Cada fila se despliega con su detalle (quién decidió, quién ejecutó, montos,
 * evidencia, ubicación, checklist…). Presentación pura: el detalle extra lo
 * consulta el contenedor (`DetalleExtra`).
 */
import { Link } from "@tanstack/react-router";
import { ChevronDown, ExternalLink, FileText, X } from "lucide-react";
import * as React from "react";
import { resumenChecklist } from "server/src/lib/recuperacion-solicitud";
import { ESTADOS_VEHICULO } from "server/src/lib/recuperacion-vehiculo";
import { fechaAIso, isoAFecha } from "@/components/cobros/campo-fecha";
import { UbicacionGuardada } from "@/components/cobros/inmovilizacion-ubicacion";
import { ChecklistVista } from "@/components/cobros/recuperacion-checklist";
import { nombreCorto } from "@/components/cobros/supervision/formato";
import { FilterChip } from "@/components/ds/cartera-chips";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-picker";
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
	TIPOS_FILTRO_HISTORIAL,
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

export type HistorialDecisionesProps = {
	/** La página que se ve, ya ordenada (las más recientes primero). */
	entradas: EntradaHistorial[];
	/** Registros con estos filtros en el servidor; null mientras carga. */
	total: number | null;
	pagina: number;
	totalPaginas: number;
	onPagina: (pagina: number) => void;
	porPagina: number;
	filtros: FiltrosHistorial;
	onFiltros: (cambio: Partial<FiltrosHistorial>) => void;
	/** Asesores del filtro (usuario del CRM). */
	asesores: Array<{ value: string; label: string }>;
	cargando: boolean;
	/** Llega otra página u otros filtros: la tabla se atenúa. */
	actualizando?: boolean;
	error: boolean;
	onReintentar: () => void;
	/** Arriba de la tabla (límite de la bitácora, documentos…). */
	aviso?: React.ReactNode;
	/** Completa el detalle de una fila al abrirla. */
	DetalleExtra?: DetalleExtraHistorial;
};

const TODOS = "__todos__";

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
export function DetalleInmovilizacion({
	i,
}: {
	i: InmovilizacionHistorialFuente;
}) {
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
export function DetalleRecuperacion({ r }: { r: RecuperacionFuente }) {
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

export function DetalleFilas({
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

/** Lo que la entrada trae consigo, sin consultas. */
function DetalleBase({ e }: { e: EntradaHistorial }) {
	return e.detalle.tipo === "inmovilizacion" ? (
		<DetalleInmovilizacion i={e.detalle.item} />
	) : e.detalle.tipo === "recuperacion" ? (
		<DetalleRecuperacion r={e.detalle.item} />
	) : (
		<DetalleFilas filas={e.detalle.filas} />
	);
}

const CABECERA =
	"h-9 px-0 pr-4 font-semibold text-[10px] text-fg-tertiary uppercase leading-[1.26] first:pl-6";
const CELDA = "whitespace-normal py-3.5 pr-4 align-middle first:pl-6";

export type DetalleExtraHistorial = React.ComponentType<{
	entrada: EntradaHistorial;
	/** Lo que trae la bitácora; se muestra mientras carga o si no hay más. */
	base: React.ReactNode;
}>;

function FilaHistorial({
	e,
	DetalleExtra,
}: {
	e: EntradaHistorial;
	DetalleExtra?: DetalleExtraHistorial;
}) {
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
							{DetalleExtra ? (
								<DetalleExtra entrada={e} base={<DetalleBase e={e} />} />
							) : (
								<DetalleBase e={e} />
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
	total,
	pagina,
	totalPaginas,
	onPagina,
	porPagina,
	filtros,
	onFiltros,
	asesores,
	cargando,
	actualizando = false,
	error,
	onReintentar,
	aviso,
	DetalleExtra,
}: HistorialDecisionesProps) {
	const visibles = entradas;
	const tipoValor = TIPOS_FILTRO_HISTORIAL.some((t) => t.value === filtros.tipo)
		? filtros.tipo
		: "todas";
	const filtrando =
		filtros.vista !== "todas" ||
		tipoValor !== "todas" ||
		filtros.estado !== "todos" ||
		filtros.asesorId !== null ||
		filtros.desde !== null ||
		filtros.hasta !== null;
	const buscando = filtros.busqueda.trim() !== "";

	let cuerpo: React.ReactNode;
	if (cargando && entradas.length === 0) {
		cuerpo = (
			<div className="flex flex-col gap-3 p-6" aria-hidden>
				{[0, 1, 2, 3, 4].map((i) => (
					<Skeleton key={i} className="h-10 w-full" />
				))}
			</div>
		);
	} else if (error && entradas.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="error"
				title="No se pudo cargar el historial"
				action={
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				}
			/>
		);
	} else if (visibles.length === 0) {
		cuerpo = (
			<EmptyState
				size="sm"
				variant="no-data"
				title={
					buscando
						? "No hay registros con esa búsqueda"
						: filtrando
							? "No hay registros con estos filtros"
							: "No hay decisiones registradas"
				}
				description={
					buscando
						? "Revise el número de crédito o el nombre del cliente, o cambie los filtros."
						: filtrando
							? "Cambie los filtros o el rango de fechas."
							: undefined
				}
			/>
		);
	} else {
		cuerpo = (
			<div
				className={cn(
					"overflow-x-auto transition-opacity",
					actualizando && "opacity-60",
				)}
				aria-busy={actualizando}
			>
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
						{visibles.map((e) => (
							<FilaHistorial key={e.id} e={e} DetalleExtra={DetalleExtra} />
						))}
					</TableBody>
				</Table>
			</div>
		);
	}

	const rango =
		filtros.desde || filtros.hasta
			? {
					from: isoAFecha(filtros.desde ?? filtros.hasta ?? undefined),
					to: isoAFecha(filtros.hasta ?? filtros.desde ?? undefined),
				}
			: undefined;

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

			{aviso}

			{error && entradas.length > 0 ? (
				<div className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-subtle px-3 py-2 text-[13px] text-danger-text">
					<span className="min-w-0 flex-1">
						No se pudo actualizar el historial. Se muestra lo último que se
						cargó.
					</span>
					<Button variant="outline" size="sm" onClick={onReintentar}>
						Reintentar
					</Button>
				</div>
			) : null}

			<div className="@container flex flex-col overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised contain-inline-size">
				<div className="flex flex-wrap items-center gap-3 px-4 py-3">
					<SearchBar
						containerClassName="w-full sm:w-[300px]"
						placeholder="Buscar por crédito o cliente…"
						aria-label="Buscar en el historial por número de crédito o nombre del cliente"
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
							{TIPOS_FILTRO_HISTORIAL.map((t) => (
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
					<Select
						value={filtros.asesorId ?? TODOS}
						onValueChange={(v) =>
							onFiltros({ asesorId: v === TODOS ? null : v })
						}
					>
						<SelectTrigger
							size="sm"
							className="w-full sm:w-48"
							aria-label="Asesor que pidió la solicitud"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							<SelectItem value={TODOS}>Todos los asesores</SelectItem>
							{asesores.map((a) => (
								<SelectItem key={a.value} value={a.value}>
									{a.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<div className="flex w-full items-center gap-1 sm:w-auto">
						<DateRangePicker
							className="h-8 w-full min-w-48 rounded-lg px-3 text-[13px] sm:w-auto"
							placeholder="Todas las fechas"
							range={rango}
							onRangeChange={(r) => {
								if (!r?.from) {
									onFiltros({ desde: null, hasta: null });
									return;
								}
								const desde = fechaAIso(r.from);
								onFiltros({
									desde,
									hasta: r.to ? fechaAIso(r.to) : desde,
								});
							}}
						/>
						{filtros.desde || filtros.hasta ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Quitar el rango de fechas"
								onClick={() => onFiltros({ desde: null, hasta: null })}
							>
								<X />
							</Button>
						) : null}
					</div>
					<div className="ml-auto flex items-center gap-2.5">
						<h3 className="font-semibold text-[15px] text-fg leading-[1.26]">
							Registros
						</h3>
						<span className="inline-flex shrink-0 items-center rounded-full bg-brand-subtle px-2 py-0.5 font-semibold text-[11px] text-brand tabular-nums leading-[1.26]">
							{total === null
								? "…"
								: `${total.toLocaleString("es-GT")} ${total === 1 ? "registro" : "registros"}`}
						</span>
					</div>
				</div>
				{cuerpo}
				{total !== null && total > 0 ? (
					<Pagination
						className="rounded-none border-x-0 border-b-0"
						page={pagina}
						pageCount={totalPaginas}
						onPageChange={onPagina}
						totalItems={total}
						pageSize={porPagina}
						disabled={actualizando}
					/>
				) : null}
			</div>
		</div>
	);
}
