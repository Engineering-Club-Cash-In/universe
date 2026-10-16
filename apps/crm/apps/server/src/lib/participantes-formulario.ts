/**
 * Quiénes son los participantes de los formularios de una oportunidad (titular,
 * codeudores y los que ya no están pero tienen enlace o formulario) y cómo se
 * llaman: las tarjetas de «Formularios del Cliente».
 */

export type TipoPersona = "lead" | "coDebtor";

export type ParticipanteFormulario = {
	personType: TipoPersona;
	personId: string;
	displayName: string;
	roleLabel: string;
	email: string | null;
	phone: string | null;
	canGenerateLink: boolean;
};

/** Lo mínimo de una solicitud o estado patrimonial para identificar y nombrar a su dueño. */
export type FilaDeFormulario = {
	personType: string | null;
	personId: string | null;
	opportunityId: string;
	primerNombre?: string | null;
	segundoNombre?: string | null;
	primerApellido?: string | null;
	segundoApellido?: string | null;
	email?: string | null;
	telMovil?: string | null;
};

type Persona = {
	id: string;
	email: string | null;
	phone: string | null;
};

type Titular = Persona & {
	firstName: string | null;
	middleName: string | null;
	lastName: string | null;
	secondLastName: string | null;
};

export type EntradaParticipantes = {
	opportunityId: string;
	lead: Titular | null;
	coDebtors: (Persona & { fullName: string })[];
	tokens: { personType: string | null; personId: string | null }[];
	creditRows: FilaDeFormulario[];
	financialRows: FilaDeFormulario[];
};

/** Persona + formulario: `lead:<id>`, `coDebtor:<id>` o `legacy:<oportunidad>` si no tiene dueño. */
export function claveDeFormulario(row: {
	personType: string | null;
	personId: string | null;
	opportunityId: string;
}): string {
	return row.personType && row.personId
		? `${row.personType}:${row.personId}`
		: `legacy:${row.opportunityId}`;
}

/** El nombre que la persona escribió en su formulario ("" si no hay). */
export function nombreDelFormulario(row: FilaDeFormulario | null | undefined) {
	if (!row) return "";
	return [
		row.primerNombre,
		row.segundoNombre,
		row.primerApellido,
		row.segundoApellido,
	]
		.map((valor) => (typeof valor === "string" ? valor.trim() : ""))
		.filter(Boolean)
		.join(" ");
}

function contactoDelFormulario(creditApp: FilaDeFormulario | null | undefined) {
	return {
		email: typeof creditApp?.email === "string" ? creditApp.email : null,
		phone: typeof creditApp?.telMovil === "string" ? creditApp.telMovil : null,
	};
}

/**
 * Alguien que ya no es titular ni codeudor de la oportunidad (cambió el titular,
 * borraron al codeudor) pero dejó formulario o enlace: se nombra por lo que
 * escribió en su formulario.
 */
function participanteHistorico(
	personType: TipoPersona,
	personId: string,
	creditApp: FilaDeFormulario | null | undefined,
	financialStmt: FilaDeFormulario | null | undefined,
): ParticipanteFormulario {
	const etiqueta =
		personType === "lead" ? "Titular historico" : "Co-firmante historico";
	return {
		personType,
		personId,
		displayName:
			nombreDelFormulario(creditApp) ||
			nombreDelFormulario(financialStmt) ||
			etiqueta,
		roleLabel: etiqueta,
		...contactoDelFormulario(creditApp),
		canGenerateLink: false,
	};
}

/**
 * En orden: titular, codeudores (en el orden recibido), quienes ya no figuran
 * pero dejaron enlace, y el formulario sin dueño.
 */
export function armarParticipantes(
	entrada: EntradaParticipantes,
): Map<string, ParticipanteFormulario> {
	const { opportunityId, lead, coDebtors } = entrada;
	const credito = new Map(
		entrada.creditRows.map((r) => [claveDeFormulario(r), r]),
	);
	const patrimonial = new Map(
		entrada.financialRows.map((r) => [claveDeFormulario(r), r]),
	);
	const participantes = new Map<string, ParticipanteFormulario>();

	if (lead) {
		participantes.set(`lead:${lead.id}`, {
			personType: "lead",
			personId: lead.id,
			displayName: [
				lead.firstName,
				lead.middleName,
				lead.lastName,
				lead.secondLastName,
			]
				.filter(Boolean)
				.join(" "),
			roleLabel: "Titular",
			email: lead.email,
			phone: lead.phone,
			canGenerateLink: true,
		});
	}
	for (const [indice, coDebtor] of coDebtors.entries()) {
		participantes.set(`coDebtor:${coDebtor.id}`, {
			personType: "coDebtor",
			personId: coDebtor.id,
			displayName: coDebtor.fullName,
			roleLabel: `Co-firmante ${indice + 1}`,
			email: coDebtor.email,
			phone: coDebtor.phone,
			canGenerateLink: true,
		});
	}
	for (const token of entrada.tokens) {
		if (!token.personType || !token.personId) continue;
		const clave = `${token.personType}:${token.personId}`;
		if (participantes.has(clave)) continue;
		participantes.set(
			clave,
			participanteHistorico(
				token.personType as TipoPersona,
				token.personId,
				credito.get(clave),
				patrimonial.get(clave),
			),
		);
	}

	const legacy = `legacy:${opportunityId}`;
	if (
		entrada.tokens.some((t) => !(t.personType && t.personId)) ||
		credito.has(legacy) ||
		patrimonial.has(legacy)
	) {
		const creditApp = credito.get(legacy);
		participantes.set(legacy, {
			personType: "lead",
			personId: legacy,
			displayName:
				nombreDelFormulario(creditApp) ||
				nombreDelFormulario(patrimonial.get(legacy)) ||
				"Titular legacy",
			roleLabel: "Titular legacy",
			...contactoDelFormulario(creditApp),
			canGenerateLink: false,
		});
	}
	return participantes;
}

/**
 * A quiénes nombra la alerta de referencias repetidas, en las dos pantallas.
 * Como revisa solicitudes, quien dejó una y ya no figura sale como histórico
 * tenga o no enlace; mismo orden y nombres que las tarjetas.
 */
export function participantesDeLaAlerta(
	entrada: Omit<EntradaParticipantes, "tokens">,
): Map<string, ParticipanteFormulario> {
	// Cada solicitud cuenta como el enlace de su dueño.
	return armarParticipantes({ ...entrada, tokens: entrada.creditRows });
}

/**
 * Las personas propias de la oportunidad para la alerta de referencias
 * repetidas: las mismas que nombra `participantesDeLaAlerta` (titular actual,
 * codeudores vigentes y quienes dejaron solicitud y ya no figuran), con sus
 * leads y todos sus DPI tal como están escritos (de lead, de codeudor y el de
 * su solicitud). Cómo se comparan los DPI lo decide la búsqueda.
 */
export function personasPropias(
	entrada: Pick<EntradaParticipantes, "opportunityId"> & {
		lead:
			| (NonNullable<EntradaParticipantes["lead"]> & { dpi: string | null })
			| null;
		coDebtors: (EntradaParticipantes["coDebtors"][number] & { dpi: string })[];
		creditRows: (FilaDeFormulario & { dpi?: string | null })[];
	},
): { leadIds: string[]; dpis: string[] } {
	const leadIds = new Set<string>();
	const dpis = new Set<string>();
	const codeudores = new Map(
		entrada.coDebtors.map((c) => [`coDebtor:${c.id}`, c]),
	);
	const participantes = participantesDeLaAlerta({
		...entrada,
		financialRows: [],
	});
	for (const [clave, participante] of participantes) {
		if (participante.personType === "lead" && !clave.startsWith("legacy:")) {
			leadIds.add(participante.personId);
		}
		for (const dpi of [
			clave === `lead:${entrada.lead?.id}` ? entrada.lead?.dpi : null,
			codeudores.get(clave)?.dpi,
		]) {
			if (dpi?.trim()) dpis.add(dpi.trim());
		}
	}
	// El DPI escrito en CADA solicitud: puede haber varias sin dueño en la misma
	// oportunidad y todas son de personas propias.
	for (const solicitud of entrada.creditRows) {
		if (solicitud.dpi?.trim()) dpis.add(solicitud.dpi.trim());
	}
	return { leadIds: [...leadIds], dpis: [...dpis] };
}
