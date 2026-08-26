export type PagaloLinkDisplayStatus =
	| "CREATING"
	| "ACTIVE"
	| "PAID"
	| "REJECTED"
	| "CANCELLED"
	| "EXPIRED"
	| "REPLACED"
	| "ERROR";

type StatusInfo = {
	label: string;
	className: string;
	canCopy: boolean;
};

const STATUS_INFO: Record<PagaloLinkDisplayStatus, StatusInfo> = {
	CREATING: {
		label: "Creando link",
		className: "bg-blue-50 text-blue-700",
		canCopy: false,
	},
	ACTIVE: {
		label: "Pendiente de pago",
		className: "bg-amber-50 text-amber-700",
		canCopy: true,
	},
	PAID: {
		label: "Pagado",
		className: "bg-green-50 text-green-700",
		canCopy: false,
	},
	REJECTED: {
		label: "Rechazado",
		className: "bg-red-50 text-red-700",
		canCopy: false,
	},
	CANCELLED: {
		label: "Cancelado",
		className: "bg-muted text-muted-foreground",
		canCopy: false,
	},
	EXPIRED: {
		label: "Vencido",
		className: "bg-muted text-muted-foreground",
		canCopy: false,
	},
	REPLACED: {
		label: "Reemplazado",
		className: "bg-muted text-muted-foreground",
		canCopy: false,
	},
	ERROR: {
		label: "Error al crear",
		className: "bg-red-50 text-red-700",
		canCopy: false,
	},
};

export function getPagaloLinkStatusInfo(status: string): StatusInfo {
	return (
		STATUS_INFO[status as PagaloLinkDisplayStatus] ?? {
			label: status,
			className: "bg-muted text-muted-foreground",
			canCopy: false,
		}
	);
}

export function getPagaloGroupSummary(links: Array<{ status: string }>) {
	if (links.length === 0) return null;
	const pagados = links.filter((link) => link.status === "PAID").length;
	return `${pagados} de ${links.length} pagados`;
}

export async function copyPagaloLink(
	paymentUrl: string,
	clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard,
) {
	await clipboard.writeText(paymentUrl);
}
