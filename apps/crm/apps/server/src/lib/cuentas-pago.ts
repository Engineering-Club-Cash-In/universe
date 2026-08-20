/**
 * Las cuentas de Cash In donde el cliente deposita.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESTE ARCHIVO ES LA ÚNICA FUENTE DE LOS NÚMEROS DE CUENTA.
 *
 * Se leen desde dos lados que no se parecen en nada:
 *   · los recordatorios de cobros (`cobros-plantillas.ts`), que arman una sola
 *     línea larga porque las plantillas de SimpleTech no dan para más;
 *   · el bot de WhatsApp, que muestra una lista con negritas y saltos.
 *
 * Antes el texto estaba escrito a mano en los dos lugares. Si mañana cambia una
 * cuenta y solo se corrige uno, la mitad de los clientes deposita en una cuenta
 * que ya no existe. Por eso los datos viven acá y cada canal arma su formato.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Contrato del bot: docs/features/bot-whatsapp-cobros/02-menu-del-credito.md
 * Decisión: docs/features/bot-whatsapp-cobros/DECISIONES.md (D-37)
 */

export type CuentaPago = {
	/** Como se le muestra al cliente en el bot. */
	banco: string;
	/**
	 * El id del catálogo `cartera.bancos`, tomado de las filas que tienen
	 * `id_banco_transferencia` — las únicas sin duplicados. Sirve para cruzar
	 * la cuenta destino que se lee de una boleta.
	 */
	bancoId: number;
	numero: string;
	titular: string;
	tipo: "monetaria";
	/**
	 * Cómo se nombra el banco en la línea de las plantillas de cobros.
	 *
	 * Va aparte de `banco` porque ese texto ya salió a producción miles de veces
	 * y no se toca por gusto: `BANCO GyT CONTINENTAL` no se escribe igual que el
	 * `Banco G&T Continental` que lee el cliente en el chat.
	 */
	etiquetaPlantilla: string;
};

export const CUENTAS_PAGO: readonly CuentaPago[] = [
	{
		banco: "Banco Industrial",
		bancoId: 1,
		numero: "5520029876",
		titular: "CUBE INVESTMENTS, S.A.",
		tipo: "monetaria",
		etiquetaPlantilla: "BANCO INDUSTRIAL (BI)",
	},
	{
		banco: "Banco Agromercantil (BAM)",
		bancoId: 16,
		numero: "3020123033",
		titular: "CUBE INVESTMENTS, S.A.",
		tipo: "monetaria",
		etiquetaPlantilla: "BANCO AGROMERCANTIL (BAM)",
	},
	{
		banco: "Banco G&T Continental",
		bancoId: 19,
		numero: "01300039945",
		titular: "CUBE INVESTMENTS, S.A.",
		tipo: "monetaria",
		etiquetaPlantilla: "BANCO GyT CONTINENTAL",
	},
	{
		banco: "Banrural",
		bancoId: 2,
		numero: "3394002346",
		titular: "CUBE INVESTMENTS, S.A.",
		tipo: "monetaria",
		etiquetaPlantilla: "BANRURAL",
	},
] as const;

/**
 * La línea de siempre para las plantillas de cobros.
 *
 * Reproduce **carácter por carácter** el texto que ya se venía mandando; hay una
 * prueba que lo fija. Si esta función cambia una coma, esa prueba falla — y está
 * bien que falle, porque son mensajes que ya salieron a producción.
 */
export function textoCuentasPlantilla(): string {
	const cuentas = CUENTAS_PAGO.map(
		(c) => `${c.titular} (${c.tipo}) No. ${c.numero} ${c.etiquetaPlantilla}`,
	).join(" / ");

	return `A continuación, le compartimos los números de cuenta para realizar su depósito o transferencia: - ${cuentas}`;
}

/**
 * Lo mismo, pero para leerse en un chat.
 *
 * Negrita de WhatsApp = **un** asterisco (con dos se ven los asteriscos).
 */
export function textoCuentasWhatsapp(): string {
	const lineas = CUENTAS_PAGO.map((c) => `• *${c.banco}* — ${c.numero}`);

	return [
		"🏦 *Cuentas para tu pago*",
		"",
		`Todas a nombre de *${CUENTAS_PAGO[0].titular}* (monetarias):`,
		"",
		...lineas,
	].join("\n");
}

/** Deja solo dígitos: se van espacios, guiones y puntos. */
export function normalizarCuenta(numero: string): string {
	return numero.replace(/\D/g, "");
}

/**
 * Mínimo de dígitos para arriesgar una comparación.
 *
 * Con menos no se compara: cuatro dígitos coinciden por casualidad más seguido
 * de lo que uno cree, y un falso positivo acá le dice a conta que el dinero
 * entró en una cuenta que no fue.
 */
const MINIMO_DIGITOS = 6;

export type ResultadoCuenta =
	| { estado: "reconocida"; cuenta: CuentaPago }
	| { estado: "ilegible" }
	| { estado: "no_reconocida" };

/**
 * ¿La cuenta que se leyó de la boleta es una de las nuestras?
 *
 * La comparación es **por sufijo**, no literal, y eso resuelve dos casos reales:
 * el cero inicial de la cuenta de G&T (`01300039945`), que los modelos se comen
 * a menudo, y las boletas que imprimen la cuenta recortada.
 *
 * `ilegible` NO es `no_reconocida`: la primera significa que no se pudo
 * verificar y no dispara nada; la segunda avisa a conta. Confundirlas llenaría
 * de alertas falsas al asesor, que es la forma más rápida de que deje de
 * mirarlas.
 */
export function reconocerCuenta(
	leida: string | null | undefined,
): ResultadoCuenta {
	const digitos = normalizarCuenta(leida ?? "");

	if (digitos.length < MINIMO_DIGITOS) return { estado: "ilegible" };

	for (const cuenta of CUENTAS_PAGO) {
		const nuestra = normalizarCuenta(cuenta.numero);
		const [larga, corta] =
			nuestra.length >= digitos.length
				? [nuestra, digitos]
				: [digitos, nuestra];

		if (corta.length >= MINIMO_DIGITOS && larga.endsWith(corta)) {
			return { estado: "reconocida", cuenta };
		}
	}

	return { estado: "no_reconocida" };
}

/** Lo que viaja al bot dentro de la info del crédito. */
export function cuentasParaBot() {
	return {
		texto: textoCuentasWhatsapp(),
		cuentas: CUENTAS_PAGO.map(({ banco, bancoId, numero, titular, tipo }) => ({
			banco,
			bancoId,
			numero,
			titular,
			tipo,
		})),
	};
}

export type CuentasPagoBot = ReturnType<typeof cuentasParaBot>;
