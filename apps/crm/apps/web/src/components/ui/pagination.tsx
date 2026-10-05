import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Pagination — Figma "02 · Componentes › Pagination" (127:1175).
 *
 * Componente de presentación: no pagina datos, solo pinta el estado y avisa con `onPageChange`.
 *
 * Figma → código:
 *   contenedor (surface, border/subtle, radius/md, p 12/16) → <Pagination>
 *   "Mostrando 1–20 de 1,538" (12px, text/tertiary)       → se arma con `totalItems` + `pageSize`,
 *                                                            o se reemplaza con `summary`
 *   "pb" 34×16, radius/sm                                  → botón de página
 *     · actual: brand/primary + brand/on-primary           → página === `page` (aria-current)
 *     · resto: surface + border/subtle + text/secondary
 *     · flechas ‹ › con opacity/disabled en el límite      → ChevronLeft/ChevronRight de lucide
 *   "…" (text/tertiary)                                    → elipsis (ver `getPaginationRange`)
 * Hover (no definido en Figma): fondo muted. El área clicable de cada botón se amplía en
 * vertical con un pseudo-elemento para no quedarse en los 16px del diseño.
 */

type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

/**
 * Páginas a mostrar: primera, última, la actual ±1 (al menos 3 seguidas) y elipsis en los huecos.
 * p. ej. página 1 de 77 → [1, 2, 3, "…", 77]; página 10 de 77 → [1, "…", 9, 10, 11, "…", 77].
 */
function getPaginationRange(page: number, pageCount: number): PaginationItem[] {
	if (pageCount <= 7) {
		return Array.from({ length: Math.max(pageCount, 1) }, (_, i) => i + 1);
	}
	const current = Math.min(Math.max(page, 1), pageCount);
	let start = Math.max(current - 1, 1);
	let end = Math.min(current + 1, pageCount);
	if (current === 1) end = 3;
	if (current === pageCount) start = pageCount - 2;

	const items: PaginationItem[] = [1];
	// Si el hueco es de una sola página, se muestra la página en vez de "…".
	if (start === 3) items.push(2);
	else if (start > 3) items.push("ellipsis-start");
	for (let p = Math.max(start, 2); p <= Math.min(end, pageCount - 1); p++) {
		items.push(p);
	}
	if (end === pageCount - 2) items.push(pageCount - 1);
	else if (end < pageCount - 2) items.push("ellipsis-end");
	items.push(pageCount);
	return items;
}

const numberFormat = new Intl.NumberFormat("es-GT");

const pageButtonClass =
	"relative inline-flex h-4 w-8.5 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line-subtle bg-surface font-medium text-[13px] text-fg-secondary leading-none outline-none transition-colors duration-150 ease-out after:absolute after:-inset-y-2 after:inset-x-0 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3";

type PaginationProps = Omit<React.ComponentProps<"nav">, "onChange"> & {
	/** Página actual, empezando en 1. */
	page: number;
	/** Total de páginas. */
	pageCount: number;
	onPageChange: (page: number) => void;
	/** Total de registros: con `pageSize` arma "Mostrando 1–20 de 1,538". */
	totalItems?: number;
	pageSize?: number;
	/** Reemplaza el texto de la izquierda. `null` lo oculta. */
	summary?: React.ReactNode;
	disabled?: boolean;
};

function Pagination({
	page,
	pageCount,
	onPageChange,
	totalItems,
	pageSize,
	summary,
	disabled = false,
	className,
	...props
}: PaginationProps) {
	const safePageCount = Math.max(pageCount, 1);
	const current = Math.min(Math.max(page, 1), safePageCount);

	let summaryContent: React.ReactNode = summary;
	if (summary === undefined && totalItems !== undefined && pageSize) {
		const from = totalItems === 0 ? 0 : (current - 1) * pageSize + 1;
		const to = Math.min(current * pageSize, totalItems);
		summaryContent = `Mostrando ${numberFormat.format(from)}–${numberFormat.format(to)} de ${numberFormat.format(totalItems)}`;
	}

	const goTo = (target: number) => {
		if (disabled || target < 1 || target > safePageCount || target === current)
			return;
		onPageChange(target);
	};

	return (
		<nav
			aria-label="Paginación"
			data-slot="pagination"
			className={cn(
				"flex w-full items-center justify-between gap-4 rounded-xl border border-line-subtle bg-surface px-4 py-3",
				className,
			)}
			{...props}
		>
			<div className="type-caption min-w-0 truncate text-fg-tertiary">
				{summaryContent}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<button
					type="button"
					className={pageButtonClass}
					aria-label="Página anterior"
					disabled={disabled || current <= 1}
					onClick={() => goTo(current - 1)}
				>
					<ChevronLeft />
				</button>
				{getPaginationRange(current, safePageCount).map((item) =>
					typeof item === "number" ? (
						<button
							key={item}
							type="button"
							aria-label={`Página ${item}`}
							aria-current={item === current ? "page" : undefined}
							disabled={disabled}
							onClick={() => goTo(item)}
							className={cn(
								pageButtonClass,
								item === current &&
									"border-brand bg-brand text-on-brand hover:bg-brand-hover",
							)}
						>
							{item}
						</button>
					) : (
						<span
							key={item}
							aria-hidden="true"
							className="text-[13px] text-fg-tertiary leading-none"
						>
							…
						</span>
					),
				)}
				<button
					type="button"
					className={pageButtonClass}
					aria-label="Página siguiente"
					disabled={disabled || current >= safePageCount}
					onClick={() => goTo(current + 1)}
				>
					<ChevronRight />
				</button>
			</div>
		</nav>
	);
}

export { Pagination, getPaginationRange, type PaginationItem };
