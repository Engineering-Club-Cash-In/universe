import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Chip — Figma "02 · Componentes › Chip" (134:1261).
 *
 * Etiqueta reutilizable para filtros y atributos (no es un badge de estado: para
 * estados usar `Badge`). Píldora p 4/12 · gap 6 · radius/full · label 12px medium,
 * con punto de 6px del color del texto.
 *
 * Tipo → `tone`:  Neutro → "neutral" · Marca → "brand" · Info → "info"
 *                 Éxito → "success" · Alerta → "warning" · Peligro → "danger"
 * Removible → Sí cuando se pasa `onRemove` (agrega la ✕ y baja el padding derecho a 8px).
 * `dot={false}` oculta el punto (en Figma siempre está).
 *
 * Neutro usa neutral/100 en Figma; en código va `bg-muted` (neutral/100 en claro,
 * carbon/800 en oscuro) para que el modo oscuro no quede con una píldora clara.
 */
const chipVariants = cva(
	"type-label-sm inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full py-1 pl-3",
	{
		variants: {
			tone: {
				neutral: "bg-muted text-fg-secondary",
				brand: "bg-brand-subtle text-brand",
				info: "bg-info-subtle text-info-text",
				success: "bg-success-subtle text-success-text",
				warning: "bg-warning-subtle text-warning-text",
				danger: "bg-danger-subtle text-danger-text",
			},
			removable: {
				true: "pr-2",
				false: "pr-3",
			},
		},
		defaultVariants: {
			tone: "neutral",
			removable: false,
		},
	},
);

type ChipProps = Omit<React.ComponentProps<"span">, "children"> &
	Omit<VariantProps<typeof chipVariants>, "removable"> & {
		children: React.ReactNode;
		/** Muestra la ✕ (Removible=Sí) y se llama al pulsarla. */
		onRemove?: () => void;
		/** Texto accesible de la ✕. */
		removeLabel?: string;
		/** Punto de color antes del texto. */
		dot?: boolean;
	};

function Chip({
	className,
	tone,
	onRemove,
	removeLabel = "Quitar",
	dot = true,
	children,
	...props
}: ChipProps) {
	const removable = Boolean(onRemove);
	// En Figma, la ✕ de Alerta y Peligro va en text/secondary; en el resto, del color del chip.
	const mutedRemove = tone === "warning" || tone === "danger";

	return (
		<span
			data-slot="chip"
			className={cn(chipVariants({ tone, removable }), className)}
			{...props}
		>
			{dot && (
				<span
					aria-hidden
					data-slot="chip-dot"
					className="size-1.5 shrink-0 rounded-full bg-current"
				/>
			)}
			{children}
			{removable && (
				<button
					type="button"
					data-slot="chip-remove"
					aria-label={removeLabel}
					onClick={onRemove}
					className={cn(
						"inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full outline-none transition-colors duration-150 hover:bg-current/8 focus-visible:ring-2 focus-visible:ring-ring",
						mutedRemove && "text-fg-secondary",
					)}
				>
					<X aria-hidden className="size-2.5" strokeWidth={3} />
				</button>
			)}
		</span>
	);
}

export { Chip, chipVariants };
export type { ChipProps };
