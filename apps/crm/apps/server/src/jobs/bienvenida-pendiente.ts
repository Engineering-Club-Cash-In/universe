/**
 * Recuperación de la bienvenida al cliente cuando el disparo del cierre al 90%
 * se perdió (el CRM se reinició o se redesplegó mientras esperaba a cartera o
 * a WhatsApp).
 *
 * `confirmContractsSigned` lanza `enviarMensajesDeCreditoNuevo` sin esperarlo;
 * si el proceso muere en el medio, ese envío no queda en ningún lado. Este
 * barrido (cada 30 minutos) busca las oportunidades que pasaron al 90% por
 * "contratos firmados" en los últimos 3 días, hace más de 15 minutos, que NO
 * tienen una bienvenida enviada en `cobros_send_logs`, y les manda los
 * mensajes. Los 15 minutos dejan terminar al disparo normal; los 3 días evitan
 * que prender BIENVENIDA_WHATSAPP_ENABLED le escriba a créditos viejos.
 *
 * Tope de 3 intentos fallidos por crédito (registrados en `cobros_send_logs`).
 * Los leads sin teléfono válido se saltan (fuera del modo prueba) para no pedir
 * la cuenta Nexa a cartera en cada vuelta. Nunca lanza.
 */

import { and, desc, eq, gt, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { cobrosSendLogs } from "../db/schema/cobros-send-logs";
import {
	leads,
	opportunities,
	opportunityStageHistory,
} from "../db/schema/crm";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { enviarMensajesDeCreditoNuevo } from "../services/bienvenida-credito";

const LOG_PREFIX = "[BienvenidaPendiente]";
/** Mismo texto que `confirmContractsSigned` deja en el historial de etapas. */
export const MOTIVO_CONTRATOS_FIRMADOS =
	"Contratos firmados confirmados - Avanza a formalización";
const MAX_FALLIDOS = 3;
const LIMITE = 50;

export interface CandidatoBienvenida {
	opportunityId: string;
	userId: string;
	numeroSifco: string;
	leadPhone: string | null;
}

export interface BienvenidaPendienteDeps {
	habilitada?: () => boolean;
	candidatos?: (modoPrueba: boolean) => Promise<CandidatoBienvenida[]>;
	enviados?: (
		sifcos: string[],
	) => Promise<Map<string, { enviada: boolean; fallidos: number }>>;
	enviar?: typeof enviarMensajesDeCreditoNuevo;
	modoPrueba?: () => boolean;
}

async function candidatosEnCrm(
	modoPrueba: boolean,
): Promise<CandidatoBienvenida[]> {
	// Los que ya tienen bienvenida enviada, los que agotaron intentos y (fuera
	// del modo prueba) los que no tienen teléfono se descartan EN SQL, antes
	// del límite: si no, los mismos 50 ya resueltos taparían a los pendientes
	// más viejos hasta que salieran de la ventana de 3 días.
	const sinTelefono = modoPrueba
		? sql`true`
		: sql`length(regexp_replace(split_part(translate(coalesce(${leads.phone}, ''), ',', '/'), '/', 1), '[^0-9]', '', 'g')) >= 8`;
	const filas = await db
		.select({
			opportunityId: opportunityStageHistory.opportunityId,
			userId: opportunityStageHistory.changedBy,
			numeroSifco: opportunities.numeroSifco,
			leadPhone: leads.phone,
		})
		.from(opportunityStageHistory)
		.innerJoin(
			opportunities,
			eq(opportunities.id, opportunityStageHistory.opportunityId),
		)
		.leftJoin(leads, eq(leads.id, opportunities.leadId))
		.where(
			and(
				eq(opportunityStageHistory.reason, MOTIVO_CONTRATOS_FIRMADOS),
				gt(opportunityStageHistory.changedAt, sql`now() - interval '3 days'`),
				lt(
					opportunityStageHistory.changedAt,
					sql`now() - interval '15 minutes'`,
				),
				isNotNull(opportunities.numeroSifco),
				// Nombres calificados a mano: dentro de sql`` drizzle no califica la
				// columna de afuera y el EXISTS quedaría siempre verdadero.
				sql`NOT EXISTS (
					SELECT 1 FROM bienvenidas_credito b
					WHERE b.numero_credito_sifco = "opportunities"."numero_sifco"
						AND b.estado <> 'fallida'
				)`,
				sql`NOT EXISTS (
					SELECT 1 FROM cobros_send_logs l
					WHERE l.numero_credito_sifco = "opportunities"."numero_sifco"
						AND l.plantilla_id = 'bienvenida'
						AND l.status = 'sent'
				)`,
				sql`(
					SELECT count(*) FROM cobros_send_logs l
					WHERE l.numero_credito_sifco = "opportunities"."numero_sifco"
						AND l.plantilla_id = 'bienvenida'
						AND l.status = 'failed'
				) < ${MAX_FALLIDOS}`,
				sinTelefono,
			),
		)
		.orderBy(desc(opportunityStageHistory.changedAt))
		.limit(LIMITE);
	return filas.flatMap((f) =>
		f.numeroSifco
			? [
					{
						opportunityId: f.opportunityId,
						userId: f.userId,
						numeroSifco: f.numeroSifco,
						leadPhone: f.leadPhone,
					},
				]
			: [],
	);
}

async function enviadosEnCrm(
	sifcos: string[],
): Promise<Map<string, { enviada: boolean; fallidos: number }>> {
	const resultado = new Map<string, { enviada: boolean; fallidos: number }>();
	if (sifcos.length === 0) return resultado;
	const filas = await db
		.select({
			sifco: cobrosSendLogs.numeroCreditoSifco,
			status: cobrosSendLogs.status,
			total: sql<number>`count(*)::int`,
		})
		.from(cobrosSendLogs)
		.where(
			and(
				eq(cobrosSendLogs.plantillaId, "bienvenida"),
				inArray(cobrosSendLogs.numeroCreditoSifco, sifcos),
			),
		)
		.groupBy(cobrosSendLogs.numeroCreditoSifco, cobrosSendLogs.status);
	for (const f of filas) {
		if (!f.sifco) continue;
		const actual = resultado.get(f.sifco) ?? { enviada: false, fallidos: 0 };
		if (f.status === "sent") actual.enviada = true;
		if (f.status === "failed") actual.fallidos += Number(f.total);
		resultado.set(f.sifco, actual);
	}
	return resultado;
}

let corriendo = false;

export async function recuperarBienvenidasPendientes(
	deps: BienvenidaPendienteDeps = {},
): Promise<{ revisadas: number; enviadas: number }> {
	const habilitada =
		deps.habilitada ??
		(() => process.env.BIENVENIDA_WHATSAPP_ENABLED === "true");
	const buscar = deps.candidatos ?? candidatosEnCrm;
	const yaEnviados = deps.enviados ?? enviadosEnCrm;
	const enviar = deps.enviar ?? enviarMensajesDeCreditoNuevo;
	const modoPrueba = deps.modoPrueba ?? isTestModeEnabled;

	const resumen = { revisadas: 0, enviadas: 0 };
	if (!habilitada() || corriendo) return resumen;
	corriendo = true;
	try {
		const candidatos = await buscar(modoPrueba());
		// Una oportunidad puede aparecer más de una vez en el historial.
		const unicos = [
			...new Map(candidatos.map((c) => [c.numeroSifco, c])).values(),
		];
		const estado = await yaEnviados(unicos.map((c) => c.numeroSifco));
		for (const c of unicos) {
			const previo = estado.get(c.numeroSifco);
			if (previo?.enviada || (previo?.fallidos ?? 0) >= MAX_FALLIDOS) continue;
			if (!modoPrueba() && !primerTelefono(c.leadPhone)) continue;
			resumen.revisadas += 1;
			const r = await enviar({
				opportunityId: c.opportunityId,
				userId: c.userId,
				numeroSifco: c.numeroSifco,
			});
			if (r.bienvenidaEnviada) resumen.enviadas += 1;
		}
		if (resumen.revisadas > 0) {
			console.log(
				`${LOG_PREFIX} ${resumen.enviadas}/${resumen.revisadas} bienvenidas recuperadas`,
			);
		}
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error: ${msg}`);
	} finally {
		corriendo = false;
	}
	return resumen;
}
