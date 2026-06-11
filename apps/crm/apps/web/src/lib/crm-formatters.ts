// CRM formatting utilities for consistent display across the application
export {
	getLeadSourceBadgeClass,
	getLeadSourceLabel,
	LEAD_SOURCE_OPTIONS,
} from "server/src/lib/lead-sources";

import { getLeadSourceLabel } from "server/src/lib/lead-sources";

export const getSourceLabel = (source: string) => {
	return getLeadSourceLabel(source);
};

export const getStatusLabel = (status: string) => {
	switch (status) {
		case "new":
			return "Nuevo";
		case "contacted":
			return "Contactado";
		case "qualified":
			return "Calificado";
		case "unqualified":
			return "No Calificado";
		case "converted":
			return "Convertido";
		case "active":
			return "Activo";
		case "inactive":
			return "Inactivo";
		case "churned":
			return "Perdido";
		case "open":
			return "Abierto";
		case "won":
			return "Ganado";
		case "lost":
			return "Perdido";
		case "on_hold":
			return "En Espera";
		default:
			return status;
	}
};

export const formatGuatemalaDate = (date: string | Date) => {
	return new Date(date).toLocaleDateString("es-GT", {
		timeZone: "America/Guatemala",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
};

export const formatGuatemalaCalendarDate = (date: string | Date) => {
	return new Date(date).toLocaleDateString("es-GT", {
		timeZone: "UTC",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
};

export const formatGuatemalaDateTime = (date: string | Date) => {
	return new Date(date).toLocaleString("es-GT", {
		timeZone: "America/Guatemala",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: true,
	});
};

export const formatDate = (date: string | Date) => {
	const dateObj = typeof date === "string" ? new Date(date) : date;
	const day = String(dateObj.getUTCDate()).padStart(2, "0");
	const month = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
	const year = dateObj.getUTCFullYear();
	return `${day}/${month}/${year}`;
};

export const getMaritalStatusLabel = (status: string) => {
	switch (status) {
		case "single":
			return "Soltero/a";
		case "married":
			return "Casado/a";
		case "divorced":
			return "Divorciado/a";
		case "widowed":
			return "Viudo/a";
		default:
			return status;
	}
};

export const getOccupationLabel = (occupation: string) => {
	switch (occupation) {
		case "owner":
			return "Dueño";
		case "employee":
			return "Empleado";
		default:
			return occupation;
	}
};

export const getWorkTimeLabel = (time: string) => {
	switch (time) {
		case "less_than_1":
			return "Menos de un año";
		case "1_to_5":
			return "1 a 5 años";
		case "5_to_10":
			return "5 a 10 años";
		case "10_plus":
			return "Más de 10 años";
		default:
			return time;
	}
};

export const getClientTypeLabel = (clientType: string) => {
	switch (clientType) {
		case "individual":
			return "Individual";
		case "comerciante":
			return "Comerciante";
		case "empresa":
			return "Empresa";
		default:
			return clientType;
	}
};

export const getGenderLabel = (gender: string) => {
	switch (gender) {
		case "male":
			return "Masculino";
		case "female":
			return "Femenino";
		default:
			return gender;
	}
};

export const getLoanPurposeLabel = (purpose: string) => {
	switch (purpose) {
		case "personal":
			return "Personal";
		case "business":
			return "Negocio";
		default:
			return purpose;
	}
};

export const formatCurrency = (amount: number | string) => {
	return new Intl.NumberFormat("es-GT", {
		style: "currency",
		currency: "GTQ",
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(Number(amount));
};

export const getLeadStatusBadgeColor = (status: string) => {
	switch (status) {
		case "new":
			return "bg-blue-100 text-blue-800";
		case "contacted":
			return "bg-yellow-100 text-yellow-800";
		case "qualified":
			return "bg-green-100 text-green-800";
		case "unqualified":
			return "bg-red-100 text-red-800";
		case "converted":
			return "bg-purple-100 text-purple-800";
		default:
			return "bg-gray-100 text-gray-800";
	}
};

export const getOpportunityStatusBadgeColor = (status: string) => {
	switch (status) {
		case "open":
			return "bg-blue-100 text-blue-800";
		case "won":
			return "bg-green-100 text-green-800";
		case "lost":
			return "bg-red-100 text-red-800";
		case "on_hold":
			return "bg-yellow-100 text-yellow-800";
		default:
			return "bg-gray-100 text-gray-800";
	}
};

export const getDocumentTypeLabel = (documentType: string): string => {
	const labels: Record<string, string> = {
		// Documentos de identificación y personales
		dpi: "DPI",
		licencia: "Licencia",
		recibo_luz: "Recibo de luz",
		recibo_adicional: "Recibo adicional",
		formularios: "Formularios",
		// Estados de cuenta
		estados_cuenta_1: "Estado de cuenta mes 1",
		estados_cuenta_2: "Estado de cuenta mes 2",
		estados_cuenta_3: "Estado de cuenta mes 3",
		// Documentos comerciales
		patente_comercio: "Patente de comercio",
		patente_mercantil: "Patente mercantil",
		// Documentos empresariales (S.A.)
		representacion_legal: "Representación Legal",
		constitucion_sociedad: "Constitución de sociedad",
		iva_1: "Formulario IVA mes 1",
		iva_2: "Formulario IVA mes 2",
		iva_3: "Formulario IVA mes 3",
		estado_financiero: "Estado financiero",
		clausula_consentimiento: "Cláusula de consentimiento",
		minutas: "Minutas",
		// Documentos de vehículos
		tarjeta_circulacion: "Tarjeta de circulación",
		titulo_propiedad: "Título de propiedad",
		dpi_dueno: "DPI del dueño del vehículo",
		patente_comercio_vehiculo: "Patente comercio (vehículo)",
		representacion_legal_vehiculo: "Representación legal (vehículo)",
		dpi_representante_legal_vehiculo: "DPI representante legal (vehículo)",
		pago_impuesto_circulacion: "Pago impuesto de circulación",
		consulta_sat: "Usuario de SAT (Propietario)",
		consulta_garantias_mobiliarias: "Consulta garantías mobiliarias",
		datos_vehiculo_nuevo: "Documentos del vehículo nuevo",
		cotizacion_vehiculo_nuevo: "Cotización del vehículo nuevo",
		// === Verificaciones de Cliente ===
		usuario_sat_cliente: "Usuario de SAT (Cliente)",
		rtu_cliente: "RTU (Cliente)",
		omisos_incumplimientos_cliente: "Omisos e Incumplimientos (Cliente)",
		infornet: "Infornet",
		confirmacion_referencias: "Confirmación de Referencias",
		visita_domiciliar: "Visita Domiciliar",
		redes_sociales_internet: "Redes Sociales - Internet",
		enganche: "Comprobante de Enganche",
		// === Verificaciones de Vehículo / Propietario ===
		rtu_propietario: "RTU (Propietario)",
		omisos_incumplimientos_propietario:
			"Omisos e Incumplimientos (Propietario)",
		garantia_mobiliaria_sat: "Garantía Mobiliaria (SAT)",
		garantia_mobiliaria_dpi: "Garantía Mobiliaria (DPI Propietario)",
		garantia_mobiliaria_nit: "Garantía Mobiliaria (NIT Propietario)",
		garantia_mobiliaria_serie: "Garantía Mobiliaria (SERIE)",
		multas_vehiculo: "Multas del Vehículo",
		// === Documentos Etapa 90% (Cierre) ===
		seguro_vehiculo: "Seguro del Vehículo",
		inscripcion_garantia_mobiliaria: "Inscripción Garantía Mobiliaria",
		traspaso: "Traspaso",
		documentos_firmados_vendedor: "Documentos Firmados por Vendedor",
		copia_llave: "Copia de Llave",
		confirmacion_enganche: "Confirmación de Enganche",
		desembolso: "Desembolso",
		// Legacy (para compatibilidad)
		identification: "Identificación (DPI/Pasaporte)",
		income_proof: "Comprobante de Ingresos",
		bank_statement: "Estado de Cuenta Bancario",
		business_license: "Patente de Comercio",
		property_deed: "Escrituras de Propiedad",
		vehicle_title: "Tarjeta de Circulación",
		credit_report: "Reporte Crediticio",
		detalle_analisis: "Detalle de Análisis",
		other: "Otro",
	};

	if (labels[documentType]) {
		return labels[documentType];
	}

	// Fallback: convertir snake_case a Title Case
	return documentType
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
};

export const getContractTypeLabel = (contractType: string) => {
	// Map for known contract types
	const knownTypes: Record<string, string> = {
		solicitud_compra_vehiculo_tercero: "Solicitud Compra Vehículo Tercero",
		contrato_privado_uso_carro_usado: "Contrato Privado Uso Carro Usado",
		contrato_privado_uso_carro_nuevo: "Contrato Privado Uso Carro Nuevo",
		pagare: "Pagaré",
		carta_notarial: "Carta Notarial",
		contrato_compraventa: "Contrato Compraventa",
		contrato_financiamiento: "Contrato Financiamiento",
		contrato_prenda: "Contrato Prenda",
	};

	// Check if it's a known type
	if (knownTypes[contractType]) {
		return knownTypes[contractType];
	}

	// Otherwise, convert snake_case to Title Case
	return contractType
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
};
