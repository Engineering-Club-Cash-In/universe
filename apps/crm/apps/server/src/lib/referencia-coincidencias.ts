import {
	type CoincidePor,
	coincidenciaReferencia,
	type ReferenciaComparable,
} from "./referencia-normalizacion";

/**
 * Parte pura de la alerta de referencias repetidas (EXTRAIT-267): de las filas
 * candidatas de la base, cuáles son la misma persona y cómo se presentan.
 */

/** Dónde está la otra referencia: cobros, o la lista personal o familiar de una solicitud. */
export type TipoReferencia = "cobros" | "personal" | "familiar";
export type RolReferencia = "titular" | "codeudor";

export type ReferenciaDuplicada = {
	tipo: TipoReferencia;
	leadId: string | null;
	clienteNombre: string | null;
	oportunidadId: string | null;
	referenciaNombre: string | null;
	parentesco: string | null;
	dadaPor: { nombre: string | null; rol: RolReferencia };
	coincidePor: CoincidePor;
};

export type ResultadoReferenciasDuplicadas = {
	total: number;
	coincidencias: ReferenciaDuplicada[];
};

export const MAX_COINCIDENCIAS = 10;

/** Fila candidata tal como sale de la base, la más reciente primero. */
export type FilaCandidata = {
	tipo: TipoReferencia;
	lead_id: string | null;
	oportunidad_id: string | null;
	cliente_nombre: string | null;
	referencia_nombre: string | null;
	parentesco: string | null;
	referencia_dpi: string | null;
	referencia_telefono: string | null;
	dada_por_nombre: string | null;
	dada_por_rol: RolReferencia;
};

/**
 * Un cliente sale una vez (cobros y solicitud, personal y familiar, titular y
 * codeudor). Si coincide por DPI en una fila y por teléfono en otra, manda la
 * del DPI y se muestra esa fila. Tope de `MAX_COINCIDENCIAS`, con el total real.
 */
export function coincidenciasDeReferencia(
	referencia: ReferenciaComparable,
	candidatas: FilaCandidata[],
): ResultadoReferenciasDuplicadas {
	const porCliente = new Map<string, ReferenciaDuplicada>();
	for (const fila of candidatas) {
		const coincidePor = coincidenciaReferencia(referencia, {
			dpi: fila.referencia_dpi,
			telefono: fila.referencia_telefono,
		});
		if (!coincidePor) continue;

		const coincidencia: ReferenciaDuplicada = {
			tipo: fila.tipo,
			leadId: fila.lead_id,
			clienteNombre: fila.cliente_nombre,
			oportunidadId: fila.oportunidad_id,
			referenciaNombre: fila.referencia_nombre?.trim() || null,
			parentesco: fila.parentesco,
			dadaPor: { nombre: fila.dada_por_nombre, rol: fila.dada_por_rol },
			coincidePor,
		};
		// Sin lead, el cliente es la oportunidad.
		const cliente = fila.lead_id ?? `oportunidad:${fila.oportunidad_id}`;
		const previa = porCliente.get(cliente);
		if (!previa) porCliente.set(cliente, coincidencia);
		else if (previa.coincidePor === "telefono" && coincidePor === "dpi") {
			Object.assign(previa, coincidencia);
		}
	}
	const todas = [...porCliente.values()];
	return {
		total: todas.length,
		coincidencias: todas.slice(0, MAX_COINCIDENCIAS),
	};
}
