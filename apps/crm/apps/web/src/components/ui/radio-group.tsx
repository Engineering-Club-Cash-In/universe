import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Radio — Figma "02 · Componentes › Radio Button" (83:910).
 *
 * Estado de Figma → props (Radix):
 *   Default          → ítem no seleccionado (círculo 20px, bg-surface, borde 1.5px border/default)
 *   Selected         → ítem cuyo `value` es el del grupo (borde brand/primary + punto de 10px)
 *   Disabled         → disabled en el ítem o en `RadioGroup` (opacity/disabled 40 %)
 *   DisabledSelected → seleccionado + disabled
 * La etiqueta se compone al lado: gap 10px (`gap-2.5`), 14px text-fg; para atenuarla con el
 * control deshabilitado use `peer-disabled:opacity-40` en el texto.
 */
const RadioGroup = React.forwardRef<
	React.ElementRef<typeof RadioGroupPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => {
	return (
		<RadioGroupPrimitive.Root
			data-slot="radio-group"
			className={cn("grid gap-2", className)}
			{...props}
			ref={ref}
		/>
	);
});
RadioGroup.displayName = RadioGroupPrimitive.Root.displayName;

const RadioGroupItem = React.forwardRef<
	React.ElementRef<typeof RadioGroupPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
	return (
		<RadioGroupPrimitive.Item
			ref={ref}
			data-slot="radio-group-item"
			className={cn(
				"peer inline-flex aspect-square size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-line bg-surface outline-none transition-[border-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 aria-invalid:border-danger-solid data-[state=checked]:border-brand",
				className,
			)}
			{...props}
		>
			<RadioGroupPrimitive.Indicator
				data-slot="radio-group-indicator"
				className="flex items-center justify-center"
			>
				<span className="size-2.5 rounded-full bg-brand" />
			</RadioGroupPrimitive.Indicator>
		</RadioGroupPrimitive.Item>
	);
});
RadioGroupItem.displayName = RadioGroupPrimitive.Item.displayName;

export { RadioGroup, RadioGroupItem };
