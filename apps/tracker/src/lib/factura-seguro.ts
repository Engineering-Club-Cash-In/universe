import { type Caso, formatearFecha } from "./pasos";

export const MIME_FACTURA = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;
export const EXTENSIONES_FACTURA = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
export const TAMANO_MAXIMO_FACTURA = 10 * 1024 * 1024;

export type TonoFactura = "accion" | "ok" | "proceso" | "error" | "info";

export interface VistaFactura {
	tono: TonoFactura;
	titulo: string;
	texto: string;
	accion: "subir" | "reenviar" | null;
	/** Texto del botón de reenvío, según por qué no salió. */
	etiquetaReenvio: string | null;
}

/**
 * Qué muestra la sección "Factura del seguro" del caso. La decisión de fondo
 * (quién puede subir o reenviar) la toma el servidor; aquí solo se traduce.
 * `null` = el caso todavía no llega a esa etapa y la sección no se muestra.
 */
export function vistaFacturaSeguro(
	caso: Pick<Caso, "facturaSeguro" | "porcentaje" | "estado">,
): VistaFactura | null {
	const f = caso.facturaSeguro;
	const subida = f.subidaAt ? ` Subida el ${formatearFecha(f.subidaAt)}.` : "";

	if (f.envio === "enviado") {
		return {
			tono: "ok",
			titulo: "Factura enviada a la aseguradora",
			texto: `El correo con la factura fue enviado a la aseguradora para iniciar la póliza.${subida}`,
			accion: null,
			etiquetaReenvio: null,
		};
	}
	if (f.envio === "pendiente" && !f.reenviable) {
		return {
			tono: "proceso",
			titulo: "Enviando la factura a la aseguradora",
			texto: `El envío está en proceso.${subida}`,
			accion: null,
			etiquetaReenvio: null,
		};
	}
	// Un envío que quedó a medias pudo haber salido: no se afirma que falló.
	// Tampoco se promete que el reintento no duplique: Resend solo lo evita
	// durante 24 h.
	if (f.envio === "pendiente") {
		return {
			tono: "info",
			titulo: "No pudimos confirmar el envío",
			texto: `La factura está guardada, pero no pudimos confirmar si el correo llegó a la aseguradora. Puedes reintentar el envío.${subida}`,
			accion: "reenviar",
			etiquetaReenvio: "Reintentar envío",
		};
	}
	// Sin destinatarios configurados no es un fallo del envío: falta que Club
	// Cash In configure el correo de la aseguradora.
	if (f.envio === "sin_destinatario") {
		return {
			tono: "info",
			titulo: "Factura recibida",
			texto: f.reenviable
				? `El envío a la aseguradora está pendiente de configuración por parte de Club Cash In. Cuando esté listo, reintenta el envío.${subida}`
				: `El envío a la aseguradora está pendiente de configuración por parte de Club Cash In.${subida}`,
			accion: f.reenviable ? "reenviar" : null,
			etiquetaReenvio: "Reintentar envío",
		};
	}
	if (f.envio !== null) {
		return {
			tono: "error",
			titulo: "La factura no se pudo enviar a la aseguradora",
			texto: f.reenviable
				? `La factura está guardada; reenvíala para que llegue a la aseguradora.${subida}`
				: `La factura está guardada; el vendedor asignado puede reenviarla.${subida}`,
			accion: f.reenviable ? "reenviar" : null,
			etiquetaReenvio: "Reenviar a la aseguradora",
		};
	}
	if (f.habilitada) {
		return {
			tono: "accion",
			titulo: "Sube la factura del seguro",
			texto:
				"Se enviará automáticamente a la aseguradora para iniciar la póliza. Una vez enviada no se puede reemplazar.",
			accion: "subir",
			etiquetaReenvio: null,
		};
	}
	// En formalización final sin factura: quien no puede subirla (el gerente)
	// ve que está pendiente y por qué. No se mira `cerrado`: en el flujo normal
	// el caso llega a 90% ya ganado.
	if (
		caso.estado !== "rechazado" &&
		caso.porcentaje >= 90 &&
		caso.porcentaje < 100
	) {
		return {
			tono: "info",
			titulo: "Factura del seguro pendiente",
			texto: f.motivo ?? "La sube el vendedor asignado.",
			accion: null,
			etiquetaReenvio: null,
		};
	}
	return null;
}

/** Validación del lado del cliente; el servidor vuelve a validar. */
export function errorDeArchivoFactura(archivo: {
	name: string;
	type: string;
	size: number;
}): string | null {
	const nombre = archivo.name.toLowerCase();
	const tipoValido =
		(MIME_FACTURA as readonly string[]).includes(archivo.type) ||
		EXTENSIONES_FACTURA.some((ext) => nombre.endsWith(ext));
	if (!tipoValido) {
		return "La factura debe ser un PDF o una imagen (JPG, PNG o WebP)";
	}
	if (archivo.size > TAMANO_MAXIMO_FACTURA) {
		return "La factura no puede pesar más de 10 MB";
	}
	if (archivo.size === 0) return "El archivo está vacío";
	return null;
}
