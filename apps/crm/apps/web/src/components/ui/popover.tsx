import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Popover — superficie flotante genérica. Sin ficha propia en Figma: toma el panel del
 * "02 · Componentes › Dropdown" (120:975, nodo "menu"): bg/surface-raised, border/subtle,
 * radius/md (rounded-xl) y Elevation/Dropdown. Padding por defecto 16px; los menús de
 * selección (Combobox, Multi) pasan `p-0` y dejan el padding al `Command` (8/4 como Figma).
 */
const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
	<PopoverPrimitive.Content
		ref={ref}
		data-slot="popover-content"
		align={align}
		sideOffset={sideOffset}
		className={cn(
			"data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-9999 w-72 rounded-xl border border-line-subtle bg-surface-raised p-4 text-fg shadow-dropdown outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
			className,
		)}
		{...props}
	/>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverTrigger, PopoverContent };
