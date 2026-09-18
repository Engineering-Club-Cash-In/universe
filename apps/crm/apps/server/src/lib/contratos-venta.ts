/**
 * Los contratos de venta cuyo layout de firmas está auditado.
 *
 * Son los únicos que se pueden subir a mano: el generador ubica las líneas de
 * firma por el layout declarado para cada tipo, y sólo estos lo tienen (salieron
 * de inspeccionar los PDF renderizados, no del DOCX). Un tipo que no esté acá no
 * se puede repartir por rol, y colocar las firmas a ojo produce un contrato
 * firmado en el lugar equivocado.
 *
 * La fuente de verdad es `signaturePatterns.ts` del generador: son los tipos con
 * `bloques` declarados. Inversiones, sociedad y cartas poder no están y siguen
 * por el camino viejo.
 */
export const CONTRATOS_VENTA_MAPEADOS = [
	"carta_aceptacion_instalacion_gps",
	"carta_carro_nuevo",
	"carta_emision_cheques",
	"carta_traspaso_vehiculo_rdbe",
	"cobertura_inrexsa",
	"cobertura_inrexsa_comercial",
	"contrato_privado_uso_carro_nuevo",
	"contrato_privado_uso_carro_usado",
	"declaracion_vendedor",
	"descargo_responsabilidades",
	"garantia_mobiliaria",
	"pagare_unico_libre_protesto",
	"reconocimiento_deuda_feb_2025",
	"solicitud_compra_vehiculo_tercero",
] as const;

export type ContratoVentaMapeado = (typeof CONTRATOS_VENTA_MAPEADOS)[number];

export function esContratoVentaMapeado(contractType: string): boolean {
	return (CONTRATOS_VENTA_MAPEADOS as readonly string[]).includes(contractType);
}
