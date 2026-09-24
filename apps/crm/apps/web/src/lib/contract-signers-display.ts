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
	/** Cuándo vence el link de esta persona. */
	signingUrlExpiry?: Date | string | null;
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
	/** El link ya venció y hay que regenerarlo para que esa persona pueda firmar. */
	vencido: boolean;
}

/** Un link vencido ya no deja firmar: hay que regenerarlo. */
function linkVencido(expiry: Date | string | null | undefined): boolean {
	if (!expiry) return false;
	const vence = expiry instanceof Date ? expiry : new Date(expiry);
	return !Number.isNaN(vence.getTime()) && vence.getTime() < Date.now();
}

const ETIQUETA_POR_ROL: Record<string, string> = {
	TITULAR: "Cliente",
	COFIRMANTE: "Codeudor",
	REP_LEGAL: "Rep. Legal",
	REP_LEGAL_RDBE: "Rep. Legal RDBE",
	VENDEDOR: "Vendedor",
};

/**
 * Los mismos roles, leídos desde inversiones.
 *
 * El titular de un contrato de inversión no es "el cliente" sino el
 * inversionista, y las dos entidades que firman el contrato de servicios
 * tienen que distinguirse: si las dos dicen "Rep. Legal", quien copia enlaces
 * no sabe cuál le toca a cada una.
 */
export const ETIQUETAS_DE_INVERSIONES: Record<string, string> = {
	...ETIQUETA_POR_ROL,
	TITULAR: "Inversionista",
	REP_LEGAL: "Rep. Legal CUBE",
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
	/** Cómo se lee cada rol. Inversiones usa los suyos. */
	etiquetasPorRol: Record<string, string> = ETIQUETA_POR_ROL,
): FirmanteEnFicha[] {
	if (signatories && signatories.length > 0) {
		// Los codeudores van numerados aunque sea uno solo: "Codeudor 1" deja
		// claro que puede haber más, y con dos o tres hay que poder distinguirlos.
		let nCodeudor = 0;

		return signatories.map((s, i) => {
			let etiqueta = etiquetasPorRol[s.role] ?? s.role;
			if (s.role === "COFIRMANTE") {
				nCodeudor += 1;
				etiqueta = `Codeudor ${nCodeudor}`;
			}
			const estado = s.status ?? "pending";
			return {
				clave: `${s.role}-${s.email}-${i}`,
				etiqueta,
				nombre: s.name || null,
				url: s.signingUrl ?? null,
				estado,
				// A quien ya firmó no le importa que el link haya vencido.
				vencido: estado === "pending" && linkVencido(s.signingUrlExpiry),
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
			vencido: false,
		});
	}
	return viejos;
}

/**
 * Si un contrato ya no está vigente: anulado, o reclamado por su reemplazo
 * aunque siga en "pendiente" (entre que se confirma el nuevo y se anula este, o
 * para siempre si ese paso no llegó). Cuenta como anulado, igual que para el
 * portal y el WhatsApp: sus enlaces son de un documento descartado.
 */
export function estaAnulado(contract: {
	status: string;
	replacedByContractId?: string | null;
}): boolean {
	return contract.status === "cancelled" || !!contract.replacedByContractId;
}

/**
 * El documento tiene todas las firmas y WeeTrust igual no lo cerró.
 *
 * WeeTrust sólo cierra un documento (COMPLETED) cuando, además de las firmas,
 * la verificación facial de quien la lleva salió válida. Si esa verificación
 * falló, el documento se queda en PENDING con todo firmado y no avanza más: hay
 * que repetirla. Mientras siga abierto no existe el PDF firmado —el generador
 * no lo entrega— y por eso el contrato tampoco puede quedar "Firmado".
 *
 * Se distingue en la ficha porque "En firma" ahí parece que falta que alguien
 * firme, y no falta nadie.
 */
export function firmadoSinCerrar(
	estado: string,
	firmantes: { status?: string | null }[] | undefined,
): boolean {
	return (
		estado === "pending" &&
		!!firmantes?.length &&
		firmantes.every((f) => f.status === "signed")
	);
}

/** Cómo se rotula mientras no se sabe por qué no cerró. */
export const ETIQUETA_SIN_CERRAR = {
	label: "Sin cerrar",
	className:
		"border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400",
	title:
		"Ya firmaron todos, pero WeeTrust no ha cerrado el documento. Suele ser la verificación facial: si no pasó, hay que repetirla para que el contrato quede firmado.",
} as const;

/** Y cuando WeeTrust ya dijo que la verificación facial no pasó. */
export const ETIQUETA_IDENTIDAD_FALLIDA = {
	label: "Identidad fallida",
	className: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-400",
	title:
		"Firmaron todos, pero la verificación facial no pasó y WeeTrust no cierra el documento. Hay que repetir la verificación.",
} as const;

/**
 * Un firmante tal como lo devuelve la consulta a WeeTrust, con lo que contó de
 * su verificación facial.
 */
export interface FirmanteConBiometria {
	name?: string;
	signatoryID?: string;
	biometric?: {
		logID?: string | null;
		finished: boolean;
		valid: boolean;
		resultUrl?: string | null;
	} | null;
}

/**
 * Los firmantes cuya verificación facial terminó y no pasó.
 *
 * Mientras haya uno, el documento no cierra por más que estén todas las firmas.
 */
export function identidadesFallidas<T extends FirmanteConBiometria>(
	firmantes: T[] | undefined,
): T[] {
	return (firmantes ?? []).filter(
		(f) => f.biometric?.finished && !f.biometric.valid,
	);
}
