import { Info } from "lucide-react";
import type * as React from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * InfoTooltip — Figma "02 · Componentes › Info Tooltip" (component set `749:1866`).
 *
 * Ícono ⓘ (lucide/info, Icon XS 14px, color Terciario) que muestra el Tooltip al pasar el
 * cursor o al enfocarlo con el teclado. Reutiliza Tooltip; el texto de ayuda va en `children`.
 *
 * Estado (variante de Figma) → comportamiento:
 *   Reposo → cerrado (solo ⓘ) · Hover → abierto (ⓘ + Tooltip)
 *   `open`/`defaultOpen`/`onOpenChange` permiten controlarlo (p. ej. dejarlo abierto en el catálogo).
 * Posición del Tooltip: `side` "top" (Arriba, default) o "bottom" (Abajo).
 */
function InfoTooltip({
	children,
	side = "top",
	align,
	label = "Más información",
	open,
	defaultOpen,
	onOpenChange,
	className,
	contentClassName,
}: {
	/** Texto de ayuda del Tooltip. */
	children: React.ReactNode;
	side?: "top" | "bottom";
	align?: React.ComponentProps<typeof TooltipContent>["align"];
	/** Nombre accesible del ícono. */
	label?: string;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
	contentClassName?: string;
}) {
	return (
		<Tooltip open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
			<TooltipTrigger asChild>
				<button
					type="button"
					data-slot="info-tooltip"
					aria-label={label}
					className={cn(
						"inline-flex size-3.5 shrink-0 cursor-help items-center justify-center rounded-full text-fg-tertiary outline-none focus-visible:ring-2 focus-visible:ring-ring",
						className,
					)}
				>
					<Info className="size-3.5" aria-hidden />
				</button>
			</TooltipTrigger>
			<TooltipContent
				side={side}
				align={align}
				className={cn("max-w-64", contentClassName)}
			>
				{children}
			</TooltipContent>
		</Tooltip>
	);
}

export { InfoTooltip };
