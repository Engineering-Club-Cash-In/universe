/**
 * Correos de prueba para los firmantes de contratos.
 *
 * Con `TEST_MESSAGE=true` los contratos se siguen generando con los datos
 * reales del cliente (nombre, DPI, vehículo), pero los enlaces de firma se
 * emiten contra estos correos y no contra los suyos. Hace falta porque WeeTrust
 * apunta a producción: sin esto, probar el flujo le manda un contrato a firmar a
 * alguien de verdad.
 *
 * Vive acá y no en `contract-signature-mode.ts` porque ese módulo lo importa
 * también el navegador, donde `process` no existe.
 *
 * Lo usan DOS lugares y tienen que coincidir: el que arma los firmantes al
 * generar, y el que arma los destinatarios del WhatsApp. Si cada uno hiciera su
 * propia cuenta, los enlaces quedarían guardados con un correo y se buscarían
 * con otro, y nadie recibiría su link. Pasó.
 */
const CONTRATOS_TEST_EMAIL_TITULAR =
	process.env.CONTRATOS_TEST_EMAIL_TITULAR?.trim() || "";

const CONTRATOS_TEST_EMAIL_COFIRMANTES = (
	process.env.CONTRATOS_TEST_EMAIL_COFIRMANTES || ""
)
	.split(",")
	.map((email) => email.trim())
	.filter(Boolean);

export function hayCorreosDePrueba(): boolean {
	return Boolean(
		CONTRATOS_TEST_EMAIL_TITULAR || CONTRATOS_TEST_EMAIL_COFIRMANTES.length,
	);
}

/**
 * Cambia los correos por los de prueba, respetando el rol.
 *
 * El representante legal no se toca: su correo ya sale de una env
 * (`CONTRATOS_REP_LEGAL_EMAIL`), así que es el mismo de los dos lados.
 *
 * Los codeudores se reparten en orden por la lista y rotan si hay más
 * codeudores que correos: es preferible a dejar a uno con su correo real.
 */
export function aplicarCorreosDePrueba<
	T extends { role: string; email: string | null },
>(personas: T[]): T[] {
	if (!hayCorreosDePrueba()) return personas;

	let nCofirmante = 0;

	return personas.map((p) => {
		if (p.role === "TITULAR" && CONTRATOS_TEST_EMAIL_TITULAR) {
			return { ...p, email: CONTRATOS_TEST_EMAIL_TITULAR };
		}
		if (p.role === "COFIRMANTE" && CONTRATOS_TEST_EMAIL_COFIRMANTES.length) {
			const email =
				CONTRATOS_TEST_EMAIL_COFIRMANTES[
					nCofirmante % CONTRATOS_TEST_EMAIL_COFIRMANTES.length
				];
			nCofirmante += 1;
			return { ...p, email };
		}
		return p;
	});
}
