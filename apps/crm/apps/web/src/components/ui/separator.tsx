import * as SeparatorPrimitive from "@radix-ui/react-separator";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Separator — Figma "02 · Componentes › Divider" (135:1234).
 *
 * Tipo → props:
 *   Horizontal → orientation="horizontal" (por defecto): línea de 1px, border/divider.
 *   Vertical   → orientation="vertical": 1px de ancho, alto del contenedor.
 *   ConTítulo  → `label`: texto 12px semibold text/tertiary + línea que llena el resto (gap 12).
 */
function Separator({
	className,
	orientation = "horizontal",
	decorative = true,
	label,
	...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root> & {
	/** Título a la izquierda de la línea (Divider "ConTítulo"). Solo horizontal. */
	label?: React.ReactNode;
}) {
	const withLabel = label != null && orientation === "horizontal";
	const line = (
		<SeparatorPrimitive.Root
			data-slot="separator"
			decorative={decorative}
			orientation={orientation}
			className={cn(
				"shrink-0 bg-divider data-[orientation=horizontal]:h-px data-[orientation=vertical]:h-full data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px",
				withLabel ? "min-w-0 flex-1" : className,
			)}
			{...props}
		/>
	);

	if (!withLabel) return line;

	return (
		<div
			data-slot="separator-with-label"
			className={cn("flex w-full items-center gap-3", className)}
		>
			<span className="type-label-sm shrink-0 font-semibold text-fg-tertiary">
				{label}
			</span>
			{line}
		</div>
	);
}

export { Separator };
