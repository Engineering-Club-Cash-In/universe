import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import {
	ArrowUpDown,
	Columns3,
	EllipsisVertical,
	Eye,
	ListFilter,
	type LucideIcon,
	Phone,
	Search,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Botones de tabla — Figma "02 · Componentes › Botones de Tabla".
 *
 * ToolbarButton = Button/Toolbar (130:1209). Va en la barra superior de una tabla.
 *   Acción  Buscar · Filtros · Ordenar · Columnas → `action` ("buscar" | "filtros" |
 *           "ordenar" | "columnas"): pone el ícono y el texto de Figma. Con `icon` y
 *           `children` se arma cualquier otra acción.
 *   Estado  Default → (nada) · Hover → :hover · Activo → `active` o data-state="open"
 *           (queda activo solo cuando abre un Popover/DropdownMenu con asChild).
 *   31px de alto, padding 8/12, gap 6, radio md(14), texto 12/500, ícono XS (14px).
 *
 * QuickActionButton = Button/QuickAction (130:1234). Acción rápida de una fila.
 *   Acción  Llamar · Ver · Más → `action` ("llamar" | "ver" | "mas"), con su ícono y
 *           aria-label. `icon` + `aria-label` para otras acciones.
 *   Estado  Default → (nada) · Hover → :hover (también data-state="open").
 *   32×22, radio md(14), fondo bg/canvas, borde border/subtle, ícono XS.
 *
 * Ícono XS de Figma: 14px con trazo de 2px absoluto (`absoluteStrokeWidth`), más grueso
 * que el de lucide escalado.
 */

const toolbarActions = {
	buscar: { icon: Search, label: "Buscar" },
	filtros: { icon: ListFilter, label: "Filtros" },
	ordenar: { icon: ArrowUpDown, label: "Ordenar" },
	columnas: { icon: Columns3, label: "Columnas" },
} satisfies Record<string, { icon: LucideIcon; label: string }>;

const quickActions = {
	llamar: { icon: Phone, label: "Llamar" },
	ver: { icon: Eye, label: "Ver" },
	mas: { icon: EllipsisVertical, label: "Más acciones" },
} satisfies Record<string, { icon: LucideIcon; label: string }>;

const toolbarButtonVariants = cva(
	"inline-flex h-7.75 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border px-2.75 font-medium text-xs/3.75 outline-none transition-[background-color,border-color,color,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			active: {
				false:
					"border-line-subtle bg-surface text-fg-secondary hover:bg-cci-neutral-50 data-[state=open]:border-brand data-[state=open]:bg-brand-subtle data-[state=open]:text-brand dark:hover:bg-cci-carbon-800",
				true: "border-brand bg-brand-subtle text-brand",
			},
		},
		defaultVariants: { active: false },
	},
);

function ToolbarButton({
	className,
	action,
	active = false,
	icon,
	asChild = false,
	children,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof toolbarButtonVariants> & {
		/** Acción de Figma: pone el ícono y el texto por defecto. */
		action?: keyof typeof toolbarActions;
		/** Ícono propio (reemplaza al de `action`). */
		icon?: LucideIcon;
		asChild?: boolean;
	}) {
	const preset = action ? toolbarActions[action] : undefined;
	const Icon = icon ?? preset?.icon;
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			data-slot="toolbar-button"
			data-active={active || undefined}
			type={asChild ? undefined : "button"}
			className={cn(toolbarButtonVariants({ active }), className)}
			{...props}
		>
			{asChild ? (
				children
			) : (
				<>
					{Icon && <Icon aria-hidden size={14} absoluteStrokeWidth />}
					{children ?? preset?.label}
				</>
			)}
		</Comp>
	);
}

const quickActionButtonVariants = cva(
	"inline-flex h-5.5 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line-subtle bg-canvas text-fg-secondary outline-none transition-[background-color,border-color,color,opacity] duration-150 ease-out hover:border-brand hover:bg-brand-subtle hover:text-brand focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-[state=open]:border-brand data-[state=open]:bg-brand-subtle data-[state=open]:text-brand [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:pointer-events-none [&_svg]:shrink-0",
);

function QuickActionButton({
	className,
	action,
	icon,
	asChild = false,
	children,
	"aria-label": ariaLabel,
	...props
}: React.ComponentProps<"button"> & {
	/** Acción de Figma: pone el ícono y el aria-label por defecto. */
	action?: keyof typeof quickActions;
	/** Ícono propio (reemplaza al de `action`). Acompáñelo de `aria-label`. */
	icon?: LucideIcon;
	asChild?: boolean;
}) {
	const preset = action ? quickActions[action] : undefined;
	const Icon = icon ?? preset?.icon;
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			data-slot="quick-action-button"
			type={asChild ? undefined : "button"}
			aria-label={ariaLabel ?? preset?.label}
			className={cn(quickActionButtonVariants(), className)}
			{...props}
		>
			{asChild
				? children
				: (children ??
					(Icon && <Icon aria-hidden size={14} absoluteStrokeWidth />))}
		</Comp>
	);
}

export {
	QuickActionButton,
	quickActionButtonVariants,
	ToolbarButton,
	toolbarButtonVariants,
};
