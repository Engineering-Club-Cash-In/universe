// Desde el paquete `radix-ui` del web (como checkbox y dropdown-menu), no desde
// `@radix-ui/react-popover`: ese no está declarado en package.json y resolvía a
// otra copia de `react-dismissable-layer` que la del Dialog. Con dos copias, la
// pila de capas no se compartía y un Escape en un calendario o combobox dentro
// de un modal cerraba también el modal.
import { Popover as PopoverPrimitive } from "radix-ui";
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

/**
 * Dónde montar los popovers (opcional). Por defecto se pintan en su lugar, sin
 * portal (así la rueda del mouse funciona dentro de un Dialog). El Workspace de
 * cobros pasa su DialogContent: sus formularios embebidos usan `@container`,
 * que vuelve al formulario el bloque contenedor de los elementos `fixed`, y el
 * calendario o el combobox se pintaban corridos fuera del formulario.
 */
export const PopoverPortalContext = React.createContext<HTMLElement | null>(
	null,
);

const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ collisionBoundary, collisionPadding, ...props }, ref) => {
	const contenedor = React.useContext(PopoverPortalContext);
	// Montado en la caja de un modal, Radix igual calcula las colisiones contra
	// el viewport: un calendario que sí cabe en la pantalla pero no en el modal
	// quedaba cortado por el overflow del DialogContent. Con la caja como límite
	// se corre o se voltea para quedar dentro (salvo que el llamador decida).
	const contenido = (
		<PopoverContentBase
			ref={ref}
			collisionBoundary={collisionBoundary ?? contenedor ?? undefined}
			collisionPadding={collisionPadding ?? (contenedor ? 12 : undefined)}
			{...props}
		/>
	);
	return contenedor ? (
		<PopoverPrimitive.Portal container={contenedor}>
			{contenido}
		</PopoverPrimitive.Portal>
	) : (
		contenido
	);
});
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverContentBase = React.forwardRef<
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
PopoverContentBase.displayName = "PopoverContentBase";

export { Popover, PopoverAnchor, PopoverTrigger, PopoverContent };
