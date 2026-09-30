import { vistaFacturaSeguro } from "./factura-seguro";
import type { Caso } from "./pasos";

type CasoConDocumentos = Pick<Caso, "facturaSeguro" | "porcentaje" | "estado">;

/**
 * - `pendiente`: falta subirlo.
 * - `atencion`: se subió pero el envío falló y hay que reenviarlo.
 * - `subido`: no requiere nada del socio.
 */
export type EstadoDocumento = "pendiente" | "atencion" | "subido";

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
		documentos.push({
			clave: "factura_seguro",
			nombre: "Factura del seguro",
			estado:
				caso.facturaSeguro.envio === null
					? "pendiente"
					: factura.tono === "error"
						? "atencion"
						: "subido",
		});
	}
	return documentos;
}

export function tieneDocumentosPendientes(caso: CasoConDocumentos): boolean {
	return documentosDelCaso(caso).some((d) => d.estado === "pendiente");
}

export type TonoResumen = "ok" | "pendiente" | "atencion";

/** Estado general de la tarjeta "Documentos"; `null` si el caso no pide ninguno. */
export function resumenDocumentos(
	documentos: DocumentoCaso[],
): { tono: TonoResumen; texto: string } | null {
	if (documentos.length === 0) return null;
	if (documentos.some((d) => d.estado === "pendiente")) {
		return { tono: "pendiente", texto: "Documentos pendientes" };
	}
	if (documentos.some((d) => d.estado === "atencion")) {
		return { tono: "atencion", texto: "Revisar envío" };
	}
	return { tono: "ok", texto: "Sin documentos pendientes" };
}
