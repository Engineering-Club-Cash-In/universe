/**
 * Recordatorios Premora (CC2-11) — D-5, D-3, D-1 y D-0.
 *
 * Job diario que evita mora POR OLVIDO en créditos AL DÍA (B0): pregunta a
 * cartera-back qué cuotas pendientes vencen en exactamente 5/3/1/0 días y
 * envía el WhatsApp correspondiente reutilizando la MISMA infraestructura del
 * resto de cobros (plantillas del server, `sendWhatsappTemplate`, test-mode y
 * `cobros_send_logs`).
 *
 * Garantías:
 *  - Idempotente: `recordatorios_premora` con UNIQUE (cuota, tipo) — cada
 *    cuota recibe como máximo UN recordatorio de cada tipo. El insert se hace
 *    como CLAIM *antes* de enviar (si otra corrida concurrente ya reclamó,
 *    no se envía); si el envío falla, el claim se libera y la próxima
 *    corrida reintenta.
 *  - Historial de contacto: cada envío queda registrado en `contactos_cobros`
 *    (el histórico que ya usa el CRM) cuando el crédito tiene caso; si no hay
 *    caso, la traza queda igual en `cobros_send_logs` + `recordatorios_premora`.
 *  - D-0: además del mensaje, notifica al responsable del caso (si existe) y
 *    manda un resumen a los supervisores de cobros para la agenda del día.
 *  - Nunca lanza al caller: devuelve un resumen y loguea (patrón bienvenida).
 */

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import { notifications } from "../db/schema/notifications";
import { recordatoriosPremora } from "../db/schema/recordatorios-premora";
import {
	interpolar,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
} from "../lib/cobros-plantillas";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { sendWhatsappTemplate } from "../lib/simpletech";
import type { CarteraCuotaProximaVencer } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[Premora]";

type TipoPremora = "premora_5" | "premora_3" | "premora_1" | "premora_0";

/** Días exactos para vencer → plantilla premora. */
const TIPO_POR_DIAS: Record<number, TipoPremora> = {
	5: "premora_5",
	3: "premora_3",
	1: "premora_1",
	0: "premora_0",
};

export interface PremoraRunOptions {
	/**
	 * Corrida MANUAL (endpoint /api/premora/run): ignora el gate de env
	 * PREMORA_WHATSAPP_ENABLED. Todo lo demás aplica igual (test-mode,
	 * claims, historial).
	 */
	force?: boolean;
	/** Limita el batch a estos créditos (pruebas quirúrgicas). */
	sifcos?: string[];
	/** Corre solo estos días (subconjunto de 5/3/1/0); vacío = todos. */
	dias?: number[];
	/** Override de PREMORA_BUCKETS para esta corrida (0-5). */
	buckets?: number[];
}

/**
 * Buckets del funnel a los que se les manda recordatorio, desde
 * PREMORA_BUCKETS (CSV 0-5, default "0" = solo créditos al día). Encender
 * B1-B4 = poner PREMORA_BUCKETS=0,1,2,3,4 en el env — sin deploy de código.
 * B5 (jurídico) queda fuera simplemente no incluyéndolo. Valor inválido →
 * warn y fallback a [0] (jamás mandar de más por un typo).
 */
function bucketsDesdeEnv(): number[] {
	const raw = process.env.PREMORA_BUCKETS?.trim();
	if (!raw) return [0];
	const tokens = raw.split(",").map((s) => s.trim());
	if (tokens.some((s) => !/^[0-5]$/.test(s))) {
		console.warn(
			`${LOG_PREFIX} PREMORA_BUCKETS inválido ("${raw}"); fallback a "0"`,
		);
		return [0];
	}
	return [...new Set(tokens.map(Number))].sort((a, b) => a - b);
}

export interface PremoraResumen {
	skipped?: boolean;
	reason?: string;
	cuotas: number;
	enviados: number;
	yaEnviados: number;
	sinTelefono: number;
	sinTelefonoAsesor: number;
	fallidos: number;
	contactosRegistrados: number;
	notificacionesD0: number;
}

const resumenVacio = (extra?: Partial<PremoraResumen>): PremoraResumen => ({
	cuotas: 0,
	enviados: 0,
	yaEnviados: 0,
	sinTelefono: 0,
	sinTelefonoAsesor: 0,
	fallidos: 0,
	contactosRegistrados: 0,
	notificacionesD0: 0,
	...extra,
});

/** "YYYY-MM-DD" → "dd/mm/aaaa" (formato del cliente en la plantilla). */
const fechaLegible = (iso: string) => {
	const [y, m, d] = String(iso ?? "").split("-");
	return y && m && d ? `${d}/${m}/${y}` : String(iso ?? "");
};

const montoLegible = (v: string) => {
	const n = Number(v);
	return Number.isFinite(n)
		? n.toLocaleString("es-GT", {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			})
		: String(v ?? "");
};

/**
 * Usuario "sistema" para los FKs de auditoría (send-log, contacto,
 * notificación): PREMORA_SYSTEM_USER_ID si está seteado, si no el primer
 * admin activo. El job es automático — no hay un humano detrás del envío.
 */
async function resolverUsuarioSistema(): Promise<string | null> {
	const fromEnv = process.env.PREMORA_SYSTEM_USER_ID?.trim();
	if (fromEnv) return fromEnv;
	const [admin] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "admin"))
		.limit(1);
	return admin?.id ?? null;
}

export async function sendPremoraReminders(
	opts: PremoraRunOptions = {},
): Promise<PremoraResumen> {
	try {
		// 0. Habilitado por env (mismo patrón que la bienvenida).
		if (!opts.force && process.env.PREMORA_WHATSAPP_ENABLED !== "true") {
			console.log(
				`${LOG_PREFIX} PREMORA_WHATSAPP_ENABLED != "true"; job omitido`,
			);
			return resumenVacio({ skipped: true, reason: "deshabilitado" });
		}
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return resumenVacio({ skipped: true, reason: "cartera_back_disabled" });
		}

		// 1. Cuotas próximas a vencer desde cartera-back. Con PREMORA_BUCKETS=0
		// (default) va la consulta clásica: solo créditos al día en tiempo real.
		// Con buckets extra va el funnel filtrado por bucket MOTOR — y cada
		// cuota decide su plantilla (normal vs _mora) según su bucket.
		const diasQuery = opts.dias?.length ? opts.dias : [5, 3, 1, 0];
		const bucketsActivos = opts.buckets?.length
			? [...new Set(opts.buckets)].sort((a, b) => a - b)
			: bucketsDesdeEnv();
		const soloB0 = bucketsActivos.length === 1 && bucketsActivos[0] === 0;
		console.log(
			`${LOG_PREFIX} Buckets activos: ${bucketsActivos.map((b) => `B${b}`).join(", ")}`,
		);
		const respuesta = soloB0
			? await carteraBackClient.getCuotasProximasVencer(diasQuery)
			: await carteraBackClient.getCuotasProximasVencer(diasQuery, {
					soloAlDia: false,
					buckets: bucketsActivos,
				});
		let cuotas = respuesta.data ?? [];
		if (opts.sifcos?.length) {
			const filtro = new Set(opts.sifcos);
			cuotas = cuotas.filter((c) => filtro.has(c.numero_credito_sifco));
			console.log(
				`${LOG_PREFIX} Filtro manual por SIFCO (${opts.sifcos.join(", ")}): ${cuotas.length} cuota(s)`,
			);
		}
		console.log(
			`${LOG_PREFIX} ${cuotas.length} cuota(s) próximas a vencer (D-5/D-3/D-1/D-0)`,
		);
		if (cuotas.length === 0) return resumenVacio();

		const resumen = resumenVacio({ cuotas: cuotas.length });

		// 2. Batch: ya enviados (idempotencia), casos y teléfonos del CRM.
		const cuotaIds = [...new Set(cuotas.map((c) => c.cuota_id))];
		const sifcos = [...new Set(cuotas.map((c) => c.numero_credito_sifco))];

		const enviadosPrevios = await db
			.select({
				cuotaId: recordatoriosPremora.cuotaId,
				tipo: recordatoriosPremora.tipo,
			})
			.from(recordatoriosPremora)
			.where(inArray(recordatoriosPremora.cuotaId, cuotaIds));
		const enviadoSet = new Set(
			enviadosPrevios.map((e) => `${e.cuotaId}:${e.tipo}`),
		);

		// Casos de cobros TAMBIÉN inactivos (review Codex): el sync cierra los
		// casos curados con activo=false, y premora apunta justo a créditos al
		// día (los curados). El caso —aunque cerrado— trae el teléfono
		// corregido por el asesor y es el ancla del historial de contacto y de
		// la notificación D-0. Con varios por SIFCO gana el activo; a igualdad,
		// el más reciente.
		const casos = await db
			.select({
				id: casosCobros.id,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				telefonoPrincipal: casosCobros.telefonoPrincipal,
				responsable: casosCobros.responsableCobros,
				activo: casosCobros.activo,
				updatedAt: casosCobros.updatedAt,
			})
			.from(casosCobros)
			.where(inArray(casosCobros.numeroCreditoSifco, sifcos));
		const casoPorSifco = new Map<string, (typeof casos)[number]>();
		for (const caso of casos) {
			const sifco = caso.numeroCreditoSifco ?? "";
			const previo = casoPorSifco.get(sifco);
			const gana =
				!previo ||
				(Boolean(caso.activo) && !previo.activo) ||
				(Boolean(caso.activo) === Boolean(previo.activo) &&
					(caso.updatedAt?.getTime() ?? 0) >
						(previo.updatedAt?.getTime() ?? 0));
			if (gana) casoPorSifco.set(sifco, caso);
		}

		const oportunidades = await db
			.select({
				numeroSifco: opportunities.numeroSifco,
				leadPhone: leads.phone,
			})
			.from(opportunities)
			.leftJoin(leads, eq(opportunities.leadId, leads.id))
			.where(inArray(opportunities.numeroSifco, sifcos));
		const leadPhonePorSifco = new Map(
			oportunidades.map((o) => [o.numeroSifco ?? "", o.leadPhone]),
		);

		// Teléfono del cliente: caso de cobros → lead del CRM → cartera.
		const resolverTelefono = (c: CarteraCuotaProximaVencer): string | null =>
			primerTelefono(
				casoPorSifco.get(c.numero_credito_sifco)?.telefonoPrincipal,
			) ??
			primerTelefono(leadPhonePorSifco.get(c.numero_credito_sifco)) ??
			primerTelefono(c.telefono_cliente_cartera);

		const usuarioSistema = await resolverUsuarioSistema();
		if (!usuarioSistema) {
			// Sin usuario para los FKs de auditoría no podemos dejar traza — mejor
			// no enviar nada que enviar sin registro (requisito explícito).
			console.error(
				`${LOG_PREFIX} Sin usuario sistema (PREMORA_SYSTEM_USER_ID o admin); job omitido`,
			);
			return resumenVacio({
				skipped: true,
				reason: "sin_usuario_sistema",
				cuotas: cuotas.length,
			});
		}

		const testMode = isTestModeEnabled();

		// 3. Envío secuencial (volúmenes chicos; mismo criterio que el masivo).
		for (const cuota of cuotas) {
			const tipo = TIPO_POR_DIAS[cuota.dias_para_vencer];
			if (!tipo) continue;

			if (enviadoSet.has(`${cuota.cuota_id}:${tipo}`)) {
				resumen.yaEnviados++;
				continue;
			}

			// Plantilla según el bucket MOTOR de la cuota: B0 la normal; B1+ la
			// variante `_mora` (recuerda también el saldo vencido). El claim
			// sigue siendo por tipo BASE (premora_X): un cliente jamás recibe la
			// normal Y la de mora para la misma cuota.
			// En modo clásico (soloB0) SIEMPRE la normal (review Codex): ese
			// batch es al-día estricto en TIEMPO REAL, pero el bucket motor puede
			// venir stale (un crédito recién curado sigue en B2 en
			// buckets_historial hasta que corra procesarMoras) → mirar el bucket
			// histórico le mandaría "saldo vencido" a quien ya está al día.
			// La variante `_mora` NOMBRA las cuotas vencidas y el recargo, y esos
			// números salen de `moras_credito`, que es una FOTO refrescada solo
			// cuando corre procesarMoras (review Codex). Si CONTA validó una cuota
			// vencida hace un rato, la foto todavía dice las cuotas y el recargo
			// viejos → le diríamos "registra 2 cuota(s) vencida(s)" a quien ya
			// bajó a 1. Por eso solo citamos números cuando la foto COINCIDE con
			// las cuotas vencidas reales de este instante; si están desfasadas (o
			// ya no hay vencidas) va la plantilla base, que nunca miente: solo
			// recuerda la cuota próxima a vencer.
			// El monto NO se recalcula acá a propósito: la fórmula del recargo es
			// del motor de moras (latefee.ts) y duplicarla sería una segunda
			// fuente de verdad que puede discrepar.
			const vencidasReales = cuota.cuotas_vencidas_reales ?? 0;
			const fotoMoraAlDia =
				vencidasReales > 0 && vencidasReales === cuota.cuotas_atrasadas;
			const plantillaId =
				!soloB0 && (cuota.bucket ?? 0) >= 1 && fotoMoraAlDia
					? `${tipo}_mora`
					: tipo;
			const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === plantillaId);
			if (!plantilla) {
				console.error(`${LOG_PREFIX} Plantilla "${plantillaId}" no encontrada`);
				resumen.fallidos++;
				continue;
			}

			// Sin teléfono de asesor no se envía (el cuerpo trae el NO_REPLY que
			// redirige al asesor — mismo guard que el envío masivo).
			const asesorCheck = prepararTelefonoAsesorParaEnvio(
				plantilla.cuerpo,
				cuota.telefono_asesor,
			);
			if (!asesorCheck.enviar) {
				console.log(
					`${LOG_PREFIX} ${cuota.numero_credito_sifco} ${tipo}: omitido (${asesorCheck.motivo})`,
				);
				resumen.sinTelefonoAsesor++;
				continue;
			}

			const telefono = resolverTelefono(cuota);
			if (!telefono) {
				console.log(
					`${LOG_PREFIX} ${cuota.numero_credito_sifco} ${tipo}: sin teléfono válido; omitido`,
				);
				resumen.sinTelefono++;
				continue;
			}

			const mensaje = interpolar(plantilla.cuerpo, {
				clienteNombre: cuota.cliente ?? "",
				fechaPago: fechaLegible(cuota.fecha_vencimiento),
				cuotaMensual: montoLegible(cuota.monto_cuota),
				placa: "",
				marcaLineaModelo: "",
				montoAdeudado: "",
				montoMora: montoLegible(cuota.monto_mora),
				// Conteo VIVO (== cuotas_atrasadas cuando se usa la variante _mora).
				cuotasAtraso: vencidasReales,
				telefonoAsesor: asesorCheck.telefonoAsesor,
				nombreAsesor: cuota.asesor ?? "",
			});

			const telefonoDestino = testMode ? getTestPhone() : telefono;

			// 4. RECLAMAR el recordatorio ANTES de enviar (review Codex): el
			// INSERT contra el UNIQUE (cuota, tipo) es el lock — si otra corrida
			// concurrente ya lo reclamó, no devuelve fila y NO se envía (jamás
			// doble WhatsApp al cliente). Si el envío falla, se libera el claim
			// más abajo para que la próxima corrida reintente. Trade-off asumido:
			// un crash justo entre reclamar y enviar pierde ESE recordatorio,
			// pero premora tiene red (al D-5 le siguen D-3/D-1/D-0) y un doble
			// mensaje al cliente no tiene deshacer.
			// EN MODO TEST NO se escribe el claim (review Codex): el envío va al
			// teléfono de prueba y no debe CONSUMIR el recordatorio real — al
			// apagar el test, el cliente debe recibir el suyo.
			let claimId: string | null = null;
			if (testMode) {
				console.log(
					`${LOG_PREFIX}[TEST] claim omitido para ${cuota.numero_credito_sifco} ${tipo} (no consume el recordatorio real)`,
				);
			} else {
				const claim = await db
					.insert(recordatoriosPremora)
					.values({
						cuotaId: cuota.cuota_id,
						creditoId: cuota.credito_id,
						numeroCreditoSifco: cuota.numero_credito_sifco,
						tipo,
						telefono: telefonoDestino,
						fechaVencimiento: cuota.fecha_vencimiento,
					})
					.onConflictDoNothing()
					.returning({ id: recordatoriosPremora.id });
				if (claim.length === 0) {
					resumen.yaEnviados++;
					continue;
				}
				claimId = claim[0].id;
			}

			const result = await sendWhatsappTemplate({
				phone: telefonoDestino,
				message: mensaje,
				logPrefix: testMode ? `${LOG_PREFIX}[TEST]` : LOG_PREFIX,
			});

			// Traza del intento SIEMPRE (éxito o fallo), como todos los envíos.
			await persistCobrosSendLog({
				numeroCreditoSifco: cuota.numero_credito_sifco,
				plantillaId,
				telefono: telefonoDestino,
				mensaje,
				providerRequest: result.providerRequest ?? null,
				createdBy: usuarioSistema,
				result: result.success
					? {
							success: true,
							providerResponse: {
								...(result.providerResponse ?? {}),
								templateMessageId: result.templateMessageId,
								testMode,
								realTarget: testMode ? telefono : undefined,
							},
						}
					: {
							success: false,
							errorMessage: result.error,
							providerResponse: {
								...(result.providerResponse ?? {}),
								...(testMode ? { testMode, realTarget: telefono } : {}),
							},
						},
			});

			if (!result.success) {
				// Liberar el claim → la próxima corrida lo reintenta.
				console.error(
					`${LOG_PREFIX} ${cuota.numero_credito_sifco} ${tipo}: falló envío (${result.error})`,
				);
				if (claimId) {
					try {
						await db
							.delete(recordatoriosPremora)
							.where(eq(recordatoriosPremora.id, claimId));
					} catch (err) {
						console.error(
							`${LOG_PREFIX} No se pudo liberar el claim ${claimId}:`,
							err,
						);
					}
				}
				resumen.fallidos++;
				continue;
			}

			resumen.enviados++;

			// 5. Historial de contacto del CRM (requisito: que quede en el
			//    histórico que ya existe). Solo si el crédito tiene caso —
			//    `contactos_cobros.caso_cobro_id` es NOT NULL.
			const caso = casoPorSifco.get(cuota.numero_credito_sifco);
			if (caso) {
				try {
					await db.insert(contactosCobros).values({
						casoCobroId: caso.id,
						metodoContacto: "whatsapp",
						estadoContacto: "contactado",
						comentarios: `Recordatorio automático ${tipo.replace("premora_", "Premora D-")} enviado por WhatsApp al ${telefonoDestino}${testMode ? " (modo prueba)" : ""}. Cuota #${cuota.numero_cuota} vence el ${fechaLegible(cuota.fecha_vencimiento)} por Q${montoLegible(cuota.monto_cuota)}.`,
						realizadoPor: caso.responsable ?? usuarioSistema,
					});
					resumen.contactosRegistrados++;
				} catch (err) {
					// Best-effort: el contacto es traza, no debe frenar el batch.
					console.error(
						`${LOG_PREFIX} No se pudo registrar contacto para ${cuota.numero_credito_sifco}:`,
						err,
					);
				}
			}
		}

		// 6. D-0 → agenda del día: notificación individual al responsable del
		//    caso y resumen a los supervisores (los D-0 sin caso no tienen dueño
		//    individual en el CRM). Se notifica aunque el WhatsApp fallara: el
		//    asesor debe llamar igual.
		const d0 = cuotas.filter((c) => c.dias_para_vencer === 0);
		if (d0.length > 0) {
			resumen.notificacionesD0 += await notificarAgendaD0(
				d0,
				casoPorSifco,
				usuarioSistema,
			);
		}

		console.log(
			`${LOG_PREFIX} Resumen: ${resumen.enviados} enviados · ${resumen.yaEnviados} ya enviados · ${resumen.sinTelefono} sin teléfono · ${resumen.sinTelefonoAsesor} sin tel. asesor · ${resumen.fallidos} fallidos · ${resumen.contactosRegistrados} contactos · ${resumen.notificacionesD0} notif. D-0`,
		);
		return resumen;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		console.error(`${LOG_PREFIX} Error no controlado: ${msg}`);
		return resumenVacio({ skipped: true, reason: msg });
	}
}

const TITULO_D0_INDIVIDUAL = "Pago vence hoy (Premora D-0)";
// El título lleva la FECHA GT de vencimiento (review Codex en #1119): el job
// también corre al boot, y un deploy tarde en el día GT dejaba la corrida de
// las 8:00 del día siguiente dentro de la ventana de 20h → sin resumen para
// OTRA fecha. Con la fecha en el título, el dedup es por día de vencimiento.
const tituloResumenD0 = (fechaGT: string) =>
	`Agenda D-0: pagos que vencen hoy (${fechaGT})`;

/**
 * Notificaciones D-0. Dedup por título + ventana de 24h (mismo criterio que
 * el job de notificaciones de cobros) para no duplicar si el job re-corre.
 */
async function notificarAgendaD0(
	d0: CarteraCuotaProximaVencer[],
	casoPorSifco: Map<
		string,
		{ id: string; responsable: string | null } & Record<string, unknown>
	>,
	usuarioSistema: string,
): Promise<number> {
	let creadas = 0;
	try {
		// Individuales: caso con responsable asignado.
		const conCaso = d0
			.map((c) => ({
				cuota: c,
				caso: casoPorSifco.get(c.numero_credito_sifco),
			}))
			.filter(
				(
					x,
				): x is {
					cuota: CarteraCuotaProximaVencer;
					caso: NonNullable<typeof x.caso>;
				} => Boolean(x.caso?.responsable),
			);

		if (conCaso.length > 0) {
			const casoIds = conCaso.map((x) => x.caso.id);
			const yaNotificados = await db
				.select({ relatedEntityId: notifications.relatedEntityId })
				.from(notifications)
				.where(
					and(
						inArray(notifications.relatedEntityId, casoIds),
						eq(notifications.titulo, TITULO_D0_INDIVIDUAL),
						gt(notifications.createdAt, sql`now() - interval '24 hours'`),
					),
				);
			const notificadosSet = new Set(
				yaNotificados.map((n) => n.relatedEntityId),
			);

			const nuevas = conCaso
				.filter((x) => !notificadosSet.has(x.caso.id))
				.map((x) => ({
					titulo: TITULO_D0_INDIVIDUAL,
					descripcion: `Hoy vence la cuota #${x.cuota.numero_cuota} del crédito ${x.cuota.numero_credito_sifco} (${x.cuota.cliente}) por Q${montoLegible(x.cuota.monto_cuota)}. Buscar contacto efectivo y promesa de pago.`,
					type: "reminder" as const,
					status: "pending" as const,
					createdBy: x.caso.responsable as string,
					createdByRole: "cobros" as const,
					assignedToRole: "cobros" as const,
					assignedTo: x.caso.responsable,
					relatedEntityType: "collection_case" as const,
					relatedEntityId: x.caso.id,
					redirectPage: "cobros_detail" as const,
				}));
			if (nuevas.length > 0) {
				await db.insert(notifications).values(nuevas);
				creadas += nuevas.length;
			}
		}

		// Resumen a supervisores: TODOS los D-0 del día (con y sin caso), una
		// notificación por supervisor, deduplicada a una por día.
		const supervisores = await db
			.select({ id: user.id })
			.from(user)
			.where(eq(user.role, "cobros_supervisor"));
		if (supervisores.length > 0) {
			// Todos los D-0 de una corrida comparten fecha (= hoy GT): el título
			// con esa fecha hace el dedup por día de vencimiento, no por edad.
			const tituloResumen = tituloResumenD0(
				fechaLegible(d0[0].fecha_vencimiento),
			);
			const yaResumen = await db
				.select({ id: notifications.id })
				.from(notifications)
				.where(
					and(
						eq(notifications.titulo, tituloResumen),
						gt(notifications.createdAt, sql`now() - interval '20 hours'`),
					),
				)
				.limit(1);
			if (yaResumen.length === 0) {
				const listado = d0
					.slice(0, 10)
					.map((c) => c.numero_credito_sifco)
					.join(", ");
				const extra = d0.length > 10 ? ` y ${d0.length - 10} más` : "";
				await db.insert(notifications).values(
					supervisores.map((s) => ({
						titulo: tituloResumen,
						descripcion: `${d0.length} crédito(s) al día tienen cuota que vence hoy: ${listado}${extra}.`,
						type: "reminder" as const,
						status: "pending" as const,
						createdBy: usuarioSistema,
						createdByRole: "cobros_supervisor" as const,
						assignedToRole: "cobros_supervisor" as const,
						assignedTo: s.id,
					})),
				);
				creadas += supervisores.length;
			}
		}
	} catch (err) {
		console.error(`${LOG_PREFIX} Error creando notificaciones D-0:`, err);
	}
	return creadas;
}
