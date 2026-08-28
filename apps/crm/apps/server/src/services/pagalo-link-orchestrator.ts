import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../db";
import { casosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import {
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";
import { reclamarYProcesarGrupo } from "../jobs/pagalo-dispatch";
import { isTestModeEnabled } from "../lib/messaging-test-mode";
import {
	buildPagaloAllocations,
	type PagaloInstallment,
} from "../lib/pagalo-allocations";
import { deduplicarCuotasPagalo } from "../lib/pagalo-installments";
import {
	assertPagaloInstallmentSelection,
	assertPagaloOtrosRequiresInstallment,
} from "../lib/pagalo-selection";
import { primerTelefono } from "../lib/phone-utils";
import { carteraBackClient } from "./cartera-back-client";
import {
	createPagaloClient,
	getPagaloSandboxConfig,
	toPagaloProviderAmount,
} from "./pagalo-client";
import {
	ESTADOS_INVALIDABLES_SUPERVISOR,
	invalidarGrupoEnTx,
	PagaloReemplazoInvalido,
	proximaGeneracion,
} from "./pagalo-group-lifecycle";
import {
	construirIdentificadorCredito,
	resolverVehiculoCasoPagalo,
} from "./pagalo-vehiculo";
import { sendPagaloLinksWhatsapp } from "./send-pagalo-links-whatsapp";

type CreatePagaloLinksInput = {
	casoCobroId: string;
	numeroSifco: string;
	creditoId: number;
	cuotaIds: number[];
	otros?: string;
	requestedBy: string;
};

// TEST_MESSAGE=true redirige también el contacto real del cliente que se
// manda a Págalo — mismo patrón que WhatsApp (messaging-test-mode.ts): sirve
// para probar el checkout real en sandbox sin exponer datos de un cliente
// real al proveedor.
const PAGALO_TEST_EMAIL = "j.alvarez@clubcashin.com";
const PAGALO_TEST_PHONE = "35219722";

/**
 * Un link ERROR puede venir de dos caminos con riesgo muy distinto:
 * createPaymentRequest lanzó (Págalo puede no haber visto nada, o pudo
 * haber procesado el request y solo se perdió la respuesta — igual de
 * ambiguo), o respondió 200 sin `payment_url`/`uuid` — este segundo caso
 * es el más peligroso: Págalo ACEPTÓ el request (200), así que el link real
 * probablemente existe del otro lado. Marcarlo con este nombre distingue
 * "definitivamente ambiguo" del resto de errores ERROR, para no ofrecer
 * "Regenerar" sobre un link que casi seguro ya es cobrable en Págalo
 * (hallazgo de code review).
 */
class PagaloRespuestaAmbigua extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PagaloRespuestaAmbigua";
	}
}

const pickString = (value: unknown, names: string[]): string | undefined => {
	if (!value || typeof value !== "object") return undefined;
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		if (names.includes(key.toLowerCase()) && typeof child === "string" && child)
			return child;
		const nested = pickString(child, names);
		if (nested) return nested;
	}
	return undefined;
};

/** CRM orchestration. Solo sandbox; una llamada externa por componente > Q0. */
/**
 * Datos de contacto: casos_cobros es la fuente principal; leads (vía
 * opportunities.numeroSifco) rellena lo que falte. cartera-back no expone
 * teléfono/email/dirección en /credito. Reutilizado por `createPagaloLinks`
 * y por `regenerarGrupo` (CB-127): el contacto puede haber cambiado desde
 * que se emitió el grupo original, así que regenerar lo vuelve a resolver
 * en vez de copiar el que quedó congelado en el link viejo.
 */
async function resolverContactoPagalo(
	casoCobroId: string,
	numeroSifco: string,
) {
	const [caso] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			telefonoPrincipal: casosCobros.telefonoPrincipal,
			emailContacto: casosCobros.emailContacto,
			direccionContacto: casosCobros.direccionContacto,
		})
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!caso || caso.numeroCreditoSifco !== numeroSifco) {
		throw new Error("Caso de cobro no corresponde al crédito Págalo.");
	}
	// D-04 pedía siempre "crédito {sifco}" en el mensaje; ahora el pedido es
	// identificar el vehículo cuando esté cargado — mismo helper que usa el
	// preview del modal (getVehiculoCasoPagalo, cobros.ts) para que ambos
	// textos coincidan siempre (hallazgo de Codex, PR #1470).
	const vehiculoCaso = await resolverVehiculoCasoPagalo(casoCobroId);
	const identificadorCredito = construirIdentificadorCredito(
		vehiculoCaso,
		numeroSifco,
	);
	const [leadInfo] = await db
		.select({
			email: leads.email,
			phone: leads.phone,
			direccion: leads.direccion,
			departamento: leads.departamento,
			municipio: leads.municipio,
			zona: leads.zona,
		})
		.from(opportunities)
		.leftJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.numeroSifco, numeroSifco))
		.limit(1);

	const telefono = primerTelefono(
		caso?.telefonoPrincipal ?? leadInfo?.phone,
	)?.replace(/\D/g, "");
	const email = caso?.emailContacto || leadInfo?.email;
	const location = caso?.direccionContacto || leadInfo?.direccion;
	if (!telefono || !email || !location) {
		throw new Error(
			"Págalo requiere teléfono, correo y dirección reales del cliente.",
		);
	}
	// Sustitución de test mode DESPUÉS de validar que el caso sí tiene
	// contacto real cargado — testMode no debe ocultar un caso mal cargado.
	// Solo phone/email se redirigen (para que cualquier correo/mensaje real
	// que dispare Págalo llegue acá); nombre, ciudad, departamento y
	// dirección se quedan reales por trazabilidad — decisión explícita del
	// usuario.
	const testMode = isTestModeEnabled();
	const clientContact: ClientContact = {
		phone: testMode ? PAGALO_TEST_PHONE : telefono,
		email: testMode ? PAGALO_TEST_EMAIL : email,
		country: "GT" as const,
		...(leadInfo?.municipio ? { city: leadInfo.municipio } : {}),
		...(leadInfo?.departamento ? { state: leadInfo.departamento } : {}),
		location,
	};
	return { identificadorCredito, telefono, clientContact };
}

export async function createPagaloLinks(input: CreatePagaloLinksInput) {
	const credit = await carteraBackClient.getCredito(input.numeroSifco, false);
	if (credit.credito.credito_id !== input.creditoId) {
		throw new Error("Crédito Págalo no coincide con SIFCO.");
	}
	const vencidas = deduplicarCuotasPagalo(
		credit.cuotasAtrasadas.filter((cuota) => cuota.numero_cuota > 0),
	);
	// cuotasPendientes es "todas las no pagadas" (sin filtro de fecha), no
	// "solo próximas" — ya incluye las vencidas. Sin excluirlas acá, [0] cae
	// siempre en la misma cuota que ya está en `vencidas` y la cuota vigente
	// real nunca se ofrece (hallazgo del usuario, crédito 9216).
	const proximaPendiente = deduplicarCuotasPagalo(
		credit.cuotasPendientes.filter(
			(cuota) =>
				cuota.numero_cuota > 0 &&
				!vencidas.some((v) => v.numero_cuota === cuota.numero_cuota),
		),
	)[0];
	const cuotasDisponibles = deduplicarCuotasPagalo(
		proximaPendiente ? [...vencidas, proximaPendiente] : vencidas,
	);
	const selectable = cuotasDisponibles.filter((cuota) =>
		input.cuotaIds.includes(cuota.cuota_id),
	);
	if (selectable.length !== input.cuotaIds.length) {
		throw new Error(
			"Una cuota Págalo ya no está vencida o no pertenece al crédito.",
		);
	}
	assertPagaloInstallmentSelection(
		selectable.map((cuota) => cuota.numero_cuota),
		cuotasDisponibles.map((cuota) => cuota.numero_cuota),
	);
	assertPagaloOtrosRequiresInstallment(
		input.otros,
		selectable.map((cuota) => cuota.numero_cuota),
	);
	const installments: PagaloInstallment[] = selectable
		.sort((a, b) => a.numero_cuota - b.numero_cuota)
		.map((cuota) => ({
			cuotaId: cuota.cuota_id,
			numeroCuota: cuota.numero_cuota,
			capital: cuota.capital_restante,
			interes: cuota.interes_restante,
			iva: cuota.iva_12_restante,
			seguro: cuota.seguro_restante,
			gps: cuota.gps_restante,
			membresias: cuota.membresias_restante,
		}));
	// Mora se cobra siempre que exista. Para grupo solo-mora necesita una cuota
	// de referencia, pero sus rubros quedan vacíos: no se inventa capital/link.
	const installmentsForCalculation =
		installments.length > 0
			? installments
			: vencidas[0]
				? [
						{
							cuotaId: vencidas[0].cuota_id,
							numeroCuota: vencidas[0].numero_cuota,
						},
					]
				: [];
	const calculation = buildPagaloAllocations({
		installments: installmentsForCalculation,
		mora: credit.moraActual,
		otros: input.otros,
	});

	const { identificadorCredito, telefono, clientContact } =
		await resolverContactoPagalo(input.casoCobroId, input.numeroSifco);

	// Cualquier grupo ACTIVO del crédito —en revisión, esperando pago, o uno
	// que el BOT creó desde WhatsApp— se devuelve tal cual en vez de intentar
	// otro insert: el índice único parcial (un grupo activo por crédito) lo
	// rechazaría y salía como error interno (hallazgo de Codex, PR #1445).
	const grupoActivo = await db
		.select({
			groupId: pagaloPaymentGroups.id,
			status: pagaloPaymentGroups.status,
			origen: pagaloPaymentGroups.origen,
			capitalTotal: pagaloPaymentGroups.capitalTotal,
			facturableTotal: pagaloPaymentGroups.facturableTotal,
			totalAmount: pagaloPaymentGroups.totalAmount,
			linkType: pagaloPaymentLinks.linkType,
			linkStatus: pagaloPaymentLinks.status,
			paymentUrl: pagaloPaymentLinks.paymentUrl,
		})
		.from(pagaloPaymentGroups)
		.leftJoin(
			pagaloPaymentLinks,
			eq(pagaloPaymentLinks.groupId, pagaloPaymentGroups.id),
		)
		.where(
			and(
				eq(pagaloPaymentGroups.carteraCreditoId, input.creditoId),
				notInArray(pagaloPaymentGroups.status, ["COMPLETED", "CANCELLED"]),
			),
		);
	if (grupoActivo.length > 0) {
		const group = grupoActivo[0]!;
		return {
			groupId: group.groupId,
			status: group.status,
			origen: group.origen,
			capitalTotal: group.capitalTotal,
			facturableTotal: group.facturableTotal,
			totalAmount: group.totalAmount,
			links: grupoActivo.flatMap((link) =>
				link.linkType && link.paymentUrl && link.linkStatus === "ACTIVE"
					? [
							{
								linkType: link.linkType,
								paymentUrl: link.paymentUrl,
								status: link.linkStatus as "ACTIVE",
								amount:
									link.linkType === "CAPITAL"
										? group.capitalTotal
										: group.facturableTotal,
							},
						]
					: [],
			),
			// Grupo ya existía (reintento o creado por otro asesor/el BOT) — este
			// llamado no intentó enviar WhatsApp, `null` distingue "no aplica" de
			// "se intentó y falló" (whatsappEnviado: false), para no instruir al
			// asesor a reenviar manualmente un mensaje que sí pudo haber llegado
			// en la creación original (hallazgo de Codex, PR #1470).
			whatsappEnviado: null as boolean | null,
		};
	}
	const config = getPagaloSandboxConfig();
	if (!config.linkCreationEnabled) {
		throw new Error(
			"Creación de links Págalo deshabilitada por configuración.",
		);
	}

	const group = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(pagaloPaymentGroups)
			.values({
				casoCobroId: input.casoCobroId,
				numeroCreditoSifco: input.numeroSifco,
				carteraCreditoId: input.creditoId,
				pagaloEnvironment: "STAGING",
				origen: "ASESOR",
				carteraAsesorId: credit.asesor?.asesor_id ?? null,
				capitalTotal: calculation.capitalTotal,
				facturableTotal: calculation.facturableTotal,
				otrosTotal: calculation.otrosTotal,
				totalAmount: calculation.totalAmount,
				allocationsSnapshot: calculation.allocations,
				status: "LINKS_PENDING",
				expirationEnabled: false,
				expirationHours: null,
				createdBy: input.requestedBy,
			})
			.returning();
		if (!created) throw new Error("No se pudo crear grupo Págalo.");
		await tx.insert(pagaloPaymentEvents).values({
			groupId: created.id,
			eventType: "GROUP_CREATED",
			source: "ASESOR",
			actorUserId: input.requestedBy,
			toStatus: "LINKS_PENDING",
			payload: {
				capitalTotal: calculation.capitalTotal,
				facturableTotal: calculation.facturableTotal,
				otrosTotal: calculation.otrosTotal,
			},
		});
		return created;
	});

	const emitido = await emitirLinksDeGrupo({
		groupId: group.id,
		numeroSifco: input.numeroSifco,
		requestedBy: input.requestedBy,
		capitalTotal: calculation.capitalTotal,
		facturableTotal: calculation.facturableTotal,
		clienteNombre: credit.usuario.nombre ?? "",
		clientContact,
		identificadorCredito,
		telefono,
		config,
		enviarWhatsapp: true,
	});

	return {
		groupId: group.id,
		capitalTotal: calculation.capitalTotal,
		facturableTotal: calculation.facturableTotal,
		otrosTotal: calculation.otrosTotal,
		totalAmount: calculation.totalAmount,
		links: emitido.links,
		whatsappEnviado: emitido.whatsappEnviado,
	};
}

type ClientContact = {
	phone: string;
	email: string;
	country: "GT";
	city?: string;
	state?: string;
	location: string;
};

type GeneracionPorTipo = Partial<
	Record<
		"CAPITAL" | "MORA_INTERES",
		{ generation: number; supersedesLinkId: string }
	>
>;

/**
 * Emite UN link de Págalo y lo persiste. Extraído del loop de
 * `emitirLinksDeGrupo` para poder reutilizarlo en
 * `regenerarLinkIndividual` (CB-127) sin duplicar el manejo de éxito/error.
 *
 * `grupoAReviewSiFalla` distingue los dos llamadores: en la emisión inicial
 * de un grupo (`emitirLinksDeGrupo`), un link que falla deja el grupo entero
 * en REVIEW_REQUIRED porque el grupo depende de que TODOS los links salgan
 * bien. Regenerar un link individual es distinto: el grupo ya estaba vivo
 * antes (con el otro link, si existe, intacto) y debe seguir vivo aunque
 * este intento puntual falle — el link nuevo queda ERROR, el resto del
 * grupo no se toca.
 */
async function emitirUnLink(params: {
	client: ReturnType<typeof createPagaloClient>;
	groupId: string;
	numeroSifco: string;
	requestedBy: string;
	clienteNombre: string;
	clientContact: ClientContact;
	config: ReturnType<typeof getPagaloSandboxConfig>;
	linkType: "CAPITAL" | "MORA_INTERES";
	amount: string;
	providerAmount: number;
	etiqueta: string;
	generation?: number;
	supersedesLinkId?: string;
	grupoAReviewSiFalla: boolean;
}): Promise<{ paymentUrl: string; activo: boolean }> {
	const externalIdentifier = `pagalo-${params.groupId}-${params.linkType}-${randomUUID().slice(0, 8)}`;
	const requestPayload = {
		total_amount: params.providerAmount,
		currency: "GTQ" as const,
		description: `Crédito ${params.numeroSifco} · ${params.etiqueta}`,
		external_identifier: externalIdentifier,
		type_request: "SP" as const,
		n_quotas: false,
		expiration: false as const,
		client: {
			first_name: params.clienteNombre.split(" ")[0] || "Cliente",
			last_name: params.clienteNombre.split(" ").slice(1).join(" ") || "Cashin",
			...params.clientContact,
		},
		products: [
			{
				product_uuid: 0,
				name: params.etiqueta,
				product_name: params.etiqueta,
				amount: params.providerAmount,
				quantity: 1,
				subtotal: params.providerAmount,
			},
		],
	};
	// Bloquear el grupo antes de insertar la fila CREATING: sin esto, un
	// invalidarGrupoPagalo concurrente (regenerarLinkIndividual valida el
	// grupo con un SELECT suelto bastante antes de llegar acá, tras HTTP a
	// cartera-back de por medio) podía cancelar el grupo en el hueco entre
	// esa validación y este INSERT, dejando un link recién creado — y pronto
	// activo en Págalo — dentro de un grupo ya CANCELLED (hallazgo de code
	// review). Tomar el candado acá, lo más cerca posible del INSERT y de la
	// llamada HTTP, es lo que realmente cierra la ventana — revalidar con un
	// SELECT sin candado más arriba en el caller no alcanza.
	//
	// Orden de candados cuando supersedesLinkId pertenece a OTRO grupo
	// (regenerarGrupo: el link viejo es del grupo que se acaba de cancelar,
	// no del grupo nuevo que se está emitiendo acá): marcarLinkPagado
	// (pagalo-poll.ts) bloquea, en ese orden, grupo-del-link-viejo → link
	// viejo → grupo-activo-del-crédito (que es ESTE grupo nuevo, para
	// escalarlo a REVIEW_REQUIRED si el link viejo cobra tarde). Bloquear
	// acá primero el grupo actual y después el link viejo invierte ese
	// orden — dos transacciones tomando los mismos dos recursos en orden
	// cruzado es un deadlock clásico; si Postgres aborta esta, el grupo
	// nuevo (ya comiteado por la transacción de invalidar+crear, aparte)
	// queda huérfano en LINKS_PENDING sin su link (hallazgo de code
	// review). Por eso el grupo del link viejo (si es distinto al actual)
	// se bloquea PRIMERO, replicando el orden del poller.
	const stored = await db.transaction(async (tx) => {
		let grupoDelLinkViejo: string | null = null;
		if (params.supersedesLinkId) {
			const [viejo] = await tx
				.select({ groupId: pagaloPaymentLinks.groupId })
				.from(pagaloPaymentLinks)
				.where(eq(pagaloPaymentLinks.id, params.supersedesLinkId));
			grupoDelLinkViejo = viejo?.groupId ?? null;
		}
		// Grupo del link viejo si es OTRO grupo (regenerarGrupo): se bloquea
		// primero, replicando el orden del poller (ver comentario arriba).
		if (grupoDelLinkViejo && grupoDelLinkViejo !== params.groupId) {
			await tx
				.select({ id: pagaloPaymentGroups.id })
				.from(pagaloPaymentGroups)
				.where(eq(pagaloPaymentGroups.id, grupoDelLinkViejo))
				.for("update");
		}
		// Grupo ACTUAL: se bloquea antes que el link viejo cuando ambos
		// pertenecen al mismo grupo (regenerarLinkIndividual) — bloquear el
		// link primero y el grupo después invertía el orden de
		// marcarLinkPagado (pagalo-poll.ts), que siempre toma grupo→link. Un
		// pago tardío concurrente sobre el mismo link (el poller con el grupo
		// bloqueado, esperando el link) contra esta transacción (con el link
		// bloqueado, esperando el grupo) era un deadlock clásico que podía
		// abortar la regeneración del supervisor antes del INSERT (hallazgo
		// de code review — el caso cross-group ya estaba resuelto, este es
		// el caso same-group, que seguía con el orden original invertido).
		const [grupo] = await tx
			.select({
				status: pagaloPaymentGroups.status,
				carteraCreditoId: pagaloPaymentGroups.carteraCreditoId,
			})
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, params.groupId))
			.for("update");
		if (!grupo) throw new Error("Grupo Págalo no encontrado.");
		if (grupo.status === "CANCELLED" || grupo.status === "COMPLETED") {
			throw new Error(
				`El grupo cambió a ${grupo.status} justo antes de emitir el link — no se creó ningún link nuevo.`,
			);
		}
		// El chequeo de pago-predecesor corría antes en una transacción propia
		// que terminaba (y soltaba su candado) ANTES de que esta transacción
		// tomara el suyo — un pago podía llegar en esa ventana sin candado
		// entre ambas y colarse igual (hallazgo de code review). Movido acá,
		// bajo el MISMO candado que protege el INSERT de más abajo: sin
		// ventana entre el chequeo y la emisión.
		const [pagoPredecesorSinReconciliar] = await tx
			.select({ linkId: pagaloPaymentLinks.id })
			.from(pagaloPaymentLinks)
			.innerJoin(
				pagaloPaymentGroups,
				eq(pagaloPaymentGroups.id, pagaloPaymentLinks.groupId),
			)
			.where(
				and(
					eq(pagaloPaymentGroups.carteraCreditoId, grupo.carteraCreditoId),
					eq(pagaloPaymentLinks.status, "PAID"),
					eq(pagaloPaymentLinks.isApplicationSource, false),
				),
			)
			.limit(1);
		if (pagoPredecesorSinReconciliar) {
			throw new PagaloReemplazoInvalido();
		}
		// regenerarLinkIndividual valida el link viejo (supersedesLinkId) con
		// un SELECT suelto bastante antes de llegar acá, tras
		// resolverContactoPagalo/getCredito (HTTP externo) de por medio. En
		// ese hueco el link viejo puede cobrar (REPLACED_LINK_PAID, el poller
		// SÍ transiciona REPLACED→PAID) sin que nada lo vuelva a mirar acá —
		// sin esta revalidación bajo candado, se emitía un link nuevo
		// cobrable para un tipo que ya tiene dinero adentro por el link
		// "viejo" (hallazgo de code review).
		if (params.supersedesLinkId) {
			const [viejo] = await tx
				.select({
					status: pagaloPaymentLinks.status,
					errorCode: pagaloPaymentLinks.errorCode,
					activatedAt: pagaloPaymentLinks.activatedAt,
					pagaloRequestUuid: pagaloPaymentLinks.pagaloRequestUuid,
				})
				.from(pagaloPaymentLinks)
				.where(eq(pagaloPaymentLinks.id, params.supersedesLinkId))
				.for("update");
			const ESTADOS_CERRADOS_SIN_PAGO = [
				"REPLACED",
				"EXPIRED",
				"CANCELLED",
				"ERROR",
			];
			if (!viejo || !ESTADOS_CERRADOS_SIN_PAGO.includes(viejo.status)) {
				throw new Error(
					`El link que se está reemplazando cambió a ${viejo?.status ?? "eliminado"} justo antes de emitir el nuevo — no se creó ningún link.`,
				);
			}
			if (
				viejo.status === "ERROR" &&
				viejo.errorCode === "PagaloRespuestaAmbigua"
			) {
				throw new Error(
					"El link que se está reemplazando quedó en un estado ambiguo con Págalo — no se puede regenerar hasta reconciliarlo a mano.",
				);
			}
			// Este chequeo vivía solo en la validación de entrada de
			// regenerarLinkIndividual, así que regenerarGrupo (que llama acá
			// directo, sin pasar por esa validación) quedaba sin protección:
			// invalidarGrupoEnTx acepta CREATING→REPLACED sin mirar
			// activatedAt (correcto para el bot, que la usa igual), y sin este
			// chequeo compartido un predecesor REPLACED/CANCELLED/EXPIRED que
			// se cerró mientras su solicitud original todavía estaba en vuelo
			// se aceptaba igual, disparando una segunda solicitud real antes
			// de que la primera confirmara su destino (hallazgo de code
			// review). Movido acá, al punto compartido bajo candado, para
			// cubrir ambos llamadores en vez de duplicarlo.
			//
			// CANCELLED/EXPIRED con pagaloRequestUuid es una excepción: ese
			// UUID solo se guarda tras una respuesta HTTP real de Págalo
			// (incluso si llegó después de una invalidación, ver el bloque de
			// emitirUnLink más abajo que la preserva sin reactivar el link), y
			// marcarLinkTerminal (pagalo-poll.ts) solo pone CANCELLED/EXPIRED
			// cuando el poller consultó ESE uuid contra Págalo y el proveedor
			// respondió terminal — o sea, Págalo ya confirmó que el link
			// murió, aunque activatedAt nunca se haya llegado a setear
			// (hallazgo de code review). REPLACED sin activatedAt sigue
			// bloqueado siempre: ahí no hubo ninguna confirmación del
			// proveedor, solo nuestra invalidación local.
			const cerradoSinConfirmarNiUuid =
				["REPLACED", "CANCELLED", "EXPIRED"].includes(viejo.status) &&
				!viejo.activatedAt &&
				!(
					["CANCELLED", "EXPIRED"].includes(viejo.status) &&
					viejo.pagaloRequestUuid
				);
			if (cerradoSinConfirmarNiUuid) {
				throw new Error(
					"El link que se está reemplazando se cerró mientras Págalo todavía no confirmaba su creación — no se puede regenerar hasta saber si esa solicitud tuvo éxito o no.",
				);
			}
		}
		const [insertado] = await tx
			.insert(pagaloPaymentLinks)
			.values({
				groupId: params.groupId,
				linkType: params.linkType,
				generation: params.generation ?? 1,
				supersedesLinkId: params.supersedesLinkId ?? null,
				externalIdentifier,
				apiBaseUrl: params.config.baseUrl,
				status: "CREATING",
				requestPayload,
				requestedBy: params.requestedBy,
			})
			.returning({ id: pagaloPaymentLinks.id });
		return insertado;
	});
	if (!stored) throw new Error("No se pudo persistir link Págalo.");
	// La llamada HTTP a Págalo y la persistencia posterior en nuestra DB
	// estaban en el mismo try/catch: un fallo de persistencia DESPUÉS de que
	// Págalo ya creó el link real (ej. un error transitorio de conexión a
	// Postgres justo al guardar la respuesta) caía en el catch de "falló
	// Págalo" y marcaba el link ERROR — con el link real ya vivo y cobrable
	// en Págalo, sin que el poller lo vuelva a mirar, y habilitando
	// "Regenerar" (ERROR es un estado regenerable) para crear un SEGUNDO
	// link real duplicado (hallazgo de code review). Separados: un fallo de
	// la llamada HTTP en sí sigue marcando ERROR (Págalo nunca creó nada);
	// un fallo de persistencia posterior a una respuesta HTTP exitosa
	// reintenta la persistencia sola, nunca marca ERROR.
	let response: unknown;
	try {
		response = await params.client.createPaymentRequest(requestPayload);
	} catch (error) {
		await marcarLinkCreacionFallida({
			linkId: stored.id,
			groupId: params.groupId,
			requestedBy: params.requestedBy,
			linkType: params.linkType,
			grupoAReviewSiFalla: params.grupoAReviewSiFalla,
			error,
		});
		throw error;
	}

	const paymentUrl = pickString(response, [
		"payment_url",
		"paymenturl",
		"url",
		"link",
	]);
	const requestUuid = pickString(response, ["uuid", "request_uuid"]);
	if (!paymentUrl || !requestUuid) {
		// Págalo respondió 200 pero sin los campos esperados — no es un fallo
		// de red, es una respuesta rara del proveedor con el link ya creado
		// del otro lado; igual se registra como fallo de creación porque no
		// hay paymentUrl que darle al cliente, pero el link real puede seguir
		// existiendo en Págalo (mismo hueco documentado en D-51).
		// PagaloRespuestaAmbigua (no un Error genérico): el errorCode que
		// queda en la fila permite excluir este link puntual de
		// "Regenerar" — Págalo aceptó el request (200), así que el link
		// real casi seguro existe del otro lado.
		const error = new PagaloRespuestaAmbigua(
			"Págalo no devolvió URL y UUID de request.",
		);
		await marcarLinkCreacionFallida({
			linkId: stored.id,
			groupId: params.groupId,
			requestedBy: params.requestedBy,
			linkType: params.linkType,
			grupoAReviewSiFalla: params.grupoAReviewSiFalla,
			error,
		});
		throw error;
	}

	const REINTENTOS_PERSISTENCIA = 3;
	let ultimoError: unknown;
	for (let intento = 1; intento <= REINTENTOS_PERSISTENCIA; intento++) {
		try {
			const activo = await db.transaction(async (tx) => {
				// La respuesta HTTP de Págalo puede llegar DESPUÉS de que un
				// supervisor invalide este mismo link (CREATING es un estado
				// "vivo", invalidable) — sin este WHERE, este UPDATE reactivaba
				// el link a ACTIVE pisando el REPLACED recién puesto (hallazgo
				// de code review). El link ya existe y es cobrable en Págalo
				// pase lo que pase acá (mismo hueco que D-51/D-21), así que
				// igual se guardan paymentUrl/pagaloRequestUuid/responsePayload
				// aunque no gane el status — el poller los necesita para
				// seguir viéndolo si cobra.
				const [actualizado] = await tx
					.update(pagaloPaymentLinks)
					.set({
						status: "ACTIVE",
						paymentUrl,
						pagaloRequestUuid: requestUuid,
						responsePayload: response,
						activatedAt: new Date(),
						nextPollAt: new Date(),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(pagaloPaymentLinks.id, stored.id),
							eq(pagaloPaymentLinks.status, "CREATING"),
						),
					)
					.returning({ id: pagaloPaymentLinks.id });
				if (!actualizado) {
					// El WHERE status='CREATING' de arriba también da falso
					// negativo cuando el status ya no es CREATING porque un
					// INTENTO ANTERIOR de este mismo reintento ya lo puso en
					// ACTIVE y comiteó — pero la conexión se cortó antes de que
					// el await de ese intento devolviera el commit, así que cayó
					// en el catch y reintentó. Sin distinguir este caso de una
					// invalidación real, un link perfectamente activo (mismo
					// pagaloRequestUuid que esta respuesta) se descartaba como
					// si hubiera sido invalidado (hallazgo de code review). Se
					// relee el status fresco: si ya es ACTIVE con el UUID de
					// ESTA respuesta, es éxito idempotente del intento previo,
					// no invalidación.
					const [actual] = await tx
						.select({
							status: pagaloPaymentLinks.status,
							pagaloRequestUuid: pagaloPaymentLinks.pagaloRequestUuid,
						})
						.from(pagaloPaymentLinks)
						.where(eq(pagaloPaymentLinks.id, stored.id));
					if (
						actual?.status === "ACTIVE" &&
						actual.pagaloRequestUuid === requestUuid
					) {
						return true;
					}
					const [preservado] = await tx
						.update(pagaloPaymentLinks)
						.set({
							paymentUrl,
							pagaloRequestUuid: requestUuid,
							responsePayload: response,
							nextPollAt: new Date(),
							updatedAt: new Date(),
						})
						.where(eq(pagaloPaymentLinks.id, stored.id))
						.returning({ status: pagaloPaymentLinks.status });
					// toStatus decía "ACTIVE" acá aunque el status real
					// preservado fuera otro (típicamente REPLACED) — la nota en
					// el payload lo explicaba en texto libre, pero cualquier
					// lector que use la columna estructurada (la bitácora
					// incluida) veía una transición que nunca pasó (hallazgo de
					// code review). Sin transición real que declarar, toStatus
					// queda null.
					await tx.insert(pagaloPaymentEvents).values({
						groupId: params.groupId,
						linkId: stored.id,
						eventType: "LINK_ACTIVE",
						source: "PAGALO",
						actorUserId: params.requestedBy,
						payload: {
							linkType: params.linkType,
							statusPreservado: preservado?.status ?? null,
							nota: "Respuesta de Págalo llegó después de que el link fue invalidado; status preservado, no reactivado.",
						},
					});
					return false;
				}
				await tx.insert(pagaloPaymentEvents).values({
					groupId: params.groupId,
					linkId: stored.id,
					eventType: "LINK_ACTIVE",
					source: "PAGALO",
					actorUserId: params.requestedBy,
					fromStatus: "CREATING",
					toStatus: "ACTIVE",
					payload: { linkType: params.linkType },
				});
				return true;
			});
			// El link puede haber sido invalidado por un supervisor mientras la
			// llamada HTTP a Págalo estaba en vuelo — el bloque de arriba ya
			// preserva el status real en la DB (no lo reactiva), pero devolver
			// éxito acá igual dejaba que emitirLinksDeGrupo/regenerarLinkIndividual
			// mandaran este paymentUrl al cliente por WhatsApp como si el link
			// siguiera siendo válido: alguien podía pagar un link que el
			// supervisor explícitamente invalidó (hallazgo de code review).
			return { paymentUrl, activo };
		} catch (error) {
			ultimoError = error;
			if (intento < REINTENTOS_PERSISTENCIA) {
				await new Promise((resolve) => setTimeout(resolve, 200 * intento));
			}
		}
	}
	// Se agotaron los reintentos de persistencia con el link YA CREADO en
	// Págalo — no se marca ERROR (mentiría sobre el estado real). El link
	// queda en CREATING (el UPDATE de arriba nunca llegó a comitear) con
	// errorCode=PagaloRespuestaAmbigua para que quede marcado igual que el
	// caso "200 sin URL/UUID" — CREATING sigue siendo un estado "vivo"
	// (invalidable por invalidarLinkEnTx/invalidarGrupoEnTx), así que sin
	// este marcador un supervisor podía invalidarlo (pasa a REPLACED) y
	// después regenerarlo (REPLACED es un estado cerrado válido para
	// regenerar), creando un SEGUNDO link real en Págalo sin que nada lo
	// impidiera (hallazgo de code review). Best-effort: si este UPDATE
	// también falla, ya no hay más que intentar acá — el error original se
	// relanza igual.
	try {
		await db
			.update(pagaloPaymentLinks)
			.set({
				errorCode: "PagaloRespuestaAmbigua",
				errorMessage:
					"Reintentos de persistencia agotados con éxito confirmado en Págalo — requiere reconciliación manual antes de invalidar o regenerar.",
				updatedAt: new Date(),
			})
			.where(eq(pagaloPaymentLinks.id, stored.id));
	} catch (marcarError) {
		console.error(
			`[Págalo] No se pudo marcar errorCode=PagaloRespuestaAmbigua para el link ${stored.id}:`,
			marcarError instanceof Error ? marcarError.message : marcarError,
		);
	}
	console.error(
		`[Págalo] No se pudo persistir la respuesta de creación para el link ${stored.id} tras ${REINTENTOS_PERSISTENCIA} intentos — el link YA EXISTE en Págalo (paymentUrl: ${paymentUrl}). Requiere reconciliación manual.`,
		ultimoError instanceof Error ? ultimoError.message : ultimoError,
	);
	throw ultimoError instanceof Error
		? ultimoError
		: new Error("No se pudo persistir la creación del link Págalo.");
}

async function marcarLinkCreacionFallida(params: {
	linkId: string;
	groupId: string;
	requestedBy: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	grupoAReviewSiFalla: boolean;
	error: unknown;
}) {
	await db.transaction(async (tx) => {
		const mensaje =
			params.error instanceof Error
				? params.error.message
				: String(params.error);
		// El HTTP a Págalo puede tardar lo suficiente para que un supervisor
		// invalide este mismo link (CREATING es invalidable) mientras está en
		// vuelo — sin este WHERE, un fallo de red pisaba a ERROR un link que
		// ya había sido correctamente marcado REPLACED por esa invalidación
		// (hallazgo de code review). Si no afectó filas, no hay nada más que
		// registrar acá: el estado ya lo decidió otra transacción.
		const [actualizado] = await tx
			.update(pagaloPaymentLinks)
			.set({
				status: "ERROR",
				errorCode:
					params.error instanceof Error ? params.error.name : "PAGALO_ERROR",
				errorMessage: mensaje,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(pagaloPaymentLinks.id, params.linkId),
					eq(pagaloPaymentLinks.status, "CREATING"),
				),
			)
			.returning({ id: pagaloPaymentLinks.id });
		if (!actualizado) return;
		if (params.grupoAReviewSiFalla) {
			// Mismo razonamiento: si el grupo ya fue invalidado/completado
			// concurrentemente, este UPDATE sin condición lo reabría a
			// REVIEW_REQUIRED — solo tiene sentido escalar un grupo que
			// todavía está en curso.
			await tx
				.update(pagaloPaymentGroups)
				.set({ status: "REVIEW_REQUIRED", updatedAt: new Date() })
				.where(
					and(
						eq(pagaloPaymentGroups.id, params.groupId),
						inArray(pagaloPaymentGroups.status, [
							"LINKS_PENDING",
							"PENDING_PAYMENT",
							"PARTIALLY_PAID",
						]),
					),
				);
		}
		await tx.insert(pagaloPaymentEvents).values({
			groupId: params.groupId,
			linkId: params.linkId,
			eventType: "LINK_CREATE_FAILED",
			source: "PAGALO",
			actorUserId: params.requestedBy,
			fromStatus: "CREATING",
			toStatus: "ERROR",
			payload: {
				errorCode:
					params.error instanceof Error ? params.error.name : "PAGALO_ERROR",
				errorMessage: mensaje.slice(0, 500),
				linkType: params.linkType,
			},
		});
	});
}

/**
 * Fase "emitir links de un grupo ya existente" — separada de la creación del
 * grupo para que CB-127 pueda reutilizarla en la regeneración: el grupo
 * nuevo se inserta dentro de la misma transacción que invalida el viejo
 * (cierra el hueco del índice único de crédito activo), pero los links
 * necesitan HTTP a Págalo, que no puede correr dentro de esa transacción.
 */
export async function emitirLinksDeGrupo(params: {
	groupId: string;
	numeroSifco: string;
	requestedBy: string;
	capitalTotal: string;
	facturableTotal: string;
	clienteNombre: string;
	clientContact: ClientContact;
	identificadorCredito: string;
	telefono: string;
	config: ReturnType<typeof getPagaloSandboxConfig>;
	generacionPorTipo?: GeneracionPorTipo;
	// WhatsApp solo en la creación real desde el modal (createPagaloLinks).
	// regenerarGrupo reusa esta misma función para emitir los links del
	// grupo de reemplazo, pero una regeneración no manda mensaje — decisión
	// de producto: el envío es únicamente al crear por primera vez.
	enviarWhatsapp: boolean;
}) {
	const client = createPagaloClient(params.config);
	const components = [
		["CAPITAL", params.capitalTotal] as const,
		["MORA_INTERES", params.facturableTotal] as const,
	];
	const providerAmounts = new Map(
		components
			.filter(([, amount]) => amount !== "0.00")
			.map(([linkType, amount]) => [linkType, toPagaloProviderAmount(amount)]),
	);

	// D-04 (docs/features/pagalo/DECISIONES.md): texto visible al cliente
	// siempre neutro — nunca "CAPITAL" ni "MORA_INTERES". Con dos links reales,
	// se numeran en orden fijo (CAPITAL siempre 1 de 2) sin importar cuál se
	// crea primero; con uno solo, "Pago" a secas.
	const dosLinks = providerAmounts.size === 2;
	const etiquetaPago = (linkType: "CAPITAL" | "MORA_INTERES") =>
		dosLinks
			? linkType === "CAPITAL"
				? "Pago 1 de 2"
				: "Pago 2 de 2"
			: "Pago";

	const links = [] as Array<{
		linkType: "CAPITAL" | "MORA_INTERES";
		paymentUrl: string;
		status: "ACTIVE";
		amount: string;
	}>;
	for (const component of components) {
		const [linkType, amount] = component;
		if (amount === "0.00") continue;
		const providerAmount = providerAmounts.get(linkType);
		if (providerAmount === undefined)
			throw new Error("Monto Págalo no disponible.");
		const generacion = params.generacionPorTipo?.[linkType];
		const emitido = await emitirUnLink({
			client,
			groupId: params.groupId,
			numeroSifco: params.numeroSifco,
			requestedBy: params.requestedBy,
			clienteNombre: params.clienteNombre,
			clientContact: params.clientContact,
			config: params.config,
			linkType,
			amount,
			providerAmount,
			etiqueta: etiquetaPago(linkType),
			generation: generacion?.generation,
			supersedesLinkId: generacion?.supersedesLinkId,
			// El catch de fallo escala el grupo a REVIEW_REQUIRED: correcto acá
			// (creación normal, todo el grupo depende de que ambos links salgan
			// bien), pero NO para regenerarLinkIndividual (ver esa función).
			grupoAReviewSiFalla: true,
		});
		// activo=false: la respuesta de Págalo llegó después de que el link
		// fue invalidado — el link real existe y es cobrable en Págalo, pero
		// no se manda por WhatsApp ni se cuenta como parte de la emisión
		// (hallazgo de code review). Sin esto, un cliente podía recibir y
		// pagar un link que un supervisor invalidó segundos antes.
		if (!emitido.activo) continue;
		links.push({
			linkType,
			paymentUrl: emitido.paymentUrl,
			status: "ACTIVE",
			amount,
		});
	}
	// Grupo de dos componentes: si uno se invalida concurrentemente mientras
	// el otro ya salió bien (activo=true), `links` queda con solo el
	// componente sobreviviente — la invalidación ya escaló el grupo a
	// REVIEW_REQUIRED (invalidarLinkEnTx), así que este grupo quedó
	// intencionalmente incompleto. Avanzar a PENDING_PAYMENT y mandar por
	// WhatsApp ese link parcial dejaba pagable solo una parte de un grupo
	// que no puede completarse tal como está — dinero que no fluye por el
	// camino normal de aplicación (hallazgo de code review). Solo se
	// considera "completo" cuando TODOS los tipos requeridos llegaron
	// activos, no cuando `links` simplemente no está vacío.
	const completo = links.length === providerAmounts.size;

	// Solo avanza el grupo si seguía en la fase de emisión inicial — un
	// regenerarLinkIndividual sobre un grupo ya PARTIALLY_PAID/READY_TO_APPLY
	// no debe retrocederlo a PENDING_PAYMENT (perdería el otro link ya pagado
	// del radar del dispatcher). `completo` solo cuenta cuántos links salieron
	// bien, no si el grupo SIGUE en un estado enviable — una invalidación
	// concurrente (de un supervisor, o de un pago tardío de un predecesor)
	// pudo mover el grupo a REVIEW_REQUIRED/CANCELLED después de que todos
	// los emitirUnLink ya habían devuelto activo=true, y antes de llegar
	// acá. Sin leer si este UPDATE realmente afectó una fila, `completo`
	// seguía siendo true y el bloque de WhatsApp de abajo mandaba los links
	// de todas formas, sobre un grupo que ya no podía completarse tal como
	// está (hallazgo de code review).
	let grupoSigueVivo = false;
	if (completo) {
		const [actualizado] = await db
			.update(pagaloPaymentGroups)
			.set({ status: "PENDING_PAYMENT", updatedAt: new Date() })
			.where(
				and(
					eq(pagaloPaymentGroups.id, params.groupId),
					inArray(pagaloPaymentGroups.status, [
						"LINKS_PENDING",
						"PENDING_PAYMENT",
					]),
				),
			)
			.returning({ id: pagaloPaymentGroups.id });
		grupoSigueVivo = !!actualizado;
	}

	// Cada emitirUnLink incluye una llamada HTTP real a Págalo — el poller
	// puede observar y marcar PAID un link ya emitido MIENTRAS este loop
	// sigue emitiendo el resto (creación inicial) o antes de que este
	// UPDATE corriera. evaluarGrupo (pagalo-poll.ts) solo promueve a
	// READY_TO_APPLY desde PENDING_PAYMENT/PARTIALLY_PAID — si el pago
	// llegó mientras el grupo seguía en LINKS_PENDING, evaluarGrupo no hizo
	// nada, y este UPDATE ciego a PENDING_PAYMENT lo dejaba ahí sin que
	// nada lo reevaluara (un link PAID deja de tener nextPollAt). Mismo
	// hueco que ya se cerró en regenerarLinkIndividual (hallazgo de code
	// review, no se había aplicado acá). Se relee fresco y, si con eso
	// todos los tipos requeridos ya quedan pagados, se promueve directo a
	// READY_TO_APPLY y se dispara el dispatch.
	if (grupoSigueVivo) {
		const linksDelGrupo = await db
			.select({
				linkType: pagaloPaymentLinks.linkType,
				isApplicationSource: pagaloPaymentLinks.isApplicationSource,
			})
			.from(pagaloPaymentLinks)
			.where(eq(pagaloPaymentLinks.groupId, params.groupId));
		const tiposPagados = new Set(
			linksDelGrupo.filter((l) => l.isApplicationSource).map((l) => l.linkType),
		);
		const todosPagados = [...providerAmounts.keys()].every((t) =>
			tiposPagados.has(t),
		);
		if (todosPagados) {
			const [listo] = await db
				.update(pagaloPaymentGroups)
				.set({
					status: "READY_TO_APPLY",
					readyToApplyAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(pagaloPaymentGroups.id, params.groupId),
						eq(pagaloPaymentGroups.status, "PENDING_PAYMENT"),
					),
				)
				.returning({ id: pagaloPaymentGroups.id });
			if (listo) {
				await db.insert(pagaloPaymentEvents).values({
					groupId: params.groupId,
					eventType: "GROUP_READY",
					source: "PAGALO",
					fromStatus: "PENDING_PAYMENT",
					toStatus: "READY_TO_APPLY",
					payload: {
						motivo:
							"Todos los tipos requeridos ya estaban pagados al terminar de emitir los links.",
					},
				});
				try {
					await reclamarYProcesarGrupo(params.groupId);
				} catch (error) {
					console.error(
						`[Págalo] Grupo ${params.groupId} quedó READY_TO_APPLY tras emitir links pero falló el dispatch inline:`,
						error instanceof Error ? error.message : error,
					);
				}
			}
		}
	}

	// D-04: un solo mensaje, con TODOS los links requeridos, solo cuando el
	// grupo ya está completo Y sigue siendo un grupo enviable. Fallo de
	// WhatsApp nunca revierte la creación de links, que ya ocurrió y es
	// válida sin importar si el mensaje llega — el asesor igual ve las URLs
	// en el modal. `enviarWhatsapp=false` en regenerarGrupo (decisión de
	// producto): WhatsApp es solo para la creación real desde el modal, una
	// regeneración de grupo no reenvía nada.
	let whatsappEnviado = false;
	if (completo && grupoSigueVivo && params.enviarWhatsapp) {
		try {
			const resultado = await sendPagaloLinksWhatsapp({
				numeroSifco: params.numeroSifco,
				identificadorCredito: params.identificadorCredito,
				telefono: params.telefono,
				clienteNombre: params.clienteNombre,
				links,
				createdBy: params.requestedBy,
			});
			whatsappEnviado = resultado.sent;
		} catch (error) {
			console.error(
				`[Págalo] Error enviando links por WhatsApp para ${params.numeroSifco}:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	return { links, whatsappEnviado };
}

/**
 * CB-127 · Regenerar = invalidar el grupo viejo + crear uno nuevo con las
 * mismas cuotas y montos (mismo `allocationsSnapshot`), en una sola
 * transacción DB, y emitir sus links después.
 *
 * Dos fases, igual que `createPagaloLinks`: la transacción solo hace DB
 * (invalidar + insertar el grupo nuevo, así el índice único de "un grupo
 * activo por crédito" nunca ve un hueco entre el CANCELLED y el INSERT);
 * el HTTP a Págalo corre después, fuera de la transacción.
 */
export async function regenerarGrupo(params: {
	groupId: string;
	actorUserId: string;
	motivo: string;
}) {
	const [grupoViejo] = await db
		.select()
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, params.groupId))
		.limit(1);
	if (!grupoViejo) throw new Error("Grupo Págalo no encontrado.");
	if (!grupoViejo.casoCobroId) {
		throw new Error(
			"Grupo Págalo sin caso de cobro asociado: no se puede regenerar.",
		);
	}

	const linksViejos = await db
		.select({
			id: pagaloPaymentLinks.id,
			linkType: pagaloPaymentLinks.linkType,
			status: pagaloPaymentLinks.status,
			generation: pagaloPaymentLinks.generation,
			errorCode: pagaloPaymentLinks.errorCode,
		})
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.groupId, params.groupId));
	// Si algún link del grupo quedó ambiguo (errorCode=PagaloRespuestaAmbigua
	// — reintentos de persistencia agotados con éxito HTTP confirmado, o
	// Págalo respondió sin URL/UUID), invalidarGrupoEnTx más abajo ya lo
	// rechaza — pero eso corre DESPUÉS de elegir viejoDelTipo por generación
	// más alta e insertar el grupo nuevo; para cuando emitirUnLink lo
	// detectaría (si ese fuera el elegido), la transacción destructiva ya
	// comiteó: viejo CANCELLED, nuevo LINKS_PENDING sin ningún link
	// (hallazgo de code review). Se valida acá, antes de tocar nada.
	if (linksViejos.some((l) => l.errorCode === "PagaloRespuestaAmbigua")) {
		throw new PagaloReemplazoInvalido();
	}

	// Preflight ANTES de la transacción: config, contacto y cartera-back son
	// las tres cosas que pueden fallar entre "invalidar viejo + crear nuevo"
	// y "emitir links" — si fallaran después del commit, el grupo nuevo
	// quedaría huérfano en LINKS_PENDING para siempre y el viejo ya
	// CANCELLED, sin forma de recuperarlo sin tocar la DB a mano (hallazgo de
	// code review). Resolviéndolas antes, un fallo acá no toca la DB.
	const config = getPagaloSandboxConfig();
	if (!config.linkCreationEnabled) {
		throw new Error(
			"Creación de links Págalo deshabilitada por configuración.",
		);
	}
	const { identificadorCredito, telefono, clientContact } =
		await resolverContactoPagalo(
			grupoViejo.casoCobroId,
			grupoViejo.numeroCreditoSifco,
		);
	const credit = await carteraBackClient.getCredito(
		grupoViejo.numeroCreditoSifco,
		false,
	);

	const { groupIdNuevo } = await db.transaction(async (tx) => {
		// Bloquear el grupo ANTES de chequear el pago-predecesor: sin esto,
		// si el poller (marcarLinkPagado) está a mitad de su transacción —ya
		// tiene el candado de ESTE grupo (el "grupo activo del crédito" que
		// escala a REVIEW_REQUIRED) pero todavía no comiteó el PAID del link
		// predecesor—, un SELECT sin candado corría en paralelo, no veía ese
		// PAID (no comiteado aún) y dejaba pasar la regeneración; recién
		// después invalidarGrupoEnTx esperaba el mismo candado, despertaba
		// con el REVIEW_REQUIRED ya comiteado, y lo aceptaba como
		// regenerable sin volver a mirar el pago (hallazgo de code review:
		// el guard anterior corría antes de tomar este candado, snapshot
		// obsoleto en esa ventana). Bloqueando primero, si el poller tiene
		// el lock esta transacción espera — y cuando despierta, ve TODO lo
		// que el poller comiteó en su transacción (marcar PAID + escalar el
		// grupo van juntos, misma tx), incluido el pago del predecesor.
		await tx
			.select({ id: pagaloPaymentGroups.id })
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, params.groupId))
			.for("update");

		// invalidarGrupoEnTx solo mira links PAID del grupo que se está
		// invalidando — pero un grupo puede llegar a REVIEW_REQUIRED porque
		// un link REPLACED de un PREDECESOR (ya CANCELLED, mismo crédito)
		// cobró tarde (REPLACED_LINK_PAID, pagalo-poll.ts escala el "grupo
		// activo del crédito", no necesariamente el dueño del link pagado).
		// Ese PAID vive en una fila del grupo viejo, invisible para el
		// chequeo local de invalidarGrupoEnTx — sin esto, regenerarGrupo
		// cancelaba el grupo en revisión, emitía links nuevos y se los
		// mandaba al cliente mientras el pago anterior quedaba sin
		// reconciliar para siempre (hallazgo de code review). Se busca en
		// TODOS los grupos del mismo carteraCreditoId, no solo el actual.
		const [pagoSinReconciliar] = await tx
			.select({ linkId: pagaloPaymentLinks.id })
			.from(pagaloPaymentLinks)
			.innerJoin(
				pagaloPaymentGroups,
				eq(pagaloPaymentGroups.id, pagaloPaymentLinks.groupId),
			)
			.where(
				and(
					eq(pagaloPaymentGroups.carteraCreditoId, grupoViejo.carteraCreditoId),
					eq(pagaloPaymentLinks.status, "PAID"),
					eq(pagaloPaymentLinks.isApplicationSource, false),
				),
			)
			.limit(1);
		if (pagoSinReconciliar) {
			throw new PagaloReemplazoInvalido();
		}

		await invalidarGrupoEnTx(tx, {
			groupId: params.groupId,
			actorUserId: params.actorUserId,
			source: "SUPERVISOR",
			motivo: params.motivo,
			estadosPermitidos: ESTADOS_INVALIDABLES_SUPERVISOR,
			eventType: "GROUP_INVALIDATED_BY_SUPERVISOR",
		});

		// pagalo_payment_groups_contact_uq es INCONDICIONAL (a diferencia del
		// índice de "grupo activo por crédito", que solo mira status NOT IN
		// COMPLETED/CANCELLED) — invalidarGrupoEnTx cancela el grupo viejo
		// pero no le toca contactoCobroId, así que copiarlo al grupo nuevo
		// más abajo violaba el índice único siempre que hubiera gestión
		// asociada: el INSERT tiraba 23505 y regenerarGrupo nunca funcionaba
		// para esos casos (hallazgo de code review). Soltar la asociación del
		// viejo, en la MISMA transacción, antes de insertar el nuevo con esa
		// misma gestión.
		if (grupoViejo.contactoCobroId) {
			await tx
				.update(pagaloPaymentGroups)
				.set({ contactoCobroId: null, updatedAt: new Date() })
				.where(eq(pagaloPaymentGroups.id, params.groupId));
		}

		const [creado] = await tx
			.insert(pagaloPaymentGroups)
			.values({
				casoCobroId: grupoViejo.casoCobroId,
				contactoCobroId: grupoViejo.contactoCobroId,
				numeroCreditoSifco: grupoViejo.numeroCreditoSifco,
				carteraCreditoId: grupoViejo.carteraCreditoId,
				pagaloEnvironment: grupoViejo.pagaloEnvironment,
				origen: grupoViejo.origen,
				carteraAsesorId: grupoViejo.carteraAsesorId,
				capitalTotal: grupoViejo.capitalTotal,
				facturableTotal: grupoViejo.facturableTotal,
				otrosTotal: grupoViejo.otrosTotal,
				totalAmount: grupoViejo.totalAmount,
				allocationsSnapshot: grupoViejo.allocationsSnapshot,
				status: "LINKS_PENDING",
				expirationEnabled: false,
				expirationHours: null,
				createdBy: params.actorUserId,
			})
			.returning({ id: pagaloPaymentGroups.id });
		if (!creado) throw new Error("No se pudo crear el grupo regenerado.");
		await tx.insert(pagaloPaymentEvents).values({
			groupId: creado.id,
			eventType: "GROUP_REGENERATED",
			source: "SUPERVISOR",
			actorUserId: params.actorUserId,
			toStatus: "LINKS_PENDING",
			payload: {
				motivo: params.motivo.slice(0, 500),
				grupoAnteriorId: params.groupId,
			},
		});
		return { groupIdNuevo: creado.id };
	});

	const generacionPorTipo: GeneracionPorTipo = {};
	for (const linkType of ["CAPITAL", "MORA_INTERES"] as const) {
		// De haber más de una generación del mismo tipo en el grupo viejo
		// (regeneraciones individuales previas a esta regeneración de grupo),
		// supersedesLinkId debe apuntar a la MÁS RECIENTE — .find() se
		// quedaba con la primera del array, sin ordenar por generation
		// (hallazgo de code review).
		const viejoDelTipo = linksViejos
			.filter((l) => l.linkType === linkType)
			.reduce<(typeof linksViejos)[number] | undefined>(
				(max, l) => (!max || l.generation > max.generation ? l : max),
				undefined,
			);
		if (!viejoDelTipo) continue;
		const generation = await db.transaction((tx) =>
			proximaGeneracion(tx, {
				carteraCreditoId: grupoViejo.carteraCreditoId,
				linkType,
			}),
		);
		generacionPorTipo[linkType] = {
			generation,
			supersedesLinkId: viejoDelTipo.id,
		};
	}

	const emitido = await emitirLinksDeGrupo({
		groupId: groupIdNuevo,
		numeroSifco: grupoViejo.numeroCreditoSifco,
		requestedBy: params.actorUserId,
		capitalTotal: grupoViejo.capitalTotal,
		facturableTotal: grupoViejo.facturableTotal,
		clienteNombre: credit.usuario.nombre ?? "",
		clientContact,
		identificadorCredito,
		telefono,
		config,
		generacionPorTipo,
		// WhatsApp solo en la creación real desde el modal — regenerar un
		// grupo (aunque técnicamente cree links nuevos) no reenvía nada,
		// decisión de producto.
		enviarWhatsapp: false,
	});

	return {
		groupIdNuevo,
		links: emitido.links,
		whatsappEnviado: emitido.whatsappEnviado,
	};
}

/**
 * CB-127 · Regenera UN link específico de un tipo dentro del MISMO grupo
 * (a diferencia de `regenerarGrupo`, que cancela el grupo entero y crea uno
 * nuevo). El link viejo debe estar cerrado sin pago (REPLACED/EXPIRED/
 * CANCELLED/ERROR) — no tiene sentido regenerar uno vivo o pagado. El grupo
 * debe seguir activo (no CANCELLED/COMPLETED).
 *
 * Monto: usa el mismo capitalTotal/facturableTotal ya congelado en el
 * grupo, no recalcula contra deuda viva — coherente con que el otro link
 * (si sigue vivo) ya se emitió con esos montos y ambos deben sumar al mismo
 * total_amount registrado.
 */
export async function regenerarLinkIndividual(params: {
	linkId: string;
	actorUserId: string;
	motivo: string;
}) {
	const [linkViejo] = await db
		.select()
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.id, params.linkId))
		.limit(1);
	if (!linkViejo) throw new Error("Link Págalo no encontrado.");
	const ESTADOS_CERRADOS = ["REPLACED", "EXPIRED", "CANCELLED", "ERROR"];
	if (!ESTADOS_CERRADOS.includes(linkViejo.status)) {
		throw new Error(
			`El link está en ${linkViejo.status}: solo se regenera un link cerrado sin pago.`,
		);
	}
	// Un ERROR con errorCode=PagaloRespuestaAmbigua significa que Págalo
	// respondió 200 (aceptó el request) pero sin los campos esperados — el
	// link real probablemente existe del otro lado. Regenerar acá crearía
	// un SEGUNDO link cobrable que el poller no puede reconciliar con el
	// primero, porque no tenemos su UUID para buscarlo (hallazgo de code
	// review). El resto de ERROR (fallo de red antes de que Págalo
	// respondiera) sigue siendo regenerable con seguridad.
	if (
		linkViejo.status === "ERROR" &&
		linkViejo.errorCode === "PagaloRespuestaAmbigua"
	) {
		throw new Error(
			"Págalo respondió sin confirmar el link — puede que ya lo haya creado del otro lado. No se puede regenerar hasta reconciliarlo a mano.",
		);
	}
	// activatedAt solo se setea cuando emitirUnLink confirma ACTIVE — un
	// link REPLACED/CANCELLED/EXPIRED sin activatedAt se cerró MIENTRAS
	// createPaymentRequest todavía estaba en vuelo (invalidado por un
	// supervisor, o por invalidarGrupoEnTx del bot, antes de que Págalo
	// respondiera): no hay forma de saber si esa solicitud original va a
	// tener éxito o no. Regenerar acá dispara una SEGUNDA solicitud real
	// antes de que la primera confirme su destino — si ambas terminan
	// aceptadas, dos links cobrables en Págalo que el poller no puede
	// reconciliar entre sí (hallazgo de code review, ventana distinta al
	// caso post-respuesta ya cerrado con PagaloRespuestaAmbigua).
	if (
		["REPLACED", "CANCELLED", "EXPIRED"].includes(linkViejo.status) &&
		!linkViejo.activatedAt
	) {
		throw new Error(
			"Este link se cerró mientras Págalo todavía no confirmaba su creación — no se puede regenerar hasta saber si esa solicitud tuvo éxito o no.",
		);
	}

	// Solo la generación MÁS ALTA de ese tipo, dentro de ESTE grupo, puede
	// regenerarse — regenerar una fila vieja (p. ej. generación 1 cuando ya
	// existe una 2) dejaría el supersedesLinkId apuntando al link
	// equivocado. El índice único active_type_uq evita el caso catastrófico
	// (dos links vivos del mismo tipo), pero no evita este enlazado
	// incorrecto — se valida explícito acá (hallazgo de code review).
	const generacionesDelTipo = await db
		.select({ generation: pagaloPaymentLinks.generation })
		.from(pagaloPaymentLinks)
		.where(
			and(
				eq(pagaloPaymentLinks.groupId, linkViejo.groupId),
				eq(pagaloPaymentLinks.linkType, linkViejo.linkType),
			),
		);
	const generacionMaxima = generacionesDelTipo.reduce(
		(max, f) => Math.max(max, f.generation),
		0,
	);
	if (linkViejo.generation !== generacionMaxima) {
		throw new Error(
			`Este link es la generación ${linkViejo.generation}, pero ya existe una generación ${generacionMaxima} más reciente del mismo tipo — regenerá esa, no esta.`,
		);
	}

	const [grupo] = await db
		.select()
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, linkViejo.groupId))
		.limit(1);
	if (!grupo) throw new Error("Grupo Págalo no encontrado.");
	if (grupo.status === "CANCELLED" || grupo.status === "COMPLETED") {
		throw new Error(
			`El grupo está en ${grupo.status}: no se puede regenerar un link ahí.`,
		);
	}
	if (!grupo.casoCobroId) {
		throw new Error(
			"Grupo Págalo sin caso de cobro asociado: no se puede regenerar el link.",
		);
	}

	const generation = await db.transaction((tx) =>
		proximaGeneracion(tx, {
			carteraCreditoId: grupo.carteraCreditoId,
			linkType: linkViejo.linkType,
			// Acotado al grupo actual (D-20: "generación más alta de ese tipo
			// EN EL GRUPO") — sin esto, un crédito con grupos anteriores ya
			// COMPLETED/CANCELLED con generaciones más altas hacía saltar el
			// número acá también, aunque este grupo nunca tuvo esas
			// generaciones (hallazgo de code review).
			groupId: grupo.id,
		}),
	);

	const config = getPagaloSandboxConfig();
	if (!config.linkCreationEnabled) {
		throw new Error(
			"Creación de links Págalo deshabilitada por configuración.",
		);
	}
	// identificadorCredito/telefono ya no se usan acá: eran solo para el
	// WhatsApp de la regeneración, que se quitó (decisión de producto —
	// WhatsApp solo en la creación real desde el modal). clientContact sí
	// sigue siendo necesario para emitirUnLink (el HTTP real a Págalo).
	const { clientContact } = await resolverContactoPagalo(
		grupo.casoCobroId,
		grupo.numeroCreditoSifco,
	);
	const credit = await carteraBackClient.getCredito(
		grupo.numeroCreditoSifco,
		false,
	);

	// Revalidar el grupo justo antes de emitir: entre la lectura de arriba y
	// acá corrieron resolverContactoPagalo/getCredito (HTTP externo, sin
	// candado posible) — en ese hueco un invalidarGrupoPagalo concurrente
	// puede haber cancelado el grupo. Sin esto, emitirUnLink insertaba un
	// link ACTIVE dentro de un grupo ya CANCELLED (hallazgo de code review).
	// No cierra la ventana entera (emitirUnLink hace su propio INSERT+HTTP,
	// no se puede envolver en esta transacción), pero angosta el hueco al
	// tramo HTTP final, igual que el resto del feature acepta como riesgo
	// residual documentado (D-51).
	const [grupoFresco] = await db
		.select({ status: pagaloPaymentGroups.status })
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, grupo.id))
		.limit(1);
	if (
		!grupoFresco ||
		grupoFresco.status === "CANCELLED" ||
		grupoFresco.status === "COMPLETED"
	) {
		throw new Error(
			`El grupo cambió a ${grupoFresco?.status ?? "eliminado"} mientras se preparaba la regeneración — no se emitió ningún link nuevo.`,
		);
	}

	const amount =
		linkViejo.linkType === "CAPITAL"
			? grupo.capitalTotal
			: grupo.facturableTotal;
	const providerAmount = toPagaloProviderAmount(amount);

	// El chequeo de pago-predecesor (antes en una transacción propia acá)
	// ahora vive dentro de emitirUnLink, bajo el mismo candado que protege
	// el INSERT — una transacción separada que termina antes de que
	// emitirUnLink tome SU candado dejaba una ventana sin lock entre ambas
	// donde un pago podía colarse igual (hallazgo de code review).

	// Registrar el INTENTO de regeneración (actor + motivo) ANTES de llamar
	// a Págalo — antes se registraba después de emitirUnLink, así que si
	// Págalo fallaba (o se agotaban los reintentos de persistencia), la
	// excepción se propagaba sin dejar rastro de quién pidió la regeneración
	// ni por qué; lo único que quedaba era LINK_CREATE_FAILED, sin actor de
	// supervisor ni motivo (hallazgo de code review). linkId apunta al link
	// VIEJO (el que se está reemplazando) — motivoPorLink en
	// getPagaloSupervision NO cruza este eventType (se sacó a propósito en
	// una ronda anterior para no pisar el motivo real de cierre), así que
	// este registro es puramente de bitácora/auditoría.
	await db.insert(pagaloPaymentEvents).values({
		groupId: grupo.id,
		linkId: linkViejo.id,
		eventType: "LINK_REGENERATED_BY_SUPERVISOR",
		source: "SUPERVISOR",
		actorUserId: params.actorUserId,
		payload: {
			motivo: params.motivo.slice(0, 500),
			linkAnteriorId: linkViejo.id,
			linkType: linkViejo.linkType,
			generation,
			resultado: "intentando",
		},
	});

	// D-04: mismo texto neutro que la creación normal. "Pago" a secas porque
	// este mensaje lleva solo el link nuevo — el otro link (si sigue vivo o
	// ya pagado) no se reenvía, evita duplicar el mensaje original completo.
	const client = createPagaloClient(config);
	const emitido = await emitirUnLink({
		client,
		groupId: grupo.id,
		numeroSifco: grupo.numeroCreditoSifco,
		requestedBy: params.actorUserId,
		clienteNombre: credit.usuario.nombre ?? "",
		clientContact,
		config,
		linkType: linkViejo.linkType,
		amount,
		providerAmount,
		etiqueta: "Pago",
		generation,
		supersedesLinkId: linkViejo.id,
		grupoAReviewSiFalla: false,
	});

	const quedoListo = await db.transaction(async (tx) => {
		// Un link invalidado por el supervisor escala el grupo a
		// REVIEW_REQUIRED (invalidarLinkEnTx, pagalo-group-lifecycle.ts). Sin
		// restaurarlo, regenerar con éxito dejaba el grupo atascado ahí para
		// siempre: el poller solo promueve PENDING_PAYMENT/PARTIALLY_PAID a
		// READY_TO_APPLY (evaluarGrupo, pagalo-poll.ts) — REVIEW_REQUIRED nunca
		// matchea ese WHERE.
		//
		// Pero restaurar a ciegas es igual de peligroso: si el grupo requiere
		// AMBOS tipos (capitalTotal>0 y facturableTotal>0) y el que NO se está
		// regenerando ahora ni está pagado ni tiene un link vivo (nunca se creó,
		// o quedó cerrado sin regenerar), el poller jamás lo va a ver — no hay
		// evento de pago que dispare evaluarGrupo para ese tipo. El grupo
		// quedaría en PENDING_PAYMENT pareciendo normal, sin nadie notando que
		// le falta un link entero (hallazgo de code review). Por eso se
		// verifica primero que TODOS los tipos requeridos tengan cobertura
		// (vivo o pagado) antes de salir de REVIEW_REQUIRED; si falta alguno,
		// el grupo se queda en revisión — el supervisor debe regenerar también
		// ese otro tipo.
		//
		// Candado: mismo orden grupo→links que marcarLinkPagado (pagalo-poll.ts)
		// — si el link viejo REPLACED cobra durante la emisión HTTP de acá
		// arriba, el poller pudo haber vuelto a poner el grupo en
		// REVIEW_REQUIRED por REPLACED_LINK_PAID mientras esta transacción
		// corría. Sin candado, esta transacción podía pisar ese
		// REVIEW_REQUIRED recién puesto con PENDING_PAYMENT/PARTIALLY_PAID,
		// ocultando el pago inesperado (hallazgo de code review). Bloquear el
		// grupo y releer los links fresco bajo candado antes de decidir.
		await tx
			.select({ id: pagaloPaymentGroups.id })
			.from(pagaloPaymentGroups)
			.where(eq(pagaloPaymentGroups.id, grupo.id))
			.for("update");

		const tiposRequeridos: Array<"CAPITAL" | "MORA_INTERES"> = [];
		if (Number(grupo.capitalTotal) > 0) tiposRequeridos.push("CAPITAL");
		if (Number(grupo.facturableTotal) > 0) tiposRequeridos.push("MORA_INTERES");

		const linksDelGrupo = await tx
			.select({
				linkType: pagaloPaymentLinks.linkType,
				status: pagaloPaymentLinks.status,
				isApplicationSource: pagaloPaymentLinks.isApplicationSource,
				errorCode: pagaloPaymentLinks.errorCode,
			})
			.from(pagaloPaymentLinks)
			.where(eq(pagaloPaymentLinks.groupId, grupo.id))
			.for("update");

		// Un link PAID con isApplicationSource=false es un pago que llegó por
		// el link EQUIVOCADO (REPLACED_LINK_PAID, pagalo-poll.ts): el poller ya
		// escaló el grupo a REVIEW_REQUIRED por eso, y esa plata necesita
		// reconciliación manual en cartera, no solo "cobertura" de tipos. Que
		// el mismo tipo tenga además un link vivo tras la regeneración no
		// resuelve ese pago mal aplicado — restaurar el grupo lo escondería
		// (hallazgo de code review).
		//
		// Este chequeo original solo miraba linksDelGrupo (el grupo ACTUAL) —
		// pero el grupo puede estar en REVIEW_REQUIRED por un link REPLACED
		// de un PREDECESOR (ya CANCELLED, mismo crédito) que cobró tarde. Esa
		// fila PAID vive en el grupo viejo, invisible acá: regenerar CUALQUIER
		// link cerrado del grupo actual restauraba el grupo escondiendo el
		// pago del predecesor sin reconciliar (mismo hueco que ya se cerró en
		// regenerarGrupo — hallazgo de code review, nunca se aplicó acá).
		// Bajo el mismo candado del grupo actual (arriba), para no dejar la
		// misma ventana de lectura-sin-bloqueo que regenerarGrupo tuvo que
		// corregir después.
		const [pagoPredecesorSinReconciliar] = await tx
			.select({ linkId: pagaloPaymentLinks.id })
			.from(pagaloPaymentLinks)
			.innerJoin(
				pagaloPaymentGroups,
				eq(pagaloPaymentGroups.id, pagaloPaymentLinks.groupId),
			)
			.where(
				and(
					eq(pagaloPaymentGroups.carteraCreditoId, grupo.carteraCreditoId),
					eq(pagaloPaymentLinks.status, "PAID"),
					eq(pagaloPaymentLinks.isApplicationSource, false),
				),
			)
			.limit(1);
		const hayPagoMalAplicado =
			linksDelGrupo.some(
				(l) => l.status === "PAID" && !l.isApplicationSource,
			) || !!pagoPredecesorSinReconciliar;

		// CREATING con errorCode=PagaloRespuestaAmbigua es un link que agotó
		// reintentos de persistencia con éxito HTTP confirmado en Págalo (ver
		// emitirUnLink más arriba): quedó en CREATING sin pagaloRequestUuid
		// persistido, así que el poller nunca lo vuelve a mirar (huérfano) y
		// requiere reconciliación manual. Contarlo como "cubierto" restauraba
		// el grupo de REVIEW_REQUIRED a PENDING_PAYMENT como si ese tipo
		// estuviera resuelto, escondiendo el link ambiguo (hallazgo de code
		// review) — mismo criterio que ya aplica regenerarGrupo en su entrada.
		const cubiertos = new Set(
			linksDelGrupo
				.filter(
					(l) =>
						l.isApplicationSource ||
						((l.status === "CREATING" || l.status === "ACTIVE") &&
							l.errorCode !== "PagaloRespuestaAmbigua"),
				)
				.map((l) => l.linkType),
		);
		const todosCubiertos = tiposRequeridos.every((t) => cubiertos.has(t));

		if (todosCubiertos && !hayPagoMalAplicado) {
			// El link recién emitido puede haber cobrado YA (Págalo respondió
			// rapidísimo en sandbox, o el poller corrió entre el commit de
			// emitirUnLink y este candado) — si con eso TODOS los tipos
			// requeridos quedan isApplicationSource=true, restaurar solo a
			// PENDING_PAYMENT/PARTIALLY_PAID dejaba un grupo ya totalmente
			// pagado esperando un pago que nunca va a llegar: evaluarGrupo
			// (pagalo-poll.ts) solo promueve a READY_TO_APPLY desde
			// PENDING_PAYMENT/PARTIALLY_PAID, y un link PAID deja de tener
			// nextPollAt — nada vuelve a mirar este grupo (hallazgo de code
			// review). Se replica el mismo criterio de evaluarGrupo acá.
			const tiposPagados = new Set(
				linksDelGrupo
					.filter((l) => l.isApplicationSource)
					.map((l) => l.linkType),
			);
			const todosPagados = tiposRequeridos.every((t) => tiposPagados.has(t));
			// Capturar con .returning() y condicionar el evento al UPDATE real
			// — no a la variable calculada en memoria. Dos regeneraciones
			// concurrentes de tipos distintos, ambas pagadas, serializan en
			// este candado: la primera pone READY_TO_APPLY; cuando la segunda
			// llega, su WHERE status='REVIEW_REQUIRED' ya no matchea (el
			// grupo no está en REVIEW_REQUIRED cuando esta transacción lo
			// relee), así que el UPDATE no afecta fila — pero `todosPagados`
			// seguía siendo true, y sin este chequeo se insertaba un segundo
			// GROUP_READY mintiendo una transición que no ocurrió (mismo
			// patrón que evaluarGrupo ya resuelve en pagalo-poll.ts, hallazgo
			// de code review).
			const [actualizado] = await tx
				.update(pagaloPaymentGroups)
				.set(
					todosPagados
						? {
								status: "READY_TO_APPLY",
								readyToApplyAt: new Date(),
								updatedAt: new Date(),
							}
						: {
								status:
									tiposPagados.size > 0 ? "PARTIALLY_PAID" : "PENDING_PAYMENT",
								updatedAt: new Date(),
							},
				)
				.where(
					and(
						eq(pagaloPaymentGroups.id, grupo.id),
						eq(pagaloPaymentGroups.status, "REVIEW_REQUIRED"),
					),
				)
				.returning({ id: pagaloPaymentGroups.id });
			if (actualizado && todosPagados) {
				await tx.insert(pagaloPaymentEvents).values({
					groupId: grupo.id,
					eventType: "GROUP_READY",
					source: "SUPERVISOR",
					actorUserId: params.actorUserId,
					fromStatus: "REVIEW_REQUIRED",
					toStatus: "READY_TO_APPLY",
					payload: {
						motivo:
							"Restaurado por regeneración de link; todos los tipos requeridos ya estaban pagados.",
					},
				});
				return true;
			}
		}
		return false;
	});

	// Con el dispatcher automático apagado (TAREAS_PROGRAMADAS_ACTIVAS=false),
	// dejar el grupo en READY_TO_APPLY sin disparar el dispatch lo dejaba
	// esperando indefinidamente a que alguien corriera el poll manual — el
	// poller sí dispara inline en su propio camino de éxito
	// (reclamarYProcesarGrupo, pagalo-poll.ts), esta restauración no lo hacía
	// (hallazgo de code review). Fuera de la transacción de arriba, mismo
	// motivo que el poller: nunca llamar cartera-back mientras una tx de DB
	// sigue abierta.
	if (quedoListo) {
		try {
			await reclamarYProcesarGrupo(grupo.id);
		} catch (error) {
			console.error(
				`[Págalo] Grupo ${grupo.id} quedó READY_TO_APPLY tras regenerar un link pero falló el dispatch inline:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	// WhatsApp solo en la creación real desde el modal (createPagaloLinks) —
	// regenerar un link individual no reenvía nada, decisión de producto.
	// El supervisor ve el link nuevo (o el fallo) en la UI y decide si
	// comunicarlo por otro medio.
	return {
		groupId: grupo.id,
		linkType: linkViejo.linkType,
		paymentUrl: emitido.activo ? emitido.paymentUrl : null,
		whatsappEnviado: false,
	};
}
