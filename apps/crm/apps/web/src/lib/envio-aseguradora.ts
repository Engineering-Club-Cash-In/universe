const ASEGURADORAS: Record<string, string> = {
	gyt: "Seguros G&T",
	universales: "Seguros Universales",
};

export function nombreAseguradora(codigo: string | null | undefined): string {
	return ASEGURADORAS[codigo ?? ""] ?? "la aseguradora";
}

interface EnvioAseguradora {
	estado: string | null;
	aseguradora: string | null;
	/** `pendiente` pasado el plazo: no se sabe si salió. */
	sinConfirmar?: boolean;
}

/** Estado del correo de la factura del seguro subida desde el tracker. */
export function etiquetaEnvioAseguradora(
	envio: EnvioAseguradora | null | undefined,
): { texto: string; className: string } | null {
	if (!envio?.estado) return null;
	const aseguradora = nombreAseguradora(envio.aseguradora);
	switch (envio.estado) {
		case "enviado":
			return {
				texto: `Correo enviado a ${aseguradora}`,
				className: "bg-green-100 text-green-800",
			};
		case "pendiente":
			return envio.sinConfirmar
				? {
						texto: `No se pudo confirmar el correo a ${aseguradora}`,
						className: "bg-amber-100 text-amber-800",
					}
				: {
						texto: `Correo a ${aseguradora} en proceso`,
						className: "bg-blue-100 text-blue-800",
					};
		case "fallido":
			return {
				texto: `No se pudo enviar el correo a ${aseguradora}`,
				className: "bg-red-100 text-red-800",
			};
		case "sin_destinatario":
			return {
				texto: `Correo a ${aseguradora} pendiente de configuración`,
				className: "bg-amber-100 text-amber-800",
			};
		default:
			return null;
	}
}

export interface ResultadoFacturaSubida {
	enviada: boolean;
	envio?: string;
	aseguradora?: string;
	motivo?: string;
}

/** Aviso tras subir un "Seguro del Vehículo" desde el CRM; null para los demás documentos. */
export function avisoFacturaSubida(
	resultado: ResultadoFacturaSubida | null | undefined,
): { tipo: "success" | "info" | "warning"; texto: string } | null {
	if (!resultado) return null;
	if (!resultado.enviada) {
		return {
			tipo: "info",
			texto: `Documento guardado. No se envió a la aseguradora: ${resultado.motivo}.`,
		};
	}
	const aseguradora = nombreAseguradora(resultado.aseguradora);
	switch (resultado.envio) {
		case "enviado":
			return { tipo: "success", texto: `Factura enviada a ${aseguradora}` };
		case "sin_destinatario":
			return {
				tipo: "info",
				texto: `Factura guardada. El correo a ${aseguradora} está pendiente de configuración`,
			};
		case "fallido":
			return {
				tipo: "warning",
				texto: `Factura guardada, pero no se pudo enviar el correo a ${aseguradora}. Puedes reintentarlo una vez.`,
			};
		default:
			return {
				tipo: "info",
				texto: `Factura guardada. El correo a ${aseguradora} está en proceso`,
			};
	}
}

export function textoSubidoPor(doc: {
	uploadedBy?: { name: string | null } | null;
	subidoDesde?: string | null;
}): string {
	const nombre = doc.uploadedBy?.name || "Usuario desconocido";
	const agencia = doc.subidoDesde?.trim();
	return agencia
		? `Subido desde ${agencia} por ${nombre}`
		: `Subido por ${nombre}`;
}
