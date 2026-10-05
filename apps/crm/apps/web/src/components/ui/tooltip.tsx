import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tooltip — Figma "02 · Componentes › Tooltip" (component set `121:934`).
 *
 * Posición (variante de Figma) → `side` de TooltipContent:
 *   Arriba → "top" (default de Radix) · Abajo → "bottom"
 *
 * "bubble": p 8/12 · radius/sm (8) · neutral/900 · Elevation/Tooltip · texto 12/500 neutral/0.
 * "Polygon": flecha de 10×6 del mismo color (TooltipPrimitive.Arrow).
 * Figma liga el primitivo neutral/900 (sin modo); en oscuro se usa carbon/700 para que el
 * globo siga siendo oscuro pero se separe del fondo carbon.
 */

function TooltipProvider({
	delayDuration = 0,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function Tooltip({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return (
		<TooltipProvider>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	);
}

function TooltipTrigger({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	sideOffset = 4,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					"z-50 w-fit origin-(--radix-tooltip-content-transform-origin) text-balance rounded-md bg-cci-neutral-900 px-3 py-2 font-medium text-cci-neutral-0 text-xs leading-[1.26] shadow-tooltip dark:bg-cci-carbon-700",
					"fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 animate-in duration-150 data-[state=closed]:animate-out",
					className,
				)}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow
					width={10}
					height={6}
					className="z-50 fill-cci-neutral-900 dark:fill-cci-carbon-700"
				/>
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
