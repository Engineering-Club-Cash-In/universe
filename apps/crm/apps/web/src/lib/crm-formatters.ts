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
