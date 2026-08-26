/**
 * Recordatorio WhatsApp de links Págalo pendientes (CB-028), cada 3h.
 *
 * Stateless a propósito: no toca la DB salvo lectura. No hay columnas de
 * cursor/lease en `pagalo_payment_groups` ni `pagalo_payment_links` — cada
 * corrida vuelve a mirar el estado real de los links y decide desde cero.
 * Nunca escribe `status` de grupo/link, nunca marca "ya recordé esto" en
 * ningún lado. Simplemente: cada 3h, revisa qué sigue sin pagar y reenvía.
 *
 * A diferencia del poller (`pagalo-poll.ts`, fuente de verdad de pago) y el
 * dispatcher (`pagalo-dispatch.ts`, aplica dinero en cartera-back), este job
 * es puramente notificación.
 *
 * Regla de "no pagado" es a nivel de LINK, no de grupo: un link cuenta como
 * pendiente si `status = 'ACTIVE'`, tiene `paymentUrl` (link ya activado por
 * Págalo, con URL real) y `isApplicationSource = false`. `CREATING` se
 * excluye a propósito: todavía no tiene URL asignada por el proveedor —
 * mandar ese link produciría un mensaje "Pago:" sin destino. Un grupo con
 * ambos links ya `PAID`/`isApplicationSource=true` no recibe nada, aunque su
 * `status` todavía no sea `COMPLETED` (ej. `READY_TO_APPLY` esperando al
 * dispatcher).
 *
 * Orden del mensaje (requisito explícito, inverso al envío original D-04 que
 * siempre pone CAPITAL primero): MORA_INTERES siempre primero si sigue
 * pendiente; si ya no está pendiente (pagado, o el grupo nunca tuvo lado
 * facturable, D-48), se manda solo CAPITAL. Nunca CAPITAL antes que un
 * MORA_INTERES pendiente.
 *
 * Sin tope de recordatorios: cada corrida de 3h que encuentre algo pendiente
 * reenvía — decisión explícita del usuario. Si dos instancias del proceso
 * llegaran a correr a la vez, ambas mandarían el mismo recordatorio en esa
 * ventana; aceptado porque no hay estado que coordinar (sandbox de una
 * instancia, mismo supuesto que el resto de jobs de este módulo).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { clients, leads, opportunities } from "../db/schema/crm";
import {
	type PagaloPaymentGroupStatus,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { vehicles } from "../db/schema/vehicles";
import { primerTelefono } from "../lib/phone-utils";
import { carteraBackClient } from "../services/cartera-back-client";
import { resolverUsuarioSistemaCobros } from "../services/cobros-notif-helpers";
import {
	type PagaloLinkParaEnviar,
	sendPagaloReminderWhatsapp,
	type VehiculoRecordatorioPagalo,
} from "../services/send-pagalo-reminder-whatsapp";

/** Grupo debe haber terminado de emitir TODOS sus links antes de recordar. */
export const ESTADOS_GRUPOS_RECORDABLES = [
	"PENDING_PAYMENT",
	"PARTIALLY_PAID",
] as const satisfies readonly PagaloPaymentGroupStatus[];

export const ESTADOS_OPORTUNIDAD_CON_CREDITO = ["won", "migrate"] as const;

type Grupo = typeof pagaloPaymentGroups.$inferSelect;
type LinkVigente = typeof pagaloPaymentLinks.$inferSelect;

export const esPendiente = (l: LinkVigente) =>
	l.status === "ACTIVE" && Boolean(l.paymentUrl) && !l.isApplicationSource;

/**
 * Links pendientes del grupo, en el orden correcto de envío: MORA_INTERES
 * primero si sigue pendiente, CAPITAL solo si es lo único que falta. `null`
 * si no hay nada pendiente (ambos pagados, o el único lado vivo ya se pagó)
 * — el caller no manda nada en ese caso.
 */
export function resolverLinksPendientes(
	links: LinkVigente[],
): LinkVigente[] | null {
	const ultimoVigentePorTipo = (tipo: "MORA_INTERES" | "CAPITAL") =>
		links
			.filter((l) => l.linkType === tipo && esPendiente(l))
			.sort((a, b) => b.generation - a.generation)[0];

	const moraLink = ultimoVigentePorTipo("MORA_INTERES");
	const capitalLink = ultimoVigentePorTipo("CAPITAL");

	if (moraLink) return [moraLink, ...(capitalLink ? [capitalLink] : [])];
	if (capitalLink) return [capitalLink];
	return null;
}

export function resolverLinksRecordables(
	statusGrupo: PagaloPaymentGroupStatus,
	links: LinkVigente[],
): LinkVigente[] | null {
	if (!(ESTADOS_GRUPOS_RECORDABLES as readonly PagaloPaymentGroupStatus[]).includes(statusGrupo)) {
		return null;
	}
	return resolverLinksPendientes(links);
}

/**
 * Cada fuente se prueba por separado con primerTelefono() antes de encadenar
 * con ??: si telefonoPrincipal existe pero es basura ("N/A", muy corto),
 * primerTelefono ya lo descarta devolviendo null — encadenar los strings
 * crudos ANTES de validar dejaba ese null bloqueando el fallback válido de
 * leads.phone. Mismo patrón que send-recibo-pago-whatsapp.ts /
 * send-premora-reminders.ts.
 */
export function resolverTelefono(
	telefonoPrincipal: string | null | undefined,
	telefonoLead: string | null | undefined,
	telefonoAlternativo?: string | null,
): string | undefined {
	return (
		primerTelefono(telefonoPrincipal) ??
		primerTelefono(telefonoAlternativo) ??
		primerTelefono(telefonoLead)
	) ?? undefined;
}

export function resolverVehiculo(
	vehiculoPrincipal: VehiculoRecordatorioPagalo | null | undefined,
	vehiculoLead: VehiculoRecordatorioPagalo | null | undefined,
): VehiculoRecordatorioPagalo | undefined {
	const tieneDatos = (vehiculo: VehiculoRecordatorioPagalo | null | undefined) =>
		Boolean(
			vehiculo &&
			(vehiculo.marca || vehiculo.modelo || vehiculo.year || vehiculo.placa),
		);
	if (tieneDatos(vehiculoPrincipal)) return vehiculoPrincipal ?? undefined;
	if (tieneDatos(vehiculoLead)) return vehiculoLead ?? undefined;
	return undefined;
}

/**
 * Teléfono y nombre del cliente. Mismo patrón que
 * `pagalo-link-orchestrator.ts`: `casosCobros.telefonoPrincipal` primero,
 * fallback `leads.phone` vía `opportunities.numeroSifco`. Nombre sale de
 * cartera-back (`credit.usuario.nombre`), igual que el envío original.
 *
 * GAP CONOCIDO (hallazgo de code review, verificado 2026-08-26): un grupo
 * `origen='BOT'` sin `casoCobroId` (`pago-link.ts` lo deja `null` cuando no
 * existe fila en `casosCobros` para ese SIFCO) y sin `opportunity` asociada
 * no tiene teléfono resoluble por ningún camino durable — el teléfono
 * verificado por OTP en ese flujo vive en `otps.phoneNumber`, pero esa tabla
 * no referencia `pagaloPaymentGroups` ni el crédito. En ese caso el grupo
 * cae en `SIN_TELEFONO` y el recordatorio simplemente no se manda (no
 * revienta, no reintenta agresivo). Verificado en DEV el 2026-08-26: 0
 * grupos BOT activos hoy caen en este caso, así que no se persiste
 * teléfono/OTP en la creación de grupo BOT como parte de este cambio — eso
 * exigiría tocar `pago-link.ts` y probablemente el schema. Si este job
 * empieza a recibir tráfico BOT real, revisar de nuevo antes de asumir que
 * el recordatorio cubre esos clientes.
 */
async function resolverContacto(
	group: Grupo,
): Promise<{
	telefono: string | undefined;
	clienteNombre: string;
	vehiculo: VehiculoRecordatorioPagalo | undefined;
}> {
	const [caso] = group.casoCobroId
		? await db
				.select({
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					telefonoAlternativo: casosCobros.telefonoAlternativo,
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
				})
				.from(casosCobros)
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.where(eq(casosCobros.id, group.casoCobroId))
				.limit(1)
		: [undefined];
	const [leadInfo] = await db
		.select({
			phone: leads.phone,
			vehiculoMarca: vehicles.make,
			vehiculoModelo: vehicles.model,
			vehiculoYear: vehicles.year,
			vehiculoPlaca: vehicles.licensePlate,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.leftJoin(clients, eq(clients.opportunityId, opportunities.id))
		.leftJoin(
			contratosFinanciamiento,
			eq(contratosFinanciamiento.clientId, clients.id),
		)
		.leftJoin(vehicles, eq(vehicles.id, contratosFinanciamiento.vehicleId))
		.where(
			and(
				eq(opportunities.numeroSifco, group.numeroCreditoSifco),
				inArray(opportunities.status, [...ESTADOS_OPORTUNIDAD_CON_CREDITO]),
			),
		)
		.orderBy(desc(opportunities.updatedAt))
		.limit(1);

	const telefono = resolverTelefono(
		caso?.telefonoPrincipal,
		leadInfo?.phone,
		caso?.telefonoAlternativo,
	);
	const vehiculo = resolverVehiculo(
		caso
			? {
					marca: caso.vehiculoMarca,
					modelo: caso.vehiculoModelo,
					year: caso.vehiculoYear,
					placa: caso.vehiculoPlaca,
				}
			: undefined,
		leadInfo
			? {
					marca: leadInfo.vehiculoMarca,
					modelo: leadInfo.vehiculoModelo,
					year: leadInfo.vehiculoYear,
					placa: leadInfo.vehiculoPlaca,
				}
			: undefined,
	);

	let clienteNombre = "";
	try {
		const credit = await carteraBackClient.getCredito(group.numeroCreditoSifco);
		clienteNombre = credit.usuario.nombre ?? "";
	} catch (error) {
		console.error(
			`[Págalo][RECORDATORIO] no se pudo resolver nombre de cliente para ${group.numeroCreditoSifco}:`,
			error instanceof Error ? error.message : error,
		);
	}

	return { telefono, clienteNombre, vehiculo };
}

export type ResultadoRecordatorioGrupo =
	| "ENVIADO"
	| "SIN_LINKS_PENDIENTES"
	| "SIN_TELEFONO"
	| "ERROR";

async function procesarRecordatorioDeGrupo(
	group: Grupo,
	links: LinkVigente[],
	usuarioSistema: string,
): Promise<ResultadoRecordatorioGrupo> {
	const linksPendientes = resolverLinksRecordables(group.status, links);
	if (!linksPendientes) return "SIN_LINKS_PENDIENTES";

	const { telefono, clienteNombre, vehiculo } = await resolverContacto(group);
	if (!telefono) return "SIN_TELEFONO";

	// Relee estado después de consultas de contacto/cartera: un asesor o bot
	// pudo reemplazar selección mientras esas I/O corrían. Links REPLACED
	// siguen cobrables en proveedor, así que nunca se manda URL capturada antes
	// de confirmar que grupo y links siguen vigentes.
	const [grupoFresco] = await db
		.select({ status: pagaloPaymentGroups.status })
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, group.id))
		.limit(1);
	if (!grupoFresco) return "SIN_LINKS_PENDIENTES";
	const linksFrescos = await db
		.select()
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.groupId, group.id));
	const linksPendientesFrescos = resolverLinksRecordables(
		grupoFresco.status,
		linksFrescos,
	);
	if (!linksPendientesFrescos) return "SIN_LINKS_PENDIENTES";

	// paymentUrl no-nulo garantizado por esPendiente() al construir linksPendientesFrescos.
	const linksParaEnviar: PagaloLinkParaEnviar[] = linksPendientesFrescos.map((l) => ({
		linkType: l.linkType,
		paymentUrl: l.paymentUrl as string,
	}));

	const resultado = await sendPagaloReminderWhatsapp({
		numeroSifco: group.numeroCreditoSifco,
		telefono,
		clienteNombre,
		links: linksParaEnviar,
		vehiculo,
		createdBy: usuarioSistema,
	});
	return resultado.sent ? "ENVIADO" : "ERROR";
}

export type ResultadoRecordatorioPagalo = {
	revisados: number;
	enviados: number;
	omitidos: number;
	errores: number;
};

export async function correrRecordatorioPagalo(): Promise<ResultadoRecordatorioPagalo> {
	const grupos = await db
		.select()
		.from(pagaloPaymentGroups)
		.where(
			inArray(pagaloPaymentGroups.status, [...ESTADOS_GRUPOS_RECORDABLES]),
		);

	const resultado: ResultadoRecordatorioPagalo = {
		revisados: grupos.length,
		enviados: 0,
		omitidos: 0,
		errores: 0,
	};
	if (grupos.length === 0) return resultado;

	// Mismo criterio que bot-cobros/premora: sin usuario sistema no hay a
	// nombre de quién dejar el log de envío (created_by es FK NOT NULL a
	// user.id) — mejor no correr la tanda que dejar cada insert fallando en
	// silencio (persistCobrosSendLog solo loguea el error, no lo propaga).
	const usuarioSistema = await resolverUsuarioSistemaCobros();
	if (!usuarioSistema) {
		console.error(
			"[Págalo][RECORDATORIO] no hay usuario sistema para created_by; se omite la corrida.",
		);
		resultado.errores = grupos.length;
		return resultado;
	}

	for (const group of grupos) {
		try {
			const linksDelGrupo = await db
				.select()
				.from(pagaloPaymentLinks)
				.where(eq(pagaloPaymentLinks.groupId, group.id));
			const resultadoGrupo = await procesarRecordatorioDeGrupo(
				group,
				linksDelGrupo,
				usuarioSistema,
			);
			if (resultadoGrupo === "ENVIADO") resultado.enviados++;
			else if (
				resultadoGrupo === "SIN_LINKS_PENDIENTES" ||
				resultadoGrupo === "SIN_TELEFONO"
			) {
				resultado.omitidos++;
			} else resultado.errores++;
		} catch (error) {
			resultado.errores++;
			console.error(
				`[Págalo][RECORDATORIO] grupo ${group.id} falló:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	return resultado;
}
