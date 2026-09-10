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
	const totalCentavos = links.reduce((total, link) => {
		const monto = link.amount.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
		if (!monto) throw new Error("Monto de link Págalo inválido.");
		return (
			total + BigInt(monto[1]) * 100n + BigInt((monto[2] ?? "").padEnd(2, "0"))
		);
	}, 0n);
	return `${totalCentavos / 100n}.${String(totalCentavos % 100n).padStart(2, "0")}`;
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

export function resumenGestionLinksPagalo(
	links: readonly {
		amount: string;
		status: string | null;
		isApplicationSource: boolean | null;
	}[],
): { cantidadLinks: number; totalAmount: string } {
	const contabilizables = links.filter((link) =>
		esLinkPagaloContabilizableEnGestion(link.status, link.isApplicationSource),
	);
	return {
		cantidadLinks: contabilizables.length,
		totalAmount: totalDeLinksPagalo(contabilizables),
	};
}
