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
				: "";
	return `Links Págalo generados: ${links} por Q${params.totalAmount}.${whatsapp}`.trim();
}
