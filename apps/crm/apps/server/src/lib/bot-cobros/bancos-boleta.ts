/**
 * De "lo que dice la boleta" al `banco_id` de cartera.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO NO ES UN `LIKE` CONTRA LA TABLA DE BANCOS
 *
 * `cartera.bancos` tiene 24 filas para unos 15 bancos reales: `Banrural` está
 * también como `Banco de Desarrollo Rural` (1,236 y 566 pagos), `BAM` está tres
 * veces, y hay un `test` con 92 pagos encima. Un match por parecido de texto
 * caería en cualquiera de las copias.
 *
 * La deduplicación ya existe y es la columna `id_banco_transferencia`: las 15
 * filas que la tienen son una por banco. Esos son los ids canónicos de abajo.
 *
 * Adivinar el banco es adivinar en qué cuenta va a buscar conta el dinero, así
 * que si el nombre leído no cae en ningún alias **no se inventa**: se devuelve
 * `null` y el cliente elige de una lista.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato: docs/features/bot-whatsapp-cobros/04-validacion-de-boleta.md (§8)
 */

export type BancoBoleta = {
	id: number;
	/** Como se le muestra al cliente. */
	nombre: string;
	/**
	 * Todo lo que puede venir impreso en una boleta de ese banco, normalizado.
	 *
	 * Ojo con Banrural: **la misma hoja trae los dos nombres** — `BANRURAL` en el
	 * logo y `Banco de Desarrollo Rural, S.A.` en la letra chica del pie. Los dos
	 * tienen que caer en el mismo id.
	 */
	alias: readonly string[];
};

/**
 * Los 15 bancos con `id_banco_transferencia` en `cartera.bancos`, al 2026-08-20.
 *
 * Es una foto, no una consulta: son 15 filas que cambian una vez al año y
 * consultarlas metería una llamada de red en cada lectura de boleta. Si cartera
 * agrega un banco, se agrega acá.
 */
export const BANCOS_BOLETA: readonly BancoBoleta[] = [
	{
		id: 1,
		nombre: "Banco Industrial",
		alias: ["banco industrial", "industrial", "bi", "banco industrial sa"],
	},
	{
		id: 2,
		nombre: "Banrural",
		alias: [
			"banrural",
			"banco de desarrollo rural",
			"banco de desarrollo rural sa",
			"desarrollo rural",
		],
	},
	{
		id: 16,
		nombre: "Banco Agromercantil (BAM)",
		alias: ["bam", "banco agromercantil", "agromercantil"],
	},
	{
		id: 19,
		nombre: "Banco G&T Continental",
		alias: [
			"gyt",
			"g y t",
			"gt continental",
			"banco gyt continental",
			"banco g y t continental",
			"g t continental",
			"continental",
		],
	},
	{
		id: 10,
		nombre: "BAC Credomatic",
		alias: ["bac", "bac credomatic", "credomatic", "banco de america central"],
	},
	{
		id: 9,
		nombre: "Banco Promerica",
		alias: ["promerica", "banco promerica"],
	},
	{ id: 6, nombre: "Bantrab", alias: ["bantrab", "banco de los trabajadores"] },
	{
		id: 8,
		nombre: "Banco Internacional",
		alias: ["banco internacional", "internacional", "bi internacional"],
	},
	{ id: 13, nombre: "Banco Azteca", alias: ["azteca", "banco azteca"] },
	{
		id: 25,
		nombre: "Banco Inmobiliario",
		alias: ["inmobiliario", "banco inmobiliario"],
	},
	{ id: 11, nombre: "Citibank", alias: ["citibank", "citi"] },
	{ id: 12, nombre: "Ficohsa", alias: ["ficohsa", "banco ficohsa"] },
	{ id: 7, nombre: "Vivibanco", alias: ["vivibanco", "vivi banco"] },
	{ id: 30, nombre: "CHN", alias: ["chn", "credito hipotecario nacional"] },
	{ id: 26, nombre: "Nexa", alias: ["nexa", "nexa banco"] },
] as const;

/**
 * Bancos reales que **no** tienen id universal todavía.
 *
 * Se buscan solo si el nombre no cayó en la lista de arriba. `test` y `test2`
 * quedan fuera a propósito, aunque tengan pagos encima.
 */
const BANCOS_SIN_ID_UNIVERSAL: readonly BancoBoleta[] = [
	{ id: 27, nombre: "Interbanco", alias: ["interbanco", "inter banco"] },
	{ id: 28, nombre: "PAGALO", alias: ["pagalo", "pagalo gt"] },
] as const;

/**
 * Quita tildes, puntuación y sobras societarias.
 *
 * `Banco de Desarrollo Rural, S.A.` y `BANCO DE DESARROLLO RURAL SA` tienen que
 * dar lo mismo, o los alias habría que escribirlos en todas sus variantes.
 */
export function normalizarNombreBanco(nombre: string): string {
	return nombre
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[.,;:()"']/g, " ")
		.replace(/\b(s\s?a|sociedad anonima|sa de cv)\b/g, " ")
		.replace(/&/g, "y")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Busca el banco por alias exacto o por alias contenido en lo leído.
 *
 * No hay fuzzy ni distancia de edición: un `banco industrial` y un
 * `banco internacional` se parecen demasiado como para dejarlo a criterio de
 * un porcentaje.
 */
export function reconocerBanco(
	leido: string | null | undefined,
): BancoBoleta | null {
	const texto = normalizarNombreBanco(leido ?? "");
	if (!texto) return null;

	for (const lista of [BANCOS_BOLETA, BANCOS_SIN_ID_UNIVERSAL]) {
		// Primero exactos: si el modelo devolvió "banrural" limpio, no hay por qué
		// arriesgarse a que "bi" aparezca dentro de otra palabra.
		const exacto = lista.find((banco) => banco.alias.includes(texto));
		if (exacto) return exacto;
	}

	for (const lista of [BANCOS_BOLETA, BANCOS_SIN_ID_UNIVERSAL]) {
		const contenido = lista.find((banco) =>
			banco.alias.some((alias) => {
				// Los alias de 2-3 letras (bi, bac, chn) solo valen como palabra
				// suelta: "bi" está dentro de "combi" y de "banco bi-lateral".
				if (alias.length <= 3) {
					return new RegExp(`\\b${alias}\\b`).test(texto);
				}
				return texto.includes(alias);
			}),
		);
		if (contenido) return contenido;
	}

	return null;
}

/** La lista que se le ofrece al cliente cuando no se reconoció el banco. */
export function bancosSugeridos() {
	return BANCOS_BOLETA.map(({ id, nombre }) => ({ id, nombre }));
}

/** ¿Ese `bancoId` es uno que aceptamos? (para `/boleta/confirmar`). */
export function bancoValido(id: number): boolean {
	return [...BANCOS_BOLETA, ...BANCOS_SIN_ID_UNIVERSAL].some(
		(b) => b.id === id,
	);
}
