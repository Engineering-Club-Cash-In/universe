import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/**
 * Checklist — Figma "02 · Componentes › Callout & Checklist".
 *
 * Checklist / Item (366:1569) → <ChecklistItem>
 *   Etiqueta → `label`
 *   Estado: Pendiente | Completado → `checked` (controlado) o `defaultChecked`
 *   Reutiliza el Checkbox del sistema (ui/checkbox). Completado tacha la etiqueta y
 *   la pasa a text/tertiary. Alterna al hacer clic en la casilla o en el texto.
 *   Medidas: padding 6/0, gap 10, etiqueta label/base (500 14/20).
 *
 * Checklist (367:1561) → <Checklist title description action>{items}</Checklist>
 *   Section Header (título 600 18/26, alto 40) + lista con gap 2.
 *   Pasos configurables (Paso 3/4/5 de Figma) → los <ChecklistItem> hijos.
 *   Contenedor: padding 18/20, gap 12, radio lg (20), bg/surface, borde
 *   border/subtle y Shadow/Clay-Raised.
 */
function ChecklistItem({
	label,
	checked,
	defaultChecked = false,
	onCheckedChange,
	disabled,
	id: idProp,
	className,
	...props
}: Omit<React.ComponentProps<"label">, "children" | "onChange"> & {
	/** Etiqueta del paso. */
	label: React.ReactNode;
	/** Completado (controlado). */
	checked?: boolean;
	/** Completado al montar (no controlado). */
	defaultChecked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	disabled?: boolean;
}) {
	const [internal, setInternal] = React.useState(defaultChecked);
	const isChecked = checked ?? internal;
	const autoId = React.useId();
	const id = idProp ?? autoId;

	return (
		<label
			htmlFor={id}
			data-slot="checklist-item"
			data-state={isChecked ? "checked" : "unchecked"}
			className={cn(
				"flex cursor-pointer items-center gap-2.5 py-1.5 has-disabled:cursor-not-allowed",
				className,
			)}
			{...props}
		>
			<Checkbox
				id={id}
				checked={isChecked}
				disabled={disabled}
				onCheckedChange={(value) => {
					const next = value === true;
					if (checked === undefined) setInternal(next);
					onCheckedChange?.(next);
				}}
			/>
			<span
				className={cn(
					"type-label-base min-w-0 flex-1 text-fg transition-colors duration-150 peer-disabled:opacity-40",
					isChecked && "text-fg-tertiary line-through",
				)}
			>
				{label}
			</span>
		</label>
	);
}

function Checklist({
	title,
	description,
	action,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"div">, "title"> & {
	/** Título del Section Header, p. ej. "Checklist de gestión". */
	title?: React.ReactNode;
	/** Descripción opcional del Section Header. */
	description?: React.ReactNode;
	/** Acción del Section Header (botón Text/Ghost pequeño). */
	action?: React.ReactNode;
}) {
	return (
		<div
			data-slot="checklist"
			className={cn(
				"flex w-full flex-col gap-3 rounded-2xl border border-line-subtle bg-surface px-5 py-4.5 shadow-clay-raised",
				className,
			)}
			{...props}
		>
			{title || action ? (
				<div className="flex min-h-10 items-center justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-0.5">
						{title ? (
							<p className="font-semibold text-fg text-lg leading-6.5">
								{title}
							</p>
						) : null}
						{description ? (
							<p className="type-body-sm text-fg-secondary">{description}</p>
						) : null}
					</div>
					{action}
				</div>
			) : null}
			<div className="flex flex-col gap-0.5">{children}</div>
		</div>
	);
}

export { Checklist, ChecklistItem };
