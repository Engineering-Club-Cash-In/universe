import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Skeleton — Figma "02 · Componentes › Skeleton" (125:943).
 *
 * <Skeleton className="h-4 w-32" /> es la pieza base: radio xs (6) y el degradado
 * horizontal de Figma (#ebe8e5 → #f5f5f2 → #ebe8e5 ≈ neutral/200 → neutral/100 →
 * neutral/200; en oscuro carbon/750 → carbon/700). El "shimmer" es
 * animate-shimmer (index.css): el degradado al 200% se desplaza de derecha a izquierda.
 * Tipo de Figma → componente armado:
 *   Texto → <SkeletonText lines>   barras de 14px, gap 10, anchos 100% / 80% / 60%
 *   Card  → <SkeletonCard>         tarjeta 240px, padding 20, gap 14, radio lg, Clay-Raised
 *   Fila  → <SkeletonTable rows>   filas de tabla 52px, padding 12/16, gap 16, divisores
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn(
				"animate-shimmer rounded-sm bg-size-[200%_100%] bg-linear-to-r from-cci-neutral-200 via-cci-neutral-100 to-cci-neutral-200 motion-reduce:animate-none dark:from-cci-carbon-750 dark:via-cci-carbon-700 dark:to-cci-carbon-750",
				className,
			)}
			{...props}
		/>
	);
}

const TEXT_WIDTHS = ["w-full", "w-4/5", "w-3/5"];

/** Figma "Tipo=Texto": párrafo en carga. */
function SkeletonText({
	lines = 3,
	className,
	...props
}: React.ComponentProps<"div"> & { lines?: number }) {
	return (
		<div
			data-slot="skeleton-text"
			aria-hidden
			className={cn("flex w-full flex-col gap-2.5", className)}
			{...props}
		>
			{Array.from({ length: lines }, (_, i) => (
				<Skeleton
					// biome-ignore lint/suspicious/noArrayIndexKey: filas fijas de relleno
					key={i}
					className={cn("h-3.5", TEXT_WIDTHS[i % TEXT_WIDTHS.length])}
				/>
			))}
		</div>
	);
}

/** Figma "Tipo=Card": tarjeta de métrica en carga. */
function SkeletonCard({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton-card"
			aria-hidden
			className={cn(
				"flex w-full max-w-60 flex-col gap-3.5 rounded-2xl bg-surface p-5 shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<div className="flex items-center justify-between gap-2">
				<Skeleton className="h-3 w-27.5" />
				<Skeleton className="size-8 rounded-full" />
			</div>
			<Skeleton className="h-7 w-30" />
			<Skeleton className="h-3 w-22.5" />
		</div>
	);
}

/** Figma "Tipo=Fila": filas de tabla en carga. */
function SkeletonTable({
	rows = 4,
	className,
	...props
}: React.ComponentProps<"div"> & { rows?: number }) {
	return (
		<div
			data-slot="skeleton-table"
			aria-hidden
			className={cn(
				"w-full divide-y divide-divider overflow-hidden rounded-xl border border-line-subtle bg-surface",
				className,
			)}
			{...props}
		>
			{Array.from({ length: rows }, (_, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: filas fijas de relleno
					key={i}
					className="flex items-center gap-4 px-4 py-3"
				>
					<Skeleton className="size-4" />
					<div className="flex w-25 flex-col gap-1.5">
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-2.5 w-full" />
					</div>
					<Skeleton className="h-6 w-7 rounded-md" />
					<Skeleton className="h-4.5 w-17.5 rounded-full" />
					<Skeleton className="h-3 w-22.5" />
					<Skeleton className="h-3 w-30" />
				</div>
			))}
		</div>
	);
}

export { Skeleton, SkeletonCard, SkeletonTable, SkeletonText };
