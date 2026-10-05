import * as React from "react";

import { fieldStateClassName, type InputStatus } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Textarea — Figma "02 · Componentes › Inputs" › Input/Variants › Tipo=Textarea (80:906).
 * Misma caja que Input/Text (p 12/16, radius/md, bg/surface, border/default, 14px) y los
 * mismos estados: hover, focus, disabled, readOnly, `status="success"`, error (`status="error"`
 * o `aria-invalid`).
 *
 * Contador "0 / 500" de Figma (counter-row: 12px text/tertiary, alineado a la derecha) →
 * `showCount`. Muestra "n / maxLength" (o solo "n" sin `maxLength`); con `showCount` el
 * textarea va dentro de un contenedor y `containerClassName` le da clases a ese contenedor.
 *
 * Desvío: Figma lo dibuja de 42px (una línea, el frame abraza el placeholder); se deja un
 * mínimo de 64px para que se lea como campo de varias líneas. Crece con el contenido.
 */
function Textarea({
	className,
	status,
	showCount = false,
	containerClassName,
	onChange,
	"aria-invalid": ariaInvalid,
	...props
}: React.ComponentProps<"textarea"> & {
	/** Success / Error de Figma. */
	status?: InputStatus;
	/** Contador de caracteres de Figma ("0 / 500"). */
	showCount?: boolean;
	/** Clases del contenedor cuando hay contador. */
	containerClassName?: string;
}) {
	const isControlled = props.value !== undefined;
	const [uncontrolledLength, setUncontrolledLength] = React.useState(
		() => String(props.defaultValue ?? "").length,
	);
	const length = isControlled
		? String(props.value ?? "").length
		: uncontrolledLength;

	const textarea = (
		<textarea
			data-slot="textarea"
			data-status={status}
			aria-invalid={status === "error" ? true : ariaInvalid}
			className={cn(
				fieldStateClassName,
				"field-sizing-content flex min-h-16 w-full px-4 py-3 text-base leading-[1.26] md:text-sm",
				className,
			)}
			onChange={(event) => {
				if (!isControlled) setUncontrolledLength(event.target.value.length);
				onChange?.(event);
			}}
			{...props}
		/>
	);

	if (!showCount) return textarea;

	return (
		<div
			data-slot="textarea-container"
			className={cn("flex w-full flex-col gap-1.5", containerClassName)}
		>
			{textarea}
			<div
				data-slot="textarea-counter"
				className="type-caption self-end text-fg-tertiary tabular-nums"
			>
				{props.maxLength ? `${length} / ${props.maxLength}` : length}
			</div>
		</div>
	);
}

export { Textarea };
