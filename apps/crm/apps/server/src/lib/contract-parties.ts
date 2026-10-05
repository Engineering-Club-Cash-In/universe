/**
 * Partes del contrato que se capturan al asignar la inversión (etapa del 50%):
 * la agencia cuando el carro es nuevo y el vendedor (dueño) cuando es usado.
 *
 * Nunca bloquean el avance al 80%: si faltan, jurídico los llena a mano.
 */

export type VendorGender = "male" | "female";

export type MissingContractParty = "agencia" | "vendedor";

interface RenapName {
	firstName: string;
	secondName?: string | null;
	thirdName?: string | null;
	firstLastName: string;
	secondLastName?: string | null;
	marriedLastName?: string | null;
}

/**
 * Nombre completo como va en los contratos. RENAP guarda el apellido de
 * casada sin la partícula ("LEÓN"), y jurídico lo escribe "MEJÍA DE LEÓN".
 */
export function buildRenapFullName(renap: RenapName): string {
	const casada = renap.marriedLastName?.trim();
	return [
		renap.firstName,
		renap.secondName,
		renap.thirdName,
		renap.firstLastName,
		renap.secondLastName,
		casada ? `DE ${casada}` : null,
	]
		.map((parte) => parte?.trim())
		.filter(Boolean)
		.join(" ");
}

export function renapGenderToVendorGender(
	gender: string | null | undefined,
): VendorGender | null {
	if (gender === "M") return "male";
	if (gender === "F") return "female";
	return null;
}

export interface ContractPartiesInput {
	vehicleId?: string | null;
	vehicleIsNew?: boolean | null;
	companyId?: string | null;
	companyRazonSocial?: string | null;
	vendorId?: string | null;
	vendorGender?: string | null;
}

/**
 * Qué parte del contrato falta. Un carro nuevo se compra a una agencia; uno
 * usado lo vende su dueño. `isNew` nulo se trata como usado, igual que en el
 * aviso del 30%.
 */
export function getMissingContractParties(
	input: ContractPartiesInput,
): MissingContractParty[] {
	if (!input.vehicleId) return [];

	if (input.vehicleIsNew === true) {
		return input.companyId && input.companyRazonSocial?.trim()
			? []
			: ["agencia"];
	}

	return input.vendorId && input.vendorGender ? [] : ["vendedor"];
}
