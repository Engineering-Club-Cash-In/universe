export function construirComentarioGestionLinkPagalo(params: {
	totalAmount: string;
	cantidadLinks: number;
	whatsappEnviado: boolean | null;
}): string {
	const links = `${params.cantidadLinks} ${params.cantidadLinks === 1 ? "link" : "links"}`;
	const whatsapp =
		params.whatsappEnviado === true
			? " WhatsApp enviado."
			: params.whatsappEnviado === false
				? " WhatsApp no enviado."
				: " WhatsApp sin confirmación.";
	return `Links Págalo generados: ${links} por Q${params.totalAmount}.${whatsapp}`.trim();
}

export function gestionLinkPagaloTieneWhatsappConfirmado(
	comentarios: string,
): boolean {
	return (
		comentarios.includes("WhatsApp enviado.") ||
		comentarios.includes("WhatsApp no enviado.")
	);
}

/** Conserva resultado histórico cuando una regeneración refresca sus links. */
export function resultadoWhatsappGestionLinkPagalo(
	comentarios: string,
): boolean | null {
	if (comentarios.includes("WhatsApp enviado.")) return true;
	if (comentarios.includes("WhatsApp no enviado.")) return false;
	return null;
}

export function totalDeLinksPagalo(
	links: readonly { amount: string }[],
): string {
	return links
		.reduce((total, link) => total + Number(link.amount), 0)
		.toFixed(2);
}

export function esLinkPagaloGenerado(status: string | null): boolean {
	return status === "ACTIVE" || status === "PAID";
}

export function esLinkPagaloContabilizableEnGestion(
	status: string | null,
	isApplicationSource: boolean | null,
): boolean {
	return (
		esLinkPagaloGenerado(status) &&
		(status !== "PAID" || isApplicationSource === true)
	);
}
