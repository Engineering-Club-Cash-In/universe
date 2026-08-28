/**
 * CB-127 · Lógica pura de la bandeja de supervisión (/cobros/pagalo),
 * separada del JSX para poder testearla. Prefijo `-`: archivo no-ruta
 * (patrón ya usado en el repo, p. ej. `-mora-display.ts`).
 */

/** Selección multi-toggle de estados: agrega si no está, quita si ya está. */
export function alternarEstado(
	seleccionados: string[],
	estado: string,
): string[] {
	return seleccionados.includes(estado)
		? seleccionados.filter((e) => e !== estado)
		: [...seleccionados, estado];
}

/**
 * Etiqueta compacta de un link para la fila de la bandeja: solo tipo +
 * generación (si aplica). El estado completo NO se repite acá — el badge de
 * Estado del grupo ya lo dice para el caso común; cuando los links difieren
 * entre sí (p. ej. uno PAID y otro ACTIVE en un grupo PARTIALLY_PAID) el
 * color del punto + el tooltip cubren la diferencia sin duplicar texto.
 */
export function etiquetaLinkCompacta(link: {
	linkType: "CAPITAL" | "MORA_INTERES";
	generation: number;
}): string {
	const tipo = link.linkType === "CAPITAL" ? "Capital" : "Mora/Int.";
	return link.generation > 1 ? `${tipo} (gen. ${link.generation})` : tipo;
}

/** Color del punto de estado de un link: verde=pagado, ámbar=vivo, rojo=error, gris=cerrado sin pago. */
export function colorPuntoLink(status: string): string {
	if (status === "PAID") return "bg-green-500";
	if (status === "ERROR" || status === "REJECTED") return "bg-red-500";
	if (status === "CREATING" || status === "ACTIVE") return "bg-amber-500";
	return "bg-muted-foreground";
}

/** Título compuesto para un badge de link: "Capital · Pagado · Q1,500.00". */
export function tituloLink(
	link: { linkType: "CAPITAL" | "MORA_INTERES" },
	estadoLabel: string,
	montoFormateado?: string,
): string {
	const tipo = link.linkType === "CAPITAL" ? "Capital" : "Mora/Int.";
	const base = `${tipo} · ${estadoLabel}`;
	return montoFormateado ? `${base} · ${montoFormateado}` : base;
}

/**
 * "GERARDO FERMÍN LÓPEZ" → "Gerardo Fermín López". Solo interviene cuando el
 * nombre viene TODO en mayúsculas (dato crudo de cartera-back); si ya trae
 * mezcla de casos (nombres compuestos con partículas: "de la Cruz", "van
 * der..."), se deja tal cual viene — forzar un capitalize ciego rompería
 * esos casos.
 */
export function normalizarNombreCliente(nombre: string | null): string | null {
	if (!nombre) return nombre;
	if (nombre !== nombre.toUpperCase()) return nombre;
	return nombre
		.toLowerCase()
		.split(" ")
		.map((palabra) =>
			palabra ? palabra[0]?.toUpperCase() + palabra.slice(1) : palabra,
		)
		.join(" ");
}
