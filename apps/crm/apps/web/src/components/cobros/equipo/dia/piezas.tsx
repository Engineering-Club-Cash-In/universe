import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { type Bucket, BucketBadge } from "@/components/ds/badges";
import { bucketSolidClass } from "@/components/ds/distribucion-bucket";
import { KpiCard, type KpiTrendTone } from "@/components/ds/kpi";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
	type BucketsCatalogoQueryData,
	catalogoDeNumero,
} from "@/lib/cobros/buckets-catalogo";
import { cn } from "@/lib/utils";

/**
 * Piezas comunes de «Mi equipo» › Día (Apertura y Cierre), con el lenguaje de
 * Reportería del Figma: «Migración de bucket» (3550:5760) y «B3 · Rescate»
 * (3537:5283).
 *
 *   EncabezadoVistaDia → «perfHeadPersonal»: título 17/600 + subtítulo 13 y, a la
 *                        derecha, los controles (selector de vista, fechas…).
 *   TiraResumen        → «refstrip»: franja gris con «Etiqueta valor · …».
 *   FilaDesplegable    → «Rep/BucketRow v2»: fila con borde que se despliega
 *                        hacia sus sub-filas.
 *   SubFila            → la sub-fila gris de asesor de esa misma fila.
 *   TarjetaReporte     → tarjeta con borde de «Entradas y salidas».
 *   PuntoLista         → renglón de lista con punto, número 16/700 y subtítulo.
 * Presentación pura; los colores salen de los tokens del design system.
 */

/* ── Buckets ──────────────────────────────────────────────────────────────── */

const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];

/** Número de bucket (0–5) → id del DS («B3»); `undefined` fuera de rango. */
export function bucketId(numero: number | null | undefined) {
	return numero == null ? undefined : BUCKETS[numero];
}

/** Nombre del bucket según el catálogo dinámico («Rescate»), con respaldo fijo. */
export function nombreBucket(
	numero: number,
	catalogo: BucketsCatalogoQueryData | undefined,
) {
	const fila = catalogoDeNumero(numero, catalogo);
	if (fila?.label) return fila.label;
	return (
		(
			{
				0: "Cartera Sana",
				1: "Alerta Temprana",
				2: "Gestión Activa",
				3: "Rescate",
				4: "Pre Jurídico",
				5: "Jurídico",
			} as Record<number, string>
		)[numero] ?? `Bucket ${numero}`
	);
}

/** «B3» con el color del bucket (Badge/Bucket compacta del DS). */
export function ChipBucket({
	numero,
	catalogo,
	className,
}: {
	numero: number | null | undefined;
	catalogo?: BucketsCatalogoQueryData;
	className?: string;
}) {
	const id = bucketId(numero);
	if (!id || numero == null) {
		return (
			<span className={cn("font-semibold text-fg-tertiary text-xs", className)}>
				{numero == null ? "—" : `B${numero}`}
			</span>
		);
	}
	return (
		<BucketBadge
			bucket={id}
			className={className}
			title={`${id} · ${nombreBucket(numero, catalogo)}`}
		/>
	);
}

/** Punto de 8px del color del bucket. */
export function PuntoBucket({ numero }: { numero: number }) {
	const id = bucketId(numero);
	return (
		<span
			aria-hidden
			className={cn(
				"size-2 shrink-0 rounded-full",
				id ? bucketSolidClass[id] : "bg-fg-tertiary",
			)}
		/>
	);
}

/* ── Formatos ─────────────────────────────────────────────────────────────── */

export function montoQ(v: number) {
	return Number.isFinite(v)
		? `Q${v.toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})}`
		: "Q0.00";
}

/** «Q18.4K» · «Q1.2M» · «Q850» (valores de fila, como el Figma de Reportería). */
export function montoCompacto(v: number) {
	if (!Number.isFinite(v)) return "Q0";
	const abs = Math.abs(v);
	const corto = (n: number) => n.toFixed(1).replace(/\.0$/, "");
	if (abs >= 1_000_000) return `Q${corto(v / 1_000_000)}M`;
	if (abs >= 1_000) return `Q${corto(v / 1_000)}K`;
	return `Q${Math.round(v).toLocaleString("es-GT")}`;
}

/** «2026-10-07» → «mar 7 oct» (día de calendario, sin zona horaria). */
export function fechaCorta(iso: string) {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	if (!m) return iso;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d
		.toLocaleDateString("es-GT", {
			weekday: "short",
			day: "numeric",
			month: "short",
			timeZone: "UTC",
		})
		.replace(/\./g, "")
		.replace(",", "");
}

export function plural(n: number, uno: string, varios: string) {
	return `${n.toLocaleString("es-GT")} ${n === 1 ? uno : varios}`;
}

/** Neto de migración: bajadas − subidas (positivo = a favor). */
export function tonoNeto(neto: number): KpiTrendTone {
	return neto > 0 ? "positiva" : neto < 0 ? "negativa" : "neutra";
}

/* ── Encabezado de cada vista ─────────────────────────────────────────────── */

export function EncabezadoVistaDia({
	titulo,
	descripcion,
	controles,
}: {
	titulo: React.ReactNode;
	descripcion?: React.ReactNode;
	/** Selector Apertura / Cierre / Gestiones, fechas, filtros. */
	controles?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
			<div className="flex min-w-0 flex-col gap-0.5">
				<h2 className="font-semibold text-[17px] text-fg leading-[1.26]">
					{titulo}
				</h2>
				{descripcion ? (
					<p className="type-body-sm text-fg-secondary">{descripcion}</p>
				) : null}
			</div>
			{controles ? (
				<div className="flex min-w-0 flex-wrap items-center gap-2.5">
					{controles}
				</div>
			) : null}
		</div>
	);
}

/* ── Franja de referencia ─────────────────────────────────────────────────── */

export type ItemTira = {
	etiqueta: React.ReactNode;
	valor: React.ReactNode;
	tono?: "neutral" | "success" | "danger" | "warning";
};

const tonoValor = {
	neutral: "text-fg",
	success: "text-success-text",
	danger: "text-danger-text",
	warning: "text-warning-text",
} as const;

export function TiraResumen({ items }: { items: ItemTira[] }) {
	return (
		<ul className="flex flex-col gap-x-2.5 gap-y-1 rounded-lg bg-muted px-4 py-2.5 text-xs leading-[1.26] sm:flex-row sm:flex-wrap sm:items-center">
			{items.map((item, i) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: lista fija de presentación
					key={i}
					className="flex items-center gap-2.5"
				>
					{i > 0 ? (
						<span aria-hidden className="hidden text-fg-tertiary sm:inline">
							·
						</span>
					) : null}
					<span className="flex flex-wrap items-baseline gap-x-1.25">
						<span className="text-fg-tertiary">{item.etiqueta}</span>
						<span
							className={cn(
								"font-semibold tabular-nums",
								tonoValor[item.tono ?? "neutral"],
							)}
						>
							{item.valor}
						</span>
					</span>
				</li>
			))}
		</ul>
	);
}

/* ── Tarjeta con borde (Reportería) ───────────────────────────────────────── */

export function TarjetaReporte({
	titulo,
	descripcion,
	accion,
	children,
	className,
}: {
	titulo: React.ReactNode;
	descripcion?: React.ReactNode;
	accion?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"flex min-w-0 flex-col gap-3.5 rounded-xl border border-line-subtle bg-surface p-4 sm:p-5",
				className,
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className="font-semibold text-[15px] text-fg leading-[1.26]">
						{titulo}
					</h3>
					{descripcion ? (
						<p className="text-fg-tertiary text-xs leading-[1.26]">
							{descripcion}
						</p>
					) : null}
				</div>
				{accion}
			</div>
			{children}
		</section>
	);
}

/** Título de grupo dentro de una lista («Distribución por bucket · …»). */
export function TituloGrupo({
	titulo,
	ayuda,
}: {
	titulo: React.ReactNode;
	ayuda?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
			<h3 className="font-semibold text-[15px] text-fg leading-[1.26]">
				{titulo}
			</h3>
			{ayuda ? (
				<p className="text-fg-tertiary text-xs leading-[1.26]">{ayuda}</p>
			) : null}
		</div>
	);
}

/* ── Fila que se despliega (Rep/BucketRow v2) ─────────────────────────────── */

export function FilaDesplegable({
	abierta,
	onToggle,
	inicio,
	titulo,
	subtitulo,
	fin,
	children,
	etiqueta,
}: {
	abierta: boolean;
	/** Sin `onToggle` la fila no se despliega (p. ej. un bucket sin casos). */
	onToggle?: () => void;
	inicio?: React.ReactNode;
	titulo: React.ReactNode;
	subtitulo?: React.ReactNode;
	/** Lado derecho: píldoras, valores. */
	fin?: React.ReactNode;
	/** Contenido desplegado (sub-filas). */
	children?: React.ReactNode;
	/** Nombre accesible del botón. */
	etiqueta?: string;
}) {
	const cabecera = (
		<>
			{inicio ? (
				<span className="flex shrink-0 items-center gap-2.5">{inicio}</span>
			) : null}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate font-semibold text-[13px] text-fg leading-[1.26]">
					{titulo}
				</span>
				{subtitulo ? (
					<span className="text-[11px] text-fg-tertiary leading-[1.26]">
						{subtitulo}
					</span>
				) : null}
			</span>
			{fin ? (
				// En móvil baja a su propia línea, debajo del título (el chevron
				// se queda arriba, junto al título).
				<span className="order-last flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-1.5 sm:order-none sm:w-auto sm:flex-nowrap">
					{fin}
				</span>
			) : null}
			<ChevronRight
				aria-hidden
				className={cn(
					"size-4 shrink-0 text-fg-tertiary transition-transform duration-150",
					abierta && "rotate-90",
					!onToggle && "invisible",
				)}
			/>
		</>
	);
	const claseCabecera =
		"flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left sm:flex-nowrap";
	return (
		<div className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
			{onToggle ? (
				<button
					type="button"
					aria-expanded={abierta}
					aria-label={etiqueta}
					onClick={onToggle}
					className={cn(
						claseCabecera,
						"cursor-pointer outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
					)}
				>
					{cabecera}
				</button>
			) : (
				<div className={claseCabecera}>{cabecera}</div>
			)}
			{abierta && children ? (
				<div className="flex flex-col gap-1.5 px-3 pb-3 sm:px-4">
					{children}
				</div>
			) : null}
		</div>
	);
}

/* ── Sub-fila gris ────────────────────────────────────────────────────────── */

export function SubFila({
	onClick,
	inicio,
	titulo,
	subtitulo,
	fin,
	etiqueta,
	className,
}: {
	/** Con `onClick` la sub-fila es un botón (abre la ficha) y lleva «›». */
	onClick?: () => void;
	inicio?: React.ReactNode;
	titulo: React.ReactNode;
	subtitulo?: React.ReactNode;
	fin?: React.ReactNode;
	etiqueta?: string;
	className?: string;
}) {
	const contenido = (
		<>
			{inicio ? (
				<span className="flex shrink-0 items-center gap-2">{inicio}</span>
			) : null}
			<span className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
				<span className="truncate font-semibold text-fg text-xs leading-[1.26]">
					{titulo}
				</span>
				{subtitulo ? (
					<span className="text-[11px] text-fg-tertiary leading-[1.26]">
						{subtitulo}
					</span>
				) : null}
			</span>
			{/* El «›» va pegado a los valores: si en móvil bajan de línea, bajan juntos. */}
			{fin || onClick ? (
				<span className="ml-auto flex items-center gap-2.5">
					{fin ? (
						<span className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
							{fin}
						</span>
					) : null}
					{onClick ? (
						<ChevronRight
							aria-hidden
							className="size-3.5 shrink-0 text-fg-tertiary"
						/>
					) : null}
				</span>
			) : null}
		</>
	);
	const clase = cn(
		"flex w-full flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-md bg-muted px-3 py-2 text-left sm:flex-nowrap sm:px-3.5",
		className,
	);
	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				aria-label={etiqueta}
				className={cn(
					clase,
					"cursor-pointer outline-none transition-colors hover:bg-brand-subtle/60 focus-visible:ring-2 focus-visible:ring-ring",
				)}
			>
				{contenido}
			</button>
		);
	}
	return <div className={clase}>{contenido}</div>;
}

/* ── Valores de la derecha ────────────────────────────────────────────────── */

/** «Q18.4K» 16/700 con su nota 11 terciaria debajo (bloque «vc» del Figma). */
export function ValorNota({
	valor,
	nota,
	tamano = "md",
	className,
}: {
	valor: React.ReactNode;
	nota?: React.ReactNode;
	tamano?: "md" | "sm";
	className?: string;
}) {
	return (
		<span
			className={cn("flex flex-col items-end gap-px text-right", className)}
		>
			<span
				className={cn(
					"whitespace-nowrap font-bold text-fg tabular-nums leading-[1.26]",
					tamano === "md" ? "text-base" : "text-[13px]",
				)}
			>
				{valor}
			</span>
			{nota ? (
				<span className="whitespace-nowrap text-[10px] text-fg-tertiary leading-[1.26]">
					{nota}
				</span>
			) : null}
		</span>
	);
}

/** «↑1 ↓3»: subieron (escalados) y bajaron (recuperados). */
export function Flechas({
	subieron,
	bajaron,
	className,
}: {
	subieron: number;
	bajaron: number;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-[13px] tabular-nums leading-[1.26]",
				className,
			)}
			title={`${plural(subieron, "subió", "subieron")} de bucket · ${plural(bajaron, "bajó", "bajaron")}`}
		>
			<span className="text-danger-text">
				<span aria-hidden>↑</span>
				{subieron}
				<span className="sr-only"> subieron</span>
			</span>
			<span className="text-success-text">
				<span aria-hidden>↓</span>
				{bajaron}
				<span className="sr-only"> bajaron</span>
			</span>
		</span>
	);
}

/** Avatar de iniciales 32px en tono suave (sub-filas de asesor del Figma). */
export function AvatarSuave({
	iniciales,
	neutro = false,
}: {
	iniciales: string;
	neutro?: boolean;
}) {
	return (
		<Avatar size="sm" aria-hidden>
			<AvatarFallback
				className={cn(
					"text-[11px]",
					neutro
						? "bg-line-subtle text-fg-secondary"
						: "bg-brand-subtle text-brand",
				)}
			>
				{iniciales}
			</AvatarFallback>
		</Avatar>
	);
}

/* ── Lista con punto (Entradas y salidas) ─────────────────────────────────── */

export function PuntoLista({
	punto,
	numero,
	texto,
	detalle,
	seleccionado,
	onClick,
}: {
	punto: React.ReactNode;
	numero: React.ReactNode;
	texto: React.ReactNode;
	detalle?: React.ReactNode;
	seleccionado?: boolean;
	onClick?: () => void;
}) {
	const contenido = (
		<>
			<span className="flex items-center gap-2">
				{punto}
				<span className="font-bold text-base text-fg tabular-nums leading-5">
					{numero}
				</span>
				<span className="font-medium text-[13px] text-fg-secondary leading-[1.26]">
					{texto}
				</span>
			</span>
			{detalle ? (
				<span className="pl-4 text-fg-tertiary text-xs leading-[1.26]">
					{detalle}
				</span>
			) : null}
		</>
	);
	const clase =
		"flex w-full flex-col gap-0.75 rounded-lg px-2.5 py-2 text-left";
	if (!onClick) return <div className={clase}>{contenido}</div>;
	return (
		<button
			type="button"
			aria-pressed={seleccionado}
			onClick={onClick}
			className={cn(
				clase,
				"cursor-pointer outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
				seleccionado ? "bg-brand-subtle" : "hover:bg-muted",
			)}
		>
			{contenido}
		</button>
	);
}

/* ── Esqueletos ───────────────────────────────────────────────────────────── */

export function KpisCargando({ cantidad = 4 }: { cantidad?: number }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden>
			{Array.from({ length: cantidad }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: esqueleto fijo
				<KpiCard key={i}>
					<Skeleton className="h-3.5 w-1/2" />
					<Skeleton className="h-9 w-2/3" />
					<Skeleton className="h-2.5 w-full" />
				</KpiCard>
			))}
		</div>
	);
}

export function FilasCargando({ cantidad = 4 }: { cantidad?: number }) {
	return (
		<div className="flex flex-col gap-2" aria-hidden>
			{Array.from({ length: cantidad }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: esqueleto fijo
				<Skeleton key={i} className="h-14 w-full rounded-lg" />
			))}
		</div>
	);
}
