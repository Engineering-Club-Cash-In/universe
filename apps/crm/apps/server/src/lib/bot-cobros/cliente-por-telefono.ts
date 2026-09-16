/**
 * Créditos de quien escribe desde un WhatsApp, cuando NO se identificó en el
 * bot (no hay `referencia`).
 *
 * Lo usa solo el aviso de modo agente: un cliente que escribe "hola" y pide un
 * humano sin pasar por el OTP igual tiene que llegarle a su asesor. Por eso
 * esto NO es un control de acceso — no devuelve datos al bot, solo decide a
 * qué asesores avisar. Lo que da confianza es que el número lo pone WhatsApp,
 * no el cliente.
 *
 * El teléfono se busca como titular (`leads.phone`) y como codeudor
 * (`co_debtors.phone`), solo en personas con crédito (D-17). Los campos del CRM
 * traen varios números juntos y en formatos mezclados (ver
 * `extraerTelefonos`): el SQL filtra grueso por dígitos y el match exacto se
 * decide en JS con la misma normalización del resto del bot.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { coDebtors, leads, opportunities } from "../../db/schema/crm";
import { ESTADOS_CON_CREDITO, listarCreditosDeCliente } from "./buscar-cliente";
import type { IdentidadBot } from "./historial";
import { extraerTelefonos } from "./identificadores";

export type ClientePorTelefono = {
	/** SIFCOs de todas las personas que tienen ese número. Sin repetir. */
	creditos: string[];
	/**
	 * Para el historial de la ficha. Solo si el número es de UNA persona: con
	 * varias, colgar la interacción de una sola sería inventar quién escribió.
	 */
	identidad: IdentidadBot | null;
};

/** Dígitos del campo en SQL, para el filtro grueso. */
function digitos(columna: unknown) {
	return sql`regexp_replace(coalesce(${columna}, ''), '[^0-9]', '', 'g')`;
}

export async function buscarCreditosPorTelefono(
	telefono8: string,
): Promise<ClientePorTelefono> {
	// `::text` explícito: node-postgres manda el parámetro sin tipo y el `||`
	// con un `unknown` no siempre resuelve.
	const patron = sql`'%' || ${telefono8}::text || '%'`;

	const [titulares, codeudores] = await Promise.all([
		db
			.selectDistinct({
				leadId: leads.id,
				dpi: leads.dpi,
				phone: leads.phone,
			})
			.from(leads)
			.innerJoin(opportunities, eq(opportunities.leadId, leads.id))
			.where(
				and(
					inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
					sql`${digitos(leads.phone)} LIKE ${patron}`,
				),
			),
		db
			.selectDistinct({
				coDebtorId: coDebtors.id,
				leadId: opportunities.leadId,
				dpi: coDebtors.dpi,
				phone: coDebtors.phone,
				numeroSifco: opportunities.numeroSifco,
			})
			.from(coDebtors)
			.innerJoin(opportunities, eq(opportunities.id, coDebtors.opportunityId))
			.where(
				and(
					inArray(opportunities.status, [...ESTADOS_CON_CREDITO]),
					sql`${digitos(coDebtors.phone)} LIKE ${patron}`,
				),
			),
	]);

	const esSuyo = (phone: string | null) =>
		extraerTelefonos(phone).includes(telefono8);

	const creditos = new Set<string>();
	// Una persona = un DPI (o, sin DPI, su registro). El mismo cliente suele
	// tener varios leads con el mismo DPI; eso no lo vuelve "varias personas".
	const personas = new Map<string, IdentidadBot>();

	for (const t of titulares.filter((t) => esSuyo(t.phone))) {
		const llave = t.dpi
			? `dpi:${t.dpi.replace(/\s/g, "")}`
			: `lead:${t.leadId}`;
		if (!personas.has(llave)) {
			personas.set(llave, { leadId: t.leadId, coDebtorId: null, dpi: t.dpi });
		}
		for (const c of await listarCreditosDeCliente({
			leadId: t.leadId,
			dpi: t.dpi,
		})) {
			creditos.add(c.numeroSifco);
		}
	}

	for (const cd of codeudores.filter((c) => esSuyo(c.phone))) {
		const llave = cd.dpi
			? `dpi:${cd.dpi.replace(/\s/g, "")}`
			: `codeudor:${cd.coDebtorId}`;
		if (!personas.has(llave)) {
			personas.set(llave, {
				leadId: cd.leadId,
				coDebtorId: cd.coDebtorId,
				dpi: cd.dpi,
			});
		}
		// El crédito donde figura con este número, aunque no tenga DPI cargado.
		if (cd.numeroSifco) creditos.add(cd.numeroSifco);
		if (cd.dpi) {
			for (const c of await listarCreditosDeCliente({
				leadId: null,
				dpi: cd.dpi,
			})) {
				creditos.add(c.numeroSifco);
			}
		}
	}

	return {
		creditos: [...creditos].sort(),
		identidad: personas.size === 1 ? [...personas.values()][0] : null,
	};
}
