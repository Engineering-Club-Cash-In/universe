/**
 * Cuenta de servicio con la que el CRM llama a cartera-back. El CRM ya validó
 * el rol del supervisor en su propio sistema y manda el correo de quien decidió
 * en el body; por eso el rol de cartera no basta para distinguir «el CRM
 * actuando por un supervisor» de «un contador decidiendo directo».
 *
 * Mismo criterio que `paymentAgree.ts` (CB-033): solo esta cuenta puede fijar
 * el correo del actor.
 */
const CRM_SERVICE_USER_ID = process.env.CRM_SERVICE_USER_ID
	? Number.parseInt(process.env.CRM_SERVICE_USER_ID, 10)
	: null;

// Sin esta variable, las rebajas de mora que aprueba un supervisor desde el CRM
// responden 403 (solo un ADMIN pasa). Se avisa al arrancar para no descubrirlo
// con la primera aprobación.
if (CRM_SERVICE_USER_ID == null) {
	console.warn(
		"[cartera] CRM_SERVICE_USER_ID no configurado: las rebajas de mora aprobadas desde el CRM van a responder 403.",
	);
}

export function esCuentaDeServicioCRM(user: any): boolean {
	return CRM_SERVICE_USER_ID != null && user?.id === CRM_SERVICE_USER_ID;
}
