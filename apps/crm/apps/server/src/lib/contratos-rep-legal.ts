/**
 * El representante legal que firma los contratos por la entidad.
 *
 * El nombre y el cargo vienen impresos en el template (la garantía mobiliaria
 * trae a LUCRECIA MARISOL CUX TECÚN por CUBE INVESTMENTS); lo que hace falta
 * configurar es cómo contactarlo: el correo para que WeeTrust le mande su link
 * y el teléfono para mandárselo también por WhatsApp, como a los demás
 * firmantes.
 *
 * Va por entorno para poder cambiarlo sin desplegar. Cuando cada entidad tenga
 * su propio firmante esto pasa a ser un mapa por entidad.
 *
 * Sólo servidor: lee `process.env`, así que no puede importarse desde el
 * navegador.
 */
export const REP_LEGAL_EMAIL =
	process.env.CONTRATOS_REP_LEGAL_EMAIL || "juridico2@sepresta.com";

export const REP_LEGAL_NOMBRE =
	process.env.CONTRATOS_REP_LEGAL_NOMBRE || "Representante Legal";

/**
 * Teléfono de WhatsApp del representante legal.
 *
 * Se guarda tal como lo escriban (`+502 4216 6999` sirve): `normalizePhone` le
 * quita el formato y respeta el código de país. Si queda vacío simplemente no
 * se le manda WhatsApp; su link igual le llega por correo desde WeeTrust.
 */
export const REP_LEGAL_TELEFONO =
	process.env.CONTRATOS_REP_LEGAL_TELEFONO?.trim() || "";

/**
 * Observadores del flujo de firma: ven el documento y su avance, no firman.
 * Lista separada por comas.
 *
 * Los necesitan tanto la generación como la reemisión, así que viven acá y no
 * dentro de un router. Sólo servidor: leen `process.env`.
 */
const observadoresConfigurados = (process.env.CONTRATOS_OBSERVADORES || "")
	.split(",")
	.map((email) => email.trim())
	.filter(Boolean);

/**
 * `undefined` si no se configuró ninguno, no `[]`: el generador tiene su propia
 * lista por defecto (`WEETRUST_OBSERVERS`) y un arreglo vacío la anulaba, así
 * que quienes ya recibían copia dejaban de recibirla.
 */
export const CONTRATOS_OBSERVADORES: string[] | undefined =
	observadoresConfigurados.length > 0 ? observadoresConfigurados : undefined;
