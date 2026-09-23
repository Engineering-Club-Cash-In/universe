/**
 * Por qué se anula un contrato al reemplazarlo.
 *
 * Es una lista fija y no texto libre para que después se pueda contar cuántas
 * veces pasó cada cosa. "Identificación inválida" no es un caso hipotético:
 * WeeTrust aceptó una foto que no era un DPI y dejó firmar igual.
 */
export const MOTIVOS_DE_ANULACION = {
	identificacion_invalida: "Identificación inválida",
	datos_incorrectos: "Datos incorrectos en el contrato",
	documento_equivocado: "Se subió el documento equivocado",
	otro: "Otro",
} as const;

export type MotivoDeAnulacion = keyof typeof MOTIVOS_DE_ANULACION;

export const MOTIVOS_DE_ANULACION_KEYS = Object.keys(MOTIVOS_DE_ANULACION) as [
	MotivoDeAnulacion,
	...MotivoDeAnulacion[],
];

export function etiquetaDeMotivo(motivo: string): string {
	return MOTIVOS_DE_ANULACION[motivo as MotivoDeAnulacion] ?? motivo;
}

/**
 * Etapas en las que todavía se puede reemplazar o regenerar un contrato.
 *
 * 80% es jurídico armando los contratos y 85% es "Contratos en Firma". Del 90%
 * en adelante la oportunidad ya pasó a análisis con esos documentos: cambiarlos
 * ahí sería mover el piso de una decisión ya tomada.
 */
export const ETAPAS_QUE_PERMITEN_REEMPLAZO = [80, 85];

/**
 * Qué etapas permiten cada acción sobre un contrato ya emitido.
 *
 * - **reemplazar** (subir otro documento) es de jurídico, y sólo mientras la
 *   oportunidad está en 80%. En 85% ya salió de su operación y pasó a análisis;
 *   si hace falta que jurídico intervenga, primero hay que devolverla al 80%.
 * - **regenerar** (mismo documento, enlaces nuevos) lo hace análisis, que es
 *   quien lleva la oportunidad en 85%. Se permite también en 80% para que
 *   jurídico pueda hacerlo durante su etapa.
 */
export const ETAPAS_POR_ACCION = {
	reemplazar: [80],
	regenerar: [80, 85],
} as const;

export type AccionSobreContrato = keyof typeof ETAPAS_POR_ACCION;
