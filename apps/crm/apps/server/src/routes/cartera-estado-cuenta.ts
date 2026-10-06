import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { creditApplications } from "../db/schema/client-forms";
import { casosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import {
	type ContactoEstadoCuenta,
	type ResultadoEnvioWhatsapp,
	type TelefonoCandidato,
	UMBRAL_TELEFONO_COMPARTIDO,
	celularGuatemala,
	destinoModoPrueba,
	clasificarEnvioWhatsapp,
	ordenarContactos,
} from "../lib/cartera-estado-cuenta";
import { TEST_PHONES, getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { sendWhatsappTemplate } from "../lib/simpletech";

/**
 * Envío del estado de cuenta de cancelación que emite Cartera.
 *
 * Cartera genera el PDF y el enlace; el CRM pone lo que Cartera no tiene: los
 * teléfonos del cliente y la conexión con WhatsApp (SimpleTech). Llamada
 * máquina a máquina con el mismo secreto compartido que `compra-aceptada`.
 *
 *  - GET  /contactos?numero_sifco=…  → celulares del cliente, en el orden de Cobros.
 *  - POST /whatsapp                  → manda el mensaje con la plantilla genérica.
 */

export interface CarteraEstadoCuentaDeps {
	/** Teléfonos crudos del crédito, ya en el orden de prioridad. */
	telefonosDelCredito(numeroSifco: string): Promise<TelefonoCandidato[]>;
	/** De estos números (8 dígitos), cuáles aparecen en muchos registros distintos. */
	telefonosCompartidos(digitos: string[]): Promise<Set<string>>;
	enviarWhatsapp(params: { telefono: string; mensaje: string }): ReturnType<
		typeof sendWhatsappTemplate
	>;
	modoPrueba(): boolean;
	/** Destino en modo prueba para el número elegido (8 dígitos). */
	telefonoDePrueba(digitosElegido: string): string;
}

const envioSchema = z.object({
	intentoId: z.string().uuid(),
	numeroCreditoSifco: z.string().min(1).max(100),
	telefono: z.string().min(8).max(20),
	mensaje: z.string().min(1).max(1000),
});

/**
 * Un reintento HTTP con el mismo `intentoId` no manda dos mensajes. Es la red
 * corta (memoria del proceso): la idempotencia durable vive en Cartera, que
 * registra cada intento y nunca reintenta solo.
 */
const RECUERDO_MS = 15 * 60 * 1000;

export function crearCarteraEstadoCuentaRouter(deps: CarteraEstadoCuentaDeps) {
	const app = new Hono();
	const recientes = new Map<
		string,
		{ en: number; respuesta: Promise<Record<string, unknown>> }
	>();

	app.use("*", async (c, next) => {
		const esperado = process.env.CARTERA_RELAY_SECRET;
		if (!esperado) {
			console.error("[cartera-estado-cuenta] CARTERA_RELAY_SECRET no configurado");
			return c.json({ success: false, error: "No configurado" }, 500);
		}
		if (c.req.header("x-cartera-relay-secret") !== esperado) {
			console.warn("[cartera-estado-cuenta] Secreto inválido");
			return c.json({ success: false, error: "No autorizado" }, 401);
		}
		await next();
	});

	app.get("/contactos", async (c) => {
		const numero = (c.req.query("numero_sifco") ?? "").trim();
		if (!numero) {
			return c.json({ success: false, error: "numero_sifco es requerido" }, 400);
		}
		try {
			const candidatos = await deps.telefonosDelCredito(numero);
			const digitos = [
				...new Set(
					candidatos
						.map((t) => celularGuatemala(t.valor))
						.filter((d): d is string => d !== null),
				),
			];
			const compartidos = digitos.length
				? await deps.telefonosCompartidos(digitos)
				: new Set<string>();
			const contactos: ContactoEstadoCuenta[] = ordenarContactos(
				candidatos,
				compartidos,
			);
			return c.json({ success: true, contactos });
		} catch (error) {
			console.error("[cartera-estado-cuenta] Error buscando contactos:", error);
			return c.json({ success: false, error: "Error buscando contactos" }, 500);
		}
	});

	app.post("/whatsapp", async (c) => {
		let cuerpo: z.infer<typeof envioSchema>;
		try {
			cuerpo = envioSchema.parse(await c.req.json());
		} catch {
			return c.json(
				{ success: false, resultado: "NO_ENVIADO", error: "Body inválido" },
				400,
			);
		}
		const digitos = celularGuatemala(cuerpo.telefono);
		if (!digitos) {
			return c.json(
				{ success: false, resultado: "NO_ENVIADO", error: "Teléfono inválido" },
				400,
			);
		}

		const ahora = Date.now();
		for (const [id, r] of recientes) {
			if (ahora - r.en > RECUERDO_MS) recientes.delete(id);
		}
		const previo = recientes.get(cuerpo.intentoId);
		if (previo) {
			return c.json({ ...(await previo.respuesta), repetido: true });
		}

		const respuesta = (async () => {
			const modoPrueba = deps.modoPrueba();
			const destino = modoPrueba ? deps.telefonoDePrueba(digitos) : `+502${digitos}`;
			let resultado: ResultadoEnvioWhatsapp;
			try {
				resultado = clasificarEnvioWhatsapp(
					await deps.enviarWhatsapp({ telefono: destino, mensaje: cuerpo.mensaje }),
				);
			} catch (error) {
				resultado = {
					resultado: "INCIERTO",
					error: String((error as Error)?.message ?? error).slice(0, 500),
				};
			}
			console.log(
				`[cartera-estado-cuenta] WhatsApp crédito ${cuerpo.numeroCreditoSifco} intento ${cuerpo.intentoId}: ${resultado.resultado}${modoPrueba ? " (modo prueba)" : ""}`,
			);
			return {
				success: resultado.resultado === "ENVIADO",
				...resultado,
				proveedor: "SimpleTech",
				modoPrueba,
			} as Record<string, unknown>;
		})();
		recientes.set(cuerpo.intentoId, { en: ahora, respuesta });
		return c.json(await respuesta);
	});

	return app;
}

/**
 * Cuántos créditos distintos comparten cada número, sumando las cuatro fuentes
 * de teléfono (las mismas de `telefonosDelCredito`): lead, caso de cobros
 * (principal y alternativo) y solicitud del titular (sin codeudores). Se cuenta por crédito —o por lead u
 * oportunidad cuando aún no hay crédito— para que el mismo cliente, que
 * aparece en varias fuentes de un mismo crédito, cuente una sola vez.
 * Los dígitos se comparan como en `celularGuatemala`: últimos 8 del primer
 * número del registro.
 */
export function consultaTelefonosCompartidos(digitos: string[]) {
	const lista = sql.join(
		digitos.map((d) => sql`${d}`),
		sql`, `,
	);
	return sql`
		with registros as (
			select coalesce(o.numero_sifco, 'lead:' || l.id::text) as clave, l.phone as tel
			from leads l left join opportunities o on o.lead_id = l.id
			union all
			select coalesce(c.numero_credito_sifco, 'caso:' || c.id::text), c.telefono_principal from casos_cobros c
			union all
			select coalesce(c.numero_credito_sifco, 'caso:' || c.id::text), c.telefono_alternativo from casos_cobros c
			union all
			select coalesce(o.numero_sifco, 'lead:' || o.lead_id::text, 'opp:' || o.id::text), a.tel_movil
			from credit_applications a join opportunities o on o.id = a.opportunity_id
			where a.person_type = 'lead' or a.person_type is null
		)
		select d, count(distinct clave)::int as n
		from (
			select clave,
				right(regexp_replace(split_part(split_part(coalesce(tel, ''), ',', 1), '/', 1), '\\D', '', 'g'), 8) as d
			from registros
		) x
		where d in (${lista})
		group by d`;
}

/**
 * Solo la solicitud del TITULAR: una oportunidad puede tener también la de un
 * codeudor (`personType = 'coDebtor'`), y el estado de cuenta del titular no
 * se le puede mandar a otra persona. Las solicitudes antiguas, de antes de
 * los codeudores, no traen `personType` y son del titular.
 */
export function consultaCelularSolicitudTitular(numeroSifco: string) {
	return db
		.select({ telefono: creditApplications.telMovil })
		.from(opportunities)
		.innerJoin(
			creditApplications,
			eq(creditApplications.opportunityId, opportunities.id),
		)
		.where(
			and(
				eq(opportunities.numeroSifco, numeroSifco),
				or(
					eq(creditApplications.personType, "lead"),
					isNull(creditApplications.personType),
				),
			),
		)
		.orderBy(desc(creditApplications.updatedAt));
}

const dependenciasReales: CarteraEstadoCuentaDeps = {
	async telefonosDelCredito(numeroSifco) {
		const casos = await db
			.select({
				principal: casosCobros.telefonoPrincipal,
				alternativo: casosCobros.telefonoAlternativo,
			})
			.from(casosCobros)
			.where(eq(casosCobros.numeroCreditoSifco, numeroSifco))
			.orderBy(desc(casosCobros.activo), desc(casosCobros.updatedAt));

		const lead = await db
			.select({ telefono: leads.phone })
			.from(opportunities)
			.innerJoin(leads, eq(leads.id, opportunities.leadId))
			.where(eq(opportunities.numeroSifco, numeroSifco))
			.orderBy(desc(opportunities.updatedAt));

		const solicitudes = await consultaCelularSolicitudTitular(numeroSifco);

		return [
			...casos.flatMap((c) => [
				{ valor: c.principal, fuente: "CASO_COBROS" as const },
				{ valor: c.alternativo, fuente: "CASO_COBROS" as const },
			]),
			...lead.map((l) => ({ valor: l.telefono, fuente: "LEAD" as const })),
			...solicitudes.map((s) => ({ valor: s.telefono, fuente: "SOLICITUD" as const })),
		];
	},

	async telefonosCompartidos(digitos) {
		const { rows } = await db.execute<{ d: string; n: number }>(
			consultaTelefonosCompartidos(digitos),
		);
		return new Set(
			rows
				.filter((r) => Number(r.n) >= UMBRAL_TELEFONO_COMPARTIDO)
				.map((r) => String(r.d)),
		);
	},

	enviarWhatsapp: ({ telefono, mensaje }) =>
		sendWhatsappTemplate({
			phone: telefono,
			message: mensaje,
			logPrefix: isTestModeEnabled()
				? "[SimpleTech][estado-cuenta][TEST]"
				: "[SimpleTech][estado-cuenta]",
			// El enlace abre el estado de cuenta del cliente: no va a los logs.
			ocultarEnlacesEnLog: true,
		}),

	modoPrueba: isTestModeEnabled,
	telefonoDePrueba: (digitos) => destinoModoPrueba(digitos, TEST_PHONES, getTestPhone()),
};

export default crearCarteraEstadoCuentaRouter(dependenciasReales);
