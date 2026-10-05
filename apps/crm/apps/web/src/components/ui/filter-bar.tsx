import { ListFilter, type LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FilterBar — Figma "02 · Componentes › Filter Bar" (128:1201).
 *
 * Barra de filtros de tablas (Cartera y cualquier listado). Es solo presentación: cada chip es un
 * botón que se usa como disparador de un Popover/DropdownMenu
 * (`<PopoverTrigger asChild><FilterChip … /></PopoverTrigger>`).
 *
 * Figma → código:
 *   Estado=SinFiltros | ConFiltros     → depende de los chips: `active`/`count` en cada <FilterChip>
 *                                        y `activeCount` en <FilterBar>
 *   "lead" (list-filter + "Filtros")   → `label` (default "Filtros") e `icon` (default ListFilter)
 *   divisor 1×20                        → automático
 *   chips (Bucket, Estado de mora…)     → `children` = <FilterChip>
 *     · inactivo: surface + border/default + text/secondary, flecha text/tertiary
 *     · activo:   brand/primary-subtle + borde brand + texto brand, contador brand/on-primary
 *   "3 filtros activos" + "Limpiar"     → `activeCount` + `onClear` (Limpiar solo si hay `onClear`)
 *   "Vistas guardadas" u otras acciones → `actions` (usar <FilterBarButton>)
 * Contenedor: surface + border/subtle, radius/md, p 12/16, gap 10. Con poco ancho los chips bajan
 * de línea (flex-wrap) en vez de desbordar.
 */

function FilterBar({
	label = "Filtros",
	icon: Icon = ListFilter,
	activeCount = 0,
	onClear,
	actions,
	children,
	className,
	...props
}: React.ComponentProps<"div"> & {
	label?: React.ReactNode;
	icon?: LucideIcon;
	/** Filtros aplicados: muestra "N filtros activos" a la derecha. */
	activeCount?: number;
	/** Con filtros activos, muestra el botón "Limpiar". */
	onClear?: () => void;
	/** Acciones a la derecha (p. ej. "Vistas guardadas"). */
	actions?: React.ReactNode;
}) {
	const hasActive = activeCount > 0;

	return (
		<div
			role="toolbar"
			aria-label="Filtros"
			data-slot="filter-bar"
			className={cn(
				"flex w-full flex-wrap items-center gap-2.5 rounded-xl border border-line-subtle bg-surface px-4 py-3",
				className,
			)}
			{...props}
		>
			<div className="flex shrink-0 items-center gap-2">
				<Icon aria-hidden className="size-4 text-fg-secondary" />
				<span className="font-semibold text-[13px] text-fg leading-[1.26]">
					{label}
				</span>
			</div>
			<div aria-hidden className="h-5 w-px shrink-0 bg-divider" />
			{children}
			{hasActive || actions ? (
				<div className="ml-auto flex shrink-0 items-center gap-2.5">
					{hasActive ? (
						<span className="type-label-sm text-fg-tertiary">
							{activeCount === 1
								? "1 filtro activo"
								: `${activeCount} filtros activos`}
						</span>
					) : null}
					{hasActive && onClear ? (
						<FilterBarButton onClick={onClear}>Limpiar</FilterBarButton>
					) : null}
					{actions}
				</div>
			) : null}
		</div>
	);
}

/** Chip de dimensión de filtro ("Bucket", "Asesor"…). Sirve como disparador `asChild`. */
function FilterChip({
	label,
	count,
	active,
	className,
	children,
	...props
}: React.ComponentProps<"button"> & {
	label?: React.ReactNode;
	/** Cantidad de valores elegidos en esa dimensión (pastilla brand). */
	count?: number;
	/** Por defecto, activo si `count` > 0. */
	active?: boolean;
}) {
	const isActive = active ?? (count !== undefined && count > 0);

	return (
		<button
			type="button"
			data-slot="filter-chip"
			data-active={isActive || undefined}
			className={cn(
				"group/chip inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 font-medium text-xs leading-[1.26] outline-none transition-[background-color,border-color,color] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
				isActive
					? "border-brand bg-brand-subtle text-brand hover:bg-cci-primary-100 dark:hover:bg-cci-primary-800"
					: "border-line bg-surface text-fg-secondary hover:bg-muted data-[state=open]:border-brand",
				className,
			)}
			{...props}
		>
			{label ?? children}
			{isActive && count !== undefined && count > 0 ? (
				<span className="inline-flex items-center rounded-full bg-brand px-2 py-0.5 font-semibold text-[10px] text-on-brand leading-[1.26]">
					{count}
				</span>
			) : null}
			{/* Flecha ▾ de 8×5 (polígono de Figma). */}
			<span
				aria-hidden
				className={cn(
					"size-0 shrink-0 border-x-4 border-x-transparent border-t-[5px] transition-transform duration-150 group-data-[state=open]/chip:rotate-180",
					isActive ? "border-t-brand" : "border-t-fg-tertiary",
				)}
			/>
		</button>
	);
}

/** Botón secundario de la barra ("Vistas guardadas", "Limpiar"): borde border/default, 600. */
function FilterBarButton({
	className,
	...props
}: React.ComponentProps<"button">) {
	return (
		<button
			type="button"
			data-slot="filter-bar-button"
			className={cn(
				"inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-line bg-transparent px-3 font-semibold text-fg-secondary text-xs leading-[1.26] outline-none transition-colors duration-150 ease-out hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg:not([class*='size-'])]:size-3.5",
				className,
			)}
			{...props}
		/>
	);
}

export { FilterBar, FilterChip, FilterBarButton };
