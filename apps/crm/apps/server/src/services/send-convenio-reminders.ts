/**
 * Recordatorios de CONVENIO (COBROS-02) — D-5, D-3, D-1 y D-0.
 *
 * Hermano de send-premora-reminders.ts, pero para créditos EN_CONVENIO (el
 * funnel premora NO los toca). Pregunta a cartera-back qué cuotas del CONVENIO
 * vencen en 5/3/1/0 días y envía el WhatsApp reutilizando la MISMA infraestructura
 * (plantillas del server, `sendWhatsappTemplate`, test-mode, `cobros_send_logs`).
 *
 * En convenio el cliente paga AMBAS el mismo día: la cuota normal del crédito Y
 * la del convenio. El monto recordado es el TOTAL (normal + convenio), con el
 * desglose en el mensaje.
 *
 * Garantías (igual que premora):
 *  - Idempotente: `recordatorios_convenio` con UNIQUE (cuota, tipo) — claim
 *    ANTES de enviar; si el envío falla, el claim se libera y se reintenta.
 *  - Historial de contacto: cada envío queda en `contactos_cobros` cuando el
 *    crédito tiene caso; la traza del envío siempre en `cobros_send_logs`.
 *  - Nunca lanza al caller: devuelve un resumen y loguea.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import { recordatoriosConvenio } from "../db/schema/recordatorios-convenio";
import {
	interpolar,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
} from "../lib/cobros-plantillas";
import { persistCobrosSendLog } from "../lib/cobros-send-log";
import { getTestPhone, isTestModeEnabled } from "../lib/messaging-test-mode";
import { primerTelefono } from "../lib/phone-utils";
import { sendWhatsappTemplate } from "../lib/simpletech";
import type { CarteraConvenioProximoVencer } from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";

const LOG_PREFIX = "[ConvenioRecordatorios]";

type TipoConvenio = "convenio_5" | "convenio_3" | "convenio_1" | "convenio_0";

const TIPO_POR_DIAS: Record<number, TipoConvenio> = {
	5: "convenio_5",
	3: "convenio_3",
	1: "convenio_1",
	0: "convenio_0",
};

export interface ConvenioRunOptions {
	/** Corrida MANUAL (endpoint): ignora el gate CONVENIO_WHATSAPP_ENABLED. */
	force?: boolean;
	/** Limita el batch a estos créditos (pruebas quirúrgicas). */
	sifcos?: string[];
	/** Corre solo estos días (subconjunto de 5/3/1/0); vacío = todos. */
	dias?: number[];
}

export interface ConvenioResumen {
	skipped?: boolean;
	reason?: string;
	cuotas: number;
	enviados: number;
	yaEnviados: number;
	sinTelefono: number;
	sinTelefonoAsesor: number;
	fallidos: number;
	contactosRegistrados: number;
}

const resumenVacio = (extra?: Partial<ConvenioResumen>): ConvenioResumen => ({
	cuotas: 0,
	enviados: 0,
	yaEnviados: 0,
	sinTelefono: 0,
	sinTelefonoAsesor: 0,
	fallidos: 0,
	contactosRegistrados: 0,
	...extra,
});

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

export async function sendConvenioReminders(
	opts: ConvenioRunOptions = {},
): Promise<ConvenioResumen> {
	try {
		// 0. Habilitado por env (mismo patrón que premora).
		if (!opts.force && process.env.CONVENIO_WHATSAPP_ENABLED !== "true") {
			console.log(
				`${LOG_PREFIX} CONVENIO_WHATSAPP_ENABLED != "true"; job omitido`,
			);
			return resumenVacio({ skipped: true, reason: "deshabilitado" });
		}
		if (!isCarteraBackEnabled()) {
			console.log(`${LOG_PREFIX} Cartera-back deshabilitado; job omitido`);
			return resumenVacio({ skipped: true, reason: "cartera_back_disabled" });
		}

		// 1. Cuotas del convenio próximas a vencer desde cartera-back.
		const diasQuery = opts.dias?.length ? opts.dias : [5, 3, 1, 0];
		const respuesta =
			await carteraBackClient.getConvenioProximosVencer(diasQuery);
		let cuotas = respuesta.data ?? [];
		if (opts.sifcos?.length) {
			const filtro = new Set(opts.sifcos);
			cuotas = cuotas.filter((c) => filtro.has(c.numero_credito_sifco));
			console.log(
				`${LOG_PREFIX} Filtro manual por SIFCO (${opts.sifcos.join(", ")}): ${cuotas.length} cuota(s)`,
			);
		}
		console.log(
			`${LOG_PREFIX} ${cuotas.length} cuota(s) de convenio próximas a vencer (D-5/D-3/D-1/D-0)`,
		);
		if (cuotas.length === 0) return resumenVacio();

		const resumen = resumenVacio({ cuotas: cuotas.length });

		// 2. Batch: ya enviados (idempotencia), casos y teléfonos del CRM.
		const cuotaIds = [...new Set(cuotas.map((c) => c.cuota_id))];
		const sifcos = [...new Set(cuotas.map((c) => c.numero_credito_sifco))];

		const enviadosPrevios = await db
			.select({
				cuotaId: recordatoriosConvenio.cuotaId,
				tipo: recordatoriosConvenio.tipo,
			})
			.from(recordatoriosConvenio)
			.where(inArray(recordatoriosConvenio.cuotaId, cuotaIds));
		const enviadoSet = new Set(
			enviadosPrevios.map((e) => `${e.cuotaId}:${e.tipo}`),
		);

		// Caso de cobros (aunque inactivo): trae el teléfono corregido por el
		// asesor y es el ancla del historial de contacto. Con varios por SIFCO
		// gana el activo; a igualdad, el más reciente.
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

		const resolverTelefono = (c: CarteraConvenioProximoVencer): string | null =>
			primerTelefono(
				casoPorSifco.get(c.numero_credito_sifco)?.telefonoPrincipal,
			) ??
			primerTelefono(leadPhonePorSifco.get(c.numero_credito_sifco)) ??
			primerTelefono(c.telefono_cliente_cartera);

		const usuarioSistema = await resolverUsuarioSistema();
		if (!usuarioSistema) {
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

		// 3. Envío secuencial (volúmenes chicos).
		for (const cuota of cuotas) {
			const tipo = TIPO_POR_DIAS[cuota.dias_para_vencer];
			if (!tipo) continue;

			if (enviadoSet.has(`${cuota.cuota_id}:${tipo}`)) {
				resumen.yaEnviados++;
				continue;
			}

			const plantilla = PLANTILLAS_MENSAJES.find((p) => p.id === tipo);
			if (!plantilla) {
				console.error(`${LOG_PREFIX} Plantilla "${tipo}" no encontrada`);
				resumen.fallidos++;
				continue;
			}

			// Sin teléfono de asesor no se envía (el cuerpo trae el NO_REPLY).
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
				montoNormal: montoLegible(cuota.monto_normal),
				montoConvenio: montoLegible(cuota.monto_convenio),
				placa: "",
				marcaLineaModelo: "",
				montoAdeudado: "",
				montoMora: "",
				cuotasAtraso: 0,
				telefonoAsesor: asesorCheck.telefonoAsesor,
				nombreAsesor: cuota.asesor ?? "",
			});

			const telefonoDestino = testMode ? getTestPhone() : telefono;

			// 4. RECLAMAR antes de enviar (claim). En test-mode no se escribe (el
			//    envío va al teléfono de prueba y no debe consumir el recordatorio real).
			let claimId: string | null = null;
			if (testMode) {
				console.log(
					`${LOG_PREFIX}[TEST] claim omitido para ${cuota.numero_credito_sifco} ${tipo}`,
				);
			} else {
				const claim = await db
					.insert(recordatoriosConvenio)
					.values({
						cuotaId: cuota.cuota_id,
						creditoId: cuota.credito_id,
						numeroCreditoSifco: cuota.numero_credito_sifco,
						tipo,
						telefono: telefonoDestino,
						fechaVencimiento: cuota.fecha_vencimiento,
					})
					.onConflictDoNothing()
					.returning({ id: recordatoriosConvenio.id });
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

			await persistCobrosSendLog({
				numeroCreditoSifco: cuota.numero_credito_sifco,
				plantillaId: tipo,
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
				console.error(
					`${LOG_PREFIX} ${cuota.numero_credito_sifco} ${tipo}: falló envío (${result.error})`,
				);
				if (claimId) {
					try {
						await db
							.delete(recordatoriosConvenio)
							.where(eq(recordatoriosConvenio.id, claimId));
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

			// 5. Historial de contacto (si el crédito tiene caso).
			//    CB-128: `bucket_snapshot` queda NULL a propósito — mismo criterio
			//    que send-premora-reminders.ts. Este job trabaja sobre cuotas del
			//    convenio próximas a vencer y no tiene `cuotas_atrasadas` a mano
			//    para derivar el bucket. Ver db/schema/cobros.ts.
			const caso = casoPorSifco.get(cuota.numero_credito_sifco);
			if (caso) {
				try {
					await db.insert(contactosCobros).values({
						casoCobroId: caso.id,
						metodoContacto: "whatsapp",
						estadoContacto: "contactado",
						comentarios: `Recordatorio automático Convenio ${tipo.replace("convenio_", "D-")} enviado por WhatsApp al ${telefonoDestino}${testMode ? " (modo prueba)" : ""}. Pago del ${fechaLegible(cuota.fecha_vencimiento)} por Q${montoLegible(cuota.monto_cuota)} (normal Q${montoLegible(cuota.monto_normal)} + convenio Q${montoLegible(cuota.monto_convenio)}).`,
						realizadoPor: caso.responsable ?? usuarioSistema,
					});
					resumen.contactosRegistrados++;
				} catch (err) {
					console.error(
						`${LOG_PREFIX} No se pudo registrar contacto para ${cuota.numero_credito_sifco}:`,
						err,
					);
				}
			}
		}

		console.log(
			`${LOG_PREFIX} Resumen: ${resumen.enviados} enviados · ${resumen.yaEnviados} ya enviados · ${resumen.sinTelefono} sin teléfono · ${resumen.sinTelefonoAsesor} sin tel. asesor · ${resumen.fallidos} fallidos · ${resumen.contactosRegistrados} contactos`,
		);
		return resumen;
	} catch (err) {
		console.error(`${LOG_PREFIX} Error en el job:`, err);
		return resumenVacio({ skipped: true, reason: "error" });
	}
}
