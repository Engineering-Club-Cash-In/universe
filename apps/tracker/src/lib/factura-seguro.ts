import { type Caso, formatearFecha } from "./pasos";

export const MIME_FACTURA = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;
export const EXTENSIONES_FACTURA = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
export const TAMANO_MAXIMO_FACTURA = 10 * 1024 * 1024;

export type TonoFactura = "accion" | "ok" | "info";

export interface VistaFactura {
	tono: TonoFactura;
	titulo: string;
	texto: string;
	accion: "subir" | null;
}

/**
 * Qué muestra la sección "Factura del seguro" del caso. La decisión de fondo
 * (quién puede subir) la toma el servidor; aquí solo se traduce.
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
			titulo: "Factura enviada",
			texto: `La factura fue enviada.${subida}`,
			accion: null,
		};
	}
	if (f.envio !== null) {
		return {
			tono: "info",
			titulo: "Factura recibida",
			texto: `La factura fue recibida.${subida}`,
			accion: null,
		};
	}
	if (f.habilitada) {
		return {
			tono: "accion",
			titulo: "Sube la factura del seguro",
			texto: "Revisa que sea la factura correcta: después de subirla no se puede reemplazar.",
			accion: "subir",
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
