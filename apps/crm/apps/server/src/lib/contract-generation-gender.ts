export type ContractGender = "male" | "female";

export const LEGACY_VENDOR_GENDER_REQUIRED_MESSAGE =
	"El género del vendedor es obligatorio para generar la declaración del vendedor";

export function resolveLegacyContractGender(params: {
	apiContractType: string;
	clientGender?: string | null;
	vendorGender?: ContractGender;
}): ContractGender {
	if (params.apiContractType === "declaracion_vendedor") {
		if (!params.vendorGender) {
			throw new Error(LEGACY_VENDOR_GENDER_REQUIRED_MESSAGE);
		}

		return params.vendorGender;
	}

	return params.clientGender === "femenino" ? "female" : "male";
}
