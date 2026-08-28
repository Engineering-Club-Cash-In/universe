/**
 * CB-127 · Ciclo de vida de grupos Págalo — invalidación y regeneración.
 *
 * Extraído del bloque de reemplazo del bot (D-45…D-52,
 * docs/features/bot-whatsapp-cobros/DECISIONES.md), que era la única lógica
 * capaz de cerrar un grupo vivo y abrir otro. El bot lo sigue usando sin
 * cambio de comportamiento (`invalidarGrupoEnTx` con los mismos
 * `estadosPermitidos` de siempre); el supervisor lo usa con un conjunto más
 * amplio de estados de origen y un `source` distinto.
 *
 * Mismo orden de candados que `marcarLinkPagado` (pagalo-poll.ts): grupo
 * primero, luego sus links — necesario para no cruzarse con el poller
 * marcando un pago mientras el supervisor invalida.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
	type PagaloPaymentGroupStatus,
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../db/schema/pagalo-payments";

export type FuentePagalo = "ASESOR" | "BOT" | "SUPERVISOR";

/** El grupo cambió debajo nuestro (entró un pago o ya estaba cerrado). */
export class PagaloReemplazoInvalido extends Error {}

export function esViolacionDeUnicidadPagalo(error: unknown): boolean {
	const buscar = (e: unknown): boolean => {
		if (!e || typeof e !== "object") return false;
		const code = (e as { code?: unknown }).code;
		if (code === "23505") return true;
		return buscar((e as { cause?: unknown }).cause);
	};
	return buscar(error);
}

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ESTADOS_PERMITIDOS_DEFECTO: PagaloPaymentGroupStatus[] = [
	"PENDING_PAYMENT",
	"LINKS_PENDING",
];

export interface InvalidarGrupoParams {
	groupId: string;
	actorUserId: string;
	source: FuentePagalo;
	motivo: string;
	estadosPermitidos?: PagaloPaymentGroupStatus[];
	eventType?: string;
	payloadExtra?: Record<string, unknown>;
}

export interface InvalidarGrupoResultado {
	linksReemplazados: string[];
	statusAnterior: PagaloPaymentGroupStatus;
}

/**
 * Cancela un grupo vivo y marca sus links CREATING/ACTIVE como REPLACED.
 * Recibe el `tx`: no abre transacción propia, para que el llamador pueda
 * envolverla junto con el INSERT del grupo nuevo (regeneración) en un solo
 * commit — el índice único parcial `pagalo_payment_groups_credit_active_uq`
 * nunca ve un hueco.
 */
export async function invalidarGrupoEnTx(
	tx: Executor,
	params: InvalidarGrupoParams,
): Promise<InvalidarGrupoResultado> {
	const estadosPermitidos =
		params.estadosPermitidos ?? ESTADOS_PERMITIDOS_DEFECTO;

	const [grupoFresco] = await tx
		.select({ status: pagaloPaymentGroups.status })
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, params.groupId))
		.for("update");
	if (!grupoFresco || !estadosPermitidos.includes(grupoFresco.status)) {
		throw new PagaloReemplazoInvalido();
	}

	const linksFrescos = await tx
		.select({ id: pagaloPaymentLinks.id, status: pagaloPaymentLinks.status })
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.groupId, params.groupId))
		.for("update");
	if (linksFrescos.some((l) => l.status === "PAID")) {
		throw new PagaloReemplazoInvalido();
	}

	const reemplazables = linksFrescos
		.filter((l) => l.status === "CREATING" || l.status === "ACTIVE")
		.map((l) => l.id);
	if (reemplazables.length > 0) {
		await tx
			.update(pagaloPaymentLinks)
			.set({ status: "REPLACED", updatedAt: new Date() })
			.where(inArray(pagaloPaymentLinks.id, reemplazables));
	}

	await tx
		.update(pagaloPaymentGroups)
		.set({
			status: "CANCELLED",
			cancelledAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(pagaloPaymentGroups.id, params.groupId),
				inArray(pagaloPaymentGroups.status, estadosPermitidos),
			),
		);

	await tx.insert(pagaloPaymentEvents).values({
		groupId: params.groupId,
		eventType: params.eventType ?? "GROUP_REPLACED",
		source: params.source,
		actorUserId: params.actorUserId,
		fromStatus: grupoFresco.status,
		toStatus: "CANCELLED",
		payload: {
			motivo: params.motivo.slice(0, 500),
			linksReemplazados: reemplazables.length,
			...params.payloadExtra,
		},
	});

	return {
		linksReemplazados: reemplazables,
		statusAnterior: grupoFresco.status,
	};
}

/** Estados de origen que el supervisor puede invalidar/regenerar desde el CRM. */
export const ESTADOS_INVALIDABLES_SUPERVISOR: PagaloPaymentGroupStatus[] = [
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"PARTIALLY_PAID",
	"REVIEW_REQUIRED",
	"APPLICATION_FAILED",
];

/**
 * Wrapper de `invalidarGrupoEnTx` que abre su propia transacción — lo usa
 * el procedure "Invalidar links" del supervisor. Un grupo con cualquier
 * link PAID sigue bloqueado (paso de PAID adentro): eso se resuelve en
 * cartera, no invalidando desde acá.
 */
export async function invalidarGrupo(
	params: Omit<InvalidarGrupoParams, "estadosPermitidos" | "eventType"> & {
		eventType?: string;
	},
): Promise<InvalidarGrupoResultado> {
	return db.transaction((tx) =>
		invalidarGrupoEnTx(tx, {
			...params,
			estadosPermitidos: ESTADOS_INVALIDABLES_SUPERVISOR,
			eventType: params.eventType ?? "GROUP_INVALIDATED_BY_SUPERVISOR",
		}),
	);
}

/**
 * `SELECT max(generation)` de los links del mismo `linkType` en la cadena
 * de grupos de un crédito. Cada regeneración crea un grupo nuevo, así que
 * `generation` nunca colisionó con el índice `(groupId, linkType, generation)`
 * — pero para encadenar link viejo → link nuevo (duplicados, D-a del plan
 * CB-127) hace falta saber la generación más alta vista hasta ahora.
 */
export interface InvalidarLinkParams {
	linkId: string;
	actorUserId: string;
	motivo: string;
}

export interface InvalidarLinkResultado {
	groupId: string;
	linkType: "CAPITAL" | "MORA_INTERES";
	statusAnterior: string;
}

/**
 * CB-127 · Invalida UN link vivo sin tocar el resto del grupo — a
 * diferencia de `invalidarGrupoEnTx`, el grupo NO se cancela: si el otro
 * link (cuando existe) sigue esperando pago, el grupo sigue igual. Mismo
 * criterio conservador que `marcarLinkTerminal` (pagalo-poll.ts) cuando un
 * link muere por causas externas: el grupo escala a REVIEW_REQUIRED porque
 * ya no hay certeza de que pueda completarse tal como está — el supervisor
 * decide desde ahí si regenera el link o invalida el grupo entero.
 *
 * Bloqueado si el link ya está PAID (no se invalida dinero que entró) o si
 * no está vivo (CREATING/ACTIVE) — no tiene sentido invalidar algo que ya
 * terminó su ciclo (REPLACED/EXPIRED/CANCELLED/ERROR).
 */
export async function invalidarLinkEnTx(
	tx: Executor,
	params: InvalidarLinkParams,
): Promise<InvalidarLinkResultado> {
	// Resolver el groupId sin candado (lectura barata, no bloquea nada) para
	// poder bloquear GRUPO primero — mismo orden que invalidarGrupoEnTx y el
	// poller (marcarLinkPagado, pagalo-poll.ts). Bloquear el link antes que
	// el grupo (como estaba) invertía ese orden: una transacción que toma
	// grupo→link y otra que toma link→grupo pueden deadlockear entre sí
	// (hallazgo de code review).
	const [ubicacion] = await tx
		.select({ groupId: pagaloPaymentLinks.groupId })
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.id, params.linkId));
	if (!ubicacion) throw new PagaloReemplazoInvalido();

	const [grupo] = await tx
		.select({ status: pagaloPaymentGroups.status })
		.from(pagaloPaymentGroups)
		.where(eq(pagaloPaymentGroups.id, ubicacion.groupId))
		.for("update");

	const [linkFresco] = await tx
		.select({
			groupId: pagaloPaymentLinks.groupId,
			linkType: pagaloPaymentLinks.linkType,
			status: pagaloPaymentLinks.status,
		})
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.id, params.linkId))
		.for("update");
	if (
		!linkFresco ||
		(linkFresco.status !== "CREATING" && linkFresco.status !== "ACTIVE")
	) {
		throw new PagaloReemplazoInvalido();
	}

	await tx
		.update(pagaloPaymentLinks)
		.set({ status: "REPLACED", updatedAt: new Date() })
		.where(
			and(
				eq(pagaloPaymentLinks.id, params.linkId),
				inArray(pagaloPaymentLinks.status, ["CREATING", "ACTIVE"]),
			),
		);

	if (grupo && grupo.status !== "CANCELLED" && grupo.status !== "COMPLETED") {
		await tx
			.update(pagaloPaymentGroups)
			.set({ status: "REVIEW_REQUIRED", updatedAt: new Date() })
			.where(eq(pagaloPaymentGroups.id, linkFresco.groupId));
	}

	await tx.insert(pagaloPaymentEvents).values({
		groupId: linkFresco.groupId,
		linkId: params.linkId,
		eventType: "LINK_INVALIDATED_BY_SUPERVISOR",
		source: "SUPERVISOR",
		actorUserId: params.actorUserId,
		fromStatus: linkFresco.status,
		toStatus: "REPLACED",
		payload: { motivo: params.motivo.slice(0, 500) },
	});

	return {
		groupId: linkFresco.groupId,
		linkType: linkFresco.linkType,
		statusAnterior: linkFresco.status,
	};
}

/** Wrapper transaccional de `invalidarLinkEnTx` — lo usa el procedure del supervisor. */
export async function invalidarLink(
	params: InvalidarLinkParams,
): Promise<InvalidarLinkResultado> {
	return db.transaction((tx) => invalidarLinkEnTx(tx, params));
}

/**
 * `groupId` acota la búsqueda al grupo actual — la semántica documentada en
 * D-20 ("generación más alta de ese tipo EN EL GRUPO") para
 * `regenerarLinkIndividual`. Sin `groupId`, sigue el comportamiento
 * histórico de mirar TODO el crédito (`carteraCreditoId`): lo necesita
 * `regenerarGrupo`, que cancela el grupo viejo y crea uno nuevo — la
 * generación del grupo nuevo debe continuar la cadena del viejo, no
 * reiniciar en 1 (el grupo nuevo no tiene links todavía, así que acotar a
 * su `groupId` siempre daría 1 y perdería la cadena `supersedesLinkId`
 * entre grupos, hallazgo de code review).
 */
export async function proximaGeneracion(
	tx: Executor,
	params: {
		carteraCreditoId: number;
		linkType: "CAPITAL" | "MORA_INTERES";
		groupId?: string;
	},
): Promise<number> {
	const filas = await tx
		.select({ generation: pagaloPaymentLinks.generation })
		.from(pagaloPaymentLinks)
		.innerJoin(
			pagaloPaymentGroups,
			eq(pagaloPaymentGroups.id, pagaloPaymentLinks.groupId),
		)
		.where(
			and(
				params.groupId
					? eq(pagaloPaymentLinks.groupId, params.groupId)
					: eq(pagaloPaymentGroups.carteraCreditoId, params.carteraCreditoId),
				eq(pagaloPaymentLinks.linkType, params.linkType),
			),
		);
	const maximo = filas.reduce((max, f) => Math.max(max, f.generation), 0);
	return maximo + 1;
}
