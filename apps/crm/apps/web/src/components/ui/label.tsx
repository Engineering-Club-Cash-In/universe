import * as LabelPrimitive from "@radix-ui/react-label";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Label — etiqueta de campo de Figma "02 · Componentes › Inputs" › Input/Text (79:914):
 * 13px 500 text/secondary, a 6px del campo (gap del componente).
 *
 * Junto a un checkbox, radio o switch (hermano anterior o hijo) toma el texto de opción
 * de Figma "Checkbox" / "Radio Button" / "Toggle": 14px 400 text/primary.
 * Deshabilitado (peer o grupo con data-disabled) → opacidad 60%, como Input/Text Disabled.
 */
function Label({
	className,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
	return (
		<LabelPrimitive.Root
			data-slot="label"
			className={cn(
				"flex select-none items-center gap-2 font-medium text-[13px] text-fg-secondary leading-4",
				"[:is([role=checkbox],[role=radio],[role=switch],[type=checkbox],[type=radio])~&]:font-normal [:is([role=checkbox],[role=radio],[role=switch],[type=checkbox],[type=radio])~&]:text-fg [:is([role=checkbox],[role=radio],[role=switch],[type=checkbox],[type=radio])~&]:text-sm",
				"has-[[role=checkbox],[role=radio],[role=switch],[type=checkbox],[type=radio]]:font-normal has-[[role=checkbox],[role=radio],[role=switch],[type=checkbox],[type=radio]]:text-fg has-[[role=checkbox],[role=radio],[role=switch],[type=checkbox],[type=radio]]:text-sm",
				"peer-disabled:cursor-not-allowed peer-disabled:opacity-60 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60",
				className,
			)}
			{...props}
		/>
	);
}

export { Label };
