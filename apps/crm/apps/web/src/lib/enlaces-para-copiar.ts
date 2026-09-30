import {
	ETIQUETA_POR_ROL,
	type FirmanteDeContrato,
} from "./contract-signers-display";

/**
 * Los enlaces de firma que faltan, agrupados por persona, para copiarlos de una
 * vez y pegarlos en un mensaje.
 *
 * Antes había que copiarlos uno por uno, contrato por contrato, y armar el
 * mensaje a mano. Acá se juntan los de todos los contratos vigentes: sólo los
 * que falta firmar, y sólo con enlace. Cada persona va con los suyos, porque
 * cada enlace firma en nombre de quien le toca.
 */

export interface ContratoConEnlaces {
	nombre: string;
	firmantes: FirmanteDeContrato[] | undefined;
}

export interface PersonaConEnlaces {
	clave: string;
	/** "Cliente", "Codeudor 1", "Rep. Legal CUBE"… */
	etiqueta: string;
	nombre: string;
	enlaces: Array<{ contrato: string; url: string }>;
}

/** En qué orden van: primero quien más espera los suyos. */
const ORDEN_DE_ROL: Record<string, number> = {
	TITULAR: 0,
	COFIRMANTE: 1,
	VENDEDOR: 2,
	REP_LEGAL: 3,
	REP_LEGAL_RDBE: 4,
};

export function enlacesPendientesPorPersona(
	contratos: ContratoConEnlaces[],
	/** Cómo se lee cada rol. Inversiones usa los suyos. */
	etiquetasPorRol: Record<string, string> = ETIQUETA_POR_ROL,
): PersonaConEnlaces[] {
	const porPersona = new Map<
		string,
		PersonaConEnlaces & { role: string; orden: number }
	>();
	// Los codeudores se numeran en el orden en que aparecen, igual que en la
	// ficha: la misma persona es el mismo número en todos los contratos.
	let codeudores = 0;

	for (const contrato of contratos) {
		for (const firmante of contrato.firmantes ?? []) {
			if (firmante.status === "signed" || !firmante.signingUrl) continue;

			const clave = `${firmante.role}|${firmante.email.toLowerCase()}`;
			let persona = porPersona.get(clave);
			if (!persona) {
				const etiqueta =
					firmante.role === "COFIRMANTE"
						? `Codeudor ${++codeudores}`
						: (etiquetasPorRol[firmante.role] ?? firmante.role);
				persona = {
					clave,
					role: firmante.role,
					orden: porPersona.size,
					etiqueta,
					nombre: firmante.name || firmante.email,
					enlaces: [],
				};
				porPersona.set(clave, persona);
			}
			persona.enlaces.push({
				contrato: contrato.nombre,
				url: firmante.signingUrl,
			});
		}
	}

	return [...porPersona.values()]
		.sort(
			(a, b) =>
				(ORDEN_DE_ROL[a.role] ?? 2) - (ORDEN_DE_ROL[b.role] ?? 2) ||
				a.orden - b.orden,
		)
		.map(({ role: _role, orden: _orden, ...persona }) => persona);
}

/**
 * El mensaje, listo para pegar en WhatsApp o en un correo: un bloque por
 * persona, con el nombre de cada contrato y su enlace abajo.
 */
export function mensajeDeEnlaces(personas: PersonaConEnlaces[]): string {
	return personas
		.map((persona) =>
			[
				`*${persona.nombre}* (${persona.etiqueta})`,
				...persona.enlaces.map((e) => `${e.contrato}:\n${e.url}`),
			].join("\n"),
		)
		.join("\n\n");
}
