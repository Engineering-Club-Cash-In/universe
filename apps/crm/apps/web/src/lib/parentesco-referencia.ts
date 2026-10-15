import type { PARENTESCO_VALUES } from "../../../server/src/db/schema/crm";

type Parentesco = (typeof PARENTESCO_VALUES)[number];

/**
 * Etiquetas legibles del enum `parentesco_referencia` (referencias de cobros),
 * atadas al enum del servidor: si el enum cambia y este mapa no, el typecheck
 * falla. Las relaciones de la solicitud son texto libre y se muestran tal cual.
 */
const ETIQUETAS = {
	padre_madre: "Padre/Madre",
	hermano_a: "Hermano/a",
	hijo_a: "Hijo/a",
	conyuge: "Cónyuge",
	tio_a: "Tío/a",
	primo_a: "Primo/a",
	amigo_a: "Amigo/a",
	vecino_a: "Vecino/a",
	companero_trabajo: "Compañero de trabajo",
	otro: "Otro",
} satisfies Record<Parentesco, string>;

/** Indexable por cualquier texto: la relación de la solicitud es libre y no tiene etiqueta. */
export const PARENTESCO_LABELS: Record<string, string> = ETIQUETAS;
