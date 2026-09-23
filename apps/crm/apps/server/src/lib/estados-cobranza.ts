/**
 * Qué créditos tiene sentido gestionar en la lista de cobranza.
 *
 * La regla es una sola: si al crédito no se le devenga mora, no hay nada que
 * cobrar ahí, así que no aparece en la lista. Los estados que no devengan mora
 * son EXACTAMENTE los que el job nocturno `procesarMoras` excluye
 * (`STATUS_EXCLUIDOS_MORA`, en apps/cartera-back/src/controllers/latefee.ts).
 *
 * La lista se copia en vez de importarse porque el server del CRM no compila
 * nada fuera de su propio `src/` (tsconfig `include: ["src/**"]`, emit a
 * `dist/src/...`, arranque en `dist/src/index.js`): un import cruzado a
 * cartera-back movería la raíz del emit y rompería el arranque. Contra la
 * copia hay una prueba (`estados-cobranza.test.ts`) que lee el archivo de
 * cartera-back y se pone roja si las dos listas se separan.
 */
export const STATUS_SIN_MORA = [
	"EN_CONVENIO",
	"INCOBRABLE",
	"CANCELADO",
	"PENDIENTE_CANCELACION",
	"CAIDO",
] as const;

/** Todos los valores posibles de la columna `creditos."statusCredit"`. */
const STATUS_CREDITO = [
	"ACTIVO",
	"MOROSO",
	"EN_CONVENIO",
	"CANCELADO",
	"INCOBRABLE",
	"PENDIENTE_CANCELACION",
	"CAIDO",
] as const;

/**
 * Un estado desconocido —o ausente— SÍ devenga mora, igual que en cartera-back
 * (`STATUS_EXCLUIDOS_MORA.includes(statusCredit ?? "")`). Esconder de la lista
 * una fila cuyo estado no reconocemos sería dejar de cobrar en silencio;
 * mostrarla de más cuesta una fila.
 */
export function devengaMora(statusCredit?: string | null): boolean {
	return !(STATUS_SIN_MORA as readonly string[]).includes(statusCredit ?? "");
}

/**
 * Los estados que sí se gestionan en cobranza. Se DERIVA de la lista de
 * exclusión: si mañana un estado deja de devengar mora, desaparece solo de la
 * cobranza sin que nadie tenga que acordarse de este archivo.
 */
export const STATUS_CREDITO_COBRABLES: string[] =
	STATUS_CREDITO.filter(devengaMora);

/** Etapa del embudo/filtro del CRM → estado de crédito que pide a cartera-back. */
const STATUS_POR_ETAPA: Record<string, string> = {
	en_convenio: "EN_CONVENIO",
	incobrable: "INCOBRABLE",
	completado: "CANCELADO",
	pendiente_cancelacion: "PENDIENTE_CANCELACION",
};

/**
 * ¿La etapa seleccionada en el filtro todavía puede mostrar algo? Las etapas
 * que apuntan a un estado sin mora quedaron vacías por decisión de producto;
 * el front ya no las ofrece, pero el filtro se persiste en el navegador y un
 * usuario puede llegar con una guardada de antes.
 */
export function etapaCobrable(estadoMora?: string | null): boolean {
	const status = STATUS_POR_ETAPA[estadoMora ?? ""];
	return status === undefined || devengaMora(status);
}
