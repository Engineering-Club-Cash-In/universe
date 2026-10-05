import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tabs — Figma "02 · Componentes › Tabs": `Tabs/Item` (121:895) y la barra `Tabs` (423:1583).
 *
 * Misma API de Radix que antes (Tabs, TabsList, TabsTrigger, TabsContent); solo cambia el aspecto:
 * pestañas subrayadas sobre una línea `border/subtle`, en lugar del control segmentado gris.
 *
 * Figma → código:
 *   Tabs (barra, 3–8 pestañas)       → <TabsList>  (gap 4, línea inferior de 1px)
 *   Tabs/Item · Estado=Activa        → <TabsTrigger> con data-state="active" (texto brand 600 + barra brand de 2px)
 *   Tabs/Item · Estado=Hover         → :hover (fondo neutral/50 r:8, barra divider al 60%)
 *   Tabs/Item · Estado=Inactiva      → data-state="inactive" (texto secundario 500)
 *   Tabs/Item · Contador=True        → prop `count` de <TabsTrigger> (o <TabsCount> suelto)
 *   Etiqueta                         → children
 * Estados extra de código: focus-visible (anillo brand) y disabled (opacity 40%).
 */

function Tabs({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			className={cn("flex flex-col gap-2", className)}
			{...props}
		/>
	);
}

function TabsList({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn(
				// La línea inferior es un inset-shadow (y no un border) para que la barra de 2px
				// de la pestaña activa quede encima de ella, como en Figma.
				"flex w-full max-w-full items-end justify-start gap-1 text-fg-secondary shadow-[inset_0_-1px_0_0_var(--color-line-subtle)]",
				className,
			)}
			{...props}
		/>
	);
}

/** Contador opcional de `Tabs/Item` (pastilla 22×18, radius full). */
function TabsCount({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="tabs-count"
			className={cn(
				"inline-flex h-4.5 min-w-5.5 items-center justify-center rounded-full bg-muted px-1.5 font-semibold text-[11px] text-fg-secondary leading-none transition-colors duration-150",
				"group-data-[state=active]/tab:bg-brand-subtle group-data-[state=active]/tab:text-brand",
				className,
			)}
			{...props}
		/>
	);
}

function TabsTrigger({
	className,
	children,
	count,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger> & {
	/** "Contador" de Figma: se muestra a la derecha de la etiqueta. */
	count?: React.ReactNode;
}) {
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(
				"group/tab relative isolate inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 pb-0.5 font-medium text-fg-secondary text-sm leading-[1.26] outline-none transition-colors duration-150 ease-out",
				// Fondo de hover: rectángulo r:8 sobre la barra (42px de alto).
				"before:absolute before:inset-x-0 before:top-0 before:bottom-0.5 before:-z-10 before:rounded-md before:transition-colors before:duration-150",
				"hover:before:bg-cci-neutral-50 dark:hover:before:bg-cci-carbon-800",
				// Barra inferior de 2px.
				"after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:transition-colors after:duration-150 hover:after:bg-divider/60",
				// Activa.
				"data-[state=active]:font-semibold data-[state=active]:text-brand data-[state=active]:after:bg-brand data-[state=active]:hover:before:bg-transparent",
				"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
				"disabled:pointer-events-none disabled:opacity-40",
				"[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			{...props}
		>
			{children}
			{count !== undefined && count !== null && count !== false ? (
				<TabsCount>{count}</TabsCount>
			) : null}
		</TabsPrimitive.Trigger>
	);
}

function TabsContent({
	className,
	...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			data-slot="tabs-content"
			className={cn("flex-1 outline-none", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsCount };
