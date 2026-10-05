import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	type InputStatus,
} from "@/components/ui/input";

/**
 * PasswordInput — Figma "02 · Componentes › Inputs" › Input/Variants › Tipo=Password (80:906).
 * Contraseña con el ojo a la derecha (Icon S, text/tertiary) para mostrar u ocultar el
 * texto: Eye mientras está oculta (como en Figma), EyeOff mientras se ve.
 *
 * API: la de un <input> (`className` va al <input>); `containerClassName` → la caja;
 * `status` → Success/Error de Figma; `defaultVisible` → arranca mostrando el texto.
 */
function PasswordInput({
	containerClassName,
	status,
	defaultVisible = false,
	disabled,
	...props
}: Omit<React.ComponentProps<"input">, "type"> & {
	containerClassName?: string;
	status?: InputStatus;
	defaultVisible?: boolean;
}) {
	const [visible, setVisible] = React.useState(defaultVisible);

	return (
		<InputGroup status={status} className={containerClassName}>
			<InputGroupInput
				type={visible ? "text" : "password"}
				disabled={disabled}
				{...props}
			/>
			<InputGroupAddon>
				<button
					type="button"
					onClick={() => setVisible((v) => !v)}
					disabled={disabled}
					aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
					aria-pressed={visible}
					className="-m-1 flex cursor-pointer items-center rounded-sm p-1 outline-none transition-colors duration-150 hover:text-fg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:hover:text-fg-tertiary"
				>
					{visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
				</button>
			</InputGroupAddon>
		</InputGroup>
	);
}

export { PasswordInput };
