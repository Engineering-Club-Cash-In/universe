/**
 * Cómo se listan los firmantes de un contrato en la ficha.
 *
 * Antes la ficha leía tres columnas fijas del contrato: "Cliente" era el primer
 * link, "Rep. Legal" el segundo y el resto "adicionales". Ese orden no es el
 * que devuelve WeeTrust: con un cofirmante, el segundo link era del cofirmante
 * y se mostraba rotulado "Rep. Legal", mandando al cofirmante a firmar donde no
 * le tocaba. Ahora cada firmante viaja con su rol y acá sólo se le pone nombre.
 */

/**
 * Un firmante, venga de la base (`contract_signatories`) o recién devuelto por
 * el generador. Las dos formas encajan acá: el generador todavía no conoce el
 * estado de firma, así que `status` es opcional y se asume pendiente.
 */
export interface FirmanteDeContrato {
	role: string;
	name: string;
	email: string;
	signingUrl?: string | null;
	status?: "pending" | "signed" | "declined";
}

export interface LinksLegacyDeContrato {
	clientSigningLink: string | null;
	representativeSigningLink: string | null;
	additionalSigningLinks: string[] | null;
}

export interface FirmanteEnFicha {
	/** Clave estable para React. */
	clave: string;
	/** "Cliente", "Cofirmante 2", "Rep. Legal"… */
	etiqueta: string;
	/** Nombre de la persona, cuando lo conocemos. */
	nombre: string | null;
	url: string | null;
	estado: "pending" | "signed" | "declined";
}

const ETIQUETA_POR_ROL: Record<string, string> = {
	TITULAR: "Cliente",
	COFIRMANTE: "Codeudor",
	REP_LEGAL: "Rep. Legal",
	VENDEDOR: "Vendedor",
};

/**
 * Los firmantes a mostrar, con su etiqueta real.
 *
 * Si el contrato no tiene firmantes guardados (los generados antes de que se
 * guardara el rol) se cae a las columnas por posición, que es lo único que
 * quedó de ellos. Ahí la etiqueta "Rep. Legal" puede seguir mintiendo: no hay
 * forma de saberlo sin volver a preguntarle a WeeTrust.
 */
export function firmantesEnFicha(
	signatories: FirmanteDeContrato[] | undefined,
	legacy: LinksLegacyDeContrato,
): FirmanteEnFicha[] {
	if (signatories && signatories.length > 0) {
		// Los codeudores van numerados aunque sea uno solo: "Codeudor 1" deja
		// claro que puede haber más, y con dos o tres hay que poder distinguirlos.
		let nCodeudor = 0;

		return signatories.map((s, i) => {
			let etiqueta = ETIQUETA_POR_ROL[s.role] ?? s.role;
			if (s.role === "COFIRMANTE") {
				nCodeudor += 1;
				etiqueta = `Codeudor ${nCodeudor}`;
			}
			return {
				clave: `${s.role}-${s.email}-${i}`,
				etiqueta,
				nombre: s.name || null,
				url: s.signingUrl ?? null,
				estado: s.status ?? "pending",
			};
		});
	}

	// Sin roles guardados sólo sabemos el ORDEN en que WeeTrust devolvió los
	// links, y el orden no dice quién es quién: en la garantía mobiliaria y en el
	// contrato privado de uso el representante legal firma primero, así que
	// rotular el primero como "Cliente" es afirmar algo que no sabemos. Se
	// numeran y punto; para saber quién es cada uno hay que abrir el link.
	const viejos: FirmanteEnFicha[] = [];
	const urlsViejas = [
		legacy.clientSigningLink,
		legacy.representativeSigningLink,
		...(legacy.additionalSigningLinks ?? []),
	].filter((url): url is string => Boolean(url));

	for (const [i, url] of urlsViejas.entries()) {
		viejos.push({
			clave: `legacy-${i}`,
			etiqueta: `Firmante ${i + 1}`,
			nombre: null,
			url,
			estado: "pending",
		});
	}
	return viejos;
}
