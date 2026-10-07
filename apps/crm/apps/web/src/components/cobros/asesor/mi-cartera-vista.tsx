import { Link } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	CircleCheck,
	Info,
	TriangleAlert,
	Wallet,
} from "lucide-react";
import type * as React from "react";
import { etiquetaSegmento } from "@/components/cobros/cartera-general/segmentos";
import {
	AvisoSegmento,
	BarraSeleccion,
	BotonSegmentos,
	CasillaFila,
	CasillaPagina,
	CeldaSegmento,
	ChipsRapidosSupervision,
	ETIQUETA_COLUMNA_SEGMENTO,
	SelectorAsesor,
	type SupervisionCartera,
	VacioSegmento,
} from "@/components/cobros/cartera-general/vista-supervision";
import { PromesaActivaBadge } from "@/components/cobros/promesa-activa-badge";
import type { Bucket } from "@/components/ds/badges";
import { AsesorChip, FilterChip } from "@/components/ds/cartera-chips";
import {
	type ColumnaCartera,
	TablaCartera,
} from "@/components/ds/tabla-cartera";
import { formatearQuetzales } from "@/components/ds/table-cells";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBarButton } from "@/components/ui/filter-bar";
import { OperationalSummaryItem } from "@/components/ui/operational-summary";
import { Pagination } from "@/components/ui/pagination";
import { SearchBar } from "@/components/ui/search-bar";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton, SkeletonTable } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { cn } from "@/lib/utils";
import {
	type ColumnaOpcional,
	type FilaCartera,
	FilaCreditoAsesor,
	useColumnasVisibles,
} from "./fila-cartera";
import {
	BotonFiltrosCartera,
	BUCKETS_CARTERA,
	bucketDeEstadoMora,
	CAMPOS_ORDEN,
	ChipsFiltrosAplicados,
	contarFiltrosActivos,
	contarFiltrosAvanzados,
	diasHastaPago,
	ESTADO_POR_BUCKET,
	ETIQUETA_LABELS,
	type EtapaOpcion,
	FILTROS_GESTION,
	type FiltrosCartera,
	GESTION_LABEL,
	ORDEN_INICIAL,
	type OrdenCartera,
} from "./filtros-cartera";

/**
 * Mi Cartera — Figma «CRM Ventas › Asesor Junior › 02 · Mi Cartera» (312:1606).
 *
 * Presentación pura: recibe todo por props (la ruta /cobros/cartera arma los
 * datos en `mi-cartera.tsx`). Junior y senior son la misma pantalla: cambian los
 * buckets del perfil. Supervisión ve toda la cartera ("Cartera", B0–B5 y la
 * columna Asesor prendida por defecto).
 *
 * Con `supervision` (y perfil de supervisión) es la «Cartera general» del
 * supervisor (Figma 2262:12): migas «Dashboard / Cartera del equipo», filtro por
 * asesor, chips rápidos de Figma, el selector de segmentos que reemplaza a la
 * Cola del día y a las Alertas de promesas y de convenios, selección múltiple
 * con «Reasignar en bloque» y estado vacío por segmento. Sin `supervision` la
 * pantalla es la de siempre (el asesor no cambia).
 *
 * Orden de Figma: breadcrumb → encabezado (overline, título, subtítulo) →
 * encabezado operativo → chips de bucket → búsqueda + chips de gestión → tabla.
 * Agregado para no perder lo que ya existía: popover "Filtros" con todos los
 * filtros de antes, chips de lo aplicado, "Ordenar", "Columnas" con más datos,
 * WhatsApp masivo y tamaño de página.
 */

export type PerfilVista = {
	esSupervision: boolean;
	sinAsesor: boolean;
	buckets: number[];
};

export type ResumenCartera = {
	/** Créditos asignados (null = sin dato → "—"). */
	asignados: number | null;
	/** Total de la cola del día (null = no aplica / sin dato). */
	atencionHoy: number | null;
	/** % de cartera al día. */
	alDia: number | null;
	cargando: boolean;
	/** Los datos de cartera llegaron incompletos (antes: badge "Datos parciales"). */
	parcial?: boolean;
	/** Conteo por bucket (estatusStats). */
	porBucket: Partial<Record<Bucket, number>>;
};

export type MiCarteraVistaProps = {
	/** `undefined` mientras carga el perfil. */
	perfil: PerfilVista | undefined;
	resumen: ResumenCartera;
	filtros: FiltrosCartera;
	onCambiarFiltros: (cambio: Partial<FiltrosCartera>) => void;
	onLimpiarFiltros: () => void;
	etapas: EtapaOpcion[];
	/** Etapas que se ofrecen en el filtro (las del pool del asesor + no-bucket). */
	etapasFiltro?: EtapaOpcion[];
	filas: FilaCartera[];
	total: number;
	cargando: boolean;
	/** Trae otra página con la anterior todavía en pantalla. */
	actualizando?: boolean;
	error?: string | null;
	onReintentar?: () => void;
	pagina: number;
	totalPaginas: number;
	tamanoPagina: number;
	onPagina: (pagina: number) => void;
	onTamanoPagina: (tamano: number) => void;
	orden: OrdenCartera;
	onOrden: (orden: OrdenCartera) => void;
	/** Botón de WhatsApp masivo (MassWhatsappModal); se oculta sin resultados. */
	accionMasiva?: React.ReactNode;
	onVistaRapida: (creditoId: string) => void;
	/**
	 * Clic en una fila: abre el Workspace en esa posición de `filas` (la página
	 * visible, en su orden). Sin él, la fila navega a la Ficha 360.
	 */
	onAbrir?: (indice: number) => void;
	/** Cartera general del supervisor (ver arriba). */
	supervision?: SupervisionCartera;
};

export const TAMANOS_PAGINA = [25, 50, 75, 100, 200];

/* ── Encabezado ─────────────────────────────────────────────────────────────── */

function overline(perfil: PerfilVista | undefined) {
	if (!perfil) return null;
	if (perfil.esSupervision) return "Módulo cobros · Toda la cartera";
	if (perfil.buckets.length === 0) return "Módulo cobros";
	const nombres = perfil.buckets.map((b) => `Bucket ${b}`);
	const lista =
		nombres.length === 1
			? nombres[0]
			: `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
	return `Módulo cobros · ${lista}`;
}

const formatoEntero = new Intl.NumberFormat("es-GT");

function ValorResumen({
	valor,
	cargando,
	sufijo = "",
}: {
	valor: number | null;
	cargando: boolean;
	sufijo?: string;
}) {
	if (cargando)
		return <Skeleton className="inline-block h-4 w-8 align-middle" />;
	return valor === null ? "—" : `${formatoEntero.format(valor)}${sufijo}`;
}

function EncabezadoOperativo({
	resumen,
	perfil,
	onAtencionHoy,
}: {
	resumen: ResumenCartera;
	perfil: PerfilVista | undefined;
	/** Supervisión: «Requieren atención hoy» abre la Cola del día en la tabla. */
	onAtencionHoy?: () => void;
}) {
	const atencion = resumen.atencionHoy;
	return (
		<div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-1">
			<OperationalSummaryItem
				icon={Wallet}
				value={
					<ValorResumen valor={resumen.asignados} cargando={resumen.cargando} />
				}
				label="Créditos asignados"
			/>
			{atencion !== null || resumen.cargando ? (
				perfil?.esSupervision && onAtencionHoy ? (
					<OperationalSummaryItem
						icon={TriangleAlert}
						status={atencion ? "warning" : "normal"}
						value={
							<ValorResumen valor={atencion} cargando={resumen.cargando} />
						}
						label="Requieren atención hoy"
						title="Ver la Cola del día"
						onClick={onAtencionHoy}
					/>
				) : perfil?.esSupervision ? (
					<OperationalSummaryItem
						icon={TriangleAlert}
						status={atencion ? "warning" : "normal"}
						value={
							<ValorResumen valor={atencion} cargando={resumen.cargando} />
						}
						label="Requieren atención hoy"
					/>
				) : (
					<OperationalSummaryItem
						asChild
						icon={TriangleAlert}
						status={atencion ? "warning" : "normal"}
						value={
							<ValorResumen valor={atencion} cargando={resumen.cargando} />
						}
						label="Requieren atención hoy"
						title="Ver la cola del día en el Dashboard"
					>
						<Link to="/cobros" />
					</OperationalSummaryItem>
				)
			) : null}
			<OperationalSummaryItem
				icon={CircleCheck}
				status={resumen.alDia === null ? "normal" : "success"}
				value={
					<ValorResumen
						valor={resumen.alDia === null ? null : Math.round(resumen.alDia)}
						cargando={resumen.cargando}
						sufijo="%"
					/>
				}
				label="Cartera al día"
			/>
			{resumen.parcial ? (
				<Chip
					tone="warning"
					title="Cartera no devolvió todos los datos (p. ej. el capital). Algunos totales pueden estar incompletos."
				>
					Datos parciales
				</Chip>
			) : null}
		</div>
	);
}

/* ── Columnas opcionales ("Más datos" del botón Columnas) ───────────────────── */

export const COLUMNAS_OPCIONALES: ColumnaOpcional[] = [
	{ id: "asesor", etiqueta: "Asesor", ancho: 160, despuesDe: "cliente" },
	{ id: "diasMora", etiqueta: "Días de mora", ancho: 100, despuesDe: "mora" },
	{ id: "etapa", etiqueta: "Etapa", ancho: 170, despuesDe: "mora" },
	{
		id: "montoMora",
		etiqueta: "Monto en mora",
		ancho: 130,
		despuesDe: "deuda",
	},
	{ id: "capital", etiqueta: "Capital", ancho: 130, despuesDe: "deuda" },
	{ id: "vence", etiqueta: "Días al pago", ancho: 120, despuesDe: "fecha" },
	{
		id: "promesa",
		etiqueta: "Promesa activa",
		ancho: 130,
		despuesDe: "estado",
	},
	{
		id: "etiquetas",
		etiqueta: "Etiquetas",
		ancho: 220,
		despuesDe: "accion",
		celda: "pl-6",
	},
	{ id: "pool", etiqueta: "Pool", ancho: 70, despuesDe: "accion" },
];

const textoValor = "font-bold text-[13px] text-fg leading-[1.26] tabular-nums";
const guion = <span className="text-[13px] text-fg-tertiary">—</span>;

function monto(valor: string | number | null | undefined) {
	const n = Number(valor ?? 0);
	return n > 0 ? (
		<span className={textoValor}>{formatearQuetzales(n)}</span>
	) : (
		guion
	);
}

const TONO_ETIQUETA: Record<string, ChipProps["tone"]> = {
	juridico: "brand",
	convenio: "info",
	cobro: "success",
	no_localizable: "neutral",
	unidad_a_recuperar: "warning",
	unidad_recuperada: "success",
	moras_pendientes: "danger",
	compromiso_de_pago: "warning",
	cancelado: "neutral",
	reclamo: "danger",
};

const TONO_ETAPA: Record<string, ChipProps["tone"]> = {
	completado: "success",
	en_convenio: "success",
	pendiente_cancelacion: "info",
	incobrable: "danger",
};

function DiasAlPago({ fila }: { fila: FilaCartera }) {
	const dias = diasHastaPago(fila);
	if (dias === null) return guion;
	const [texto, color] =
		dias === 0
			? ["¡Hoy!", "text-danger-text"]
			: dias < 0
				? [
						`${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"} vencido`,
						"text-danger-text",
					]
				: [
						`en ${dias} ${dias === 1 ? "día" : "días"}`,
						dias <= 7 ? "text-warning-text" : "text-fg-tertiary",
					];
	return (
		<span className={cn("font-semibold text-[13px] leading-[1.26]", color)}>
			{texto}
		</span>
	);
}

function celdasExtra(
	fila: FilaCartera,
	etapas: EtapaOpcion[],
): Record<string, React.ReactNode> {
	const etapa =
		fila.estadoContrato === "activo"
			? fila.estadoMora || "al_dia"
			: fila.estadoContrato;
	return {
		asesor: fila.asesorNombre ? (
			<AsesorChip nombre={fila.asesorNombre} />
		) : (
			<span className="text-[13px] text-fg-tertiary">Sin asignar</span>
		),
		diasMora:
			fila.diasMoraMaximo && fila.diasMoraMaximo > 0 ? (
				<span className={textoValor}>
					{fila.diasMoraMaximo} {fila.diasMoraMaximo === 1 ? "día" : "días"}
				</span>
			) : (
				guion
			),
		etapa: (
			<Chip tone={TONO_ETAPA[etapa] ?? "neutral"} dot={false}>
				{etapas.find((e) => e.key === etapa)?.label ?? etapa}
			</Chip>
		),
		montoMora: monto(fila.montoEnMora),
		capital: monto(fila.montoFinanciado),
		vence: <DiasAlPago fila={fila} />,
		promesa: fila.promesaActiva ? <PromesaActivaBadge compact /> : guion,
		etiquetas:
			fila.etiquetas && fila.etiquetas.length > 0 ? (
				<div className="flex flex-wrap gap-1 whitespace-normal py-1">
					{fila.etiquetas.map((e) => (
						<Chip key={e} tone={TONO_ETIQUETA[e] ?? "neutral"} dot={false}>
							{ETIQUETA_LABELS[e] ?? e}
						</Chip>
					))}
				</div>
			) : (
				guion
			),
		pool: fila.isPool ? (
			<Chip tone="brand" dot={false}>
				Pool
			</Chip>
		) : null,
	};
}

/* ── Toolbar: Ordenar ───────────────────────────────────────────────────────── */

function MenuOrden({
	orden,
	onOrden,
}: {
	orden: OrdenCartera;
	onOrden: (orden: OrdenCartera) => void;
}) {
	const distinto =
		orden.campo !== ORDEN_INICIAL.campo || orden.dir !== ORDEN_INICIAL.dir;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<ToolbarButton action="ordenar" active={distinto} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={orden.campo}
					onValueChange={(v) =>
						onOrden({ ...orden, campo: v as OrdenCartera["campo"] })
					}
				>
					{CAMPOS_ORDEN.map((c) => (
						<DropdownMenuRadioItem
							key={c.key}
							value={c.key}
							onSelect={(e) => e.preventDefault()}
						>
							{c.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuRadioGroup
					value={orden.dir}
					onValueChange={(v) =>
						onOrden({ ...orden, dir: v as OrdenCartera["dir"] })
					}
				>
					<DropdownMenuRadioItem
						value="asc"
						onSelect={(e) => e.preventDefault()}
					>
						Ascendente
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem
						value="desc"
						onSelect={(e) => e.preventDefault()}
					>
						Descendente
					</DropdownMenuRadioItem>
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<p className="type-caption flex gap-2 px-3 py-2 text-fg-tertiary">
					<Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
					Se ordena la página actual. El orden de prioridad de toda la cartera
					(bucket, acción pendiente y días de mora) llegará con una próxima
					actualización.
				</p>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/* ── Tabla ──────────────────────────────────────────────────────────────────── */

function PieTabla({
	pagina,
	totalPaginas,
	total,
	tamanoPagina,
	onPagina,
	onTamanoPagina,
	deshabilitado,
}: {
	pagina: number;
	totalPaginas: number;
	total: number;
	tamanoPagina: number;
	onPagina: (p: number) => void;
	onTamanoPagina: (t: number) => void;
	deshabilitado?: boolean;
}) {
	const desde = total === 0 ? 0 : (pagina - 1) * tamanoPagina + 1;
	const hasta = Math.min(pagina * tamanoPagina, total);
	return (
		<Pagination
			className="rounded-none border-x-0 border-b-0"
			page={pagina}
			pageCount={totalPaginas}
			onPageChange={onPagina}
			disabled={deshabilitado}
			summary={
				<span className="flex items-center gap-3">
					<span>
						Mostrando {formatoEntero.format(desde)}–
						{formatoEntero.format(hasta)} de {formatoEntero.format(total)}
					</span>
					<Select
						value={String(tamanoPagina)}
						onValueChange={(v) => onTamanoPagina(Number(v))}
					>
						<SelectTrigger
							size="sm"
							className="data-[size=sm]:h-6 data-[size=sm]:px-2 data-[size=sm]:text-xs"
							aria-label="Créditos por página"
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent size="sm">
							{TAMANOS_PAGINA.map((t) => (
								<SelectItem key={t} value={String(t)}>
									{t} por página
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</span>
			}
		/>
	);
}

/** Fila de carga con las columnas visibles (Skeleton de Figma). */
function FilaCargando({
	columnas,
}: {
	columnas: { id: string; celda?: string }[];
}) {
	return (
		<TableRow className="border-divider border-b hover:bg-transparent">
			{columnas.map((c) => (
				<TableCell
					key={c.id}
					className={cn("h-14 p-0 first:pl-4 last:pr-4", c.celda)}
				>
					{c.id === "cliente" ? (
						<div className="flex flex-col gap-1.5">
							<Skeleton className="h-3 w-36" />
							<Skeleton className="h-2.5 w-24" />
						</div>
					) : c.id === "acciones" ? (
						<Skeleton className="ml-auto size-7 rounded-lg" />
					) : (
						<Skeleton className="h-3.5 w-3/5" />
					)}
				</TableCell>
			))}
		</TableRow>
	);
}

/** Estado vacío/error dentro de la tabla, fijo al ancho visible aunque la tabla haga scroll. */
function EstadoEnTabla({ children }: { children: React.ReactNode }) {
	return (
		<div className="sticky left-0 w-[calc(100cqw-2rem)] whitespace-normal py-2">
			{children}
		</div>
	);
}

/**
 * Columnas de la Cartera general: casilla de selección al inicio y, con un
 * segmento elegido, su columna («Cola del día», «Promesa de pago», «Convenio»)
 * junto al asesor, con lo que mostraba la página vieja.
 */
function columnasSupervision(
	base: ColumnaCartera[],
	segmento: SupervisionCartera["segmento"],
	casillaPagina: React.ReactNode,
): ColumnaCartera[] {
	const columnas: ColumnaCartera[] = [
		{ id: "sel", etiqueta: casillaPagina, ancho: 40 },
		...base.map((c) => (c.id === "cliente" ? { ...c, celda: "pl-2" } : c)),
	];
	if (segmento) {
		const despues = columnas.findIndex((c) => c.id === "asesor");
		columnas.splice(despues >= 0 ? despues + 1 : 2, 0, {
			id: "segmento",
			etiqueta: ETIQUETA_COLUMNA_SEGMENTO[segmento.tipo],
			ancho: 260,
			celda: "pr-4",
		});
	}
	return columnas;
}

function TablaMiCartera({
	props,
	activos,
	avanzados,
}: {
	props: MiCarteraVistaProps;
	activos: number;
	avanzados: number;
}) {
	const esSupervision = !!props.perfil?.esSupervision;
	// Se monta cuando ya se sabe el perfil: supervisión arranca con Asesor visible.
	const { columnas: columnasBase, menu } = useColumnasVisibles(
		"cartera",
		COLUMNAS_OPCIONALES,
		esSupervision ? ["asesor"] : [],
	);
	const sup = esSupervision ? props.supervision : undefined;
	const segmento = sup?.segmento ?? null;
	const marcadas = sup
		? props.filas.filter((f) => sup.seleccion.has(f.contratoId)).length
		: 0;
	const columnas = sup
		? columnasSupervision(
				columnasBase,
				segmento,
				<CasillaPagina
					marcadas={marcadas}
					total={props.filas.length}
					onMarcar={(m) =>
						sup.onSeleccionar(
							props.filas.map((f) => f.contratoId),
							m,
						)
					}
				/>,
			)
		: columnasBase;

	const sinResultados =
		!props.cargando && !props.error && props.filas.length === 0;
	const soloGestion =
		activos > 0 &&
		activos ===
			(props.filtros.gestion ? 1 : 0) +
				(bucketDeEstadoMora(props.filtros.etapa) ? 1 : 0);
	// Cartera general: el segmento (o el chip de gestión) es lo único que filtra,
	// aparte del asesor.
	const soloSegmento =
		!!sup &&
		(!!segmento || !!props.filtros.gestion) &&
		activos ===
			(props.filtros.gestion ? 1 : 0) +
				(segmento ? 1 : 0) +
				(sup.asesorId !== null ? 1 : 0);

	let vacio: React.ReactNode;
	if (props.error) {
		vacio = (
			<EmptyState
				variant="error"
				size="sm"
				title="No se pudo cargar la cartera"
				description={props.error}
				action={
					props.onReintentar ? (
						<Button size="sm" onClick={props.onReintentar}>
							Reintentar
						</Button>
					) : null
				}
			/>
		);
	} else if (sinResultados && soloSegmento && sup) {
		// Figma 2010:4449: estado vacío del segmento («Sin casos sin contacto»…).
		vacio = (
			<VacioSegmento
				segmento={segmento}
				gestion={props.filtros.gestion}
				onVerTodo={() => {
					sup.onSegmento(null);
					props.onCambiarFiltros({ gestion: null });
				}}
			/>
		);
	} else if (sinResultados && soloGestion) {
		// "Cartera sana" del diseñador: el criterio elegido no tiene pendientes.
		vacio = (
			<EmptyState
				size="sm"
				icon={<CircleCheck aria-hidden className="text-success-solid" />}
				title="Sin pendientes en este criterio"
				description="Ningún crédito de su cartera cumple este criterio en este momento."
				action={
					<Button size="sm" variant="outline" onClick={props.onLimpiarFiltros}>
						Ver toda la cartera
					</Button>
				}
			/>
		);
	} else if (sinResultados && props.total > 0) {
		// El servidor trajo créditos pero los oculta el período o los completados.
		vacio = (
			<EmptyState
				variant="no-data"
				size="sm"
				title="No hay créditos en esta página con estos filtros"
				description="El período elegido o los créditos completados e incobrables ocultan los resultados de esta página. Pruebe con otra página o cambie el período."
			/>
		);
	} else if (sinResultados) {
		vacio = (
			<EmptyState
				variant="no-data"
				size="sm"
				title="No hay créditos con estos filtros"
				description="Revise la búsqueda o quite algunos filtros para ver más resultados."
				action={
					activos > 0 ? (
						<Button size="sm" onClick={props.onLimpiarFiltros}>
							Limpiar filtros
						</Button>
					) : null
				}
			/>
		);
	}

	return (
		// @container: el estado vacío mide el ancho visible, no el de la tabla.
		<div className="@container">
			<TablaCartera
				titulo={segmento ? etiquetaSegmento(segmento) : "Cartera"}
				contador={props.cargando ? null : props.total}
				className={cn(
					"transition-opacity duration-150",
					props.actualizando && "opacity-70",
				)}
				columnas={columnas}
				vacio={vacio ? <EstadoEnTabla>{vacio}</EstadoEnTabla> : null}
				herramientas={
					<>
						<BotonFiltrosCartera
							filtros={props.filtros}
							etapas={props.etapasFiltro ?? props.etapas}
							onCambiar={props.onCambiarFiltros}
							onLimpiar={props.onLimpiarFiltros}
							activos={activos}
							avanzados={avanzados}
						/>
						<MenuOrden orden={props.orden} onOrden={props.onOrden} />
						{menu}
						{props.total > 0 && !props.error ? props.accionMasiva : null}
						{sup?.herramientas}
					</>
				}
				pie={
					props.total > 0 ? (
						<PieTabla
							pagina={props.pagina}
							totalPaginas={props.totalPaginas}
							total={props.total}
							tamanoPagina={props.tamanoPagina}
							onPagina={props.onPagina}
							onTamanoPagina={props.onTamanoPagina}
							deshabilitado={props.cargando}
						/>
					) : null
				}
			>
				{props.cargando
					? Array.from({ length: 8 }, (_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: filas fijas de carga
							<FilaCargando key={i} columnas={columnas} />
						))
					: props.error
						? null
						: props.filas.map((fila, i) => (
								<FilaCreditoAsesor
									key={fila.contratoId}
									fila={fila}
									seleccionada={sup?.seleccion.has(fila.contratoId)}
									extras={{
										...celdasExtra(fila, props.etapas),
										...(sup
											? {
													sel: (
														<CasillaFila
															marcada={sup.seleccion.has(fila.contratoId)}
															onMarcar={(m) =>
																sup.onSeleccionar([fila.contratoId], m)
															}
															etiqueta={`Seleccionar a ${fila.clienteNombre ?? "este cliente"}`}
														/>
													),
													segmento: (
														<CeldaSegmento
															detalle={sup.detalles?.get(
																fila.numeroCredito ?? "",
															)}
														/>
													),
												}
											: {}),
									}}
									onVistaRapida={props.onVistaRapida}
									onAbrir={props.onAbrir ? () => props.onAbrir?.(i) : undefined}
								/>
							))}
			</TablaCartera>
		</div>
	);
}

/* ── Pantalla ───────────────────────────────────────────────────────────────── */

export function MiCarteraVista(props: MiCarteraVistaProps) {
	const { perfil, resumen, filtros, onCambiarFiltros } = props;
	const esSupervision = !!perfil?.esSupervision;
	// Cartera general del supervisor (Figma 2262:12); sin la prop, la de siempre.
	const sup = esSupervision ? props.supervision : undefined;
	const titulo = sup
		? "Cartera general"
		: esSupervision
			? "Cartera"
			: "Mi Cartera";

	const bucketsPerfil: Bucket[] = esSupervision
		? BUCKETS_CARTERA
		: (perfil?.buckets ?? [])
				.map((b) => BUCKETS_CARTERA[b])
				.filter((b): b is Bucket => !!b);
	// Si llega un bucket fuera de los del asesor (p. ej. ?bucket=B3), también se ve.
	const bucketElegido = bucketDeEstadoMora(filtros.etapa);
	const bucketsVisibles =
		bucketElegido && !bucketsPerfil.includes(bucketElegido)
			? [...bucketsPerfil, bucketElegido].sort()
			: bucketsPerfil;

	// En la Cartera general el asesor y el segmento también cuentan como filtros.
	const activos =
		contarFiltrosActivos(filtros) +
		(sup?.segmento ? 1 : 0) +
		(sup && sup.asesorId !== null ? 1 : 0);
	const avanzados = contarFiltrosAvanzados(filtros, bucketsVisibles);

	const sinAsesor = !!perfil && perfil.sinAsesor && !perfil.esSupervision;
	const sinCartera =
		!!perfil &&
		!sinAsesor &&
		!resumen.cargando &&
		resumen.asignados === 0 &&
		!props.cargando &&
		props.total === 0 &&
		activos === 0;

	const asesorElegido =
		sup && sup.asesorId !== null
			? sup.asesores.find((a) => a.asesorId === sup.asesorId)
			: undefined;
	const alcance = sup
		? sup.asesorId === null
			? "cartera general"
			: `cartera de ${asesorElegido?.nombre ?? "un asesor"}`
		: null;

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
						<BreadcrumbPage>
							{sup ? "Cartera del equipo" : "Cartera"}
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>

			<header className="flex flex-col gap-1">
				{sup ? null : perfil ? (
					<p className="font-semibold text-fg-secondary text-xs uppercase leading-4">
						{overline(perfil)}
					</p>
				) : (
					<Skeleton className="h-4 w-60" />
				)}
				<h1 className="font-semibold text-[28px] text-fg leading-9">
					{titulo}
				</h1>
				{sup ? (
					<p className="type-body-base text-fg-secondary">
						<ValorResumen
							valor={resumen.asignados}
							cargando={resumen.cargando}
						/>{" "}
						créditos · {alcance} · B0–B5
					</p>
				) : (
					<p className="type-body-base text-fg-secondary">
						Su cola de trabajo priorizada. Empiece por los casos que requieren
						atención hoy.
					</p>
				)}
			</header>

			{sinAsesor ? (
				<div className="rounded-2xl border border-line-subtle bg-surface shadow-clay-raised">
					<EmptyState
						variant="no-permission"
						title="Su usuario no está vinculado a un asesor de cartera"
						description="Para ver su cartera, contacte a su supervisor para que lo registre como asesor de cobros."
					/>
				</div>
			) : (
				<>
					<EncabezadoOperativo
						resumen={resumen}
						perfil={perfil}
						onAtencionHoy={sup?.onAtencionHoy}
					/>

					{sinCartera ? (
						<div className="rounded-2xl border border-line-subtle bg-surface shadow-clay-raised">
							<EmptyState
								title="Aún no tiene créditos asignados"
								description="Cuando se le asigne cartera, sus créditos aparecerán aquí. Si cree que es un error, contacte a su supervisor."
							/>
						</div>
					) : (
						<>
							<div className="flex flex-col gap-3">
								<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
									<legend className="sr-only">Filtrar por bucket</legend>
									<FilterChip
										seleccionado={filtros.etapa === null}
										cantidad={
											resumen.asignados === null
												? undefined
												: formatoEntero.format(resumen.asignados)
										}
										onClick={() => onCambiarFiltros({ etapa: null })}
									>
										Todos
									</FilterChip>
									{bucketsVisibles.map((b) => {
										const estado = ESTADO_POR_BUCKET[b];
										const conteo = resumen.porBucket[b];
										return (
											<FilterChip
												key={b}
												seleccionado={filtros.etapa === estado}
												cantidad={
													conteo === undefined
														? undefined
														: formatoEntero.format(conteo)
												}
												onClick={() =>
													onCambiarFiltros({
														etapa: filtros.etapa === estado ? null : estado,
													})
												}
											>
												{b}
											</FilterChip>
										);
									})}
								</fieldset>

								<div className="flex flex-wrap items-center gap-3">
									<SearchBar
										shortcut
										containerClassName="w-full sm:w-[360px]"
										placeholder="Buscar cliente, crédito, placa o DPI…"
										aria-label="Buscar cliente, crédito, placa o DPI"
										value={filtros.busqueda}
										onChange={(e) =>
											onCambiarFiltros({ busqueda: e.target.value })
										}
									/>
									{sup ? (
										<>
											<SelectorAsesor
												asesores={sup.asesores}
												asesorId={sup.asesorId}
												onAsesor={sup.onAsesor}
												cargando={sup.asesoresCargando}
											/>
											<ChipsRapidosSupervision
												gestion={filtros.gestion}
												onGestion={(g) => onCambiarFiltros({ gestion: g })}
												segmento={sup.segmento}
												onSegmento={sup.onSegmento}
												conteos={sup.conteos}
											/>
											<BotonSegmentos
												segmento={sup.segmento}
												onSegmento={sup.onSegmento}
												gestion={filtros.gestion}
												onGestion={(g) => onCambiarFiltros({ gestion: g })}
												conteos={sup.conteos}
											/>
										</>
									) : (
										<fieldset className="flex min-w-0 flex-wrap items-center gap-2">
											<legend className="sr-only">Filtrar por gestión</legend>
											{FILTROS_GESTION.map((g) => (
												<FilterChip
													key={g}
													seleccionado={filtros.gestion === g}
													onClick={() =>
														onCambiarFiltros({
															gestion: filtros.gestion === g ? null : g,
														})
													}
												>
													{GESTION_LABEL[g]}
												</FilterChip>
											))}
										</fieldset>
									)}
									{activos > 0 || sup ? (
										<div className="ml-auto flex flex-wrap items-center gap-2.5">
											{activos > 0 ? (
												<>
													<span className="type-label-sm text-fg-tertiary">
														{activos === 1
															? "1 filtro activo"
															: `${activos} filtros activos`}
													</span>
													<FilterBarButton onClick={props.onLimpiarFiltros}>
														Limpiar filtros
													</FilterBarButton>
												</>
											) : null}
											{sup ? (
												<Button size="sm" onClick={sup.onReasignar}>
													<ArrowLeftRight aria-hidden />
													Reasignar en bloque
													{sup.seleccion.size > 0
														? ` · ${formatoEntero.format(sup.seleccion.size)}`
														: ""}
												</Button>
											) : null}
										</div>
									) : null}
								</div>

								<ChipsFiltrosAplicados
									filtros={filtros}
									etapas={props.etapas}
									bucketsVisibles={bucketsVisibles}
									onCambiar={onCambiarFiltros}
								/>

								{sup ? (
									<AvisoSegmento
										segmento={sup.segmento}
										gestion={filtros.gestion}
										avisos={sup.avisos}
										sinFila={sup.sinFila}
										onQuitar={() => sup.onSegmento(null)}
									/>
								) : null}
								{sup ? (
									<BarraSeleccion
										cantidad={sup.seleccion.size}
										onLimpiar={sup.onLimpiarSeleccion}
									/>
								) : null}
							</div>

							{perfil ? (
								<TablaMiCartera
									props={props}
									activos={activos}
									avanzados={avanzados}
								/>
							) : (
								<div className="overflow-hidden rounded-2xl border border-line-subtle bg-surface shadow-clay-raised">
									<SkeletonTable rows={8} />
								</div>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}
