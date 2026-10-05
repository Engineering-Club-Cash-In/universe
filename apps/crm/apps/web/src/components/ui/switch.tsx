import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Switch — Figma "02 · Componentes › Toggle" (83:929).
 *
 * Estado de Figma → props (Radix Switch):
 *   Off         → checked={false}  (riel neutral/300; en oscuro carbon/700)
 *   On          → checked          (riel brand/primary)
 *   OffDisabled → disabled         (opacity/disabled 40 %)
 *   OnDisabled  → checked disabled
 * Riel 44×26 radius/full, perilla blanca de 20px con 3px de aire. La etiqueta se compone al
 * lado: gap 10px (`gap-2.5`), 14px text-fg; para atenuarla con el control deshabilitado use
 * `peer-disabled:opacity-40` en el texto.
 */
function Switch({
	className,
	...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer inline-flex h-6.5 w-11 shrink-0 cursor-pointer items-center rounded-full p-0.75 outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:ring-2 aria-invalid:ring-danger-solid data-[state=checked]:bg-brand data-[state=unchecked]:bg-cci-neutral-300 dark:data-[state=unchecked]:bg-cci-carbon-700",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className="pointer-events-none block size-5 rounded-full bg-cci-neutral-0 transition-transform duration-150 ease-out data-[state=checked]:translate-x-4.5 data-[state=unchecked]:translate-x-0"
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
