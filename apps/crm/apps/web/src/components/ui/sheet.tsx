import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { XIcon } from "lucide-react";
import type * as React from "react";
import {
	dialogOverlayClassName,
	overlayCloseButtonClassName,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Sheet — Figma "03 · Componentes CRM › Side Panel / Drawer" (component set `139:2016`).
 *
 * Tamaño (variante de Figma) → `size` de SheetContent:
 *   Small (360) → "sm" · Medium (480) → "md" · Large (640) → "lg"
 *   Sin `size` se conserva el ancho anterior (3/4 de pantalla, máx. 384px en sm+).
 *
 * Anatomía de Figma → piezas:
 *   panel: bg/surface · radius/lg (20) · Elevation/SidePanel · clip   → SheetContent
 *   "panel-head" p 16/16/16/20 · gap 12 + divisor border/divider       → SheetHeader (incluye el botón de cerrar)
 *     título 16/700 text/primary · subtítulo 12/400 text/secondary     → SheetTitle · SheetDescription
 *   "panel-body" p 20 · gap 16                                         → SheetBody
 *   "panel-foot" p 16/20 · gap 10 · bg/canvas · alineado a la derecha  → SheetFooter
 *
 * El panel se pega al borde de la pantalla, así que solo redondea las esquinas que quedan
 * libres (izquierdas en `side="right"`). Si no hay SheetHeader, SheetContent muestra su
 * propio botón de cerrar en la esquina, como antes.
 */
const sheetVariants = cva(
	"fixed z-50 flex flex-col gap-0 overflow-hidden bg-surface text-fg shadow-sidepanel transition ease-out data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:duration-250 data-[state=open]:duration-400 dark:border-line-subtle [&:has([data-slot=sheet-header])>[data-slot=sheet-close-button]]:hidden",
	{
		variants: {
			side: {
				right:
					"data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-dvh max-h-dvh rounded-l-2xl dark:border-l",
				left: "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-dvh max-h-dvh rounded-r-2xl dark:border-r",
				top: "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto rounded-b-2xl dark:border-b",
				bottom:
					"data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto rounded-t-2xl dark:border-t",
			},
			size: {
				sm: "w-full sm:max-w-90",
				md: "w-full sm:max-w-120",
				lg: "w-full sm:max-w-160",
			},
		},
		defaultVariants: { side: "right" },
	},
);

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
	return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
	...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
	return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
	...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
	return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
	...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
	return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
	className,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
	return (
		<SheetPrimitive.Overlay
			data-slot="sheet-overlay"
			className={cn(dialogOverlayClassName, className)}
			{...props}
		/>
	);
}

function SheetContent({
	className,
	children,
	side = "right",
	size,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Content> &
	VariantProps<typeof sheetVariants> & {
		side?: "top" | "right" | "bottom" | "left";
	}) {
	return (
		<SheetPortal>
			<SheetOverlay />
			<SheetPrimitive.Content
				data-slot="sheet-content"
				className={cn(
					sheetVariants({ side, size }),
					// Ancho anterior cuando no se pide tamaño (laterales).
					!size && (side === "left" || side === "right") && "w-3/4 sm:max-w-sm",
					className,
				)}
				{...props}
			>
				{children}
				<SheetPrimitive.Close
					data-slot="sheet-close-button"
					className={cn(overlayCloseButtonClassName, "absolute top-4 right-4")}
				>
					<XIcon />
					<span className="sr-only">Cerrar</span>
				</SheetPrimitive.Close>
			</SheetPrimitive.Content>
		</SheetPortal>
	);
}

/**
 * Figma "panel-head": título/subtítulo a la izquierda y el botón de cerrar a la derecha,
 * con el divisor debajo. `showCloseButton={false}` lo oculta.
 */
function SheetHeader({
	className,
	children,
	showCloseButton = true,
	...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
	return (
		<div
			data-slot="sheet-header"
			className={cn(
				"flex shrink-0 items-center justify-between gap-3 border-divider border-b py-4 pr-4 pl-5",
				className,
			)}
			{...props}
		>
			<div className="flex min-w-0 flex-col gap-0.5">{children}</div>
			{showCloseButton ? (
				<SheetPrimitive.Close
					data-slot="sheet-header-close"
					className={overlayCloseButtonClassName}
				>
					<XIcon />
					<span className="sr-only">Cerrar</span>
				</SheetPrimitive.Close>
			) : null}
		</div>
	);
}

/** Figma "panel-body": contenido con scroll propio. */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-body"
			className={cn(
				"flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5",
				className,
			)}
			{...props}
		/>
	);
}

/** Figma "panel-foot": acciones alineadas a la derecha sobre bg/canvas. */
function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn(
				"flex shrink-0 items-center justify-end gap-2.5 bg-canvas px-5 py-4",
				className,
			)}
			{...props}
		/>
	);
}

function SheetTitle({
	className,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
	return (
		<SheetPrimitive.Title
			data-slot="sheet-title"
			className={cn("font-bold text-base text-fg leading-[1.26]", className)}
			{...props}
		/>
	);
}

function SheetDescription({
	className,
	...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
	return (
		<SheetPrimitive.Description
			data-slot="sheet-description"
			className={cn("text-fg-secondary text-xs leading-[1.26]", className)}
			{...props}
		/>
	);
}

export {
	Sheet,
	SheetBody,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	sheetVariants,
};
