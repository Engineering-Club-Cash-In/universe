import { Slot, Slottable } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { ClipboardCheck, type LucideIcon } from "lucide-react";
import type * as React from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * Operational Summary — Figma "02 · Componentes › Operational Summary".
 *   · Operational Summary Item (300:1347): ícono + valor + etiqueta.
 *   · Operational Summary Bar  (301:1307): contenedor con wrap para 2–6 items.
 * Congelados en Figma (Sprint 1, Asesor Junior): se reutilizan por props.
 *
 * Estado → `status` del Item:
 *   Normal → "normal"  (ícono Secundario, valor text/primary)
 *   Éxito  → "success" (ícono Éxito,      valor status/success/solid)
 *   Alerta → "warning" (ícono Alerta,     valor status/warning/solid)
 *   Peligro→ "danger"  (ícono Peligro,    valor status/danger/solid)
 *   Info   → "info"    (ícono Marca,      valor status/info/solid) — así está en Figma.
 * Icono (intercambiable) → `icon` (lucide; por defecto ClipboardCheck, como en Figma).
 *
 * Navegable: con `onClick` el item se vuelve <button>; con `asChild` se le pasa un
 * <Link>/<a> vacío como hijo y el contenido se mete dentro. En ambos casos gana foco
 * visible y la etiqueta se oscurece al pasar el puntero (Figma no define hover).
 */
const statusIconColor = {
	normal: "secondary",
	success: "success",
	warning: "warning",
	danger: "danger",
	info: "brand",
} as const;

const operationalSummaryValueVariants = cva(
	"font-bold text-base tabular-nums leading-5",
	{
		variants: {
			status: {
				normal: "text-fg",
				success: "text-success-solid",
				warning: "text-warning-solid",
				danger: "text-danger-solid",
				info: "text-info-solid",
			},
		},
		defaultVariants: {
			status: "normal",
		},
	},
);

type OperationalSummaryItemProps = Omit<
	React.HTMLAttributes<HTMLElement>,
	"children"
> &
	VariantProps<typeof operationalSummaryValueVariants> & {
		value: React.ReactNode;
		label: React.ReactNode;
		icon?: LucideIcon;
		/** Envuelve al hijo (p. ej. un `<Link>` sin contenido) para hacerlo navegable. */
		asChild?: boolean;
		children?: React.ReactElement;
	};

function OperationalSummaryItem({
	value,
	label,
	status,
	icon = ClipboardCheck,
	asChild = false,
	className,
	children,
	...props
}: OperationalSummaryItemProps) {
	const interactive = asChild || Boolean(props.onClick);
	const content = (
		<>
			<Icon icon={icon} size="sm" color={statusIconColor[status ?? "normal"]} />
			<span className="flex min-w-0 items-baseline gap-1.5">
				<span className={operationalSummaryValueVariants({ status })}>
					{value}
				</span>
				<span
					data-slot="operational-summary-label"
					className="type-caption truncate text-fg-secondary transition-colors duration-150"
				>
					{label}
				</span>
			</span>
		</>
	);
	const shared = {
		"data-slot": "operational-summary-item",
		className: cn(
			"inline-flex shrink-0 items-center gap-2 text-left",
			interactive &&
				"cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface hover:[&_[data-slot=operational-summary-label]]:text-fg",
			className,
		),
		...props,
	};

	if (asChild && children) {
		return (
			<Slot {...shared}>
				<Slottable>{children}</Slottable>
				{content}
			</Slot>
		);
	}
	if (props.onClick) {
		return (
			<button type="button" {...shared}>
				{content}
			</button>
		);
	}
	return <div {...shared}>{content}</div>;
}

/** Contenedor de la fila-resumen: p 14/20 · gap 24 · radio 16 · borde border/subtle. */
function OperationalSummaryBar({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="operational-summary-bar"
			className={cn(
				"flex w-full flex-wrap items-center gap-x-6 gap-y-3 rounded-[16px] border border-line-subtle bg-surface px-5 py-3.5",
				className,
			)}
			{...props}
		/>
	);
}

export {
	OperationalSummaryBar,
	OperationalSummaryItem,
	operationalSummaryValueVariants,
};
export type { OperationalSummaryItemProps };
