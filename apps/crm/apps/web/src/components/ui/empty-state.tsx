import { cva, type VariantProps } from "class-variance-authority";
import {
	Clock,
	File,
	type LucideIcon,
	SatelliteDish,
	Shield,
	TriangleAlert,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * EmptyState — Figma "02 · Componentes › Empty State" (439:1676).
 *
 * Tipo de Figma → `variant` (cada uno trae su ícono y colores por defecto):
 *   Vacío       → "empty"          lucide/file,           fondo bg/surface-raised, ícono text/secondary
 *   SinDatos    → "no-data"        lucide/clock,          fondo bg/surface-raised, ícono text/tertiary
 *   Error       → "error"          lucide/triangle-alert, fondo status/danger/subtle, ícono status/danger/solid
 *   SinPermisos → "no-permission"  lucide/shield,         fondo status/warning/subtle, ícono status/warning/solid
 *   SinConexión → "offline"        lucide/satellite-dish, fondo bg/surface-raised, ícono text/tertiary
 * Size de Figma → `size`: Small → "sm" (320) · Medium → "md" (480, default) · Large → "lg" (560).
 *   El ancho de Figma es el máximo; en código ocupa el ancho disponible hasta ese tope.
 * Propiedades: Título → `title`, Descripción → `description`, Icono → `icon` (reemplaza
 * el del tipo), Mostrar acción + Acción → `action` (normalmente <Button> Primary Medium).
 * "Loading" no es un tipo: en Figma es composición (Spinner + "Cargando…", gap 12).
 */
const emptyStateVariants = cva(
	"mx-auto flex w-full flex-col items-center text-center",
	{
		variants: {
			size: {
				sm: "max-w-80 gap-2.5 p-6",
				md: "max-w-120 gap-3.5 px-8 py-10",
				lg: "max-w-140 gap-4.5 px-12 py-14",
			},
		},
		defaultVariants: { size: "md" },
	},
);

const TYPES = {
	empty: {
		icon: File,
		wrap: "bg-surface-raised text-fg-secondary",
	},
	"no-data": {
		icon: Clock,
		wrap: "bg-surface-raised text-fg-tertiary",
	},
	error: {
		icon: TriangleAlert,
		wrap: "bg-danger-subtle text-danger-solid",
	},
	"no-permission": {
		icon: Shield,
		wrap: "bg-warning-subtle text-warning-solid",
	},
	offline: {
		icon: SatelliteDish,
		wrap: "bg-surface-raised text-fg-tertiary",
	},
} satisfies Record<string, { icon: LucideIcon; wrap: string }>;

type EmptyStateVariant = keyof typeof TYPES;
type EmptyStateSize = NonNullable<
	VariantProps<typeof emptyStateVariants>["size"]
>;

const SIZES: Record<
	EmptyStateSize,
	{ wrap: string; title: string; description: string }
> = {
	sm: {
		wrap: "size-10 [&>svg]:size-5",
		title: "text-base leading-6.5",
		description: "text-[13px] leading-5",
	},
	md: {
		wrap: "size-14 [&>svg]:size-6",
		title: "text-lg leading-6.5",
		description: "text-sm leading-5",
	},
	lg: {
		wrap: "size-18 [&>svg]:size-8",
		title: "text-2xl leading-6.5",
		description: "text-base leading-5",
	},
};

function EmptyState({
	variant = "empty",
	size = "md",
	icon,
	title,
	description,
	action,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "title"> &
	VariantProps<typeof emptyStateVariants> & {
		/** Tipo de Figma. Define ícono y colores por defecto. */
		variant?: EmptyStateVariant;
		/** Reemplaza el ícono del tipo (elemento de lucide). */
		icon?: React.ReactNode;
		title: React.ReactNode;
		description?: React.ReactNode;
		/** Acción (Mostrar acción = true). Normalmente un <Button>. */
		action?: React.ReactNode;
	}) {
	const type = TYPES[variant];
	const s = SIZES[size ?? "md"];
	const Icon = type.icon;

	return (
		<div
			data-slot="empty-state"
			data-variant={variant}
			className={cn(emptyStateVariants({ size }), className)}
			{...props}
		>
			<div
				className={cn(
					"flex shrink-0 items-center justify-center overflow-hidden rounded-full",
					type.wrap,
					s.wrap,
				)}
			>
				{icon ?? <Icon aria-hidden />}
			</div>
			<p className={cn("w-full font-semibold text-fg", s.title)}>{title}</p>
			{description ? (
				<p className={cn("w-full text-fg-secondary", s.description)}>
					{description}
				</p>
			) : null}
			{action}
		</div>
	);
}

export { EmptyState, emptyStateVariants };
export type { EmptyStateVariant };
