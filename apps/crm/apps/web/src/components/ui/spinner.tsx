import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Spinner / Loader — Figma "02 · Componentes › Loader" (125:889).
 *
 * Tipo de Figma → componente:
 *   Spinner → <Spinner size>        Tamaño: Small → "sm" (16px, trazo 2) · Medium → "md"
 *                                   (24px, trazo 2.5) · Large → "lg" (40px, trazo 3). Default "sm".
 *   Inline  → <LoaderInline>        arco 18px (trazo 2.5) + texto 500 13px text/secondary, gap 10.
 *   Página  → <LoaderPage>          tarjeta 320px: arco 40px + "Cargando…" 500 14px, gap 16,
 *                                   radio lg (20), bg/surface, Shadow/Clay-Raised, padding 4/0.
 * El arco de Figma (ellipse 0°→261°, brand/primary) gira en implementación (animate-spin).
 * El padding de 4px del frame de Figma no se incluye en <Spinner> para que alinee en línea.
 * `tone` (extensión de código; Figma solo usa brand/primary):
 *   "brand" (default) · "current" (hereda el color, p. ej. dentro de un botón) ·
 *   "muted" (text/tertiary) · "on-solid" (sobre rellenos sólidos).
 */
const spinnerVariants = cva("shrink-0 animate-spin", {
	variants: {
		tone: {
			brand: "text-brand",
			current: "",
			muted: "text-fg-tertiary",
			"on-solid": "text-on-solid",
		},
	},
	defaultVariants: { tone: "brand" },
});

/** [diámetro px, trazo px] de cada tamaño de Figma. */
const SIZES = {
	sm: [16, 2],
	md: [24, 2.5],
	lg: [40, 3],
} as const;

/** Arco de 261° (el de Figma) con trazo hacia adentro. */
function Arc({
	diameter,
	thickness,
	className,
	...props
}: React.ComponentProps<"svg"> & { diameter: number; thickness: number }) {
	const r = (diameter - thickness) / 2;
	const circumference = 2 * Math.PI * r;
	return (
		// biome-ignore lint/a11y/noSvgWithoutTitle: el rol y la etiqueta (o aria-hidden) llegan por props
		<svg
			width={diameter}
			height={diameter}
			viewBox={`0 0 ${diameter} ${diameter}`}
			fill="none"
			className={className}
			{...props}
		>
			<circle
				cx={diameter / 2}
				cy={diameter / 2}
				r={r}
				stroke="currentColor"
				strokeWidth={thickness}
				strokeDasharray={`${circumference * (261 / 360)} ${circumference}`}
			/>
		</svg>
	);
}

function Spinner({
	size = "sm",
	tone,
	label = "Cargando",
	className,
	...props
}: Omit<React.ComponentProps<"svg">, "children"> &
	VariantProps<typeof spinnerVariants> & {
		size?: keyof typeof SIZES;
		/** Texto para lectores de pantalla. */
		label?: string;
	}) {
	const [diameter, stroke] = SIZES[size];
	return (
		<Arc
			data-slot="spinner"
			role="img"
			aria-label={label}
			diameter={diameter}
			thickness={stroke}
			className={cn(spinnerVariants({ tone }), className)}
			{...props}
		/>
	);
}

/** Figma "Tipo=Inline": spinner + texto en línea. */
function LoaderInline({
	children = "Cargando…",
	tone,
	className,
	...props
}: React.ComponentProps<"output"> & VariantProps<typeof spinnerVariants>) {
	return (
		<output
			data-slot="loader-inline"
			aria-live="polite"
			className={cn("inline-flex items-center gap-2.5", className)}
			{...props}
		>
			<Arc
				aria-hidden
				diameter={18}
				thickness={2.5}
				className={spinnerVariants({ tone })}
			/>
			<span className="font-medium text-[13px] text-fg-secondary leading-[1.26]">
				{children}
			</span>
		</output>
	);
}

/** Figma "Tipo=Página": tarjeta de carga de página completa. */
function LoaderPage({
	children = "Cargando…",
	className,
	...props
}: React.ComponentProps<"output">) {
	return (
		<output
			data-slot="loader-page"
			aria-live="polite"
			className={cn(
				"flex w-full max-w-80 flex-col items-center justify-center gap-4 rounded-2xl bg-surface py-1 shadow-clay-raised",
				className,
			)}
			{...props}
		>
			<Arc
				aria-hidden
				diameter={40}
				thickness={3}
				className={spinnerVariants({ tone: "brand" })}
			/>
			<span className="font-medium text-fg-secondary text-sm leading-[1.26]">
				{children}
			</span>
		</output>
	);
}

export { LoaderInline, LoaderPage, Spinner, spinnerVariants };
