import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import {
	DialogIcon,
	dialogDescriptionClassName,
	dialogFooterClassName,
	dialogHeaderClassName,
	dialogOverlayClassName,
	dialogPanelClassName,
	dialogPositionClassName,
	dialogTitleClassName,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * AlertDialog — Figma "02 · Componentes › Modal" (component set `122:921`), el Modal de
 * confirmación tal cual: panel de 420px, sin botón de cerrar, botones Small (32px).
 *
 * Tipo (variante de Figma) → piezas:
 *   Confirmación → <AlertDialogIcon />                        + <AlertDialogAction>
 *   Advertencia  → <AlertDialogIcon variant="warning" />      + <AlertDialogAction>
 *   Eliminación  → <AlertDialogIcon variant="destructive" />  + <AlertDialogAction variant="destructive">
 *   Información  → <AlertDialogIcon variant="info" />         + <AlertDialogAction>
 * Botones: "Etiqueta cancelar" → AlertDialogCancel (Ghost = `outline`), "Etiqueta principal"
 * → AlertDialogAction (Primary = `default`). Ambos aceptan `variant`/`size` de Button;
 * por defecto `size="sm"` como en Figma.
 */

function AlertDialog({
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
	return (
		<AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
	);
}

function AlertDialogPortal({
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
	return (
		<AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
	);
}

function AlertDialogOverlay({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
	return (
		<AlertDialogPrimitive.Overlay
			data-slot="alert-dialog-overlay"
			className={cn(dialogOverlayClassName, className)}
			{...props}
		/>
	);
}

function AlertDialogContent({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
	return (
		<AlertDialogPortal>
			<AlertDialogOverlay />
			<AlertDialogPrimitive.Content
				data-slot="alert-dialog-content"
				className={cn(
					dialogPanelClassName,
					dialogPositionClassName,
					"sm:max-w-105",
					className,
				)}
				{...props}
			/>
		</AlertDialogPortal>
	);
}

/** Ícono en píldora del Modal (Figma "Frame" 44×28). Ver DialogIcon. */
const AlertDialogIcon = DialogIcon;

function AlertDialogHeader({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-header"
			className={cn(dialogHeaderClassName, className)}
			{...props}
		/>
	);
}

function AlertDialogFooter({
	className,
	...props
}: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-footer"
			className={cn(dialogFooterClassName, className)}
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn(dialogTitleClassName, className)}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn(dialogDescriptionClassName, className)}
			{...props}
		/>
	);
}

type AlertDialogButtonProps = Pick<
	VariantProps<typeof buttonVariants>,
	"variant" | "size"
>;

function AlertDialogAction({
	className,
	variant = "default",
	size = "sm",
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
	AlertDialogButtonProps) {
	return (
		<AlertDialogPrimitive.Action
			data-slot="alert-dialog-action"
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

function AlertDialogCancel({
	className,
	variant = "outline",
	size = "sm",
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
	AlertDialogButtonProps) {
	return (
		<AlertDialogPrimitive.Cancel
			data-slot="alert-dialog-cancel"
			className={cn(buttonVariants({ variant, size }), className)}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogTrigger,
	AlertDialogContent,
	AlertDialogHeader,
	AlertDialogFooter,
	AlertDialogIcon,
	AlertDialogOverlay,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogDescription,
	AlertDialogAction,
	AlertDialogCancel,
};
