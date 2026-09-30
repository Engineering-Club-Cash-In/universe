const ASEGURADORAS: Record<string, string> = {
	gyt: "Seguros G&T",
	universales: "Seguros Universales",
};

interface EnvioAseguradora {
	estado: string | null;
	aseguradora: string | null;
}

/** Estado del correo de la factura del seguro subida desde el tracker. */
export function etiquetaEnvioAseguradora(
	envio: EnvioAseguradora | null | undefined,
): { texto: string; className: string } | null {
	if (!envio?.estado) return null;
	const aseguradora = ASEGURADORAS[envio.aseguradora ?? ""] ?? "la aseguradora";
	switch (envio.estado) {
		case "enviado":
			return {
				texto: `Correo enviado a ${aseguradora}`,
				className: "bg-green-100 text-green-800",
			};
		case "pendiente":
			return {
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
