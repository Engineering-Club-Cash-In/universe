/**
 * Qué verificación de identidad le pide WeeTrust al inversionista al firmar.
 *
 * Depende de la compra, no del contrato:
 *
 * - **Primera compra** (no tenía nada aportado en cartera antes de ésta): selfie
 *   con prueba de vida y DPI, en todos sus contratos. Es cuando se le conoce:
 *   entrega dinero y la relación se arma por correo, sin nadie enfrente.
 * - **Compras siguientes** (ya tenía monto aportado): sólo la firma. Su
 *   identidad ya se verificó en la primera.
 *
 * ## Dónde se cambia
 *
 * En las dos constantes de abajo, y en ningún otro lado. Para que en las
 * compras siguientes se pida sólo el DPI, sin selfie:
 * `IDENTIFICACION_COMPRA_SIGUIENTE = "id"`. El generador manda lo que diga esto
 * (`identificacionDe` en `legal-docs-blueprints/services/WeeTrustService.ts`), y
 * sólo en los contratos de inversiones: ventas no pasa por acá.
 *
 * El monto "de antes" lo calcula cartera al aceptar la compra
 * (`montoAportadoAntesDeLaCompra` en `cartera-back/.../compraCarteraAceptada.ts`)
 * y queda en la batería (`investor_contract_batches.monto_aportado_previo`).
 *
 * Cada contrato guarda en `apiResponse` con qué se emitió: al renovarle los
 * enlaces se pide lo mismo, aunque la batería ya la haya reusado otra compra.
 *
 * OJO: lo lee también el navegador, así que no puede tocar `process.env`.
 */

/**
 * Lo que se le puede pedir. Son los valores de `identification` de WeeTrust,
 * más `none` para no pedir nada.
 */
export type IdentificacionDelInversionista = "face" | "id" | "none";

/** Selfie con prueba de vida y DPI. */
export const IDENTIFICACION_PRIMERA_COMPRA: IdentificacionDelInversionista =
	"face";

/**
 * Sólo la firma. Con `"id"` se le pediría sólo el DPI; con `"face"`, lo mismo
 * que en la primera.
 */
export const IDENTIFICACION_COMPRA_SIGUIENTE: IdentificacionDelInversionista =
	"none";

/** Cómo se lee en pantalla. */
export const ETIQUETA_IDENTIFICACION: Record<
	IdentificacionDelInversionista,
	string
> = {
	face: "Selfie y DPI",
	id: "Sólo DPI",
	none: "Sólo firma",
};

/**
 * Si la compra es la primera del inversionista: no tenía nada aportado antes.
 *
 * Sin el dato (baterías de antes de guardarlo, o un aviso de un cartera viejo)
 * se trata como primera: ante la duda se pide lo de siempre, no menos.
 */
export function esPrimeraCompra(
	montoAportadoPrevio: string | number | null | undefined,
): boolean {
	if (montoAportadoPrevio === null || montoAportadoPrevio === undefined) {
		return true;
	}
	const monto = Number(montoAportadoPrevio);
	if (!Number.isFinite(monto)) return true;
	// En centavos: un residuo de redondeo del espejo no hace a nadie inversionista.
	return Math.round(monto * 100) <= 0;
}

/** Qué se le pide al inversionista en los contratos de esta compra. */
export function identificacionParaLaCompra(
	montoAportadoPrevio: string | number | null | undefined,
): IdentificacionDelInversionista {
	return esPrimeraCompra(montoAportadoPrevio)
		? IDENTIFICACION_PRIMERA_COMPRA
		: IDENTIFICACION_COMPRA_SIGUIENTE;
}

export function conMarcaDeIdentificacion<T extends object>(
	apiResponse: T,
	identificacion: IdentificacionDelInversionista,
): T & { identificacionDelInversionista: IdentificacionDelInversionista } {
	return { ...apiResponse, identificacionDelInversionista: identificacion };
}

/**
 * Con qué se emitió un contrato, o null si es de antes de guardarlo (se emitió
 * con selfie, que era lo único que había).
 */
export function identificacionDelContrato(
	apiResponse: unknown,
): IdentificacionDelInversionista | null {
	if (typeof apiResponse !== "object" || apiResponse === null) return null;
	const marca = (apiResponse as { identificacionDelInversionista?: unknown })
		.identificacionDelInversionista;
	return marca === "face" || marca === "id" || marca === "none" ? marca : null;
}
