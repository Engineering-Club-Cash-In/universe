/**
 * Paso 3 del bot · Pago con link de Págalo (CB-105).
 *
 * Contrato: docs/features/bot-whatsapp-cobros/07-pago-con-link.md (§4)
 * Decisiones: D-45 … D-52 en docs/features/bot-whatsapp-cobros/DECISIONES.md
 *
 * Dos servicios:
 *   · `obtenerOpcionesPagoLink` — cuántas cuotas puede pagar el cliente y cuánto
 *     cuesta cada opción (máximo 4, acordado con SimpleTech).
 *   · `crearPagoLink` — el cliente eligió un monto: se arma el grupo CB-028
 *     (origen BOT) y se emiten uno o dos links en Págalo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLAS QUE ESTE ARCHIVO HACE CUMPLIR
 *
 * · D-46 · Se pagan cuotas COMPLETAS, acumuladas desde la más vieja, más la
 *   próxima por vencer. La mora va completa y siempre. Sin cuotas sueltas.
 * · D-47 · Una sola función arma opciones y arma el link: `/crear` recalcula y
 *   busca el `monto` entre las opciones vigentes. Si no está →
 *   MONTO_DESACTUALIZADO. Jamás se cobra un monto distinto del mostrado.
 * · D-48 · Capital en un link, todo lo demás (interés, IVA, seguro, GPS,
 *   membresías, mora) en el otro. Un lado en Q0 = un solo link. Descripciones
 *   neutras ("Pago 1 de 2"): jamás "intereses" ni "mora" a la vista del cliente.
 * · D-51 · Sin expiración. Un link reemplazado sigue siendo cobrable, así que
 *   queda REPLACED (no CANCELLED) y el poller lo sigue mirando.
 * · Un grupo con dinero adentro (PARTIALLY_PAID) JAMÁS se regenera.
 * · Un grupo del ASESOR no se cancela ni se duplica desde el bot.
 * · El snapshot de un grupo es inmutable: cambiar la selección = grupo NUEVO.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Lo que este archivo NO hace (a propósito): tocar cartera. El pago lo aplica
 * el circuito de CB-028 cuando el poller ve los ACCEPT (D-49/D-50).
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { casosCobros } from "../../db/schema/cobros";
import {
	type PagaloLinkType,
	type PagaloPaymentGroupStatus,
	pagaloPaymentEvents,
	pagaloPaymentGroups,
	pagaloPaymentLinks,
} from "../../db/schema/pagalo-payments";
import { carteraBackClient } from "../../services/cartera-back-client";
import { resolverUsuarioSistemaCobros } from "../../services/cobros-notif-helpers";
import {
	createPagaloClient,
	getPagaloSandboxConfig,
	PagaloClientError,
	toPagaloProviderAmount,
} from "../../services/pagalo-client";
import type {
	CarteraCuotaCredito,
	CreditoDirectoResponse,
} from "../../types/cartera-back";
import {
	buildPagaloAllocations,
	type PagaloAllocation,
	type PagaloInstallment,
} from "../pagalo-allocations";
import { fechaLegible, quetzales } from "./mensajes-credito";
import { verificarAcceso } from "./menu-credito";

/** Acordado con SimpleTech 2026-08-25: con 4 atrasadas ya se recoge el carro. */
export const MAXIMO_OPCIONES = 4;

/** Estados de cartera en los que el bot puede cobrar por link (D-15 excluye convenio). */
const ESTADOS_PAGABLES = new Set(["ACTIVO", "MOROSO"]);

/** Grupos —de cualquier origen— con dinero ya entrando a cartera: no se toca nada. */
const ESTADOS_POST_PAGO: PagaloPaymentGroupStatus[] = [
	"READY_TO_APPLY",
	"APPLYING",
	"APPLICATION_FAILED",
	"REVIEW_REQUIRED",
];

// ─────────────────────────────────────────────────────────────────────────────
// Cálculo puro (sin DB ni red): lo que se prueba en pago-link.test.ts
// ─────────────────────────────────────────────────────────────────────────────

export type CuotaPagable = PagaloInstallment & {
	fechaVencimiento: string;
	vencida: boolean;
};

export type OpcionPagoLink = {
	cuotas: number;
	etiqueta: string;
	montoTotal: string;
	desglose: { cuotas: string; mora: string };
	/** Lo que necesita `/crear` para armar el grupo sin recalcular distinto. */
	calculo: {
		allocations: PagaloAllocation[];
		capitalTotal: string;
		facturableTotal: string;
		totalAmount: string;
	};
};

const centavos = (valor: string | null | undefined): bigint => {
	const m = String(valor ?? "0")
		.trim()
		.match(/^(\d+)(?:\.(\d{1,2}))?$/);
	if (!m) return 0n;
	return BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
};
const dinero = (c: bigint): string =>
	`${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

const saldoDeFila = (fila: CarteraCuotaCredito): bigint =>
	centavos(fila.capital_restante) +
	centavos(fila.interes_restante) +
	centavos(fila.iva_12_restante) +
	centavos(fila.seguro_restante) +
	centavos(fila.gps_restante) +
	centavos(fila.membresias_restante);

/**
 * Las cuotas que el bot puede ofrecer, en el orden en que se acumulan.
 *
 * `getCredito` trae una fila por (cuota, pago): la fila sembrada más cada abono.
 * Por cuota se toma la fila con MENOR saldo —la más actualizada— porque las
 * opciones se calculan sobre el saldo, no el valor nominal (§4.1).
 *
 * Una cuota con un pago **esperando validación** (una boleta en bandeja de
 * conta, completa o parcial) no se ofrece: sus `*_restante` todavía no
 * descuentan ese dinero y se cobraría dos veces. Mismo criterio que
 * `cuotasAtrasadas` del paso 2.
 */
export function cuotasPagables(
	credito: Pick<CreditoDirectoResponse, "cuotasAtrasadas" | "cuotasPendientes">,
): CuotaPagable[] {
	const porCuota = new Map<number, CarteraCuotaCredito>();
	const conPagoEnValidacion = new Set<number>();

	const absorber = (filas: CarteraCuotaCredito[] | undefined) => {
		for (const fila of filas ?? []) {
			if (fila.numero_cuota <= 0 || fila.pagado) continue;
			// Una cuota sin saldo no suma opción: si entrara, dos opciones
			// tendrían el mismo monto y el monto dejaría de identificar la
			// opción (D-47). Hallazgo de Codex.
			if (saldoDeFila(fila) === 0n) continue;
			if (fila.validationStatus === "pending") {
				conPagoEnValidacion.add(fila.cuota_id);
			}
			const actual = porCuota.get(fila.cuota_id);
			if (!actual || saldoDeFila(fila) < saldoDeFila(actual)) {
				porCuota.set(fila.cuota_id, fila);
			}
		}
	};

	absorber(credito.cuotasAtrasadas);
	const vencidas = [...porCuota.values()]
		.filter((c) => !conPagoEnValidacion.has(c.cuota_id))
		.sort((a, b) => a.numero_cuota - b.numero_cuota)
		.map((c) => aCuotaPagable(c, true));

	// La próxima por vencer: la pendiente más vieja que no esté ya entre las
	// vencidas (cartera puede listar la misma cuota en ambas).
	porCuota.clear();
	absorber(credito.cuotasPendientes);
	const yaVencidas = new Set(vencidas.map((c) => c.cuotaId));
	const proxima = [...porCuota.values()]
		.filter(
			(c) =>
				!yaVencidas.has(c.cuota_id) && !conPagoEnValidacion.has(c.cuota_id),
		)
		.sort((a, b) => a.numero_cuota - b.numero_cuota)[0];

	return proxima ? [...vencidas, aCuotaPagable(proxima, false)] : vencidas;
}

function aCuotaPagable(
	fila: CarteraCuotaCredito,
	vencida: boolean,
): CuotaPagable {
	return {
		cuotaId: fila.cuota_id,
		numeroCuota: fila.numero_cuota,
		fechaVencimiento: fila.fecha_vencimiento,
		vencida,
		capital: fila.capital_restante,
		interes: fila.interes_restante,
		iva: fila.iva_12_restante,
		seguro: fila.seguro_restante,
		gps: fila.gps_restante,
		membresias: fila.membresias_restante,
	};
}

/**
 * Las opciones (§4.1): un acumulado por cada `1…N` cuotas, con tope de
 * `MAXIMO_OPCIONES`. La mora entra completa en toda opción con atraso; al día
 * no hay mora que cobrar.
 *
 * Los montos son estrictamente crecientes (cada opción agrega una cuota con
 * saldo > 0), y por eso `/crear` puede identificar la opción solo por el monto.
 */
export function calcularOpciones(
	pagables: CuotaPagable[],
	moraActual: string | null | undefined,
): OpcionPagoLink[] {
	const atrasadas = pagables.filter((c) => c.vencida).length;
	const mora = atrasadas > 0 ? (moraActual ?? "0") : "0";
	const opciones: OpcionPagoLink[] = [];

	for (let k = 1; k <= Math.min(pagables.length, MAXIMO_OPCIONES); k++) {
		const seleccion = pagables.slice(0, k);
		let calculo: ReturnType<typeof buildPagaloAllocations>;
		try {
			calculo = buildPagaloAllocations({ installments: seleccion, mora });
		} catch {
			// "No hay saldo pagable": una cuota con todo en Q0 no suma opción.
			continue;
		}
		const moraC = centavos(mora);
		const totalC = centavos(calculo.totalAmount);
		opciones.push({
			cuotas: k,
			etiqueta: etiquetaOpcion(
				seleccion,
				atrasadas,
				moraC > 0n,
				calculo.totalAmount,
			),
			montoTotal: calculo.totalAmount,
			desglose: { cuotas: dinero(totalC - moraC), mora: dinero(moraC) },
			calculo,
		});
	}

	return opciones;
}

function etiquetaOpcion(
	seleccion: CuotaPagable[],
	atrasadas: number,
	conMora: boolean,
	total: string,
): string {
	const k = seleccion.length;
	const monto = quetzales(total);
	if (atrasadas === 0) {
		const proxima = seleccion[0];
		return `Cuota del ${fechaLegible(proxima?.fechaVencimiento ?? "")} — ${monto}`;
	}
	const sufijoMora = conMora ? " + mora" : "";
	if (k <= atrasadas) {
		return `${k === 1 ? "1 cuota" : `${k} cuotas`}${sufijoMora} — ${monto}`;
	}
	return `${atrasadas === 1 ? "1 cuota" : `${atrasadas} cuotas`} + la próxima${sufijoMora} — ${monto}`;
}

/** `"6179.26"`, `"6,179.26"`, `6179.26` → `"6179.26"`; basura → `null`. */
export function normalizarMonto(monto: unknown): string | null {
	const limpio = String(monto ?? "")
		.replace(/[Qq,\s]/g, "")
		.trim();
	if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
	return dinero(centavos(limpio));
}

export function buscarOpcionPorMonto(
	opciones: OpcionPagoLink[],
	monto: string,
): OpcionPagoLink | undefined {
	return opciones.find((o) => o.montoTotal === monto);
}

/** Lo que el bot muestra: el arreglo y, como en el paso 1, las opciones planas. */
export function aplanarOpciones(
	opciones: OpcionPagoLink[],
): Record<string, unknown> {
	const plano: Record<string, unknown> = { cantidadOpciones: opciones.length };
	opciones.forEach((o, i) => {
		plano[`opcion${i + 1}Etiqueta`] = o.etiqueta;
		plano[`opcion${i + 1}Monto`] = o.montoTotal;
	});
	return plano;
}

// ─────────────────────────────────────────────────────────────────────────────
// Servicio 1 · /pago-link/opciones
// ─────────────────────────────────────────────────────────────────────────────

export type LinkParaElBot = {
	tipo: PagaloLinkType;
	titulo: string;
	monto: string;
	url: string;
};

export type ResultadoOpciones =
	| {
			ok: true;
			data: {
				resumen: {
					alDia: boolean;
					cuotasAtrasadas: number;
					cuotaMensual: string;
					mora: string;
				};
				opciones: Array<Omit<OpcionPagoLink, "calculo">>;
				mensajes: { titulo: string; resumen: string; completo: string };
			} & Record<string, unknown>;
	  }
	| {
			ok: false;
			codigo: CodigoAcceso | CodigoBloqueo;
			datos?: Record<string, unknown>;
	  };

type CodigoAcceso =
	| "REFERENCIA_INVALIDA"
	| "SESION_VENCIDA"
	| "CREDITO_NO_ES_DEL_CLIENTE"
	| "CREDITO_SIN_DATOS"
	| "CARTERA_NO_DISPONIBLE";

type CodigoBloqueo =
	| "MORA_POR_CONFIRMAR"
	| "CREDITO_NO_PAGABLE_POR_LINK"
	| "SIN_CUOTAS_QUE_PAGAR"
	| "PAGO_EN_PROCESO"
	| "PAGO_PARCIAL_EN_CURSO";

type Contexto = {
	credito: CreditoDirectoResponse;
	statusCredito: string;
	moraPorConfirmar: boolean;
	cuotaMensual: string;
	pagables: CuotaPagable[];
	opciones: OpcionPagoLink[];
};

/**
 * Todo lo que comparten los dos servicios: acceso (D-24), estado del crédito,
 * mora confiable y las opciones — calculadas UNA sola vez por la misma función
 * (D-47). `getCredito` va sin caché: el monto que se cobra tiene que ser el de
 * este segundo, no el de hace 5 minutos.
 */
async function armarContexto(
	referencia: string,
	numeroSifco: string,
): Promise<
	| { ok: true; ctx: Contexto }
	| { ok: false; codigo: CodigoAcceso | CodigoBloqueo }
> {
	const acceso = await verificarAcceso(referencia, numeroSifco);
	if (!acceso.ok) return { ok: false, codigo: acceso.codigo };

	let resumen: Awaited<ReturnType<typeof carteraBackClient.getResumenCredito>>;
	let credito: CreditoDirectoResponse;
	try {
		[resumen, credito] = await Promise.all([
			carteraBackClient.getResumenCredito(numeroSifco),
			carteraBackClient.getCredito(numeroSifco, false),
		]);
	} catch (error) {
		console.error(
			`[BotCobros] pago-link: cartera no respondió para ${numeroSifco}:`,
			error instanceof Error ? error.message : error,
		);
		return { ok: false, codigo: "CARTERA_NO_DISPONIBLE" };
	}
	if (!resumen || !credito?.credito)
		return { ok: false, codigo: "CREDITO_SIN_DATOS" };

	if (!ESTADOS_PAGABLES.has(resumen.status_credito)) {
		return { ok: false, codigo: "CREDITO_NO_PAGABLE_POR_LINK" };
	}

	const pagables = cuotasPagables(credito);
	const hayAtraso = pagables.some((c) => c.vencida);
	// Sin mora confiable no se genera link: antes cobrarle de más (o de menos)
	// se le manda con su asesor. Solo aplica si hay atraso — al día no hay mora.
	if (hayAtraso && resumen.mora_por_confirmar) {
		return { ok: false, codigo: "MORA_POR_CONFIRMAR" };
	}

	const opciones = calcularOpciones(pagables, credito.moraActual);
	if (opciones.length === 0)
		return { ok: false, codigo: "SIN_CUOTAS_QUE_PAGAR" };

	return {
		ok: true,
		ctx: {
			credito,
			statusCredito: resumen.status_credito,
			moraPorConfirmar: resumen.mora_por_confirmar,
			cuotaMensual: resumen.cuota_mensual,
			pagables,
			opciones,
		},
	};
}

type GrupoActivo = typeof pagaloPaymentGroups.$inferSelect & {
	links: Array<typeof pagaloPaymentLinks.$inferSelect>;
};

/** El único grupo fuera de COMPLETED/CANCELLED del crédito (índice único 0047). */
async function grupoActivoDelCredito(
	carteraCreditoId: number,
): Promise<GrupoActivo | null> {
	const [grupo] = await db
		.select()
		.from(pagaloPaymentGroups)
		.where(
			and(
				eq(pagaloPaymentGroups.carteraCreditoId, carteraCreditoId),
				notInArray(pagaloPaymentGroups.status, ["COMPLETED", "CANCELLED"]),
			),
		)
		.limit(1);
	if (!grupo) return null;
	const links = await db
		.select()
		.from(pagaloPaymentLinks)
		.where(eq(pagaloPaymentLinks.groupId, grupo.id))
		.orderBy(pagaloPaymentLinks.generation, pagaloPaymentLinks.linkType);
	return { ...grupo, links };
}

function linksVivos(grupo: GrupoActivo) {
	return grupo.links.filter((l) => l.status === "ACTIVE" && l.paymentUrl);
}

function titulosDe(cantidad: number): (indice: number) => string {
	return (i) => (cantidad === 1 ? "Pago" : `Pago ${i + 1} de ${cantidad}`);
}

function linksParaElBot(
	grupo: GrupoActivo,
	soloPendientes = false,
): LinkParaElBot[] {
	const vivos = linksVivos(grupo);
	const total = grupo.links.filter(
		(l) => l.status === "ACTIVE" || l.status === "PAID",
	).length;
	const titulo = titulosDe(total);
	const orden: PagaloLinkType[] = ["CAPITAL", "MORA_INTERES"];
	return orden.flatMap((tipo) => {
		const posicion = grupo.links
			.filter((l) => l.status === "ACTIVE" || l.status === "PAID")
			.sort((a, b) => orden.indexOf(a.linkType) - orden.indexOf(b.linkType))
			.findIndex((l) => l.linkType === tipo);
		const link = vivos.find((l) => l.linkType === tipo);
		if (!link || posicion < 0) return [];
		if (soloPendientes && link.status !== "ACTIVE") return [];
		return [
			{
				tipo,
				titulo: titulo(posicion),
				monto: tipo === "CAPITAL" ? grupo.capitalTotal : grupo.facturableTotal,
				url: link.paymentUrl as string,
			},
		];
	});
}

/**
 * Qué hacer con el grupo activo del crédito, si lo hay.
 *   · post-pago (cualquier origen)      → PAGO_EN_PROCESO
 *   · del asesor, con links vivos/dinero → PAGO_EN_PROCESO (no se pisa su intención)
 *   · del bot, PARTIALLY_PAID            → el link pendiente (jamás se regenera)
 *   · del bot, esperando pago            → reusable / reemplazable
 */
type Veredicto =
	| { tipo: "libre" }
	| {
			tipo: "en_proceso";
			motivo: "post_pago" | "revision" | "asesor" | "creando";
	  }
	| { tipo: "parcial"; grupo: GrupoActivo; pendiente: LinkParaElBot[] }
	| { tipo: "reusable"; grupo: GrupoActivo };

function evaluarGrupo(grupo: GrupoActivo | null): Veredicto {
	if (!grupo) return { tipo: "libre" };
	if (grupo.status === "REVIEW_REQUIRED")
		return { tipo: "en_proceso", motivo: "revision" };
	if (ESTADOS_POST_PAGO.includes(grupo.status))
		return { tipo: "en_proceso", motivo: "post_pago" };
	if (grupo.origen !== "BOT") return { tipo: "en_proceso", motivo: "asesor" };
	if (grupo.status === "PARTIALLY_PAID") {
		return { tipo: "parcial", grupo, pendiente: linksParaElBot(grupo, true) };
	}
	// LINKS_PENDING = otro /crear está en medio de las llamadas a Págalo
	// (hallazgo de Codex): reemplazarlo dejaría links cobrables colgados de un
	// grupo cancelado. Solo se considera huérfano —y reemplazable— si lleva
	// más de LINKS_PENDING_HUERFANO_MS sin avanzar (el proceso murió a mitad).
	if (
		grupo.status === "LINKS_PENDING" &&
		Date.now() - grupo.updatedAt.getTime() < LINKS_PENDING_HUERFANO_MS
	) {
		return { tipo: "en_proceso", motivo: "creando" };
	}
	return { tipo: "reusable", grupo };
}

/** Un /crear tarda segundos; pasado esto, un LINKS_PENDING es un proceso muerto. */
const LINKS_PENDING_HUERFANO_MS = 5 * 60 * 1000;

function mensajeEnProceso(
	motivo: "post_pago" | "revision" | "asesor" | "creando",
): string {
	switch (motivo) {
		case "revision":
			return "Tu último pago con link quedó en revisión. Tu asesor te va a ayudar a completarlo.";
		case "asesor":
			return "Ya tenés un pago por link en curso con tu asesor. Pagá ese o consultale a él antes de generar otro.";
		case "creando":
			return "Estamos generando tus links de pago. Intentá de nuevo en un momento.";
		default:
			return "Tu pago se está aplicando. En cuanto se confirme te mandamos tu recibo por acá.";
	}
}

function mensajeParcial(grupo: GrupoActivo, pendiente: LinkParaElBot[]) {
	const pagado = grupo.links.find((l) => l.status === "PAID");
	const total = grupo.links.filter(
		(l) => l.status === "ACTIVE" || l.status === "PAID",
	).length;
	const titulo = titulosDe(total);
	const ordenados = grupo.links
		.filter((l) => l.status === "ACTIVE" || l.status === "PAID")
		.sort(
			(a, b) =>
				(a.linkType === "CAPITAL" ? -1 : 1) -
				(b.linkType === "CAPITAL" ? -1 : 1),
		);
	const tituloPagado = pagado
		? titulo(ordenados.findIndex((l) => l.id === pagado.id))
		: "un pago";
	const falta = pendiente[0];
	const resumen = falta
		? `Ya recibimos tu ${tituloPagado}. Te falta el ${falta.titulo} por ${quetzales(falta.monto)}.`
		: `Ya recibimos tu ${tituloPagado}. Estamos confirmando el resto.`;
	const completo = falta
		? `💳 *Te falta un pago*\n\nYa recibimos tu *${tituloPagado}*. Para completar tu pago pagá el *${falta.titulo}* por ${quetzales(falta.monto)}:\n\n${falta.url}\n\nTe avisamos en cuanto se confirme.`
		: `💳 *Te falta un pago*\n\n${resumen}`;
	return {
		mensaje: resumen,
		datos: {
			pago: { referenciaPago: grupo.id, montoTotal: grupo.totalAmount },
			linkPendiente: falta ?? null,
			mensajes: { titulo: "💳 Te falta un pago", completo },
		},
	};
}

export async function obtenerOpcionesPagoLink(
	referencia: string,
	numeroSifco: string,
): Promise<ResultadoOpciones> {
	const contexto = await armarContexto(referencia, numeroSifco);
	if (!contexto.ok) return contexto;
	const { ctx } = contexto;

	const veredicto = evaluarGrupo(
		await grupoActivoDelCredito(ctx.credito.credito.credito_id),
	);
	if (veredicto.tipo === "en_proceso") {
		return {
			ok: false,
			codigo: "PAGO_EN_PROCESO",
			datos: { mensaje: mensajeEnProceso(veredicto.motivo) },
		};
	}
	if (veredicto.tipo === "parcial") {
		const { mensaje, datos } = mensajeParcial(
			veredicto.grupo,
			veredicto.pendiente,
		);
		return {
			ok: false,
			codigo: "PAGO_PARCIAL_EN_CURSO",
			datos: { mensaje, ...datos },
		};
	}

	const atrasadas = ctx.pagables.filter((c) => c.vencida).length;
	const mora =
		atrasadas > 0 ? dinero(centavos(ctx.credito.moraActual)) : "0.00";
	const alDia = atrasadas === 0;
	const opciones = ctx.opciones.map(({ calculo: _c, ...o }) => o);

	const resumenTexto = alDia
		? `Estás al día. Tu próxima cuota vence el ${fechaLegible(ctx.pagables[0]?.fechaVencimiento ?? "")}: ${quetzales(opciones[0]?.montoTotal ?? "0")}.`
		: `Tenés ${atrasadas === 1 ? "1 cuota atrasada" : `${atrasadas} cuotas atrasadas`}${centavos(mora) > 0n ? ` y ${quetzales(mora)} de mora` : ""}. Elegí cuántas cuotas querés pagar:`;
	const completo = alDia
		? `💳 *Pago con link*\n\nEstás al día 🎉\n\nTu próxima cuota vence el ${fechaLegible(ctx.pagables[0]?.fechaVencimiento ?? "")} y es de ${quetzales(opciones[0]?.montoTotal ?? "0")}. ¿La pagás con link?`
		: `💳 *Pago con link*\n\n${resumenTexto.replace(" Elegí cuántas cuotas querés pagar:", "")}\n\nElegí cuántas cuotas querés pagar.${centavos(mora) > 0n ? " La mora va incluida en todas las opciones." : ""}`;

	return {
		ok: true,
		data: {
			resumen: {
				alDia,
				cuotasAtrasadas: atrasadas,
				cuotaMensual: ctx.cuotaMensual,
				mora,
			},
			opciones,
			...aplanarOpciones(ctx.opciones),
			mensajes: { titulo: "💳 Pago con link", resumen: resumenTexto, completo },
		},
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// Servicio 2 · /pago-link/crear
// ─────────────────────────────────────────────────────────────────────────────

export type ResultadoCrear =
	| {
			ok: true;
			data: {
				pago: { referenciaPago: string; montoTotal: string; expira: null };
				links: LinkParaElBot[];
				mensajes: { titulo: string; completo: string };
			};
	  }
	| {
			ok: false;
			codigo:
				| CodigoAcceso
				| CodigoBloqueo
				| "MONTO_DESACTUALIZADO"
				| "PAGALO_NO_DISPONIBLE";
			datos?: Record<string, unknown>;
	  };

function respuestaConLinks(
	grupoId: string,
	montoTotal: string,
	links: LinkParaElBot[],
) {
	const lineas = links
		.map((l) => `*${l.titulo}* — ${quetzales(l.monto)}\n${l.url}`)
		.join("\n\n");
	const completo =
		links.length === 1
			? `💳 *Tu link de pago*\n\nPagá ${quetzales(montoTotal)} acá:\n${links[0]?.url}\n\nEn cuanto se confirme te mandamos tu recibo por acá. No necesitás avisarnos.`
			: `💳 *Tus links de pago*\n\nTu pago de ${quetzales(montoTotal)} se divide en ${links.length} partes. Pagá *todas*, en el orden que querás:\n\n${lineas}\n\nEn cuanto se confirmen te mandamos tu recibo por acá. No necesitás avisarnos.`;
	return {
		ok: true as const,
		data: {
			pago: { referenciaPago: grupoId, montoTotal, expira: null },
			links,
			mensajes: {
				titulo:
					links.length === 1 ? "💳 Tu link de pago" : "💳 Tus links de pago",
				completo,
			},
		},
	};
}

const mismaSeleccion = (a: unknown, b: PagaloAllocation[]) =>
	JSON.stringify(a) === JSON.stringify(b);

/** El grupo que íbamos a reemplazar cambió debajo nuestro (entró un pago). */
class ReemplazoInvalido extends Error {}

export async function crearPagoLink(
	referencia: string,
	numeroSifco: string,
	montoCrudo: unknown,
): Promise<ResultadoCrear> {
	const monto = normalizarMonto(montoCrudo);
	if (!monto) return { ok: false, codigo: "MONTO_DESACTUALIZADO" };

	const contexto = await armarContexto(referencia, numeroSifco);
	if (!contexto.ok) return contexto;
	const { ctx } = contexto;
	const carteraCreditoId = ctx.credito.credito.credito_id;

	const veredicto = evaluarGrupo(await grupoActivoDelCredito(carteraCreditoId));
	if (veredicto.tipo === "en_proceso") {
		return {
			ok: false,
			codigo: "PAGO_EN_PROCESO",
			datos: { mensaje: mensajeEnProceso(veredicto.motivo) },
		};
	}
	// Un grupo con dinero adentro jamás se regenera: se responde lo que falta,
	// ignorando la selección (la deriva de mora la absorbe D-52 al aplicar).
	if (veredicto.tipo === "parcial") {
		return respuestaConLinks(
			veredicto.grupo.id,
			veredicto.grupo.totalAmount,
			veredicto.pendiente,
		);
	}

	const opcion = buscarOpcionPorMonto(ctx.opciones, monto);
	if (!opcion) return { ok: false, codigo: "MONTO_DESACTUALIZADO" };

	// Mismo desglose que el grupo vivo del bot (snapshot completo, no el total):
	// los mismos links. Con desglose distinto, grupo NUEVO y el viejo cancelado.
	if (veredicto.tipo === "reusable") {
		const vivos = linksVivos(veredicto.grupo);
		const requeridos = [
			opcion.calculo.capitalTotal,
			opcion.calculo.facturableTotal,
		].filter((m) => m !== "0.00").length;
		if (
			veredicto.grupo.status === "PENDING_PAYMENT" &&
			vivos.length === requeridos &&
			mismaSeleccion(
				veredicto.grupo.allocationsSnapshot,
				opcion.calculo.allocations,
			)
		) {
			return respuestaConLinks(
				veredicto.grupo.id,
				veredicto.grupo.totalAmount,
				linksParaElBot(veredicto.grupo),
			);
		}
	}

	const usuarioSistema = await resolverUsuarioSistemaCobros();
	if (!usuarioSistema) {
		console.error(
			"[BotCobros] pago-link: no hay usuario sistema para created_by.",
		);
		return { ok: false, codigo: "PAGALO_NO_DISPONIBLE" };
	}

	let config: ReturnType<typeof getPagaloSandboxConfig>;
	try {
		config = getPagaloSandboxConfig();
	} catch (error) {
		console.error(
			"[BotCobros] pago-link: Págalo sin configurar:",
			error instanceof Error ? error.message : error,
		);
		return { ok: false, codigo: "PAGALO_NO_DISPONIBLE" };
	}

	const [caso] = await db
		.select({ id: casosCobros.id })
		.from(casosCobros)
		.where(eq(casosCobros.numeroCreditoSifco, numeroSifco))
		.limit(1);

	// Reemplazo + creación en UNA transacción: el índice único parcial
	// (0047) arbitra dos /crear concurrentes — el perdedor falla el INSERT.
	let grupoId: string;
	try {
		grupoId = await db.transaction(async (tx) => {
			if (veredicto.tipo === "reusable") {
				const viejo = veredicto.grupo;
				// Serializado contra el poller (hallazgo de Codex): candado del
				// GRUPO primero y luego de sus links —mismo orden que
				// marcarLinkPagado— y se decide con el estado FRESCO. Si mientras
				// el cliente elegía ya pagó uno de los links, este grupo ya no se
				// reemplaza: tiene dinero adentro.
				const [grupoFresco] = await tx
					.select({ status: pagaloPaymentGroups.status })
					.from(pagaloPaymentGroups)
					.where(eq(pagaloPaymentGroups.id, viejo.id))
					.for("update");
				if (
					!grupoFresco ||
					(grupoFresco.status !== "PENDING_PAYMENT" &&
						grupoFresco.status !== "LINKS_PENDING")
				) {
					throw new ReemplazoInvalido();
				}
				const linksFrescos = await tx
					.select({ status: pagaloPaymentLinks.status })
					.from(pagaloPaymentLinks)
					.where(eq(pagaloPaymentLinks.groupId, viejo.id))
					.for("update");
				if (linksFrescos.some((l) => l.status === "PAID")) {
					throw new ReemplazoInvalido();
				}
				await tx
					.update(pagaloPaymentLinks)
					.set({ status: "REPLACED", updatedAt: new Date() })
					.where(
						and(
							eq(pagaloPaymentLinks.groupId, viejo.id),
							inArray(pagaloPaymentLinks.status, ["CREATING", "ACTIVE"]),
						),
					);
				await tx
					.update(pagaloPaymentGroups)
					.set({
						status: "CANCELLED",
						cancelledAt: new Date(),
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(pagaloPaymentGroups.id, viejo.id),
							inArray(pagaloPaymentGroups.status, [
								"PENDING_PAYMENT",
								"LINKS_PENDING",
							]),
						),
					);
				await tx.insert(pagaloPaymentEvents).values({
					groupId: viejo.id,
					eventType: "GROUP_REPLACED",
					source: "BOT",
					actorUserId: usuarioSistema,
					fromStatus: viejo.status,
					toStatus: "CANCELLED",
					payload: {
						motivo: "seleccion_distinta",
						montoNuevo: opcion.montoTotal,
					},
				});
			}
			const [creado] = await tx
				.insert(pagaloPaymentGroups)
				.values({
					casoCobroId: caso?.id ?? null,
					numeroCreditoSifco: numeroSifco,
					carteraCreditoId,
					pagaloEnvironment: "STAGING",
					origen: "BOT",
					carteraAsesorId: ctx.credito.credito.asesor_id ?? null,
					capitalTotal: opcion.calculo.capitalTotal,
					facturableTotal: opcion.calculo.facturableTotal,
					totalAmount: opcion.calculo.totalAmount,
					allocationsSnapshot: opcion.calculo.allocations,
					status: "LINKS_PENDING",
					expirationEnabled: false,
					expirationHours: null,
					createdBy: usuarioSistema,
				})
				.returning({ id: pagaloPaymentGroups.id });
			if (!creado) throw new Error("No se pudo crear el grupo Págalo.");
			await tx.insert(pagaloPaymentEvents).values({
				groupId: creado.id,
				eventType: "GROUP_CREATED",
				source: "BOT",
				actorUserId: usuarioSistema,
				toStatus: "LINKS_PENDING",
				payload: {
					cuotas: opcion.cuotas,
					capitalTotal: opcion.calculo.capitalTotal,
					facturableTotal: opcion.calculo.facturableTotal,
				},
			});
			return creado.id;
		});
	} catch (error) {
		// Perdimos la carrera: otro /crear ya dejó un grupo, o el poller anotó
		// un pago en el que íbamos a reemplazar. Se relee y se responde lo que
		// corresponda al estado real (los mismos links, el pendiente, o el
		// candado).
		if (error instanceof ReemplazoInvalido || esViolacionDeUnicidad(error)) {
			const ganador = evaluarGrupo(
				await grupoActivoDelCredito(carteraCreditoId),
			);
			if (ganador.tipo === "reusable" && linksVivos(ganador.grupo).length > 0) {
				return respuestaConLinks(
					ganador.grupo.id,
					ganador.grupo.totalAmount,
					linksParaElBot(ganador.grupo),
				);
			}
			if (ganador.tipo === "parcial") {
				return respuestaConLinks(
					ganador.grupo.id,
					ganador.grupo.totalAmount,
					ganador.pendiente,
				);
			}
			return {
				ok: false,
				codigo: "PAGO_EN_PROCESO",
				datos: { mensaje: mensajeEnProceso("post_pago") },
			};
		}
		throw error;
	}

	// Emisión en Págalo, fuera de la transacción (red). Si falla cualquiera,
	// NO queda intención a medias: grupo CANCELLED y lo ya creado REPLACED
	// (sigue cobrable afuera y el poller lo sigue mirando — D-51).
	const componentes = (
		[
			["CAPITAL", opcion.calculo.capitalTotal],
			["MORA_INTERES", opcion.calculo.facturableTotal],
		] as const
	).filter(([, monto]) => monto !== "0.00");
	const titulo = titulosDe(componentes.length);
	const cliente = createPagaloClient(config);
	const nombre = (ctx.credito.usuario?.nombre ?? "").trim();
	const links: LinkParaElBot[] = [];
	const creados: string[] = [];

	for (const [i, [tipo, montoLink]] of componentes.entries()) {
		const providerAmount = toPagaloProviderAmount(montoLink);
		const externalIdentifier = `pagalo-${grupoId}-${tipo}-${randomUUID().slice(0, 8)}`;
		// Descripción y producto NEUTROS (D-48): el cliente no ve "mora" ni
		// "intereses" en la pantalla de pago — se asusta y no paga.
		const tituloLink = titulo(i);
		const requestPayload = {
			total_amount: providerAmount,
			currency: "GTQ" as const,
			description: `Crédito ${numeroSifco} · ${tituloLink}`,
			external_identifier: externalIdentifier,
			type_request: "SP" as const,
			n_quotas: false,
			expiration: false as const,
			client: {
				first_name: nombre.split(" ")[0] || "Cliente",
				last_name: nombre.split(" ").slice(1).join(" ") || "Club Cash In",
			},
			products: [
				{
					product_uuid: 0,
					name: tituloLink,
					product_name: tituloLink,
					amount: providerAmount,
					quantity: 1,
					subtotal: providerAmount,
				},
			],
		};
		const [fila] = await db
			.insert(pagaloPaymentLinks)
			.values({
				groupId: grupoId,
				linkType: tipo,
				externalIdentifier,
				apiBaseUrl: config.baseUrl,
				status: "CREATING",
				requestPayload,
				requestedBy: usuarioSistema,
			})
			.returning({ id: pagaloPaymentLinks.id });
		if (!fila) {
			await abortarGrupo(grupoId, creados, usuarioSistema, "sin_fila_de_link");
			return { ok: false, codigo: "PAGALO_NO_DISPONIBLE" };
		}
		try {
			const respuesta = await cliente.createPaymentRequest(requestPayload);
			const url = extraerTexto(respuesta, [
				"payment_url",
				"paymenturl",
				"url",
				"link",
			]);
			const uuid = extraerTexto(respuesta, ["uuid", "request_uuid"]);
			const uuidCorto = extraerTexto(respuesta, ["uuid_short", "short_uuid"]);
			if (!url || !uuid)
				throw new Error("Págalo no devolvió URL y UUID del link.");
			await db.transaction(async (tx) => {
				await tx
					.update(pagaloPaymentLinks)
					.set({
						status: "ACTIVE",
						paymentUrl: url,
						pagaloRequestUuid: uuid,
						pagaloShortUuid: uuidCorto ?? null,
						responsePayload: respuesta as object,
						activatedAt: new Date(),
						nextPollAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(pagaloPaymentLinks.id, fila.id));
				await tx.insert(pagaloPaymentEvents).values({
					groupId: grupoId,
					linkId: fila.id,
					eventType: "LINK_ACTIVE",
					source: "PAGALO",
					actorUserId: usuarioSistema,
					fromStatus: "CREATING",
					toStatus: "ACTIVE",
					payload: { linkType: tipo, titulo: tituloLink },
				});
			});
			creados.push(fila.id);
			links.push({ tipo, titulo: tituloLink, monto: montoLink, url });
		} catch (error) {
			const detalle =
				error instanceof PagaloClientError
					? `${error.code}${error.status ? ` HTTP ${error.status}` : ""}`
					: error instanceof Error
						? error.message
						: String(error);
			console.error(
				`[BotCobros] pago-link: Págalo falló creando ${tipo} del grupo ${grupoId}: ${detalle}`,
			);
			await db
				.update(pagaloPaymentLinks)
				.set({
					status: "ERROR",
					errorCode:
						error instanceof PagaloClientError ? error.code : "PAGALO_ERROR",
					errorMessage: detalle,
					httpStatus:
						error instanceof PagaloClientError ? (error.status ?? null) : null,
					updatedAt: new Date(),
				})
				.where(eq(pagaloPaymentLinks.id, fila.id));
			await abortarGrupo(grupoId, creados, usuarioSistema, detalle);
			return { ok: false, codigo: "PAGALO_NO_DISPONIBLE" };
		}
	}

	await db
		.update(pagaloPaymentGroups)
		.set({ status: "PENDING_PAYMENT", updatedAt: new Date() })
		.where(eq(pagaloPaymentGroups.id, grupoId));

	return respuestaConLinks(grupoId, opcion.calculo.totalAmount, links);
}

/** Págalo falló a medias: nada cobrable queda atado a un grupo vivo. */
async function abortarGrupo(
	grupoId: string,
	linksCreados: string[],
	actor: string,
	motivo: string,
) {
	await db.transaction(async (tx) => {
		if (linksCreados.length > 0) {
			await tx
				.update(pagaloPaymentLinks)
				.set({ status: "REPLACED", updatedAt: new Date() })
				.where(inArray(pagaloPaymentLinks.id, linksCreados));
		}
		await tx
			.update(pagaloPaymentGroups)
			.set({
				status: "CANCELLED",
				cancelledAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(pagaloPaymentGroups.id, grupoId));
		await tx.insert(pagaloPaymentEvents).values({
			groupId: grupoId,
			eventType: "GROUP_ABORTED",
			source: "BOT",
			actorUserId: actor,
			fromStatus: "LINKS_PENDING",
			toStatus: "CANCELLED",
			payload: {
				motivo: motivo.slice(0, 200),
				linksReemplazados: linksCreados.length,
			},
		});
	});
}

function esViolacionDeUnicidad(error: unknown): boolean {
	const buscar = (e: unknown): boolean => {
		if (!e || typeof e !== "object") return false;
		const code = (e as { code?: unknown }).code;
		if (code === "23505") return true;
		return buscar((e as { cause?: unknown }).cause);
	};
	return buscar(error);
}

function extraerTexto(valor: unknown, nombres: string[]): string | undefined {
	if (!valor || typeof valor !== "object") return undefined;
	for (const [clave, hijo] of Object.entries(
		valor as Record<string, unknown>,
	)) {
		if (
			nombres.includes(clave.toLowerCase()) &&
			typeof hijo === "string" &&
			hijo
		)
			return hijo;
		const anidado = extraerTexto(hijo, nombres);
		if (anidado) return anidado;
	}
	return undefined;
}
