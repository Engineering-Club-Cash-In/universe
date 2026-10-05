import { cva, type VariantProps } from "class-variance-authority";
import {
	CircleCheck,
	CircleX,
	Info,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * FieldMessage — Figma "02 · Componentes › Mensaje inline" › Input/Mensaje (479:914).
 * Mensaje bajo un campo de formulario: ícono XS (14px) + texto 12px 500, gap 6.
 *
 * Tipo de Figma → `variant` (ícono · color del texto · color del ícono):
 *   Error       → "error"   (default) · CircleX       · status/danger/text  · status/danger/solid
 *   Advertencia → "warning"           · TriangleAlert · status/warning/text · status/warning/solid
 *   Ayuda       → "help"              · Info          · text/secondary      · text/tertiary
 *   Éxito       → "success"           · CircleCheck   · status/success/text · status/success/solid
 * Prop Mensaje de Figma → `children`. `icon` cambia el ícono (o `null` para quitarlo).
 *
 * FieldDescription — texto de ayuda de Input/Text (79:914), p. ej. "Campo de solo lectura"
 * o "Monto en Q": 12px 400 text/tertiary, sin ícono.
 */
const fieldMessageVariants = cva(
	"type-label-sm flex items-start gap-1.5 [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0",
	{
		variants: {
			variant: {
				error: "text-danger-text [&>svg]:text-danger-solid",
				warning: "text-warning-text [&>svg]:text-warning-solid",
				help: "text-fg-secondary [&>svg]:text-fg-tertiary",
				success: "text-success-text [&>svg]:text-success-solid",
			},
		},
		defaultVariants: {
			variant: "error",
		},
	},
);

type FieldMessageVariant = NonNullable<
	VariantProps<typeof fieldMessageVariants>["variant"]
>;

const fieldMessageIcons: Record<FieldMessageVariant, LucideIcon> = {
	error: CircleX,
	warning: TriangleAlert,
	help: Info,
	success: CircleCheck,
};

function FieldMessage({
	className,
	variant,
	icon,
	children,
	...props
}: React.ComponentProps<"p"> &
	VariantProps<typeof fieldMessageVariants> & {
		/** Ícono de lucide en lugar del de Figma; `null` lo quita. */
		icon?: LucideIcon | null;
	}) {
	const Glyph =
		icon === undefined ? fieldMessageIcons[variant ?? "error"] : icon;
	return (
		<p
			data-slot="field-message"
			data-variant={variant ?? "error"}
			className={cn(fieldMessageVariants({ variant }), className)}
			{...props}
		>
			{Glyph ? <Glyph aria-hidden /> : null}
			<span className="min-w-0">{children}</span>
		</p>
	);
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="field-description"
			className={cn("type-caption text-fg-tertiary", className)}
			{...props}
		/>
	);
}

export {
	FieldDescription,
	FieldMessage,
	type FieldMessageVariant,
	fieldMessageVariants,
};
