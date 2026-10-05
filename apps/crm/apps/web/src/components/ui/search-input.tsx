import { Search } from "lucide-react";
import type * as React from "react";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	type InputStatus,
} from "@/components/ui/input";

/**
 * SearchInput — Figma "02 · Componentes › Inputs" › Input/Variants › Tipo=Search (80:906).
 * Campo de búsqueda dentro de formularios y filtros: lupa a la izquierda (Icon S,
 * text/tertiary) y gap 8 con el texto. Misma caja y estados que Input/Text.
 * (La barra de búsqueda global en pastilla es otro componente: SearchBar.)
 *
 * API: la de un <input> (`className` va al <input>); `containerClassName` → la caja
 * (ancho, márgenes); `status` → Success/Error de Figma.
 */
function SearchInput({
	containerClassName,
	status,
	placeholder = "Buscar…",
	...props
}: Omit<React.ComponentProps<"input">, "type"> & {
	containerClassName?: string;
	status?: InputStatus;
}) {
	return (
		<InputGroup status={status} className={containerClassName}>
			<InputGroupAddon>
				<Search aria-hidden />
			</InputGroupAddon>
			<InputGroupInput type="search" placeholder={placeholder} {...props} />
		</InputGroup>
	);
}

export { SearchInput };
