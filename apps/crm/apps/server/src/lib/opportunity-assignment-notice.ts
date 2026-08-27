/**
 * Aviso INFORMATIVO de asignaciones pendientes en la etapa del 30%.
 *
 * NUNCA bloquea el avance de etapa: solo alimenta un badge en el kanban y un
 * banner en el detalle de la oportunidad. Si algún día se vuelve requisito,
 * eso va en las validaciones de `updateOpportunity`, no aquí.
 *
 * La meta es que jurídico no tenga que escribir el vendedor ni la agencia a
 * mano al generar los contratos.
 */

/** Etapa donde se muestra el aviso: "Recepción de documentación". */
export const ASSIGNMENT_NOTICE_STAGE_PERCENTAGE = 30;

export type MissingAssignment = "empresa" | "vendedor";

export interface OpportunityAssignmentInput {
	closurePercentage?: number | null;
	status?: string | null;
	vehicleId?: string | null;
	vehicleIsNew?: boolean | null;
	companyId?: string | null;
	vendorId?: string | null;
}

/**
 * Qué falta asignarle a la oportunidad para que los contratos se llenen solos.
 *
 * La regla depende del vehículo: uno nuevo se compra a una agencia (empresa)
 * que además pone al vendedor; uno usado lo vende un particular, así que no
 * hay agencia que pedir.
 */
export function getMissingOpportunityAssignments(
	input: OpportunityAssignmentInput,
): MissingAssignment[] {
	// Igualdad estricta: con `>=` se encenderían todas las etapas superiores
	// sobre miles de oportunidades que ya pasaron por aquí.
	if (input.closurePercentage !== ASSIGNMENT_NOTICE_STAGE_PERCENTAGE) return [];

	// Una oportunidad cerrada o perdida ya no se va a completar. El kanban
	// muestra las perdidas cuando el filtro está activo.
	if (input.status === "won" || input.status === "lost") return [];

	// Sin vehículo no se sabe si hay agencia ni a quién comprarle todavía.
	if (!input.vehicleId) return [];

	const falta: MissingAssignment[] = [];

	// `isNew` es nullable y el vehículo pudo borrarse: ante la duda se trata
	// como usado, porque pedir una agencia que no existe es el error caro.
	if (input.vehicleIsNew === true && !input.companyId) falta.push("empresa");
	if (!input.vendorId) falta.push("vendedor");

	return falta;
}

/** Texto del aviso, o null si no falta nada. */
export function formatMissingAssignmentsMessage(
	missing: MissingAssignment[],
): string | null {
	const tieneEmpresa = missing.includes("empresa");
	const tieneVendedor = missing.includes("vendedor");

	if (tieneEmpresa && tieneVendedor) {
		return "Falta asignar la empresa (agencia) y el vendedor del vehículo";
	}
	if (tieneEmpresa) return "Falta asignar la empresa (agencia)";
	if (tieneVendedor) return "Falta asignar el vendedor del vehículo";
	return null;
}
