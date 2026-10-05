"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Progress — Figma "02 · Componentes › Progress" (135:1223).
 *
 * Estado de Figma → `tone`: Normal → "default" (brand/primary) · Éxito → "success" ·
 *   Alerta → "warning" · Riesgo → "danger" (los status/…/solid).
 * Tipo de Figma → componente:
 *   Barra     → <ProgressBar label value detail>  cabecera (etiqueta 500 12 + % 600 12),
 *               pista de 10px, detalle 400 11 text/tertiary; gap 8.
 *   Compacta  → <ProgressCompact value>           pista de 6px + % 600 11 a la derecha; gap 8.
 *   Circular  → <ProgressCircular value>          anillo de 72px, trazo 7, % 700 14 al centro.
 * <Progress> es la pista sola (Radix), la que ya usan las pantallas: `size` "default"
 * (10px, Barra) | "sm" (6px, Compacta); la altura se puede seguir fijando con className.
 * Pista: neutral/200 en Figma → `bg-line-subtle` (mismo valor en claro, carbon/750 en oscuro).
 */
const progressVariants = cva(
	"relative w-full overflow-hidden rounded-full bg-line-subtle",
	{
		variants: {
			size: {
				default: "h-2.5",
				sm: "h-1.5",
			},
		},
		defaultVariants: { size: "default" },
	},
);

const indicatorVariants = cva(
	"h-full w-full flex-1 rounded-full transition-transform duration-250 ease-out",
	{
		variants: {
			tone: {
				default: "bg-brand",
				success: "bg-success-solid",
				warning: "bg-warning-solid",
				danger: "bg-danger-solid",
			},
		},
		defaultVariants: { tone: "default" },
	},
);

type ProgressTone = NonNullable<VariantProps<typeof indicatorVariants>["tone"]>;

function percent(value: number | null | undefined, max = 100) {
	if (!value || max <= 0) return 0;
	return Math.min(100, Math.max(0, (value / max) * 100));
}

function Progress({
	className,
	value,
	max,
	size,
	tone,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
	VariantProps<typeof progressVariants> &
	VariantProps<typeof indicatorVariants>) {
	const pct = percent(value, max);
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			value={value}
			max={max}
			className={cn(progressVariants({ size }), className)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className={indicatorVariants({ tone })}
				style={{ transform: `translateX(-${100 - pct}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

type ProgressDisplayProps = {
	value: number;
	max?: number;
	tone?: ProgressTone;
	/** Texto del porcentaje; por defecto el valor redondeado ("65%"). */
	valueLabel?: React.ReactNode;
	className?: string;
};

/** Figma "Tipo=Barra". */
function ProgressBar({
	label,
	detail,
	value,
	max = 100,
	tone,
	valueLabel,
	className,
}: ProgressDisplayProps & {
	/** Etiqueta (p. ej. "Meta mensual"). */
	label?: React.ReactNode;
	/** Detalle bajo la barra (p. ej. "4 de 6 cuotas pagadas"). */
	detail?: React.ReactNode;
}) {
	const pct = percent(value, max);
	return (
		<div
			data-slot="progress-bar"
			className={cn("flex w-full flex-col gap-2", className)}
		>
			<div className="flex items-center justify-between gap-2">
				<span className="type-label-sm min-w-0 truncate text-fg-secondary">
					{label}
				</span>
				<span className="font-semibold text-fg text-xs tabular-nums leading-4">
					{valueLabel ?? `${Math.round(pct)}%`}
				</span>
			</div>
			<Progress
				value={value}
				max={max}
				tone={tone}
				aria-label={typeof label === "string" ? label : undefined}
			/>
			{detail ? (
				<p className="text-[11px] text-fg-tertiary leading-3.5">{detail}</p>
			) : null}
		</div>
	);
}

/** Figma "Tipo=Compacta". */
function ProgressCompact({
	value,
	max = 100,
	tone,
	valueLabel,
	className,
	"aria-label": ariaLabel,
}: ProgressDisplayProps & { "aria-label"?: string }) {
	const pct = percent(value, max);
	return (
		<div
			data-slot="progress-compact"
			className={cn("flex w-full items-center gap-2", className)}
		>
			<Progress
				value={value}
				max={max}
				tone={tone}
				size="sm"
				aria-label={ariaLabel}
				className="flex-1"
			/>
			<span className="shrink-0 font-semibold text-[11px] text-fg-secondary tabular-nums leading-3.5">
				{valueLabel ?? `${Math.round(pct)}%`}
			</span>
		</div>
	);
}

const ringTone: Record<ProgressTone, string> = {
	default: "stroke-brand",
	success: "stroke-success-solid",
	warning: "stroke-warning-solid",
	danger: "stroke-danger-solid",
};

/** Figma "Tipo=Circular": anillo de 72px, arranca arriba y avanza en sentido horario. */
function ProgressCircular({
	value,
	max = 100,
	tone = "default",
	valueLabel,
	className,
	"aria-label": ariaLabel,
}: ProgressDisplayProps & { "aria-label"?: string }) {
	const pct = percent(value, max);
	const size = 72;
	const stroke = 7;
	const r = (size - stroke) / 2;
	const circumference = 2 * Math.PI * r;
	return (
		<div
			data-slot="progress-circular"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={max}
			aria-valuenow={value}
			aria-label={ariaLabel}
			className={cn(
				"relative inline-flex size-18 shrink-0 items-center justify-center",
				className,
			)}
		>
			<svg
				aria-hidden="true"
				width={size}
				height={size}
				viewBox={`0 0 ${size} ${size}`}
				fill="none"
				className="absolute inset-0 -rotate-90"
			>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					strokeWidth={stroke}
					className="stroke-line-subtle"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					strokeWidth={stroke}
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - pct / 100)}
					className={cn(
						"transition-[stroke-dashoffset] duration-250 ease-out",
						ringTone[tone],
					)}
				/>
			</svg>
			<span className="relative font-bold text-fg text-sm tabular-nums leading-[1.26]">
				{valueLabel ?? `${Math.round(pct)}%`}
			</span>
		</div>
	);
}

export {
	Progress,
	ProgressBar,
	ProgressCircular,
	ProgressCompact,
	progressVariants,
};
