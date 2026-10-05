import { Calendar } from "lucide-react";
import * as React from "react";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	type InputStatus,
} from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * DateInput — Figma "02 · Componentes › Inputs" › Input/Variants › Tipo=Date (80:906).
 * Fecha escrita a mano ("dd / mm / aaaa") con el calendario a la derecha (Icon S,
 * text/tertiary). Usa el <input type="date"> nativo: el valor es "aaaa-mm-dd" y el
 * formato que se ve sale del idioma del navegador. Sin valor, el texto va en
 * text/tertiary como el placeholder de Figma.
 *
 * El ícono de lucide reemplaza al indicador nativo de Chrome/Safari y abre el selector
 * con showPicker(). Firefox no deja ocultar su botón propio, así que ahí se deja el suyo.
 * (El selector con calendario del Design System es DatePicker, otra sección de Figma.)
 *
 * API: la de un <input> (`className` va al <input>); `type` "date" | "month" | "week" |
 * "datetime-local"; `containerClassName` → la caja; `status` → Success/Error de Figma.
 */
function DateInput({
	containerClassName,
	status,
	type = "date",
	className,
	ref,
	onChange,
	...props
}: Omit<React.ComponentProps<"input">, "type"> & {
	type?: "date" | "month" | "week" | "datetime-local";
	containerClassName?: string;
	status?: InputStatus;
}) {
	const innerRef = React.useRef<HTMLInputElement | null>(null);
	const setRefs = React.useCallback(
		(node: HTMLInputElement | null) => {
			innerRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		[ref],
	);

	const isControlled = props.value !== undefined;
	const [uncontrolledEmpty, setUncontrolledEmpty] = React.useState(
		() => !props.defaultValue,
	);
	const empty = isControlled ? !props.value : uncontrolledEmpty;
	const blocked = props.disabled || props.readOnly;

	return (
		<InputGroup status={status} className={containerClassName}>
			<InputGroupInput
				ref={setRefs}
				type={type}
				data-empty={empty}
				onChange={(event) => {
					if (!isControlled) setUncontrolledEmpty(!event.target.value);
					onChange?.(event);
				}}
				className={cn(
					"data-[empty=true]:not-focus:text-fg-tertiary [&::-webkit-calendar-picker-indicator]:hidden",
					className,
				)}
				{...props}
			/>
			<InputGroupAddon className="supports-[-moz-appearance:none]:hidden">
				<button
					type="button"
					tabIndex={-1}
					aria-label="Abrir calendario"
					disabled={blocked}
					onClick={() => {
						const input = innerRef.current;
						if (!input || blocked) return;
						input.focus();
						try {
							input.showPicker();
						} catch {
							// Sin soporte o sin gesto del usuario: queda el campo enfocado para escribir.
						}
					}}
					className="flex cursor-pointer items-center rounded-sm outline-none transition-colors duration-150 hover:text-fg-secondary disabled:cursor-not-allowed disabled:hover:text-fg-tertiary"
				>
					<Calendar aria-hidden />
				</button>
			</InputGroupAddon>
		</InputGroup>
	);
}

export { DateInput };
