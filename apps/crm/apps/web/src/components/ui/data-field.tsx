import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * DataField — Figma "02 · Componentes › DataField" (149:3001).
 *
 * Patrón etiqueta + valor de cards, paneles y cabeceras. Usarlo en todo componente
 * nuevo que muestre pares dato-valor.
 *
 * Orientación → `orientation`:  Vertical → "vertical" (gap 2) ·
 *                               Horizontal → "horizontal" (fila, space-between, gap 12)
 * Énfasis → `emphasis`:  Normal → "normal" (13px semibold, text/primary)
 *                        Fuerte → "strong" (16px bold, text/primary)
 *                        Positivo → "positive" (13px semibold, status/success/text)
 *                        Negativo → "negative" (13px semibold, status/danger/text)
 * `align="end"` alinea a la derecha la variante vertical (columna derecha de las cards
 * de 03, p. ej. "Saldo pendiente" en Card/Crédito).
 *
 * La etiqueta es 11px regular text/tertiary; Figma no tiene estilo de texto para 11px ni
 * para 13px semibold, así que van con tamaño suelto (interlineado auto ≈ 126%).
 */
const dataFieldVariants = cva("flex min-w-0", {
	variants: {
		orientation: {
			vertical: "flex-col gap-0.5",
			horizontal: "w-full flex-row items-center justify-between gap-3",
		},
		align: {
			start: "",
			end: "",
		},
	},
	compoundVariants: [
		{
			orientation: "vertical",
			align: "end",
			className: "items-end text-right",
		},
	],
	defaultVariants: {
		orientation: "vertical",
		align: "start",
	},
});

const dataFieldValueVariants = cva("min-w-0", {
	variants: {
		emphasis: {
			normal: "font-semibold text-[13px] text-fg leading-4",
			strong: "font-bold text-base text-fg leading-5",
			positive: "font-semibold text-[13px] text-success-text leading-4",
			negative: "font-semibold text-[13px] text-danger-text leading-4",
		},
	},
	defaultVariants: {
		emphasis: "normal",
	},
});

type DataFieldProps = Omit<React.ComponentProps<"div">, "children"> &
	VariantProps<typeof dataFieldVariants> &
	VariantProps<typeof dataFieldValueVariants> & {
		label: React.ReactNode;
		value: React.ReactNode;
		labelClassName?: string;
		valueClassName?: string;
	};

function DataField({
	label,
	value,
	orientation,
	emphasis,
	align,
	className,
	labelClassName,
	valueClassName,
	...props
}: DataFieldProps) {
	return (
		<div
			data-slot="data-field"
			className={cn(dataFieldVariants({ orientation, align }), className)}
			{...props}
		>
			<span
				data-slot="data-field-label"
				className={cn(
					"text-[11px] text-fg-tertiary leading-3.5",
					orientation === "horizontal" && "shrink-0",
					labelClassName,
				)}
			>
				{label}
			</span>
			<span
				data-slot="data-field-value"
				className={cn(dataFieldValueVariants({ emphasis }), valueClassName)}
			>
				{value}
			</span>
		</div>
	);
}

export { DataField, dataFieldVariants };
export type { DataFieldProps };
