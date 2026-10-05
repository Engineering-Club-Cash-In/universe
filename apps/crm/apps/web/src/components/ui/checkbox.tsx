import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Checkbox — Figma "02 · Componentes › Checkbox" (83:891).
 *
 * Estado de Figma → props (Radix):
 *   Default       → checked={false}
 *   Checked       → checked            (relleno brand/primary + ✓ en brand/on-primary)
 *   Indeterminate → checked="indeterminate" (barra de 10×2)
 *   Disabled      → disabled           (opacity/disabled 40 %)
 * Etiqueta Visible/Oculta: este componente es solo la casilla (20×20, radius/sm, borde 1.5px
 *   border/default). La etiqueta se compone al lado: gap 10px (`gap-2.5`), 14px text-fg; para
 *   atenuarla con el control deshabilitado use `peer-disabled:opacity-40` en el texto.
 * Tamaño (agregado): "default" = 20px de Figma; "sm" = 16px, el de las opciones del Dropdown Multi.
 */
function Checkbox({
	className,
	size = "default",
	...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & {
	size?: "default" | "sm";
}) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			data-size={size}
			className={cn(
				"peer group/checkbox inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border-[1.5px] border-line bg-surface text-on-brand outline-none transition-[background-color,border-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-danger-solid data-[size=sm]:size-4 data-[state=checked]:border-brand data-[state=indeterminate]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:bg-brand",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="flex items-center justify-center text-current"
			>
				<CheckIcon
					strokeWidth={3}
					className="size-3.5 group-data-[state=indeterminate]/checkbox:hidden group-data-[size=sm]/checkbox:size-2.5"
				/>
				<span className="hidden h-0.5 w-2.5 rounded-full bg-current group-data-[state=indeterminate]/checkbox:block group-data-[size=sm]/checkbox:w-2" />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
