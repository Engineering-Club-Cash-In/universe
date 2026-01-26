/**
 * Servicio para mapear datos del CRM al formato de legal-docs-blueprints
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { leads, opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { getRenapData } from "../functions/getRenapInfo";
import {
	calculateAge,
	calculateAgeInWords,
	capitalizeWords,
	dpiToLegalFormat,
	dpiToWordsUppercase,
	formatDpi,
	formatMoneyNumber,
	formatMoneyWithQ,
	formatNationality,
	getDateComponents,
	getGenderLetter,
	getYearPartial,
	getYearTwoDigits,
	mapGender,
	mapMaritalStatus,
	numberToWords,
	numberToWordsQuetzales,
	numberToWordsQuetzalesLegal,
	toUpperCase,
} from "../lib/contract-utils";

// Tipos de contratos disponibles
export const CONTRACT_TYPES = [
	{ id: "compraventa", name: "Contrato de Compraventa", requiresBeneficiary: false },
	{ id: "credito_prendario", name: "Contrato de Crédito Prendario", requiresBeneficiary: true },
	{ id: "pagare", name: "Pagaré", requiresBeneficiary: true },
	{ id: "mandato_especial", name: "Mandato Especial Irrevocable", requiresBeneficiary: false },
	{ id: "reconocimiento_deuda", name: "Reconocimiento de Deuda", requiresBeneficiary: true },
	{ id: "contrato_gps", name: "Contrato de GPS", requiresBeneficiary: false },
	{ id: "contrato_seguro", name: "Contrato de Seguro", requiresBeneficiary: false },
	{ id: "poder_especial", name: "Poder Especial", requiresBeneficiary: false },
	{ id: "declaracion_jurada", name: "Declaración Jurada", requiresBeneficiary: false },
	{ id: "acta_entrega", name: "Acta de Entrega-Recepción", requiresBeneficiary: false },
	{ id: "contrato_fianza", name: "Contrato de Fianza", requiresBeneficiary: true },
	{ id: "carta_compromiso", name: "Carta Compromiso", requiresBeneficiary: false },
	{ id: "autorizacion_desembolso", name: "Autorización de Desembolso", requiresBeneficiary: true },
] as const;

export type ContractType = (typeof CONTRACT_TYPES)[number]["id"];

export interface Beneficiario {
	cuenta: string;
	monto: string;
	montoEnLetras: string;
}

export interface ContractDateComponents {
	day: string;
	month: string;
	year: string;
	yearPartial: string; // Solo parte después de "dos mil" (ej: "veinticinco")
	yearTwoDigits: string; // Año en 2 dígitos (ej: "25")
	dayNumber: number;
	dayPadded: string; // Día con padding (ej: "02")
	monthNumber: number;
	yearNumber: number;
}

export interface ContractData {
	// Datos del cliente
	cliente: {
		nombreCompleto: string;
		nombreCompletoMayusculas: string;
		primerNombre: string;
		segundoNombre: string;
		primerApellido: string;
		segundoApellido: string;
		dpi: string;
		dpiFormateado: string;
		dpiLegal: string;
		dpiLetras: string; // DPI en MAYÚSCULAS sin paréntesis
		edad: number;
		edadEnLetras: string;
		estadoCivil: string;
		genero: string;
		generoLetra: string; // "o" para masculino, "a" para femenino
		nacionalidad: string;
		direccion: string;
		direccionMayusculas: string;
		telefono: string;
		email: string;
		profesion?: string;
	};
	// Datos del vehículo
	vehiculo: {
		marca: string;
		marcaMayusculas: string;
		modelo: string;
		linea: string;
		lineaMayusculas: string;
		anio: number;
		anioEnLetras: string;
		color: string;
		colorMayusculas: string;
		tipoVehiculo: string;
		tipoVehiculoMayusculas: string;
		placas: string;
		placasMayusculas: string;
		vin: string;
		vinMayusculas: string;
		motor: string;
		motorMayusculas: string;
		serie?: string;
		serieMayusculas?: string;
		asientos: number;
		asientosEnLetras: string;
		puertas?: number;
		puertasEnLetras?: string;
		ejes: number;
		ejesEnLetras: string;
		cilindros?: string;
		cilindraje?: string;
		combustible?: string;
		combustibleMayusculas?: string;
		transmision?: string;
		origen?: string;
		uso: string; // Particular o Comercial
		usoMayusculas: string;
		codigoIscv?: string;
		codigoIscvMayusculas?: string;
		kilometraje?: number;
		esNuevo: boolean;
	};
	// Datos del crédito
	credito: {
		montoTotal: number;
		montoTotalEnLetras: string;
		montoTotalLegal: string; // MAYÚSCULAS (Q.número)
		montoTotalNumero: string; // Número formateado sin Q (ej: "146,970.60")
		montoTotalConQ: string; // Con Q (ej: "Q.146,970.60")
		cuotaMensual: number;
		cuotaMensualEnLetras: string;
		cuotaMensualLegal: string; // MAYÚSCULAS (Q.número)
		cuotaMensualNumero: string; // Número formateado sin Q
		cuotaMensualConQ: string; // Con Q
		numeroCuotas: number;
		numeroCuotasEnLetras: string;
		tasaInteres: number;
		tasaInteresEnLetras: string;
		diaPago: number;
		diaPagoEnLetras: string;
		seguro?: number;
		seguroEnLetras?: string;
		gps?: number;
		gpsEnLetras?: string;
	};
	// Datos del contrato
	contrato: {
		fecha: ContractDateComponents;
		fechaInicio?: ContractDateComponents;
		lugarFirma: string;
	};
	// Beneficiarios (para desembolso)
	beneficiarios?: Beneficiario[];
	// Datos adicionales de la oportunidad
	oportunidad: {
		id: string;
		titulo: string;
		tipoCredito: string;
		categoria?: string;
	};
}

export interface RenapEnrichmentResult {
	success: boolean;
	enrichedFields: string[];
	missingFields: string[];
	error?: string;
}

/**
 * Consulta RENAP para obtener datos faltantes del lead
 */
export async function enrichLeadFromRenap(
	leadId: string,
): Promise<RenapEnrichmentResult> {
	const enrichedFields: string[] = [];
	const missingFields: string[] = [];

	try {
		// Obtener el lead actual
		const [lead] = await db
			.select()
			.from(leads)
			.where(eq(leads.id, leadId))
			.limit(1);

		if (!lead) {
			return {
				success: false,
				enrichedFields: [],
				missingFields: [],
				error: "Lead no encontrado",
			};
		}

		// Verificar si faltan campos que RENAP puede proveer
		const needsGender = !lead.gender;
		const needsBirthDate = !lead.birthDate;
		const needsNationality = !lead.nationality;

		// Si ya tiene todos los datos, no consultar RENAP
		if (!needsGender && !needsBirthDate && !needsNationality) {
			return {
				success: true,
				enrichedFields: [],
				missingFields: [],
			};
		}

		// Verificar que tiene DPI para consultar
		if (!lead.dpi) {
			if (needsGender) missingFields.push("Género");
			if (needsBirthDate) missingFields.push("Fecha de Nacimiento");
			if (needsNationality) missingFields.push("Nacionalidad");
			return {
				success: false,
				enrichedFields: [],
				missingFields,
				error: "Lead no tiene DPI para consultar RENAP",
			};
		}

		// Consultar RENAP
		const renapResponse = await getRenapData(lead.dpi);

		if (!renapResponse.success || !renapResponse.data) {
			if (needsGender) missingFields.push("Género");
			if (needsBirthDate) missingFields.push("Fecha de Nacimiento");
			if (needsNationality) missingFields.push("Nacionalidad");
			return {
				success: false,
				enrichedFields: [],
				missingFields,
				error: "No se pudo obtener información de RENAP",
			};
		}

		const renapData = renapResponse.data;

		// Preparar actualización
		const updates: Partial<typeof leads.$inferInsert> = {};

		if (needsGender && renapData.gender) {
			updates.gender = renapData.gender === "F" ? "female" : "male";
			enrichedFields.push("Género");
		} else if (needsGender) {
			missingFields.push("Género");
		}

		if (needsBirthDate && renapData.birthDate) {
			updates.birthDate = new Date(renapData.birthDate);
			enrichedFields.push("Fecha de Nacimiento");
		} else if (needsBirthDate) {
			missingFields.push("Fecha de Nacimiento");
		}

		if (needsNationality && renapData.nationality) {
			updates.nationality = renapData.nationality;
			enrichedFields.push("Nacionalidad");
		} else if (needsNationality) {
			missingFields.push("Nacionalidad");
		}

		// Actualizar lead si hay campos nuevos
		if (Object.keys(updates).length > 0) {
			await db
				.update(leads)
				.set({
					...updates,
					updatedAt: new Date(),
				})
				.where(eq(leads.id, leadId));
		}

		return {
			success: missingFields.length === 0,
			enrichedFields,
			missingFields,
		};
	} catch (error) {
		console.error("Error consultando RENAP:", error);
		return {
			success: false,
			enrichedFields: [],
			missingFields: ["Género", "Fecha de Nacimiento", "Nacionalidad"],
			error: error instanceof Error ? error.message : "Error desconocido",
		};
	}
}

/**
 * Mapea los datos de una oportunidad al formato necesario para contratos
 */
export async function mapOpportunityToContractData(
	opportunityId: string,
	contractDate?: Date,
): Promise<ContractData | null> {
	// Obtener oportunidad con lead y vehículo
	const [opportunityData] = await db
		.select({
			opportunity: opportunities,
			lead: leads,
			vehicle: vehicles,
		})
		.from(opportunities)
		.innerJoin(leads, eq(opportunities.leadId, leads.id))
		.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!opportunityData) {
		return null;
	}

	const { opportunity, lead, vehicle } = opportunityData;

	// Usar fecha proporcionada o fecha actual
	const fechaContrato = contractDate || new Date();
	const fechaComponents = getDateComponents(fechaContrato);

	// Construir nombre completo
	const nombreParts = [
		lead.firstName,
		lead.middleName,
		lead.lastName,
		lead.secondLastName,
	].filter(Boolean);
	const nombreCompleto = nombreParts.join(" ");

	// Calcular edad si hay fecha de nacimiento
	const edad = lead.birthDate ? calculateAge(lead.birthDate) : 0;
	const edadEnLetras = lead.birthDate
		? calculateAgeInWords(lead.birthDate)
		: "";

	// Formatear estado civil
	const estadoCivil = mapMaritalStatus(lead.maritalStatus, lead.gender);

	// Formatear nacionalidad
	const nacionalidad = formatNationality(lead.nationality, lead.gender);

	// Datos del vehículo
	const vehicleData = vehicle
		? {
				marca: vehicle.make,
				marcaMayusculas: toUpperCase(vehicle.make),
				modelo: vehicle.model,
				linea: vehicle.model, // En algunos casos línea = modelo
				lineaMayusculas: toUpperCase(vehicle.model),
				anio: vehicle.year,
				anioEnLetras: numberToWords(vehicle.year),
				color: vehicle.color,
				colorMayusculas: toUpperCase(vehicle.color),
				tipoVehiculo: vehicle.vehicleType,
				tipoVehiculoMayusculas: toUpperCase(vehicle.vehicleType),
				placas: vehicle.licensePlate || "",
				placasMayusculas: toUpperCase(vehicle.licensePlate || ""),
				vin: vehicle.vinNumber || "",
				vinMayusculas: toUpperCase(vehicle.vinNumber || ""),
				motor: vehicle.motorNumber || "",
				motorMayusculas: toUpperCase(vehicle.motorNumber || ""),
				serie: vehicle.series || undefined,
				serieMayusculas: vehicle.series
					? toUpperCase(vehicle.series)
					: undefined,
				asientos: vehicle.seats || 0,
				asientosEnLetras: numberToWords(vehicle.seats || 0),
				puertas: vehicle.doors || undefined,
				puertasEnLetras: vehicle.doors
					? numberToWords(vehicle.doors)
					: undefined,
				ejes: vehicle.axles || 2,
				ejesEnLetras: numberToWords(vehicle.axles || 2),
				cilindros: vehicle.cylinders || undefined,
				cilindraje: vehicle.engineCC || undefined,
				combustible: vehicle.fuelType || undefined,
				combustibleMayusculas: vehicle.fuelType
					? toUpperCase(vehicle.fuelType)
					: undefined,
				transmision: vehicle.transmission || undefined,
				origen: vehicle.origin || undefined,
				uso: vehicle.vehicleUse || "Particular",
				usoMayusculas: toUpperCase(vehicle.vehicleUse || "Particular"),
				codigoIscv: vehicle.iscvCode || undefined,
				codigoIscvMayusculas: vehicle.iscvCode
					? toUpperCase(vehicle.iscvCode)
					: undefined,
				kilometraje: vehicle.kmMileage || undefined,
				esNuevo: vehicle.isNew,
			}
		: {
				marca: "",
				marcaMayusculas: "",
				modelo: "",
				linea: "",
				lineaMayusculas: "",
				anio: 0,
				anioEnLetras: "",
				color: "",
				colorMayusculas: "",
				tipoVehiculo: "",
				tipoVehiculoMayusculas: "",
				placas: "",
				placasMayusculas: "",
				vin: "",
				vinMayusculas: "",
				motor: "",
				motorMayusculas: "",
				asientos: 0,
				asientosEnLetras: "",
				ejes: 2,
				ejesEnLetras: "dos",
				uso: "Particular",
				usoMayusculas: "PARTICULAR",
				esNuevo: false,
			};

	// Datos del crédito
	const montoTotal = Number(opportunity.value) || 0;
	const cuotaMensual = Number(opportunity.cuotaMensual) || 0;
	const numeroCuotas = opportunity.numeroCuotas || 0;
	const tasaInteres = Number(opportunity.tasaInteres) || 0;
	const diaPago = opportunity.diaPagoMensual || 1;
	const seguro = opportunity.seguro ? Number(opportunity.seguro) : undefined;
	const gps = opportunity.gps ? Number(opportunity.gps) : undefined;

	// Fecha inicio del crédito
	const fechaInicio = opportunity.fechaInicio
		? getDateComponents(opportunity.fechaInicio)
		: undefined;

	return {
		cliente: {
			nombreCompleto: capitalizeWords(nombreCompleto),
			nombreCompletoMayusculas: toUpperCase(nombreCompleto),
			primerNombre: lead.firstName || "",
			segundoNombre: lead.middleName || "",
			primerApellido: lead.lastName || "",
			segundoApellido: lead.secondLastName || "",
			dpi: lead.dpi || "",
			dpiFormateado: formatDpi(lead.dpi || ""),
			dpiLegal: dpiToLegalFormat(lead.dpi || ""),
			dpiLetras: dpiToWordsUppercase(lead.dpi || ""),
			edad,
			edadEnLetras,
			estadoCivil,
			genero: mapGender(lead.gender),
			generoLetra: getGenderLetter(lead.gender),
			nacionalidad,
			direccion: lead.direccion || "",
			direccionMayusculas: toUpperCase(lead.direccion || ""),
			telefono: lead.phone || "",
			email: lead.email || "",
			profesion: lead.jobTitle || undefined,
		},
		vehiculo: vehicleData,
		credito: {
			montoTotal,
			montoTotalEnLetras: numberToWordsQuetzales(montoTotal),
			montoTotalLegal: numberToWordsQuetzalesLegal(montoTotal),
			montoTotalNumero: formatMoneyNumber(montoTotal),
			montoTotalConQ: formatMoneyWithQ(montoTotal),
			cuotaMensual,
			cuotaMensualEnLetras: numberToWordsQuetzales(cuotaMensual),
			cuotaMensualLegal: numberToWordsQuetzalesLegal(cuotaMensual),
			cuotaMensualNumero: formatMoneyNumber(cuotaMensual),
			cuotaMensualConQ: formatMoneyWithQ(cuotaMensual),
			numeroCuotas,
			numeroCuotasEnLetras: numberToWords(numeroCuotas),
			tasaInteres,
			tasaInteresEnLetras: numberToWords(Math.floor(tasaInteres)),
			diaPago,
			diaPagoEnLetras: numberToWords(diaPago),
			seguro,
			seguroEnLetras: seguro ? numberToWordsQuetzales(seguro) : undefined,
			gps,
			gpsEnLetras: gps ? numberToWordsQuetzales(gps) : undefined,
		},
		contrato: {
			fecha: fechaComponents,
			fechaInicio,
			lugarFirma: "Guatemala",
		},
		oportunidad: {
			id: opportunity.id,
			titulo: opportunity.title,
			tipoCredito: opportunity.creditType || "autocompra",
			categoria: opportunity.categoria || undefined,
		},
	};
}

/**
 * Valida si una oportunidad tiene todos los datos necesarios para generar contratos
 */
export interface ValidationResult {
	isValid: boolean;
	missingVehicleFields: string[];
	missingLeadFields: string[];
	missingCreditFields: string[];
	canEnrichFromRenap: boolean;
}

export async function validateOpportunityForContracts(
	opportunityId: string,
): Promise<ValidationResult> {
	const [opportunityData] = await db
		.select({
			opportunity: opportunities,
			lead: leads,
			vehicle: vehicles,
		})
		.from(opportunities)
		.innerJoin(leads, eq(opportunities.leadId, leads.id))
		.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
		.where(eq(opportunities.id, opportunityId))
		.limit(1);

	if (!opportunityData) {
		return {
			isValid: false,
			missingVehicleFields: ["Vehículo no asociado"],
			missingLeadFields: ["Lead no encontrado"],
			missingCreditFields: [],
			canEnrichFromRenap: false,
		};
	}

	const { opportunity, lead, vehicle } = opportunityData;
	const missingVehicleFields: string[] = [];
	const missingLeadFields: string[] = [];
	const missingCreditFields: string[] = [];

	// Validar campos del vehículo
	if (!vehicle) {
		missingVehicleFields.push("Vehículo no asociado");
	} else {
		if (!vehicle.vinNumber) missingVehicleFields.push("VIN/Chasis");
		if (!vehicle.motorNumber) missingVehicleFields.push("Número de Motor");
		if (!vehicle.seats) missingVehicleFields.push("Asientos");
		if (!vehicle.vehicleUse) missingVehicleFields.push("Uso (Particular/Comercial)");
	}

	// Validar campos del lead
	if (!lead.dpi) missingLeadFields.push("DPI");
	if (!lead.direccion) missingLeadFields.push("Dirección");
	if (!lead.maritalStatus) missingLeadFields.push("Estado Civil");
	if (!lead.gender) missingLeadFields.push("Género");
	if (!lead.birthDate) missingLeadFields.push("Fecha de Nacimiento");
	if (!lead.nationality) missingLeadFields.push("Nacionalidad");

	// Validar campos del crédito
	if (!opportunity.value) missingCreditFields.push("Monto del crédito");
	if (!opportunity.cuotaMensual) missingCreditFields.push("Cuota mensual");
	if (!opportunity.numeroCuotas) missingCreditFields.push("Número de cuotas");
	if (!opportunity.tasaInteres) missingCreditFields.push("Tasa de interés");

	// Determinar si se puede enriquecer desde RENAP
	const renapFields = ["Género", "Fecha de Nacimiento", "Nacionalidad"];
	const canEnrichFromRenap =
		!!lead.dpi && missingLeadFields.some((f) => renapFields.includes(f));

	return {
		isValid:
			missingVehicleFields.length === 0 &&
			missingLeadFields.length === 0 &&
			missingCreditFields.length === 0,
		missingVehicleFields,
		missingLeadFields,
		missingCreditFields,
		canEnrichFromRenap,
	};
}

/**
 * Obtiene los tipos de contratos disponibles
 */
export function getContractTypes() {
	return CONTRACT_TYPES;
}
