/**
 * Modo de prueba para envíos (SMS / Email / WhatsApp).
 *
 * Si la env `TEST_MESSAGE=true`, todos los envíos redirigen a la lista
 * de contactos quemados en lugar de los destinatarios reales. Sirve para
 * probar plantillas en la base de datos de producción sin molestar a
 * los clientes.
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
