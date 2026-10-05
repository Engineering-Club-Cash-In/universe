import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Icon — Figma "02 · Componentes › Icon" (161:1442).
 *
 * Contenedor base de iconografía: recibe un ícono de `lucide-react` (el "instance
 * swap" de Figma: `lucide/circle-check` → `CircleCheck`) y le da tamaño y color.
 *
 * Tamaño → `size`:  XS → "xs" (14px) · S → "sm" (16px) · M → "md" (20px)
 *                   L → "lg" (24px) · XL → "xl" (32px)
 * Color → `color`:  Default → "default" (text/primary) · Secundario → "secondary"
 *                   Terciario → "tertiary" · Marca → "brand" (brand/primary)
 *                   Éxito → "success" · Alerta → "warning" · Peligro → "danger"
 *                   (status/…/solid) · Inverso → "inverse" (text/inverse)
 * Los colores son semánticos: cambian solos entre claro y oscuro.
 *
 * Es decorativo (aria-hidden) salvo que se pase `label`, que lo expone como imagen.
 */
const iconVariants = cva(
	"inline-flex shrink-0 items-center justify-center [&>svg]:size-full",
	{
		variants: {
			size: {
				xs: "size-3.5",
				sm: "size-4",
				md: "size-5",
				lg: "size-6",
				xl: "size-8",
			},
			color: {
				default: "text-fg",
				secondary: "text-fg-secondary",
				tertiary: "text-fg-tertiary",
				brand: "text-brand",
				success: "text-success-solid",
				warning: "text-warning-solid",
				danger: "text-danger-solid",
				inverse: "text-fg-inverse",
			},
		},
		defaultVariants: {
			size: "xs",
			color: "default",
		},
	},
);

type IconProps = Omit<React.ComponentProps<"span">, "color" | "children"> &
	VariantProps<typeof iconVariants> & {
		/** Ícono de lucide-react (p. ej. `CircleCheck`). */
		icon: LucideIcon;
		/** Texto accesible. Sin él, el ícono es decorativo. */
		label?: string;
		/** Grosor del trazo de lucide (por defecto 2, como en Figma). */
		strokeWidth?: number;
	};

function Icon({
	icon: IconGlyph,
	size,
	color,
	label,
	strokeWidth,
	className,
	...props
}: IconProps) {
	const classes = cn(iconVariants({ size, color }), className);
	const glyph = <IconGlyph strokeWidth={strokeWidth} />;
	if (label) {
		return (
			<span
				data-slot="icon"
				role="img"
				aria-label={label}
				className={classes}
				{...props}
			>
				{glyph}
			</span>
		);
	}
	return (
		<span data-slot="icon" aria-hidden="true" className={classes} {...props}>
			{glyph}
		</span>
	);
}

export { Icon, iconVariants };
export type { IconProps };
