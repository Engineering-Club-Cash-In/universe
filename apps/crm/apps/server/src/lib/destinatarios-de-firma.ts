/**
 * A quién se le mandan por WhatsApp los enlaces de firma de una oportunidad.
 *
 * Sólo servidor: el representante legal sale de `process.env`.
 */
import {
	REP_LEGAL_EMAIL,
	REP_LEGAL_NOMBRE,
	REP_LEGAL_TELEFONO,
} from "./contratos-rep-legal";
import {
	esOportunidadDeSociedad,
	representanteLegalDe,
} from "./oportunidad-de-sociedad";

export interface DestinatarioDeFirma {
	/** TITULAR | COFIRMANTE | REP_LEGAL. Decide qué correo de prueba le toca. */
	role: string;
	nombre: string;
	/** Con el que se emparejan los links: WeeTrust identifica por correo. */
	email: string | null;
	phone: string | null;
	leadId?: string;
	coDebtorId?: string;
	/**
	 * Con qué roles aparece en los firmantes, si no es sólo el suyo. Ver
	 * `destinatariosDeFirma`.
	 */
	rolesQueFirma?: string[];
}

/** Los roles con los que se buscan los enlaces de un destinatario. */
export function rolesDelDestinatario(d: DestinatarioDeFirma): string[] {
	return d.rolesQueFirma ?? rolesConLosQueFirma(d.role);
}

/**
 * A quién se le mandan los enlaces de una oportunidad, en el orden en que se
 * armaron los firmantes (el reparto de correos de prueba es posicional).
 *
 * Normalmente el titular es el cliente y los codeudores cofirman. En una
 * sociedad el cliente es la empresa, que no firma: firma su representante legal
 * como titular, así que es él quien recibe los enlaces, con su teléfono. Se le
 * buscan también los de cofirmante, que es como firmaba en una batería
 * individual hecha antes de marcarlo.
 */
export function destinatariosDeFirma(params: {
	lead: {
		id: string;
		nombre: string;
		email: string | null;
		phone: string | null;
		clientType: string | null;
	} | null;
	codeudores: Array<{
		id: string;
		fullName: string;
		email: string | null;
		phone: string | null;
		esRepresentanteLegal: boolean;
	}>;
}): DestinatarioDeFirma[] {
	const { lead, codeudores } = params;
	const repLegal: DestinatarioDeFirma = {
		role: "REP_LEGAL",
		nombre: REP_LEGAL_NOMBRE,
		email: REP_LEGAL_EMAIL,
		phone: REP_LEGAL_TELEFONO || null,
	};
	const comoCofirmante = (cd: (typeof codeudores)[number]) => ({
		role: "COFIRMANTE",
		nombre: cd.fullName,
		email: cd.email,
		phone: cd.phone,
		coDebtorId: cd.id,
	});

	const deSociedad = {
		clientType: lead?.clientType,
		coDeudores: codeudores,
	};
	const representante = esOportunidadDeSociedad(deSociedad)
		? representanteLegalDe(deSociedad)
		: null;
	if (representante) {
		return [
			{
				role: "TITULAR",
				nombre: representante.fullName,
				email: representante.email,
				phone: representante.phone,
				coDebtorId: representante.id,
				rolesQueFirma: ["TITULAR", "COFIRMANTE"],
			},
			...codeudores
				.filter((cd) => cd.id !== representante.id)
				.map(comoCofirmante),
			// El representante legal firma varios de estos contratos y hasta ahora
			// sólo se enteraba por el correo de WeeTrust. Va al final porque es
			// interno, y sin `leadId` ni `coDebtorId`: no es ninguno de los dos, y
			// las dos columnas admiten nulo.
			repLegal,
		];
	}

	return [
		{
			role: "TITULAR",
			nombre: lead?.nombre ?? "Cliente",
			email: lead?.email ?? null,
			phone: lead?.phone ?? null,
			...(lead ? { leadId: lead.id } : {}),
		},
		...codeudores.map(comoCofirmante),
		repLegal,
	];
}

/**
 * Con qué roles puede aparecer una persona en los firmantes de un contrato.
 *
 * Un codeudor también firma como titular cuando el cliente es una sociedad y él
 * es su representante: en lo que jurídico sube a mano firma por la sociedad
 * (ver `armarFirmantes`). Como el cliente y los codeudores nunca comparten
 * correo, una fila de titular con el correo del codeudor sólo puede ser ésa.
 */
export function rolesConLosQueFirma(role: string): string[] {
	return role === "COFIRMANTE" ? ["COFIRMANTE", "TITULAR"] : [role];
}
