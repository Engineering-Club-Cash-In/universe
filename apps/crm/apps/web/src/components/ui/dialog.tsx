import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { CircleCheck, Info, TriangleAlert, XIcon } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Dialog — Figma "02 · Componentes › Modal" (component set `122:921`).
 *
 * Anatomía de Figma → piezas:
 *   panel 420px · p 24 · gap 20 · radius/xl (28) · bg/surface · Elevation/Modal → DialogContent
 *   "Frame" (ícono en píldora 44×28)                                           → DialogIcon
 *   "tb" (título 18/700 + descripción 14/400, gap 8)                           → DialogHeader + DialogTitle + DialogDescription
 *   "actions" (gap 10, alineado a la derecha)                                  → DialogFooter
 *
 * Tipo (variante de Figma) → `variant` de DialogIcon:
 *   Confirmación → "default"      (circle-check, marca)
 *   Advertencia  → "warning"      (triangle-alert, alerta)
 *   Eliminación  → "destructive"  (triangle-alert, peligro; el botón principal va en `variant="destructive"`)
 *   Información  → "info"         (info, color de texto por defecto)
 *
 * El ancho por defecto sigue siendo `sm:max-w-lg` porque el Dialog aloja formularios; el
 * Modal de confirmación de 420px de Figma es AlertDialog. El botón de cerrar no está en el
 * Modal de Figma: se conserva (API existente) con el mismo estilo que el del Side Panel.
 * Scrim: bg/overlay con opacity/overlay (0.5); en oscuro opacity/scrim (0.7) para que se note.
 */

/** Scrim de Modal y AlertDialog. */
const dialogOverlayClassName =
	"fixed inset-0 z-50 bg-overlay/50 duration-250 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 dark:bg-overlay/70";

/** Aspecto del panel del Modal sin posicionamiento (sirve también para previsualizarlo en línea). */
const dialogPanelClassName =
	"grid w-full gap-5 rounded-3xl bg-surface p-6 text-fg shadow-modal dark:border dark:border-line-subtle";

/** Posición centrada + animación de entrada/salida del panel. */
const dialogPositionClassName =
	"fixed top-[50%] left-[50%] z-50 max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] duration-250 ease-out data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

const dialogHeaderClassName =
	"flex flex-col gap-2 text-left [&>[data-slot=dialog-icon]]:mb-3";

const dialogFooterClassName =
	"flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-end";

/** Figma "tb": título Plus Jakarta Sans 700 18 / auto (126%), text/primary. */
const dialogTitleClassName = "font-bold text-fg text-lg leading-[1.26]";

/** Figma "tb": descripción Plus Jakarta Sans 400 14 / auto (126%), text/secondary. */
const dialogDescriptionClassName = "text-fg-secondary text-sm leading-[1.26]";

/**
 * Botón de cerrar compartido con el Side Panel (Figma "close": píldora bg/canvas, radius/md,
 * ícono lucide/x 16px text/secondary). Figma lo dibuja de 32×16; aquí mide 32×24 para que el
 * área táctil llegue al mínimo de 24px.
 */
const overlayCloseButtonClassName =
	"inline-flex h-6 w-8 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-canvas text-fg-secondary outline-none transition-colors duration-150 hover:bg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

const dialogIconVariants = cva(
	"inline-flex h-7 w-11 shrink-0 items-center justify-center rounded-full py-0.5 [&_svg:not([class*='size-'])]:size-6 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-brand-subtle text-brand",
				warning: "bg-warning-subtle text-warning-solid",
				destructive: "bg-danger-subtle text-danger-solid",
				info: "bg-info-subtle text-fg",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

const dialogIconGlyph = {
	default: CircleCheck,
	warning: TriangleAlert,
	destructive: TriangleAlert,
	info: Info,
} as const;

function Dialog({
	...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
	...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
	...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
	...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			data-slot="dialog-overlay"
			className={cn(dialogOverlayClassName, className)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
	showCloseButton?: boolean;
}) {
	return (
		<DialogPortal data-slot="dialog-portal">
			<DialogOverlay />
			<DialogPrimitive.Content
				data-slot="dialog-content"
				className={cn(
					dialogPanelClassName,
					dialogPositionClassName,
					"sm:max-w-lg",
					className,
				)}
				{...props}
			>
				{children}
				{showCloseButton && (
					<DialogPrimitive.Close
						data-slot="dialog-close"
						className={cn(
							overlayCloseButtonClassName,
							"absolute top-5 right-5",
						)}
					>
						<XIcon />
						<span className="sr-only">Cerrar</span>
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPortal>
	);
}

/**
 * Ícono en píldora del Modal (Figma "Frame" 44×28). Elige el ícono según `variant`;
 * `children` lo reemplaza. Puede ir como primer hijo de DialogContent o dentro de
 * DialogHeader: en ambos casos queda a 20px del título, como en Figma.
 */
function DialogIcon({
	className,
	variant,
	children,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof dialogIconVariants>) {
	const Glyph = dialogIconGlyph[variant ?? "default"];
	return (
		<span
			data-slot="dialog-icon"
			aria-hidden
			className={cn(dialogIconVariants({ variant }), className)}
			{...props}
		>
			{children ?? <Glyph />}
		</span>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-header"
			className={cn(dialogHeaderClassName, className)}
			{...props}
		/>
	);
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn(dialogFooterClassName, className)}
			{...props}
		/>
	);
}

function DialogTitle({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			// pr-10: deja libre la esquina del botón de cerrar.
			className={cn(dialogTitleClassName, "pr-10", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn(dialogDescriptionClassName, className)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogIcon,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
	dialogDescriptionClassName,
	dialogFooterClassName,
	dialogHeaderClassName,
	dialogIconVariants,
	dialogOverlayClassName,
	dialogPanelClassName,
	dialogPositionClassName,
	dialogTitleClassName,
	overlayCloseButtonClassName,
};
