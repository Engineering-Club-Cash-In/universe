import {
	ChartColumn,
	ChevronRight,
	CircleAlert,
	Info,
	type LucideIcon,
} from "lucide-react";
import * as React from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type BucketId, bucketSolidClass } from "./distribucion-bucket";

/**
 * KPI Cards — Figma "03 · Componentes CRM › Componentes Fuente (Masters)" y
 * "KPI Cards — Catálogo de Tipos". Componentes de presentación: reciben todo por props.
 *
 *   KPI/Simple       (109:990)  → <KpiSimple>
 *   KPI/Meta         (110:957)  → <KpiMeta>
 *   KPI/Desglose     (110:969)  → <KpiDesglose>
 *   KPI/Distribución (110:989)  → <KpiDistribucion>
 *   KPI/Ranking      (110:1022) → <KpiRanking>
 *   KPI/Trend        (137:1506) → <KpiTrend>
 *
 * Propiedades de Figma → props:
 *   Título → `title` · Valor → `value` · ValorTendencia → `trendValue`
 *   Comparación → `comparison` · ValorMeta → `target` · Progreso → `progressLabel`
 *   Icono (boolean) → `showIcon` (+ `icon` para cambiar el glifo)
 *   MostrarTendencia (boolean) → `showTrend`
 *   Tendencia (variante) Positiva · Negativa · Neutra → `trend` "positiva" | "negativa" | "neutra"
 *   Info Tooltip junto al título → `info` (texto del tooltip; sin `info` no se muestra)
 *
 * Contenedor común: radius/lg (rounded-2xl), p 20, gap 12, bg/surface, Shadow/Clay-Raised.
 * El ancho es fluido (Figma fija 240/300/340 px): lo define la retícula del dashboard.
 */

export type KpiTrendTone = "positiva" | "negativa" | "neutra";

const trendPillClass: Record<KpiTrendTone, string> = {
	positiva: "bg-success-subtle text-success-text",
	negativa: "bg-danger-subtle text-danger-text",
	// Figma liga los primitivos neutral/200 y neutral/700.
	neutra:
		"bg-cci-neutral-200 text-cci-neutral-700 dark:bg-cci-carbon-750 dark:text-cci-neutral-300",
};

const trendGlyph: Record<KpiTrendTone, string> = {
	positiva: "▲",
	negativa: "▼",
	neutra: "—",
};

/** Base de todas las KPI cards. */
function KpiCard({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="kpi-card"
			className={cn(
				"flex min-w-0 flex-col gap-3 rounded-2xl bg-surface p-5 text-fg shadow-clay-raised",
				className,
			)}
			{...props}
		/>
	);
}

/** Píldora de tendencia (▲ +8%). */
function KpiTrendPill({
	trend = "positiva",
	children,
	className,
}: {
	trend?: KpiTrendTone;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<span
			data-slot="kpi-trend"
			className={cn(
				"inline-flex shrink-0 items-center gap-0.75 whitespace-nowrap rounded-full px-2 py-0.5",
				trendPillClass[trend],
				className,
			)}
		>
			<span aria-hidden className="font-bold text-[9px] leading-[1.26]">
				{trendGlyph[trend]}
			</span>
			<span className="font-semibold text-[10px] leading-[1.26]">
				{children}
			</span>
		</span>
	);
}

/** "Info Tooltip / Estado=Reposo": ícono info 14px terciario con tooltip. */
function KpiInfo({ children }: { children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					aria-label="Más información"
					className="inline-flex shrink-0 cursor-help items-center rounded-full text-fg-tertiary outline-none transition-colors hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Info className="size-3.5" />
				</button>
			</TooltipTrigger>
			<TooltipContent side="top">{children}</TooltipContent>
		</Tooltip>
	);
}

/** Título del KPI (13 / 500 / text-secondary) con su Info Tooltip opcional. */
function KpiTitle({
	children,
	info,
}: {
	children: React.ReactNode;
	info?: React.ReactNode;
}) {
	return (
		// El ícono va en línea con el texto para que siga a la última palabra si el título hace wrap.
		<p className="min-w-0 font-medium text-[13px] text-fg-secondary leading-[1.26]">
			{children}
			{info ? (
				<span className="ml-1.25 inline-flex align-[-2px]">
					<KpiInfo>{info}</KpiInfo>
				</span>
			) : null}
		</p>
	);
}

const kpiValueClass = "font-bold text-[30px] leading-[1.26] text-fg";

/* ────────────────────────────── KPI/Simple ────────────────────────────── */

type KpiSimpleProps = Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	value: React.ReactNode;
	/** Texto del Info Tooltip junto al título. */
	info?: React.ReactNode;
	/** Glifo del ícono (default `ChartColumn`, como en Figma). */
	icon?: LucideIcon;
	/** Figma "Icono". */
	showIcon?: boolean;
	/** Figma "Tendencia" (variante). */
	trend?: KpiTrendTone;
	/** Figma "ValorTendencia", p. ej. "+12" o "+4%". */
	trendValue?: React.ReactNode;
	/** Figma "Comparación", p. ej. "vs. mes anterior". */
	comparison?: React.ReactNode;
	/** Figma "MostrarTendencia". Por defecto se muestra si hay `trendValue`. */
	showTrend?: boolean;
};

function KpiSimple({
	title,
	value,
	info,
	icon: Icon = ChartColumn,
	showIcon = true,
	trend = "positiva",
	trendValue,
	comparison,
	showTrend,
	className,
	...props
}: KpiSimpleProps) {
	const hasTrend = showTrend ?? trendValue != null;
	return (
		<KpiCard data-kpi="simple" className={className} {...props}>
			<div className="flex items-start justify-between gap-2">
				<KpiTitle info={info}>{title}</KpiTitle>
				{showIcon ? (
					<span className="flex h-4 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
						<Icon aria-hidden className="size-4" />
					</span>
				) : null}
			</div>
			<p className={kpiValueClass}>{value}</p>
			{hasTrend ? (
				<div className="flex min-w-0 items-center gap-2">
					{trendValue != null ? (
						<KpiTrendPill trend={trend}>{trendValue}</KpiTrendPill>
					) : null}
					{comparison ? (
						<span className="truncate text-[11px] text-fg-tertiary leading-[1.26]">
							{comparison}
						</span>
					) : null}
				</div>
			) : null}
		</KpiCard>
	);
}

/* ─────────────────────────────── KPI/Meta ─────────────────────────────── */

type KpiMetaProps = Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	info?: React.ReactNode;
	value: React.ReactNode;
	/** Figma "ValorMeta", p. ej. "/ Q 9.2M". */
	target?: React.ReactNode;
	/** Avance de 0 a 100 (ancho de la barra). */
	progress: number;
	/** Figma "Progreso", p. ej. "92% de la meta mensual". */
	progressLabel?: React.ReactNode;
	trend?: KpiTrendTone;
	/** Figma "Tendencia" (texto). */
	trendValue?: React.ReactNode;
};

function KpiMeta({
	title,
	info,
	value,
	target,
	progress,
	progressLabel,
	trend = "positiva",
	trendValue,
	className,
	...props
}: KpiMetaProps) {
	const pct = Math.min(Math.max(progress, 0), 100);
	return (
		<KpiCard data-kpi="meta" className={className} {...props}>
			<div className="flex items-center justify-between gap-2">
				<KpiTitle info={info}>{title}</KpiTitle>
				{trendValue != null ? (
					<KpiTrendPill trend={trend}>{trendValue}</KpiTrendPill>
				) : null}
			</div>
			<div className="flex min-w-0 items-baseline gap-1.5">
				<p className={kpiValueClass}>{value}</p>
				{target ? (
					<span className="font-medium text-fg-tertiary text-sm leading-[1.26]">
						{target}
					</span>
				) : null}
			</div>
			<div
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(pct)}
				className="h-2.5 w-full overflow-hidden rounded-full bg-line-subtle"
			>
				<div
					className="h-full rounded-full bg-brand transition-[width] duration-400 ease-out"
					style={{ width: `${pct}%` }}
				/>
			</div>
			{progressLabel ? (
				<p className="font-medium text-success-text text-xs leading-[1.26]">
					{progressLabel}
				</p>
			) : null}
		</KpiCard>
	);
}

/* ───────────────────────────── KPI/Desglose ───────────────────────────── */

/** Tono del Desglose. Figma solo define "danger" (Casos críticos). */
export type KpiDesgloseTone = "danger" | "warning" | "success" | "info";

const desgloseTone: Record<
	KpiDesgloseTone,
	{ chip: string; icon: string; value: string; dot: string }
> = {
	danger: {
		chip: "bg-danger-subtle",
		icon: "text-danger-solid",
		value: "text-danger-text",
		dot: "bg-danger-solid",
	},
	warning: {
		chip: "bg-warning-subtle",
		icon: "text-warning-solid",
		value: "text-warning-text",
		dot: "bg-warning-solid",
	},
	success: {
		chip: "bg-success-subtle",
		icon: "text-success-solid",
		value: "text-success-text",
		dot: "bg-success-solid",
	},
	info: {
		chip: "bg-info-subtle",
		icon: "text-info-solid",
		value: "text-info-text",
		dot: "bg-info-solid",
	},
};

export type KpiDesgloseItem = {
	value: React.ReactNode;
	label: React.ReactNode;
};

type KpiDesgloseProps = Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	info?: React.ReactNode;
	value: React.ReactNode;
	/** Sub-líneas del total. */
	items: KpiDesgloseItem[];
	/** Default `CircleAlert`. */
	icon?: LucideIcon;
	showIcon?: boolean;
	tone?: KpiDesgloseTone;
};

function KpiDesglose({
	title,
	info,
	value,
	items,
	icon: Icon = CircleAlert,
	showIcon = true,
	tone = "danger",
	className,
	...props
}: KpiDesgloseProps) {
	const t = desgloseTone[tone];
	return (
		<KpiCard data-kpi="desglose" className={className} {...props}>
			<div className="flex items-center justify-between gap-2">
				<KpiTitle info={info}>{title}</KpiTitle>
				{showIcon ? (
					<span
						className={cn(
							"flex w-8 shrink-0 items-center justify-center rounded-lg py-1",
							t.chip,
						)}
					>
						<Icon aria-hidden className={cn("size-4", t.icon)} />
					</span>
				) : null}
			</div>
			<p className={cn(kpiValueClass, t.value)}>{value}</p>
			<hr className="h-px w-full border-0 bg-divider" />
			<ul className="flex flex-col gap-1.5">
				{items.map((item, i) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: lista estática de presentación
						key={i}
						className="flex min-w-0 items-center gap-2"
					>
						<span
							aria-hidden
							className={cn("size-1.5 shrink-0 rounded-full", t.dot)}
						/>
						<span className="font-semibold text-[13px] text-fg leading-[1.26]">
							{item.value}
						</span>
						<span className="truncate text-fg-secondary text-xs leading-[1.26]">
							{item.label}
						</span>
					</li>
				))}
			</ul>
		</KpiCard>
	);
}

/* ─────────────────────────── KPI/Distribución ─────────────────────────── */

export type KpiDistribucionItem = {
	/** Etiqueta corta de la categoría ("B0"…). */
	label: React.ReactNode;
	/** Porcentaje 0–100 (ancho de la barra). */
	percent: number;
	/** Bucket: pinta la barra con `bg-bucket-bN`. */
	bucket?: BucketId;
	/** Color de la barra para categorías que no son buckets (clase de token). */
	barClassName?: string;
	/** Texto de la derecha; por defecto `${percent}%`. */
	display?: React.ReactNode;
};

type KpiDistribucionProps = Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	items: KpiDistribucionItem[];
	/** Si se pasa, cada fila es un botón (el chevron indica el drill-down). */
	onItemClick?: (item: KpiDistribucionItem, index: number) => void;
};

function KpiDistribucion({
	title,
	items,
	onItemClick,
	className,
	...props
}: KpiDistribucionProps) {
	return (
		<KpiCard data-kpi="distribucion" className={className} {...props}>
			<p className="font-semibold text-fg text-sm leading-[1.26]">{title}</p>
			<ul className="flex flex-col gap-2">
				{items.map((item, i) => {
					const pct = Math.min(Math.max(item.percent, 0), 100);
					const content = (
						<>
							<span className="w-6 shrink-0 text-left font-semibold text-[11px] text-fg-secondary leading-[1.26]">
								{item.label}
							</span>
							<span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-cci-neutral-100 dark:bg-cci-carbon-800">
								<span
									className={cn(
										"block h-full rounded-full",
										item.bucket ? bucketSolidClass[item.bucket] : "bg-brand",
										item.barClassName,
									)}
									style={{ width: `${pct}%` }}
								/>
							</span>
							<span className="w-8.5 shrink-0 text-right font-semibold text-[11px] text-fg-secondary tabular-nums leading-[1.26]">
								{item.display ?? `${Math.round(pct)}%`}
							</span>
							<ChevronRight
								aria-hidden
								className="size-3.5 shrink-0 text-fg-tertiary"
							/>
						</>
					);
					const rowClass = "flex w-full items-center gap-2.5";
					return (
						// biome-ignore lint/suspicious/noArrayIndexKey: lista estática de presentación
						<li key={i}>
							{onItemClick ? (
								<button
									type="button"
									onClick={() => onItemClick(item, i)}
									className={cn(
										rowClass,
										"-mx-1 cursor-pointer rounded-md px-1 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
									)}
								>
									{content}
								</button>
							) : (
								<div className={rowClass}>{content}</div>
							)}
						</li>
					);
				})}
			</ul>
		</KpiCard>
	);
}

/* ────────────────────────────── KPI/Ranking ───────────────────────────── */

/** Color del valor. Figma: 92%/88% success, 83% bucket/b1/fg, 76% warning. */
export type KpiRankingTone =
	| "success"
	| "good"
	| "warning"
	| "danger"
	| "neutral";

const rankingToneClass: Record<KpiRankingTone, string> = {
	success: "text-success-text",
	good: "text-bucket-b1-fg",
	warning: "text-warning-text",
	danger: "text-danger-text",
	neutral: "text-fg",
};

export type KpiRankingItem = {
	name: React.ReactNode;
	value: React.ReactNode;
	tone?: KpiRankingTone;
};

type KpiRankingProps = Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	/** Texto a la derecha del título, p. ej. "Mes actual". */
	period?: React.ReactNode;
	/** Ya ordenados: la posición se toma del índice. */
	items: KpiRankingItem[];
};

function KpiRanking({
	title,
	period,
	items,
	className,
	...props
}: KpiRankingProps) {
	return (
		<KpiCard data-kpi="ranking" className={className} {...props}>
			<div className="flex items-center justify-between gap-2">
				<p className="truncate font-semibold text-fg text-sm leading-[1.26]">
					{title}
				</p>
				{period ? (
					<span className="shrink-0 text-[11px] text-fg-tertiary leading-[1.26]">
						{period}
					</span>
				) : null}
			</div>
			<ol className="flex flex-col gap-2.5">
				{items.map((item, i) => (
					<li
						// biome-ignore lint/suspicious/noArrayIndexKey: la posición es el índice
						key={i}
						className="flex min-w-0 items-center justify-between gap-2.5"
					>
						<span className="flex min-w-0 items-center gap-2.5">
							<span className="flex w-5 shrink-0 items-center justify-center rounded-full bg-cci-neutral-100 font-bold text-[10px] text-fg-secondary leading-[1.26] dark:bg-cci-carbon-800">
								{i + 1}
							</span>
							<span className="truncate font-medium text-[13px] text-fg leading-[1.26]">
								{item.name}
							</span>
						</span>
						<span
							className={cn(
								"shrink-0 font-bold text-[13px] tabular-nums leading-[1.26]",
								rankingToneClass[item.tone ?? "neutral"],
							)}
						>
							{item.value}
						</span>
					</li>
				))}
			</ol>
		</KpiCard>
	);
}

/* ─────────────────────────────── KPI/Trend ────────────────────────────── */

const sparklineToneClass: Record<KpiTrendTone, string> = {
	positiva: "text-success-solid",
	negativa: "text-danger-solid",
	// Figma liga el primitivo neutral/500.
	neutra: "text-cci-neutral-500 dark:text-cci-neutral-400",
};

const SPARK_W = 260;
const SPARK_H = 60;
// La línea ocupa y 6…54 (Vector 260x48) y el área baja hasta 60 (Vector 260x54).
const SPARK_TOP = 6;
const SPARK_BOTTOM = 54;

function sparkPoints(data: number[]) {
	const min = Math.min(...data);
	const max = Math.max(...data);
	const range = max - min || 1;
	const step = data.length > 1 ? SPARK_W / (data.length - 1) : 0;
	return data.map((d, i) => ({
		x: i * step,
		y:
			max === min
				? (SPARK_TOP + SPARK_BOTTOM) / 2
				: SPARK_BOTTOM - ((d - min) / range) * (SPARK_BOTTOM - SPARK_TOP),
	}));
}

/** Sparkline: línea de 2px + área con degradado (25% → 0%) + punto final. */
function KpiSparkline({
	data,
	trend = "positiva",
	className,
}: {
	data: number[];
	trend?: KpiTrendTone;
	className?: string;
}) {
	const gradientId = React.useId();
	if (data.length === 0) return <div className={cn("h-15", className)} />;
	const points = sparkPoints(data.length === 1 ? [data[0], data[0]] : data);
	const line = points
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
		.join(" ");
	const area = `${line} L${SPARK_W},${SPARK_H} L0,${SPARK_H} Z`;
	const last = points[points.length - 1];
	return (
		<div
			className={cn(
				"relative h-15 w-full",
				sparklineToneClass[trend],
				className,
			)}
		>
			<svg
				aria-hidden="true"
				viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
				preserveAspectRatio="none"
				className="absolute inset-0 size-full overflow-visible"
			>
				<defs>
					<linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
						<stop offset="100%" stopColor="currentColor" stopOpacity={0} />
					</linearGradient>
				</defs>
				<path d={area} fill={`url(#${gradientId})`} />
				<path
					d={line}
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinejoin="round"
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			{/* Punto final: 6px, relleno del tono y borde de 2px del color de la card. */}
			<span
				aria-hidden="true"
				className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-current"
				style={{
					left: `${(last.x / SPARK_W) * 100}%`,
					top: `${(last.y / SPARK_H) * 100}%`,
				}}
			/>
		</div>
	);
}

type KpiTrendProps = Omit<React.ComponentProps<"div">, "title"> & {
	title: React.ReactNode;
	info?: React.ReactNode;
	value: React.ReactNode;
	/** Figma "Tendencia" (variante): color de la píldora y del sparkline. */
	trend?: KpiTrendTone;
	/** Figma "Tendencia" (texto), p. ej. "+12%". */
	trendValue?: React.ReactNode;
	/** Serie del sparkline (en orden cronológico). */
	data: number[];
	/** Etiquetas del eje: inicio y fin, p. ej. ["Feb", "Jul"]. */
	range?: [React.ReactNode, React.ReactNode];
};

function KpiTrend({
	title,
	info,
	value,
	trend = "positiva",
	trendValue,
	data,
	range,
	className,
	...props
}: KpiTrendProps) {
	return (
		<KpiCard data-kpi="trend" className={cn("gap-3.5", className)} {...props}>
			<div className="flex items-center justify-between gap-2">
				<KpiTitle info={info}>{title}</KpiTitle>
				{trendValue != null ? (
					<KpiTrendPill trend={trend}>{trendValue}</KpiTrendPill>
				) : null}
			</div>
			<p className="type-number-lg text-fg">{value}</p>
			<KpiSparkline data={data} trend={trend} />
			{range ? (
				<div className="flex items-center justify-between text-[10px] text-fg-tertiary leading-[1.26]">
					<span>{range[0]}</span>
					<span>{range[1]}</span>
				</div>
			) : null}
		</KpiCard>
	);
}

export {
	KpiCard,
	KpiDesglose,
	KpiDistribucion,
	KpiMeta,
	KpiRanking,
	KpiSimple,
	KpiSparkline,
	KpiTrend,
	KpiTrendPill,
};
