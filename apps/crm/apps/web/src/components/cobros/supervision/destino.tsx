import { Link } from "@tanstack/react-router";
import type * as React from "react";

/**
 * A dónde lleva un elemento del Dashboard del supervisor: ruta + search. Las
 * piezas de presentación reciben el destino ya armado (el contenedor decide la
 * URL), así se pintan igual en el showcase y en la pantalla real.
 *
 * Los parámetros nuevos de la Cartera general (`asesor`, `cola`, `promesa`,
 * `convenio`) los valida la ruta `/cobros/cartera`; aquí viajan como texto.
 */
export type Destino = {
	to: string;
	search?: Record<string, string>;
};

export function EnlaceDestino({
	destino,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"a">, "href"> & {
	destino: Destino;
}) {
	return (
		<Link
			// La ruta y sus search params se arman en el contenedor; el tipado
			// estricto de TanStack no aporta aquí y obligaría a conocer cada ruta.
			to={destino.to as never}
			search={destino.search as never}
			className={className}
			{...props}
		>
			{children}
		</Link>
	);
}
