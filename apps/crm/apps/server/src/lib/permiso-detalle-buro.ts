import { PERMISSIONS } from "./roles";

/** El estudio sigue visible en el expediente durante todo el ciclo comercial. */
export function puedeAccederDetalleBuro({
	userRole,
	userId,
	assignedTo,
}: {
	userRole: string;
	userId: string;
	assignedTo: string;
}): boolean {
	if (PERMISSIONS.canAccessAnalysis(userRole)) return true;
	return userRole === "sales" && assignedTo === userId;
}

/** El 30% admite una excepción registrada para identidad cambiada o Buró vencido. */
export function puedeReejecutarDetalleBuro({
	userRole,
	userId,
	assignedTo,
	porcentaje,
	status,
	buroRevalidacionAl30 = false,
}: {
	userRole: string;
	userId: string;
	assignedTo: string;
	porcentaje: number;
	status: string;
	buroRevalidacionAl30?: boolean;
}): boolean {
	return (
		puedeAccederDetalleBuro({ userRole, userId, assignedTo }) &&
		status === "open" &&
		(porcentaje === 20 || (porcentaje === 30 && buroRevalidacionAl30))
	);
}

/** Ventas puede validar manualmente Buró de su oportunidad al 20%; RENAP queda en análisis. */
export function puedeMarcarValidacionManualDetalleBuro({
	tipo,
	...expediente
}: Parameters<typeof puedeReejecutarDetalleBuro>[0] & {
	tipo: "buro" | "renap";
}): boolean {
	const { userRole, porcentaje } = expediente;
	const rolPermitido =
		PERMISSIONS.canOverrideValidacionManual(userRole) ||
		(userRole === "sales" && tipo === "buro" && porcentaje === 20);
	return rolPermitido && puedeReejecutarDetalleBuro(expediente);
}
