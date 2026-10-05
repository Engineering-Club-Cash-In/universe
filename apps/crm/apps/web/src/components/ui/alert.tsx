import { cva, type VariantProps } from "class-variance-authority";
import { Info } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Alert / Callout — Figma "02 · Componentes › Callout & Checklist › Callout" (365:1588).
 *
 * Tono de Figma → `variant`:
 *   Neutro  → "default" | "neutral"
 *   Marca   → "brand"
 *   Éxito   → "success"
 *   Alerta  → "warning"
 *   Peligro → "destructive" | "danger"
 *   "info"  → derivado (no existe en Figma): mismo patrón con los tokens status/info.
 * Propiedades de Figma: Título → <AlertTitle>, Cuerpo → <AlertDescription>,
 * Icono → primer hijo <svg> (lucide; 16px, toma el color del tono).
 * `Callout` arma las tres piezas por props: <Callout variant title icon>cuerpo</Callout>.
 * Medidas: padding 14/16, gap 12, radio md (14), borde 1px; los tonos de color llevan
 * Shadow/Clay-Raised y el Neutro no.
 */
const alertVariants = cva(
	"relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.75 rounded-xl border px-4 py-3.5 text-fg has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4",
	{
		variants: {
			variant: {
				default:
					"border-line-subtle bg-surface-raised [&>svg]:text-fg-secondary",
				neutral:
					"border-line-subtle bg-surface-raised [&>svg]:text-fg-secondary",
				brand:
					"border-brand bg-brand-subtle shadow-clay-raised [&>svg]:text-brand",
				success:
					"border-success-text bg-success-subtle shadow-clay-raised [&>svg]:text-success-solid",
				warning:
					"border-warning-text bg-warning-subtle shadow-clay-raised [&>svg]:text-warning-solid",
				destructive:
					"border-danger-text bg-danger-subtle shadow-clay-raised [&>svg]:text-danger-solid",
				danger:
					"border-danger-text bg-danger-subtle shadow-clay-raised [&>svg]:text-danger-solid",
				info: "border-info-text bg-info-subtle shadow-clay-raised [&>svg]:text-info-solid",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Alert({
	className,
	variant,
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return (
		<div
			data-slot="alert"
			role="alert"
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

/** Título del callout: 600 14/20, text/primary. */
function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn(
				"col-start-2 min-h-4 font-semibold text-fg text-sm leading-5",
				className,
			)}
			{...props}
		/>
	);
}

/** Cuerpo del callout: body/sm (13/18), text/secondary. */
function AlertDescription({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"type-body-sm col-start-2 grid justify-items-start gap-1 text-fg-secondary",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Callout de Figma armado por props. Por defecto usa el ícono `Info` (el de Figma);
 * `icon={null}` lo oculta. Es un bloque de contexto, no un aviso de sistema: usa
 * role="note" (se puede cambiar con `role`).
 */
function Callout({
	variant,
	title,
	icon,
	children,
	...props
}: Omit<React.ComponentProps<"div">, "title"> &
	VariantProps<typeof alertVariants> & {
		/** Título del callout (opcional). */
		title?: React.ReactNode;
		/** Ícono de lucide; `null` lo oculta. Por defecto `Info`. */
		icon?: React.ReactNode;
	}) {
	return (
		<Alert variant={variant} role="note" {...props}>
			{icon === undefined ? <Info aria-hidden /> : icon}
			{title ? <AlertTitle>{title}</AlertTitle> : null}
			{children ? <AlertDescription>{children}</AlertDescription> : null}
		</Alert>
	);
}

export { Alert, AlertDescription, AlertTitle, Callout, alertVariants };
