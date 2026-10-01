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
 * Qué variables faltan para cubrir a TODOS los firmantes externos.
 *
 * Con una sola configurada, el rol de la otra se quedaba con su correo real y
 * le llegaba una invitación de WeeTrust de producción. Quien arma los firmantes
 * usa esto para cortar antes de mandar nada.
 */
export function correosDePruebaFaltantes(
	personas: { role: string }[],
): string[] {
	const faltan: string[] = [];
	if (
		personas.some((p) => p.role === "TITULAR") &&
		!CONTRATOS_TEST_EMAIL_TITULAR
	) {
		faltan.push("CONTRATOS_TEST_EMAIL_TITULAR");
	}
	// Un correo DISTINTO por codeudor. Si se repitieran, WeeTrust junta a
	// quienes comparten correo en un solo firmante y el resto se pierde.
	const cofirmantes = personas.filter((p) => p.role === "COFIRMANTE").length;
	const distintos = new Set(
		CONTRATOS_TEST_EMAIL_COFIRMANTES.map((c) => c.toLowerCase()),
	);
	if (cofirmantes > 0 && distintos.size < cofirmantes) {
		faltan.push(
			CONTRATOS_TEST_EMAIL_COFIRMANTES.length === 0
				? "CONTRATOS_TEST_EMAIL_COFIRMANTES"
				: `CONTRATOS_TEST_EMAIL_COFIRMANTES (hacen falta ${cofirmantes} correos distintos, hay ${distintos.size})`,
		);
	}
	return faltan;
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

/**
 * El primer correo que se repite entre firmantes, o null.
 *
 * Se mira la lista completa ya resuelta (titular, codeudores y rep legal): el
 * correo de prueba del titular puede coincidir con uno de los codeudores o con
 * el del rep legal, y WeeTrust junta a quienes comparten correo en un solo
 * firmante.
 */
export function correoRepetido(
	personas: { email: string | null }[],
): string | null {
	const vistos = new Set<string>();
	for (const p of personas) {
		if (!p.email) continue;
		const clave = p.email.trim().toLowerCase();
		if (vistos.has(clave)) return p.email;
		vistos.add(clave);
	}
	return null;
}
