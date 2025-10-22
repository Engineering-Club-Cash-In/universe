// CRM formatting utilities for consistent display across the application

export const getSourceLabel = (source: string) => {
	switch (source) {
		case "website":
			return "Sitio Web";
		case "referral":
			return "Referencia";
		case "cold_call":
			return "Llamada en Frío";
		case "email":
			return "Correo Electrónico";
		case "social_media":
			return "Redes Sociales";
		case "event":
			return "Evento";
		case "other":
			return "Otro";
		default:
			return source;
	}
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
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
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
	}).format(Number(amount));
};
