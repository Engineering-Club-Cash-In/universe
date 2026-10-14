import { vistaFacturaSeguro } from "./factura-seguro";
import type { Caso } from "./pasos";

type CasoConDocumentos = Pick<Caso, "facturaSeguro" | "porcentaje" | "estado">;

/**
 * - `pendiente`: falta subirlo.
 * - `opcional`: se puede subir, pero no cuenta como pendiente (ya desembolsado).
 * - `subido`: no requiere nada del socio.
 */
export type EstadoDocumento = "pendiente" | "opcional" | "subido";

export interface DocumentoCaso {
	clave: "factura_seguro";
	nombre: string;
	estado: EstadoDocumento;
}

/** Documentos que el caso pide al socio en su etapa actual. */
export function documentosDelCaso(caso: CasoConDocumentos): DocumentoCaso[] {
	const documentos: DocumentoCaso[] = [];
	const factura = vistaFacturaSeguro(caso);
	if (factura) {
		// Ya desembolsado y sin factura: el vendedor la puede subir, pero no
		// cuenta como pendiente (si no, aparecerían de golpe los casos viejos).
		const estado: EstadoDocumento =
			caso.facturaSeguro.envio !== null || caso.facturaSeguro.yaRegistrada
				? "subido"
				: caso.porcentaje >= 100
					? "opcional"
					: "pendiente";
		documentos.push({
			clave: "factura_seguro",
			nombre: "Factura del seguro",
			estado,
		});
	}
	return documentos;
}

export function tieneDocumentosPendientes(caso: CasoConDocumentos): boolean {
	return documentosDelCaso(caso).some((d) => d.estado === "pendiente");
}

export type TonoResumen = "ok" | "pendiente";

/** Estado general de la tarjeta "Documentos"; `null` si el caso no pide ninguno. */
export function resumenDocumentos(
	documentos: DocumentoCaso[],
): { tono: TonoResumen; texto: string } | null {
	if (documentos.length === 0) return null;
	if (documentos.some((d) => d.estado === "pendiente")) {
		return { tono: "pendiente", texto: "Documentos pendientes" };
	}
	return { tono: "ok", texto: "Sin documentos pendientes" };
}
