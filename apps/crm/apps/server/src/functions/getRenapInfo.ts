import {
	CENTINELA_API_KEY,
	CLOUDFRONT_URL,
	RENAP_API_URL,
} from "../utils/constants";
export interface RenapData {
	dpi: string;
	firstName: string;
	secondName: string;
	thirdName: string;
	firstLastName: string;
	secondLastName: string;
	marriedLastName: string;
	picture: string;
	birthDate: string;
	gender: "M" | "F";
	civil_status: "S" | "C";
	nationality: string;
	borned_in: string;
	department_borned_in: string;
	municipality_borned_in: string;
	deathDate: string;
	ocupation: string;
	cedula_order: string;
	cedula_register: string;
	dpi_expiracy_date: string;
}

export type RenapResponse =
	| {
			success: true;
			data: RenapData;
			status: number;
			message: string;
			error: string | null;
	  }
	| {
			success: false;
			data: null;
			status: number;
			message: string;
			error: string | null;
	  };

const camposTextoRenap = [
	"dpi",
	"firstName",
	"secondName",
	"thirdName",
	"firstLastName",
	"secondLastName",
	"marriedLastName",
	"picture",
	"birthDate",
	"nationality",
	"borned_in",
	"department_borned_in",
	"municipality_borned_in",
	"deathDate",
	"ocupation",
	"cedula_order",
	"cedula_register",
	"dpi_expiracy_date",
] as const;

function esRegistro(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function esRenapData(value: unknown): value is RenapData {
	if (!esRegistro(value)) return false;

	return (
		camposTextoRenap.every((campo) => typeof value[campo] === "string") &&
		(value.gender === "M" || value.gender === "F") &&
		(value.civil_status === "S" || value.civil_status === "C")
	);
}

export const getRenapData = async (dpi: string): Promise<RenapResponse> => {
	const response = await fetch(`${RENAP_API_URL}?dpi=${dpi}`, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${CENTINELA_API_KEY}`,
		},
	});
	const rawData: unknown = await response.json();
	const envelope = esRegistro(rawData) ? rawData : null;
	const mensaje =
		typeof envelope?.message === "string" && envelope.message.trim()
			? envelope.message
			: response.ok
				? "RENAP devolvió una respuesta inválida"
				: `RENAP respondió HTTP ${response.status}`;
	const status =
		typeof envelope?.status === "number" ? envelope.status : response.status;
	const error = typeof envelope?.error === "string" ? envelope.error : null;

	if (!response.ok || envelope?.success !== true || !esRenapData(envelope.data)) {
		return {
			success: false,
			data: null,
			status,
			message: mensaje,
			error,
		};
	}

	return {
		success: true,
		status,
		message: mensaje,
		error,
		data: {
			...envelope.data,
			picture: envelope.data.picture.replace(
				"https://funtec-uploads.s3.amazonaws.com/",
				CLOUDFRONT_URL,
			),
		},
	};
};
