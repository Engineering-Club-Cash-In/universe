import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Card — superficie base. Figma no tiene una "Card" genérica en 02 · Componentes; el
 * estilo sale de las cards del sistema:
 *   · "03 · Componentes CRM › Card/Cliente" (88:877), Card/Vehículo, Card/Promesa…:
 *     p 20 · gap 14 · radius/lg (20) · bg/surface · Shadow/Clay-Raised, sin borde.
 *   · "02 · Workspace › Workspace/Card" (1075:1057): radio 12 · borde border/subtle,
 *     sin sombra. Es también el patrón más repetido en las pantallas (radio 10–14 + borde).
 *
 * `variant`:
 *   default → borde border/subtle + radius/md (14) + Shadow/Clay-Subtle: la mezcla de los
 *             dos, para que las ~100 pantallas que ya usan Card conserven el borde (muchas
 *             lo recolorean con className, p. ej. `border-amber-200`).
 *   raised  → Card/* de 03: radius/lg (20) + Shadow/Clay-Raised, borde transparente.
 *   flat    → Workspace/Card: borde border/subtle, sin sombra.
 * Espaciado (todas): padding 20 (py-5 en Card, px-5 en sus partes) y gap 14 entre partes.
 * CardTitle = 16px semibold text/primary (nombre en Card/Cliente); CardDescription =
 * body/sm text/secondary. Separar header y contenido con `<Separator />` (border/divider)
 * o con `className="border-b"` en el header, como antes.
 */
const cardVariants = cva(
	"flex flex-col gap-3.5 border bg-surface py-5 text-fg",
	{
		variants: {
			variant: {
				default: "rounded-xl border-line-subtle shadow-clay-subtle",
				raised: "rounded-2xl border-transparent shadow-clay-raised",
				flat: "rounded-xl border-line-subtle",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Card({
	className,
	variant,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
	return (
		<div
			data-slot="card"
			className={cn(cardVariants({ variant }), className)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-0.5 px-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:border-divider [.border-b]:pb-3.5",
				className,
			)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("type-heading-sm text-fg leading-5", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("type-body-sm text-fg-secondary", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn(
				"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
				className,
			)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-content"
			className={cn("px-5", className)}
			{...props}
		/>
	);
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn(
				"flex items-center px-5 [.border-t]:border-divider [.border-t]:pt-3.5",
				className,
			)}
			{...props}
		/>
	);
}

export {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardAction,
	CardContent,
	CardFooter,
	cardVariants,
};
