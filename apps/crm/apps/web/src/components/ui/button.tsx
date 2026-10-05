import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button — Figma "02 · Componentes › Botones" (173:1583).
 *
 * Variantes de Figma → `variant`:
 *   Primary   → "default" | "primary"
 *   Secondary → "secondary"
 *   Ghost     → "outline"   (borde + fondo transparente)
 *   Text      → "link" | "text"
 *   Danger    → "destructive" | "danger"
 *   "ghost"   → sin borde ni fondo; derivado del Ghost de Figma para botones de ícono.
 * Tamaños: Medium → "default" (42px), Small → "sm" (32px).
 * Estados: Hover/Pressed/Focus/Disabled por CSS; Loading con la prop `loading`.
 */
const buttonVariants = cva(
	"inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold outline-none transition-[background-color,box-shadow,color,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 aria-invalid:ring-2 aria-invalid:ring-danger-solid [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"bg-brand text-on-brand shadow-clay-subtle hover:bg-brand-hover active:bg-cci-primary-700 active:shadow-pressed dark:active:bg-cci-primary-200",
				primary:
					"bg-brand text-on-brand shadow-clay-subtle hover:bg-brand-hover active:bg-cci-primary-700 active:shadow-pressed dark:active:bg-cci-primary-200",
				secondary:
					"bg-brand-subtle text-brand hover:bg-cci-primary-100 active:bg-cci-primary-200 active:shadow-pressed dark:active:bg-cci-primary-700 dark:hover:bg-cci-primary-800",
				outline:
					"border border-line bg-transparent text-fg-secondary hover:bg-muted active:bg-cci-neutral-200 active:shadow-pressed dark:active:bg-cci-carbon-750",
				ghost:
					"bg-transparent text-fg-secondary hover:bg-muted hover:text-fg active:bg-cci-neutral-200 dark:active:bg-cci-carbon-750",
				link: "bg-transparent text-brand underline-offset-4 hover:underline active:shadow-pressed",
				text: "bg-transparent text-brand underline-offset-4 hover:underline active:shadow-pressed",
				destructive:
					"bg-danger-solid text-on-solid shadow-clay-subtle hover:bg-cci-danger-700 active:bg-cci-danger-700 active:shadow-pressed",
				danger:
					"bg-danger-solid text-on-solid shadow-clay-subtle hover:bg-cci-danger-700 active:bg-cci-danger-700 active:shadow-pressed",
			},
			size: {
				default: "h-10.5 px-6 text-sm",
				sm: "h-8 px-4 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
				lg: "h-12 px-8 text-base [&_svg:not([class*='size-'])]:size-5",
				icon: "size-10.5",
				"icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
				"icon-lg": "size-12 [&_svg:not([class*='size-'])]:size-5",
			},
		},
		compoundVariants: [
			// Figma "Text": padding horizontal de 8px en vez de 24/16.
			{
				variant: ["link", "text"],
				size: ["default", "sm", "lg"],
				className: "px-2",
			},
		],
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Spinner({ className }: { className?: string }) {
	return (
		<span
			aria-hidden
			className={cn(
				"size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
				className,
			)}
		/>
	);
}

function Button({
	className,
	variant,
	size,
	asChild = false,
	loading = false,
	disabled,
	children,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
		/** Estado "Loading" de Figma: muestra el spinner y deshabilita el botón. */
		loading?: boolean;
	}) {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			data-slot="button"
			className={cn(
				buttonVariants({ variant, size, className }),
				// En Figma "Loading" conserva el color pleno: no usa la opacidad de disabled.
				loading && "pointer-events-none",
			)}
			disabled={disabled}
			aria-disabled={loading || undefined}
			aria-busy={loading || undefined}
			{...props}
		>
			{loading && !asChild ? (
				<>
					<Spinner />
					{children}
				</>
			) : (
				children
			)}
		</Comp>
	);
}

export { Button, buttonVariants };
