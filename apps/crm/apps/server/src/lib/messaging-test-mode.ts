/**
 * Modo de prueba para envíos (SMS / Email / WhatsApp).
 *
 * Si la env `TEST_MESSAGE=true`, todos los envíos redirigen a la lista
 * de contactos quemados en lugar de los destinatarios reales. Sirve para
 * probar plantillas en la base de datos de producción sin molestar a
 * los clientes.
 *
 * En WhatsApp la redirección es AUTOMÁTICA y no se puede olvidar: vive dentro
 * de `lib/simpletech.ts`, la única puerta por la que sale un mensaje (ver
 * `redirigirSiEsPrueba`). En SMS y email sigue siendo responsabilidad del
 * emisor llamar a `getTestPhone()`/`TEST_EMAIL`.
 *
 * El log `cobros_send_logs` guarda el destinatario REAL que hubiera recibido
 * el mensaje (en `provider_response.realTarget`) junto con el que efectivamente
 * se usó. Así la fila refleja el envío real pero queda trazabilidad de la
 * intención original.
 */

export const TEST_EMAIL = "mdaniel.r543@gmail.com";

/**
 * Números quemados para test (8 dígitos Guatemala, sin prefijo). El prefijo
 * 502 se agrega en `normalizePhone` al enviar.
 */
export const TEST_PHONES = [
	"58446376",
	"57099747",
	"35219722",
	"30047424",
	"30440828",
	"47705027",
	"54673367",
	"59226561",
];

export function isTestModeEnabled(): boolean {
	const v = process.env.TEST_MESSAGE;
	return v === "true" || v === "1";
}

/**
 * Devuelve un teléfono de prueba a usar cuando TEST_MESSAGE=true.
 * Si se pasa un índice, rota por la lista (útil para masivos).
 */
export function getTestPhone(index = 0): string {
	return TEST_PHONES[index % TEST_PHONES.length];
}

/**
 * ¿Este número ya es uno de los de prueba?
 *
 * Existe para que la red de seguridad de abajo sea IDEMPOTENTE: los emisores
 * que ya hacen su propia redirección (OTP, links, recibo, premora, convenio…)
 * llegan con un `TEST_PHONES[i]` puesto a mano, y volver a redirigirlos
 * colapsaría la rotación de los masivos a un solo número — que es justo lo que
 * `getTestPhone(index)` evita para no mandarle 200 mensajes al mismo teléfono.
 *
 * Recibe el número ya normalizado (`+502XXXXXXXX`, ver `normalizePhone`).
 */
export function esTelefonoDePrueba(phoneNormalized: string): boolean {
	return TEST_PHONES.some((p) => phoneNormalized === `+502${p}`);
}

export type RedireccionDePrueba = {
	/** A dónde se manda de verdad. */
	destino: string;
	/** Quién lo hubiera recibido en producción (para trazabilidad). */
	realTarget: string;
	redirigido: boolean;
};

/**
 * LA RED DE SEGURIDAD DEL MODO PRUEBA.
 *
 * Se aplica DENTRO de `sendWhatsappTemplate`/`sendWhatsappTemplateBatch`, o
 * sea en la única puerta por la que sale un WhatsApp. Hasta 2026-09-01 el
 * modo prueba era una convención por emisor —cada servicio se acordaba de
 * llamar a `getTestPhone()`— y con doce emisores eso ya se había escapado
 * una vez: `lib/bot-cobros/eventos-pago.ts` (aviso de rechazo al cliente y
 * alerta al asesor) no la respetaba, y lo dispara un job que corre solo cada
 * 3 h contra una copia de producción con teléfonos reales.
 *
 * La regla ahora es que un emisor nuevo NO tiene que acordarse de nada:
 * nace protegido. Los que ya redirigían siguen funcionando igual (ver
 * `esTelefonoDePrueba`).
 */
export function redirigirSiEsPrueba(
	phoneNormalized: string,
	index = 0,
): RedireccionDePrueba {
	if (!isTestModeEnabled() || esTelefonoDePrueba(phoneNormalized)) {
		return {
			destino: phoneNormalized,
			realTarget: phoneNormalized,
			redirigido: false,
		};
	}
	return {
		destino: `+502${getTestPhone(index)}`,
		realTarget: phoneNormalized,
		redirigido: true,
	};
}

/** `+50212345678` → `****5678`. Para logs: el número completo es PII. */
export function enmascarar(phone: string): string {
	return `****${phone.slice(-4)}`;
}
