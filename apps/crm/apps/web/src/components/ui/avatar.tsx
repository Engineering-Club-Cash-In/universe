import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Avatar — Figma "02 · Componentes › Avatar" (134:1225).
 *
 * Tamaño → `size` (en <Avatar>):  XS → "xs" (24px) · S → "sm" (32px, por defecto)
 *                                  M → "md" (44px) · L → "lg" (64px)
 * Tipo:
 *   Foto      → <AvatarImage src=… /> (con <AvatarFallback> de respaldo mientras carga).
 *   Iniciales → <AvatarFallback>MC</AvatarFallback>: brand/primary + on-primary, bold.
 *   Vacío     → <AvatarFallback variant="empty" />: neutral/200 con silueta neutral/400.
 * Estado → `active` (en <Avatar>): Activo pinta el punto status/success/solid con borde
 *   de 2px bg/surface abajo a la derecha (8 · 8 · 12 · 16px según tamaño).
 *
 * En Figma los avatares quedaron con alto "hug" (salen como píldoras); la intención es
 * un círculo del ancho de cada tamaño, que es lo que se implementa.
 * Las iniciales escalan con el ancho del avatar (cqw): 9/12/15/22px en XS/S/M/L, como
 * en Figma, y proporcionales cuando se fija otro tamaño con className (p. ej. size-12).
 */
const avatarVariants = cva(
	"group/avatar @container/avatar relative flex shrink-0 rounded-full",
	{
		variants: {
			size: {
				xs: "size-6",
				sm: "size-8",
				md: "size-11",
				lg: "size-16",
			},
		},
		defaultVariants: {
			size: "sm",
		},
	},
);

const avatarStatusVariants = cva(
	"absolute right-0 bottom-0 rounded-full border-2 border-surface bg-success-solid",
	{
		variants: {
			size: {
				xs: "size-2",
				sm: "size-2",
				md: "size-3",
				lg: "size-4",
			},
		},
		defaultVariants: {
			size: "sm",
		},
	},
);

function Avatar({
	className,
	size,
	active = false,
	children,
	...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> &
	VariantProps<typeof avatarVariants> & {
		/** Estado=Activo de Figma: punto verde de "en línea". */
		active?: boolean;
	}) {
	return (
		<AvatarPrimitive.Root
			data-slot="avatar"
			data-size={size ?? "sm"}
			className={cn(avatarVariants({ size }), className)}
			{...props}
		>
			{children}
			{active && (
				<span
					data-slot="avatar-status"
					aria-hidden
					className={avatarStatusVariants({ size })}
				/>
			)}
		</AvatarPrimitive.Root>
	);
}

function AvatarImage({
	className,
	...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
	return (
		<AvatarPrimitive.Image
			data-slot="avatar-image"
			className={cn(
				"aspect-square size-full rounded-full object-cover",
				className,
			)}
			{...props}
		/>
	);
}

const avatarFallbackVariants = cva(
	"flex size-full items-center justify-center overflow-hidden rounded-full font-bold leading-none",
	{
		variants: {
			variant: {
				initials:
					"bg-brand text-[length:37.5cqw] text-on-brand group-data-[size=lg]/avatar:text-[length:34cqw] group-data-[size=md]/avatar:text-[length:34cqw]",
				empty:
					"bg-cci-neutral-200 text-cci-neutral-400 dark:bg-cci-carbon-750 dark:text-cci-neutral-600",
			},
		},
		defaultVariants: {
			variant: "initials",
		},
	},
);

/** Silueta de persona del tipo "Vacío" (cabeza + hombros, recortada por el círculo). */
function AvatarSilhouette() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="currentColor"
			className="mt-[30%] size-[80%] shrink-0"
		>
			<circle cx="12" cy="7" r="5" />
			<ellipse cx="12" cy="22" rx="10" ry="7.5" />
		</svg>
	);
}

function AvatarFallback({
	className,
	variant,
	children,
	...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback> &
	VariantProps<typeof avatarFallbackVariants>) {
	return (
		<AvatarPrimitive.Fallback
			data-slot="avatar-fallback"
			className={cn(avatarFallbackVariants({ variant }), className)}
			{...props}
		>
			{variant === "empty" && children == null ? (
				<AvatarSilhouette />
			) : (
				children
			)}
		</AvatarPrimitive.Fallback>
	);
}

export { Avatar, AvatarImage, AvatarFallback, avatarVariants };
