import { ArrowRightLeft, ChevronDown, Pencil, UserX } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { CrmPill, inicialesDe } from "@/components/ds/cards-credito";
import { KpiCard, KpiMeta, KpiSimple } from "@/components/ds/kpi";
import { CellAvatar } from "@/components/ds/table-cells";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Resumen de carga de «Mi equipo» › Carga y asignación (los datos de la vieja
 * `/cobros/carga`), con la estructura del Figma de Reportería (3550:5760):
 *
 *   KPIs (ds/kpi)        → cuentas, capacidad, % de utilización y sobrecargados.
 *   «Carga por bucket»   → una fila por bucket (asesores en pool, cuentas,
 *                          alertas y % de uso) que se despliega hacia sus
 *                          asesores: avatar, «N de M cuentas · capacidad para
 *                          +K», barra de utilización y las acciones Trasladar
 *                          cartera, Marcar ausente y Editar capacidad (esta
 *                          solo la ve el rol admin).
 *
 * Al desplegar un bucket se ve su reparto por asesor: reemplaza la tabla
 * «Reparto por asesor» y su filtro de bucket. Por defecto quedan abiertos los
 * buckets con alertas o sobrecarga. Presentación pura: el contenedor
 * (`MiEquipoAsignacion`) hace la consulta `getCargaPorAsesorBucket`.
 */

/** Buckets del funnel operativo B0–B5 (filtro del historial de reasignaciones). */
export const BUCKETS_FILTRO: { numero: number; label: string }[] = [
	{ numero: 0, label: "B0 · Cartera Sana" },
	{ numero: 1, label: "B1 · Alerta Temprana" },
	{ numero: 2, label: "B2 · Gestión Activa" },
	{ numero: 3, label: "B3 · Rescate" },
	{ numero: 4, label: "B4 · Última Instancia / Pre Jurídico" },
	{ numero: 5, label: "B5 · Jurídico" },
];

export type CargaDetalle = {
	bucket: number;
	cuentas: number;
	capacidad_base: number;
	utilizacion_pct: number;
	elegible: boolean;
	sobrecarga: boolean;
	alerta_nueva_posicion: boolean;
	margen_alerta_tipo: "porcentaje" | "fijo";
	margen_alerta_valor: number;
};

export type CargaData = {
	buckets: {
		numero: number;
		prefijo: string;
		nombre: string;
		color: string | null;
		cuentas_totales: number;
		asesores_en_pool: number;
		asesores_en_alerta: number;
		asesores_sobrecargados: number;
	}[];
	porAsesor: {
		asesor_id: number;
		nombre: string;
		email_asesor: string | null;
		porBucket: CargaDetalle[];
	}[];
};

export type EdicionCapacidad = {
	asesorId: number;
	nombre: string;
	bucket: number;
	capacidadBase: number;
	margenAlertaTipo: "porcentaje" | "fijo";
	margenAlertaValor: number;
	/** Cuentas actuales en ese bucket (contexto del modal). */
	cuentas?: number;
};

export type CargaResumenVistaProps = {
	data: CargaData | undefined;
	cargando: boolean;
	error: boolean;
	onReintentar?: () => void;
	/** El lápiz de capacidad solo lo ve el rol admin (endpoint adminProcedure). */
	esAdmin: boolean;
	onEditarCapacidad: (edicion: EdicionCapacidad) => void;
	onTrasladar: (asesorId: number) => void;
	onMarcarAusente: (asesorId: number) => void;
};

/* ── Utilidades ─────────────────────────────────────────────────────────── */

type Tono = "success" | "warning" | "danger";

// El color depende de las banderas que YA resolvió el backend (sobrecarga /
// alerta_nueva_posicion), no de comparar % contra un umbral propio — el
// margen que dispara la alerta puede ser % o cantidad fija (asesor_bucket.
// margen_alerta_tipo/valor), así que "pct >= umbral" ya no es válido en
// general. Rojo = sobrecarga (pasó capacidad_base), ámbar = alerta (pasó
// capacidad_base + margen), verde = normal.
function tonoUtilizacion(sobrecarga: boolean, alerta: boolean): Tono {
	if (sobrecarga) return "danger";
	if (alerta) return "warning";
	return "success";
}

const TEXTO_TONO: Record<Tono, string> = {
	success: "text-success-text",
	warning: "text-warning-text",
	danger: "text-danger-text",
};

const PUNTO_TONO: Record<Tono | "neutral", string> = {
	success: "bg-success-solid",
	warning: "bg-warning-solid",
	danger: "bg-danger-solid",
	neutral: "bg-fg-tertiary",
};

const formato = (n: number) => n.toLocaleString("es-GT");

function aBucket(numero: number): Bucket | null {
	return numero >= 0 && numero <= 5 ? (`B${numero}` as Bucket) : null;
}

/** Avatar chico de las filas del Figma (iniciales en marca suave). */
export function AvatarMini({
	nombre,
	className,
}: {
	nombre: string;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle font-semibold text-[10px] text-brand leading-none",
				className,
			)}
		>
			{inicialesDe(nombre)}
		</span>
	);
}

/* ── KPIs ──────────────────────────────────────────────────────────────── */

function KpisCarga({
	cuentas,
	capacidad,
	utilizacion,
	sobrecargados,
	enAlerta,
}: {
	cuentas: number;
	capacidad: number;
	utilizacion: number;
	sobrecargados: number;
	enAlerta: number;
}) {
	const libres = capacidad - cuentas;
	const tono = tonoUtilizacion(sobrecargados > 0, enAlerta > 0);
	return (
		<div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
			<KpiSimple
				title="Cuentas asignadas"
				info="Cuentas activas del equipo, sumadas por asesor y bucket."
				value={formato(cuentas)}
				showIcon={false}
			/>
			<KpiSimple
				title="Capacidad del equipo"
				info="Suma de la capacidad base de cada asesor en cada bucket de su pool. El techo es por asesor dentro de cada bucket."
				value={formato(capacidad)}
				showIcon={false}
				showTrend
				comparison={
					libres >= 0
						? `${formato(libres)} cupos libres`
						: `${formato(-libres)} cuentas sobre la capacidad`
				}
			/>
			<KpiMeta
				title="Utilización global"
				info="Cuentas asignadas sobre la capacidad del equipo."
				value={
					<span className={TEXTO_TONO[tono]}>{utilizacion.toFixed(1)}%</span>
				}
				progress={utilizacion}
			/>
			<KpiSimple
				title="Sobrecargados"
				info="Asesores por encima de su capacidad base en un bucket (cada asesor cuenta una vez por bucket). Las alertas de posición (nueva posición) avisan que, con la capacidad más el margen, ya amerita abrir otra plaza."
				value={
					<span className={sobrecargados > 0 ? "text-danger-text" : undefined}>
						{formato(sobrecargados)}
					</span>
				}
				showIcon={false}
				showTrend
				comparison={`${formato(enAlerta)} ${enAlerta === 1 ? "alerta" : "alertas"} de posición`}
			/>
		</div>
	);
}

/* ── Fila de asesor (dentro de un bucket) ─────────────────────────────── */

function AccionIcono({
	etiqueta,
	onClick,
	disabled,
	titulo,
	children,
}: {
	etiqueta: string;
	onClick: () => void;
	disabled?: boolean;
	/** Motivo por el que está deshabilitada (tooltip nativo). */
	titulo?: string;
	children: ReactNode;
}) {
	const boton = (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label={etiqueta}
			disabled={disabled}
			title={disabled ? titulo : undefined}
			onClick={onClick}
		>
			{children}
		</Button>
	);
	if (disabled) return <span title={titulo}>{boton}</span>;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{boton}</TooltipTrigger>
			<TooltipContent side="top">{etiqueta}</TooltipContent>
		</Tooltip>
	);
}

function FilaAsesorCarga({
	asesorId,
	nombre,
	detalle,
	esAdmin,
	onEditarCapacidad,
	onTrasladar,
	onMarcarAusente,
}: {
	asesorId: number;
	nombre: string;
	detalle: CargaDetalle;
} & Pick<
	CargaResumenVistaProps,
	"esAdmin" | "onEditarCapacidad" | "onTrasladar" | "onMarcarAusente"
>) {
	const d = detalle;
	const tono = tonoUtilizacion(d.sobrecarga, d.alerta_nueva_posicion);
	const libre = d.capacidad_base - d.cuentas;
	const capacidadTexto = d.sobrecarga
		? `${formato(Math.max(-libre, 0))} sobre su capacidad`
		: libre > 0
			? `capacidad para +${formato(libre)}`
			: "sin capacidad disponible";
	const chips =
		d.sobrecarga || d.alerta_nueva_posicion ? (
			<>
				{d.sobrecarga ? (
					<CrmPill tone="danger" kind="chip" className="px-2.5 py-0.5">
						Sobrecarga
					</CrmPill>
				) : null}
				{d.alerta_nueva_posicion ? (
					<CrmPill
						tone="warning"
						kind="chip"
						className="px-2.5 py-0.5"
						title="Llegó a su capacidad más el margen de alerta: amerita abrir una nueva posición."
					>
						Nueva posición
					</CrmPill>
				) : null}
			</>
		) : null;
	// Móvil: nombre · chips · barra y acciones, en tres líneas. Desde `sm`,
	// una sola fila con columnas fijas (barra, chips, acciones).
	return (
		<li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-canvas px-3 py-2.5 sm:flex-nowrap sm:px-3.5">
			<CellAvatar
				nombre={nombre}
				avatar={<AvatarMini nombre={nombre} />}
				subtitulo={
					<>
						{formato(d.cuentas)} de {formato(d.capacidad_base)} cuentas ·{" "}
						<span
							className={
								d.sobrecarga
									? "text-danger-text"
									: libre <= 0
										? "text-warning-text"
										: undefined
							}
						>
							{capacidadTexto}
						</span>
					</>
				}
				className="w-auto min-w-0 flex-1 basis-full sm:basis-auto"
			/>
			{chips ? (
				<div className="flex basis-full flex-wrap gap-1 pl-10 sm:hidden">
					{chips}
				</div>
			) : null}
			<div className="flex min-w-0 flex-1 items-center gap-2 sm:w-44 sm:flex-none">
				<Progress
					value={Math.min(d.utilizacion_pct, 100)}
					size="sm"
					tone={tono}
					aria-label={`Utilización de ${nombre} en B${d.bucket}`}
					className="min-w-16 flex-1"
				/>
				<span
					className={cn(
						"w-12 shrink-0 text-right font-semibold text-xs tabular-nums leading-[1.26]",
						TEXTO_TONO[tono],
					)}
				>
					{d.utilizacion_pct.toFixed(1)}%
				</span>
			</div>
			<div className="hidden w-36 shrink-0 flex-wrap gap-1 sm:flex">
				{chips}
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				<AccionIcono
					etiqueta={`Trasladar la cartera de ${nombre}`}
					onClick={() => onTrasladar(asesorId)}
				>
					<ArrowRightLeft aria-hidden />
				</AccionIcono>
				<AccionIcono
					etiqueta={`Marcar ausente a ${nombre}`}
					onClick={() => onMarcarAusente(asesorId)}
				>
					<UserX aria-hidden />
				</AccionIcono>
				{esAdmin ? (
					<AccionIcono
						etiqueta={`Editar capacidad de ${nombre} en B${d.bucket}`}
						disabled={!d.elegible}
						titulo="Este asesor no tiene una fila activa en el pool de este bucket: no se puede editar su capacidad."
						onClick={() =>
							onEditarCapacidad({
								asesorId,
								nombre,
								bucket: d.bucket,
								capacidadBase: d.capacidad_base,
								margenAlertaTipo: d.margen_alerta_tipo,
								margenAlertaValor: d.margen_alerta_valor,
								cuentas: d.cuentas,
							})
						}
					>
						<Pencil aria-hidden />
					</AccionIcono>
				) : null}
			</div>
		</li>
	);
}

/* ── Fila de bucket ───────────────────────────────────────────────────── */

type BucketCarga = CargaData["buckets"][number];

function FilaBucket({
	bucket,
	asesores,
	abierto,
	onAbierto,
	...acciones
}: {
	bucket: BucketCarga;
	asesores: { asesorId: number; nombre: string; detalle: CargaDetalle }[];
	abierto: boolean;
	onAbierto: (abierto: boolean) => void;
} & Pick<
	CargaResumenVistaProps,
	"esAdmin" | "onEditarCapacidad" | "onTrasladar" | "onMarcarAusente"
>) {
	const b = aBucket(bucket.numero);
	const cuentasPool = asesores.reduce((t, a) => t + a.detalle.cuentas, 0);
	const capacidad = asesores.reduce((t, a) => t + a.detalle.capacidad_base, 0);
	const uso = capacidad > 0 ? Math.round((cuentasPool / capacidad) * 100) : 0;
	const estado: Tono | "neutral" =
		bucket.asesores_en_pool === 0 && asesores.length === 0
			? "neutral"
			: tonoUtilizacion(
					bucket.asesores_sobrecargados > 0,
					bucket.asesores_en_alerta > 0,
				);
	const desplegable = asesores.length > 0;
	const chips = (
		<>
			{bucket.asesores_sobrecargados > 0 ? (
				<CrmPill
					tone="danger"
					kind="chip"
					dot={false}
					className="px-2 py-0.5 font-semibold text-[11px]"
				>
					{bucket.asesores_sobrecargados} de sobrecarga
				</CrmPill>
			) : null}
			{bucket.asesores_en_alerta > 0 ? (
				<CrmPill
					tone="warning"
					kind="chip"
					dot={false}
					className="px-2 py-0.5 font-semibold text-[11px]"
				>
					{bucket.asesores_en_alerta}{" "}
					{bucket.asesores_en_alerta === 1 ? "alerta" : "alertas"} de nueva
					posición
				</CrmPill>
			) : null}
		</>
	);
	const cabecera = (
		<>
			{b ? (
				<BucketBadge bucket={b} />
			) : (
				<span className="font-bold text-xs">{bucket.prefijo}</span>
			)}
			<span
				aria-hidden
				className={cn("size-2.25 shrink-0 rounded-full", PUNTO_TONO[estado])}
			/>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-semibold text-[13px] text-fg leading-[1.26]">
					{bucket.nombre}
				</span>
				<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
					{bucket.asesores_en_pool === 0
						? "Sin asesores en el pool"
						: `${bucket.asesores_en_pool} ${bucket.asesores_en_pool === 1 ? "asesor" : "asesores"} en el pool`}
					{capacidad > 0 ? ` · ${uso}% de su capacidad` : ""}
				</span>
				{bucket.asesores_sobrecargados > 0 || bucket.asesores_en_alerta > 0 ? (
					<span className="mt-1 flex flex-wrap gap-1.5 sm:hidden">{chips}</span>
				) : null}
			</span>
			<span className="hidden shrink-0 flex-wrap justify-end gap-1.5 sm:flex">
				{chips}
			</span>
			<span className="flex w-16 shrink-0 flex-col items-end gap-0.5">
				<span className="font-bold text-base text-fg tabular-nums leading-[1.26]">
					{formato(bucket.cuentas_totales)}
				</span>
				<span className="text-[11px] text-fg-tertiary leading-[1.26]">
					cuentas
				</span>
			</span>
		</>
	);

	return (
		<Collapsible open={desplegable && abierto} onOpenChange={onAbierto} asChild>
			<li className="overflow-hidden rounded-xl border border-line-subtle bg-surface">
				{desplegable ? (
					<CollapsibleTrigger className="group/bucket flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
						{cabecera}
						<ChevronDown
							aria-hidden
							className="size-4 shrink-0 text-fg-tertiary transition-transform duration-150 group-data-[state=open]/bucket:rotate-180"
						/>
					</CollapsibleTrigger>
				) : (
					<div className="flex w-full items-center gap-3 px-4 py-3">
						{cabecera}
						<span aria-hidden className="size-4 shrink-0" />
					</div>
				)}
				{desplegable ? (
					<CollapsibleContent>
						<ul
							aria-label={`Asesores de ${bucket.prefijo}`}
							className="flex flex-col gap-1.5 px-3 pb-3 sm:px-4"
						>
							{asesores.map((a) => (
								<FilaAsesorCarga
									key={a.asesorId}
									asesorId={a.asesorId}
									nombre={a.nombre}
									detalle={a.detalle}
									{...acciones}
								/>
							))}
						</ul>
					</CollapsibleContent>
				) : null}
			</li>
		</Collapsible>
	);
}

/* ── Vista ──────────────────────────────────────────────────────────── */

function CargandoResumen() {
	return (
		<div className="flex flex-col gap-5" aria-hidden>
			<div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<KpiCard key={i}>
						<Skeleton className="h-3.5 w-1/2" />
						<Skeleton className="h-9 w-2/3" />
					</KpiCard>
				))}
			</div>
			<div className="flex flex-col gap-2.5">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-15 w-full rounded-xl" />
				))}
			</div>
		</div>
	);
}

export function CargaResumenVista({
	data,
	cargando,
	error,
	onReintentar,
	esAdmin,
	onEditarCapacidad,
	onTrasladar,
	onMarcarAusente,
}: CargaResumenVistaProps) {
	// Buckets abiertos; `null` = los de por defecto (con alertas o sobrecarga).
	const [abiertos, setAbiertos] = useState<Set<number> | null>(null);
	const buckets = data?.buckets ?? [];
	const porAsesor = data?.porAsesor ?? [];

	// Capacidad/% utilización/sobrecarga son SIEMPRE por asesor+bucket (ticket,
	// confirmado con el informador: el techo de 300 es "la cantidad que puede
	// atender un asesor", no un agregado del bucket completo). Los KPIs
	// globales suman/promedian sobre el detalle por asesor, no sobre buckets[].
	const filasAsesorBucket = porAsesor.flatMap((a) => a.porBucket);
	const cuentasTotales = filasAsesorBucket.reduce((s, d) => s + d.cuentas, 0);
	const capacidadTotal = filasAsesorBucket.reduce(
		(s, d) => s + d.capacidad_base,
		0,
	);
	const utilizacionGlobalPct =
		capacidadTotal > 0
			? Math.round((cuentasTotales / capacidadTotal) * 1000) / 10
			: 0;
	const asesoresEnAlerta = filasAsesorBucket.filter(
		(d) => d.alerta_nueva_posicion,
	).length;
	const asesoresSobrecargados = filasAsesorBucket.filter(
		(d) => d.sobrecarga,
	).length;

	// Reparto por asesor agrupado por bucket, los más cargados primero.
	const asesoresDe = (numero: number) =>
		porAsesor
			.flatMap((a) =>
				a.porBucket
					.filter((d) => d.bucket === numero)
					.map((detalle) => ({
						asesorId: a.asesor_id,
						nombre: a.nombre,
						detalle,
					})),
			)
			.sort((x, y) => y.detalle.utilizacion_pct - x.detalle.utilizacion_pct);
	const porDefecto = new Set(
		buckets
			.filter((b) => b.asesores_en_alerta > 0 || b.asesores_sobrecargados > 0)
			.map((b) => b.numero),
	);
	const vigentes = abiertos ?? porDefecto;
	const conAsesores = buckets.filter((b) => asesoresDe(b.numero).length > 0);
	const todosAbiertos =
		conAsesores.length > 0 && conAsesores.every((b) => vigentes.has(b.numero));

	if (cargando && !data) return <CargandoResumen />;
	if (error && !data) {
		return (
			<EmptyState
				variant="error"
				size="sm"
				title="No se pudo cargar la carga del equipo"
				description="No se pudo cargar la carga de cuentas por asesor y bucket. Intente de nuevo."
				action={
					onReintentar ? (
						<Button variant="outline" size="sm" onClick={onReintentar}>
							Reintentar
						</Button>
					) : undefined
				}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-5">
			<KpisCarga
				cuentas={cuentasTotales}
				capacidad={capacidadTotal}
				utilizacion={utilizacionGlobalPct}
				sobrecargados={asesoresSobrecargados}
				enAlerta={asesoresEnAlerta}
			/>

			<section aria-label="Carga por bucket" className="flex flex-col gap-3">
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
					<div className="flex min-w-0 flex-col gap-0.5">
						<h3 className="font-bold text-[15px] text-fg leading-[1.26]">
							Carga por bucket · reparto por asesor
						</h3>
						<p className="text-fg-secondary text-xs leading-[1.26]">
							Toque un bucket para ver a sus asesores y sus acciones.
						</p>
					</div>
					{conAsesores.length > 0 ? (
						<Button
							variant="text"
							size="sm"
							className="-mr-2"
							onClick={() =>
								setAbiertos(
									todosAbiertos
										? new Set()
										: new Set(conAsesores.map((b) => b.numero)),
								)
							}
						>
							{todosAbiertos ? "Plegar todos" : "Ver todos los asesores"}
						</Button>
					) : null}
				</div>
				{buckets.length === 0 ? (
					<EmptyState
						variant="no-data"
						size="sm"
						title="Sin datos"
						description="No hay buckets con carga para mostrar."
					/>
				) : (
					<ul className="flex flex-col gap-2.5">
						{buckets.map((b) => (
							<FilaBucket
								key={b.numero}
								bucket={b}
								asesores={asesoresDe(b.numero)}
								abierto={vigentes.has(b.numero)}
								onAbierto={(abrir) => {
									const siguiente = new Set(vigentes);
									if (abrir) siguiente.add(b.numero);
									else siguiente.delete(b.numero);
									setAbiertos(siguiente);
								}}
								esAdmin={esAdmin}
								onEditarCapacidad={onEditarCapacidad}
								onTrasladar={onTrasladar}
								onMarcarAusente={onMarcarAusente}
							/>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

/** Encabezado de la sección de carga (lo usa `AsignacionVista`). */
export function EncabezadoCarga() {
	return (
		<SectionHeader
			titleAs="h2"
			title="Carga del equipo"
			description="Cuentas activas por asesor y bucket frente a su capacidad. El techo es por asesor dentro de cada bucket."
		/>
	);
}
