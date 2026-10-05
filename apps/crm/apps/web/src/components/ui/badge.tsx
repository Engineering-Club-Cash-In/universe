import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Badge — derivado de los badges de Figma: "03 · Componentes CRM › Badge/Promesa"
 * (85:905), "Badge/Convenio" (85:917), "Badge/Gestion" (85:944) y "02 · Componentes ›
 * Chip" (134:1261). En Figma no hay un Badge genérico: todos comparten la píldora
 * p 4/12 · gap 6 · radius/full · 12px semibold, con punto opcional de 7px.
 *
 * Variantes semánticas nuevas (fondo `*-subtle` + texto `*-text`, como los Badge/* de 03):
 *   success  → Cumplida / Finalizado / Recuperación
 *   warning  → Pendiente / Promesa
 *   danger   → Incumplida / Incumplido
 *   info     → Activo (convenio) / SMS
 *   brand    → Vigente
 *   neutral  → Cancelada
 * Variantes existentes (se conservan los nombres):
 *   default     → marca sólido (bg-brand) — el único badge "lleno"; sirve como "activo".
 *   secondary   → igual que neutral.
 *   destructive → igual que danger (antes era rojo sólido; ahora sigue el estilo suave de Figma).
 *   outline     → borde border/default + texto secundario, sin relleno.
 * `dot` agrega el punto de 7px del color del texto (Badge/Promesa, Badge/Convenio).
 */
const badgeVariants = cva(
	"type-label-sm inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-transparent px-2.75 py-0.75 font-semibold outline-none transition-[color,background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring aria-invalid:ring-2 aria-invalid:ring-danger-solid [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				default: "bg-brand text-on-brand [a&]:hover:bg-brand-hover",
				brand: "bg-brand-subtle text-brand",
				secondary: "bg-muted text-fg-secondary",
				neutral: "bg-muted text-fg-secondary",
				success: "bg-success-subtle text-success-text",
				warning: "bg-warning-subtle text-warning-text",
				destructive: "bg-danger-subtle text-danger-text",
				danger: "bg-danger-subtle text-danger-text",
				info: "bg-info-subtle text-info-text",
				outline:
					"border-line bg-transparent text-fg-secondary [a&]:hover:bg-muted",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Badge({
	className,
	variant,
	asChild = false,
	dot = false,
	children,
	...props
}: React.ComponentProps<"span"> &
	VariantProps<typeof badgeVariants> & {
		asChild?: boolean;
		/** Punto de 7px antes del texto, del mismo color del texto. No aplica con `asChild`. */
		dot?: boolean;
	}) {
	const Comp = asChild ? Slot : "span";

	return (
		<Comp
			data-slot="badge"
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		>
			{dot && !asChild ? (
				<>
					<span
						aria-hidden
						data-slot="badge-dot"
						className="size-1.75 shrink-0 rounded-full bg-current"
					/>
					{children}
				</>
			) : (
				children
			)}
		</Comp>
	);
}

export { Badge, badgeVariants };
