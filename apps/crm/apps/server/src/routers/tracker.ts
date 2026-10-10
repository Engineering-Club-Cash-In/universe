import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth/api";
import { and, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { session, user } from "../db/schema/auth";
import {
	companies,
	leads,
	opportunities,
	opportunityStageHistory,
	salesStages,
} from "../db/schema/crm";
import { opportunityDocuments } from "../db/schema/documents";
import {
	type EstadoEnvioFactura,
	insuranceInvoiceSubmissions,
	opportunityAgencySellers,
	partnerAccounts,
} from "../db/schema/partners";
import {
	opportunityCloseQuotations,
	quotations,
} from "../db/schema/quotations";
import { vehicles, vehicleVendors } from "../db/schema/vehicles";
import {
	armarCorreoFacturaSeguro,
	type DatosCorreoFacturaSeguro,
	enviarCorreoFacturaSeguro,
} from "../lib/correo-factura-seguro";
import {
	type Aseguradora,
	destinatariosDe,
	MENSAJE_MOTIVO,
	MENSAJE_SIN_ENVIO_DESDE_CRM,
	MENSAJE_SIN_REENVIO,
	MIME_FACTURA_SEGURO,
	nombreDeFactura,
	puedeEnviarFacturaDesdeCrm,
	puedeReenviarFacturaSeguro,
	puedeReintentarDesdeCrm,
	puedeSubirFacturaSeguro,
	resolverAseguradora,
	tipoRealDeFactura,
} from "../lib/factura-seguro";
import {
	crmProcedure,
	partnerIdentityProcedure,
	partnerProcedure,
} from "../lib/orpc";
import { PARTNER_CHANGE_PASSWORD_PATH, partnerAuth } from "../lib/partner-auth";
import {
	casoDentroDeAlcance,
	condicionDeAlcance,
	type MembresiaSocio,
	resolvePartnerScope,
} from "../lib/partner-scope";
import { extraerIp, partnerAuthLimiter } from "../lib/rate-limit";
import {
	buildUploadPrefix,
	deleteFileFromR2,
	generateUniqueFilename,
	getFileBuffer,
	getFileUrl,
	MAX_FILE_SIZE,
	uploadBufferToR2,
	validateResolvedMimeType,
} from "../lib/storage";
import {
	construirHistorial,
	type EntradaHistorial,
} from "../lib/tracker-historial";
import { type PasoTracker, pasoDesdeCierre } from "../lib/tracker-pasos";

// Los cerrados se acotan para que el payload no crezca sin límite; los activos
// van siempre porque el socio necesita verlos aunque lleven meses parados.
const MESES_HISTORICO = 24;

export type EstadoCaso =
	| "en_proceso"
	| "en_pausa"
	| "rechazado"
	| "aprobado"
	| "desembolsado";

export type { EntradaHistorial };

export type CasoTracker = {
	id: string;
	referencia: string;
	cliente: string;
	agencia: string;
	vendedor: string | null;
	vehiculo: string | null;
	valorVehiculo: number | null;
	pasoActual: PasoTracker;
	porcentaje: number;
	estado: EstadoCaso;
	cerrado: boolean;
	actualizadoAt: string;
	historial: EntradaHistorial[];
	facturaSeguro: {
		habilitada: boolean;
		motivo: string | null;
		subidaAt: string | null;
		envio: EstadoEnvioFactura | null;
	};
};

// Fecha de cierre efectiva: los perdidos nunca traen actual_close_date.
const fechaCierre = sql<Date>`COALESCE(${opportunities.actualCloseDate}, ${opportunities.updatedAt})`;

// open/on_hold siempre entran (el socio los necesita aunque lleven meses
// parados). won ya está cerrado en el pipeline de ventas — aunque "aprobado"
// no signifique desembolsado, comparte la misma ventana de retención para
// que el payload no crezca sin límite. Los perdidos ("lost") no se traen
// nunca: el socio no debe ver créditos rechazados.
function dentroDeVentanaDeRetencion(desde: Date) {
	return or(
		inArray(opportunities.status, ["open", "on_hold"]),
		and(eq(opportunities.status, "won"), gte(fechaCierre, desde)),
	);
}

// Una oportunidad puede tener varias cotizaciones. El tracker solo expone el
// valor del vehículo de la última cotización actualizada, nunca el valor del
// crédito de la oportunidad. Se arma sin `db`: crm.ts importa este módulo y
// cargarlo no debe depender de la base.
const ultimaCotizacion = new QueryBuilder()
	.selectDistinctOn([quotations.opportunityId], {
		opportunityId: quotations.opportunityId,
		vehicleBrand: quotations.vehicleBrand,
		vehicleLine: quotations.vehicleLine,
		vehicleModel: quotations.vehicleModel,
		vehicleValue: quotations.vehicleValue,
	})
	.from(quotations)
	.orderBy(
		quotations.opportunityId,
		desc(quotations.updatedAt),
		desc(quotations.createdAt),
	)
	.as("ultima_cotizacion");

const filaSelect = {
	id: opportunities.id,
	status: opportunities.status,
	assignedTo: opportunities.assignedTo,
	createdAt: opportunities.createdAt,
	updatedAt: opportunities.updatedAt,
	closurePercentage: salesStages.closurePercentage,
	companyId: opportunities.companyId,
	agenciaNombre: companies.name,
	sellerId: opportunityAgencySellers.sellerId,
	vendedorNombre: vehicleVendors.name,
	leadFirstName: leads.firstName,
	leadMiddleName: leads.middleName,
	leadLastName: leads.lastName,
	leadSecondLastName: leads.secondLastName,
	vehicleMake: vehicles.make,
	vehicleModel: vehicles.model,
	vehicleYear: vehicles.year,
	quotationBrand: ultimaCotizacion.vehicleBrand,
	quotationLine: ultimaCotizacion.vehicleLine,
	quotationModel: ultimaCotizacion.vehicleModel,
	vehicleValue: ultimaCotizacion.vehicleValue,
	facturaEnvio: insuranceInvoiceSubmissions.status,
	facturaSubidaAt: insuranceInvoiceSubmissions.createdAt,
};

type Fila = {
	id: string;
	status: string;
	assignedTo: string | null;
	createdAt: Date;
	updatedAt: Date;
	closurePercentage: number;
	companyId: string | null;
	agenciaNombre: string;
	sellerId: string | null;
	vendedorNombre: string | null;
	leadFirstName: string | null;
	leadMiddleName: string | null;
	leadLastName: string | null;
	leadSecondLastName: string | null;
	vehicleMake: string | null;
	vehicleModel: string | null;
	vehicleYear: number | null;
	quotationBrand: string | null;
	quotationLine: string | null;
	quotationModel: string | null;
	vehicleValue: string | null;
	facturaEnvio: EstadoEnvioFactura | null;
	facturaSubidaAt: Date | null;
};

export function nombreCliente(
	firstName: string | null,
	middleName: string | null,
	lastName: string | null,
	secondLastName: string | null,
) {
	const partes = [firstName, middleName, lastName, secondLastName]
		.map((parte) => (parte ?? "").trim())
		.filter(Boolean);
	return partes.length > 0 ? partes.join(" ") : "Cliente sin nombre";
}

function descripcionVehiculo(fila: Fila) {
	const vinculado = [fila.vehicleMake, fila.vehicleModel, fila.vehicleYear]
		.filter(Boolean)
		.join(" ");
	if (vinculado) return vinculado;

	const deCotizacion = [
		fila.quotationBrand,
		fila.quotationLine,
		fila.quotationModel,
	]
		.filter(Boolean)
		.join(" ");
	return deCotizacion || null;
}

// No hay señal confiable de cuándo contabilidad desembolsa un `won`, así que
// no se reclama "desembolsado" — se queda en "aprobado".
function estadoDeCaso(status: string): EstadoCaso {
	if (status === "lost") return "rechazado";
	if (status === "on_hold") return "en_pausa";
	if (status === "won") return "aprobado";
	return "en_proceso";
}

// Carga el historial de todos los casos en una sola query, sin N+1.
async function cargarHistoriales(filas: Fila[]) {
	const porCaso = new Map<string, EntradaHistorial[]>();
	if (filas.length === 0) return porCaso;

	const etapaOrigen = alias(salesStages, "etapa_origen");
	const eventos = await db
		.select({
			opportunityId: opportunityStageHistory.opportunityId,
			changedAt: opportunityStageHistory.changedAt,
			pctDestino: salesStages.closurePercentage,
			pctOrigen: etapaOrigen.closurePercentage,
		})
		.from(opportunityStageHistory)
		.innerJoin(
			salesStages,
			eq(salesStages.id, opportunityStageHistory.toStageId),
		)
		.leftJoin(
			etapaOrigen,
			eq(etapaOrigen.id, opportunityStageHistory.fromStageId),
		)
		.where(
			inArray(
				opportunityStageHistory.opportunityId,
				filas.map((f) => f.id),
			),
		)
		.orderBy(opportunityStageHistory.changedAt);

	const eventosPorCaso = new Map<string, typeof eventos>();
	for (const evento of eventos) {
		const lista = eventosPorCaso.get(evento.opportunityId);
		if (lista) lista.push(evento);
		else eventosPorCaso.set(evento.opportunityId, [evento]);
	}

	for (const fila of filas) {
		porCaso.set(
			fila.id,
			construirHistorial(eventosPorCaso.get(fila.id) ?? [], fila),
		);
	}

	return porCaso;
}

// Arma el DTO campo por campo: la fila de opportunity trae DPI, ingresos,
// buró, inversionistas y tasas que el socio no debe ver nunca.
function reglaFactura(fila: Fila, membresias: MembresiaSocio[]) {
	return puedeSubirFacturaSeguro({
		closurePercentage: fila.closurePercentage,
		status: fila.status,
		companyId: fila.companyId,
		sellerId: fila.sellerId,
		membresias,
		yaSubida: fila.facturaEnvio != null,
	});
}

function aCaso(
	fila: Fila,
	historial: EntradaHistorial[],
	membresias: MembresiaSocio[],
): CasoTracker {
	const pasoActual = pasoDesdeCierre(fila.closurePercentage);
	const factura = reglaFactura(fila, membresias);
	return {
		id: fila.id,
		referencia: fila.id.slice(0, 8).toUpperCase(),
		cliente: nombreCliente(
			fila.leadFirstName,
			fila.leadMiddleName,
			fila.leadLastName,
			fila.leadSecondLastName,
		),
		agencia: fila.agenciaNombre.trim(),
		vendedor: fila.vendedorNombre?.trim() || null,
		vehiculo: descripcionVehiculo(fila),
		valorVehiculo:
			fila.vehicleValue === null ? null : Number(fila.vehicleValue),
		pasoActual,
		porcentaje: fila.closurePercentage,
		estado: estadoDeCaso(fila.status),
		cerrado: fila.status === "lost" || fila.status === "won",
		actualizadoAt: fila.updatedAt.toISOString(),
		historial,
		facturaSeguro: {
			habilitada: factura.ok,
			motivo: factura.ok ? null : MENSAJE_MOTIVO[factura.motivo],
			subidaAt: fila.facturaSubidaAt?.toISOString() ?? null,
			envio: fila.facturaEnvio ?? null,
		},
	};
}

const consultaBase = () =>
	db
		.select(filaSelect)
		.from(opportunities)
		.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
		.innerJoin(companies, eq(companies.id, opportunities.companyId))
		.leftJoin(leads, eq(leads.id, opportunities.leadId))
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.leftJoin(
			ultimaCotizacion,
			eq(ultimaCotizacion.opportunityId, opportunities.id),
		)
		// El UNIQUE(opportunity_id) evita que este join duplique casos.
		.leftJoin(
			opportunityAgencySellers,
			eq(opportunityAgencySellers.opportunityId, opportunities.id),
		)
		.leftJoin(
			vehicleVendors,
			eq(vehicleVendors.id, opportunityAgencySellers.sellerId),
		)
		.leftJoin(
			insuranceInvoiceSubmissions,
			eq(insuranceInvoiceSubmissions.opportunityId, opportunities.id),
		);

// Caso por id, dentro de la ventana de retención y del alcance del socio.
async function casoDelSocio(id: string, membresias: MembresiaSocio[]) {
	const desde = new Date();
	desde.setUTCMonth(desde.getUTCMonth() - MESES_HISTORICO);

	const [fila] = await consultaBase()
		.where(and(eq(opportunities.id, id), dentroDeVentanaDeRetencion(desde)))
		.limit(1);

	if (!fila) {
		throw new ORPCError("NOT_FOUND", { message: "Caso no encontrado" });
	}
	// El alcance se revalida contra la membresía, nunca contra el id que manda el cliente.
	if (!casoDentroDeAlcance(fila, membresias)) {
		// Si la agencia es suya, el caso es de otro vendedor (o de ninguno).
		const esDeSuAgencia = membresias.some(
			(m) => m.companyId === fila.companyId,
		);
		throw new ORPCError("FORBIDDEN", {
			message: esDeSuAgencia
				? "Este caso no está asignado a ti"
				: "Este caso no pertenece a tu agencia",
		});
	}
	return fila;
}

async function casoDelCrm(
	id: string,
	context: { userId: string; userRole: string | null | undefined },
) {
	const [fila] = await consultaBase().where(eq(opportunities.id, id)).limit(1);
	if (!fila) {
		throw new ORPCError("NOT_FOUND", { message: "Oportunidad no encontrada" });
	}
	if (!puedeReintentarDesdeCrm(context, fila.assignedTo)) {
		throw new ORPCError("FORBIDDEN", {
			message: "No tienes permiso para reenviar esta factura",
		});
	}
	return fila;
}

function exigirReglaFactura(fila: Fila, membresias: MembresiaSocio[]) {
	const regla = reglaFactura(fila, membresias);
	if (regla.ok) return;
	const codigo =
		regla.motivo === "no_es_el_vendedor"
			? "FORBIDDEN"
			: regla.motivo === "ya_subida"
				? "CONFLICT"
				: "BAD_REQUEST";
	throw new ORPCError(codigo, { message: MENSAJE_MOTIVO[regla.motivo] });
}

// En un reenvío la aseguradora de estos datos no se usa: se conserva la que se
// resolvió al subir la factura.
async function datosDelCorreo(
	fila: Fila,
	conexion: Pick<typeof db, "select"> = db,
): Promise<{ aseguradora: Aseguradora; datos: DatosCorreoFacturaSeguro }> {
	// Cliente y vehículo se releen aquí y no se toman de `fila`: bajo el
	// bloqueo del registro, el correo no mezcla datos de antes y de ahora.
	const [oportunidad] = await conexion
		.select({
			insuranceProvider: opportunities.insuranceProvider,
			cuotaMensual: opportunities.cuotaMensual,
			actualCloseDate: opportunities.actualCloseDate,
			vin: vehicles.vinNumber,
			tipoVehiculo: vehicles.vehicleType,
			leadFirstName: leads.firstName,
			leadMiddleName: leads.middleName,
			leadLastName: leads.lastName,
			leadSecondLastName: leads.secondLastName,
			vehicleMake: vehicles.make,
			vehicleModel: vehicles.model,
			vehicleYear: vehicles.year,
		})
		.from(opportunities)
		.leftJoin(leads, eq(leads.id, opportunities.leadId))
		.leftJoin(vehicles, eq(vehicles.id, opportunities.vehicleId))
		.where(eq(opportunities.id, fila.id))
		.limit(1);
	const caso: Fila = oportunidad ? { ...fila, ...oportunidad } : fila;

	// Ya ganada (el caso normal al 90%), el crédito se armó con la cotización
	// que eligió el cierre, que la guarda en opportunity_close_quotations, y la
	// aseguradora quedó estampada en la oportunidad. Si el cierre no la guardó
	// (cierres anteriores), se reconstruye: solo las cotizaciones que existían
	// al cerrar y, entre ellas, las de la aseguradora del crédito.
	const [delCierre] =
		fila.status === "won"
			? await conexion
					.select({ quotationId: opportunityCloseQuotations.quotationId })
					.from(opportunityCloseQuotations)
					.where(eq(opportunityCloseQuotations.opportunityId, fila.id))
					.limit(1)
			: [];
	const cerradaAt =
		fila.status === "won" ? (oportunidad?.actualCloseDate ?? null) : null;
	const aseguradoraDelCredito = cerradaAt
		? (oportunidad?.insuranceProvider ?? null)
		: null;

	// Sin cerrar: la última cotización (confirmado con negocio), con el mismo
	// orden que el cierre (getLatestApprovedQuotation): una aceptada manda
	// sobre las más nuevas.
	const [cotizacion] = await conexion
		.select({
			insuranceProvider: quotations.insuranceProvider,
			insuredAmount: quotations.insuredAmount,
			monthlyPayment: quotations.monthlyPayment,
			vehicleType: quotations.vehicleType,
			vehicleBrand: quotations.vehicleBrand,
			vehicleLine: quotations.vehicleLine,
			vehicleModel: quotations.vehicleModel,
		})
		.from(quotations)
		.where(
			and(
				eq(quotations.opportunityId, fila.id),
				delCierre
					? eq(quotations.id, delCierre.quotationId)
					: cerradaAt
						? lte(quotations.createdAt, cerradaAt)
						: undefined,
			),
		)
		.orderBy(
			...(aseguradoraDelCredito
				? [desc(eq(quotations.insuranceProvider, aseguradoraDelCredito))]
				: []),
			desc(eq(quotations.status, "accepted")),
			desc(quotations.createdAt),
		)
		.limit(1);

	const aseguradora = aseguradoraDelCredito
		? resolverAseguradora(aseguradoraDelCredito, cotizacion?.insuranceProvider)
		: resolverAseguradora(
				cotizacion?.insuranceProvider,
				oportunidad?.insuranceProvider,
			);
	return {
		aseguradora,
		datos: {
			referencia: fila.id.slice(0, 8).toUpperCase(),
			cliente: nombreCliente(
				caso.leadFirstName,
				caso.leadMiddleName,
				caso.leadLastName,
				caso.leadSecondLastName,
			),
			// Sin vehículo vinculado, el nombre sale de esta misma cotización y no
			// de la última editada: si no, mezclaría datos de dos cotizaciones.
			vehiculo: descripcionVehiculo({
				...caso,
				quotationBrand: cotizacion?.vehicleBrand ?? null,
				quotationLine: cotizacion?.vehicleLine ?? null,
				quotationModel: cotizacion?.vehicleModel ?? null,
			}),
			vin: oportunidad?.vin ?? null,
			tipoVehiculo:
				oportunidad?.tipoVehiculo?.trim() || cotizacion?.vehicleType || null,
			montoAsegurado: aNumero(cotizacion?.insuredAmount),
			cuotaMensual: aNumero(
				cotizacion?.monthlyPayment ?? oportunidad?.cuotaMensual,
			),
			aseguradora,
		},
	};
}

// Dentro de la transacción del registro, con las cotizaciones de la oportunidad
// FOR SHARE: aceptar o rechazar una espera al commit, y el correo guardado sale
// con la cotización vigente al registrar.
async function datosDelCorreoBajoBloqueo(
	tx: Pick<typeof db, "select">,
	fila: Fila,
) {
	await tx
		.select({ id: quotations.id })
		.from(quotations)
		.where(eq(quotations.opportunityId, fila.id))
		.for("share");
	const { aseguradora, datos } = await datosDelCorreo(fila, tx);
	return { aseguradora, datos, destinatarios: destinatariosDe(aseguradora) };
}

// La llave de idempotencia es por registro e intento: reintentar el mismo
// intento (resultado desconocido) no duplica el correo en Resend mientras la
// llave siga vigente allá (24 h); después Resend lo trata como un correo nuevo.
export function llaveDeEnvio(registroId: string, intento: number): string {
	return `factura-seguro/${registroId}/${intento}`;
}

// Un resultado tardío no pisa otro intento ni un `enviado`: el reintento de un
// `pendiente` abandonado repite el mismo intento y puede terminar antes que el
// envío original.
function mismoIntentoSinEnviar(registro: { id: string; intento: number }) {
	return and(
		eq(insuranceInvoiceSubmissions.id, registro.id),
		eq(insuranceInvoiceSubmissions.intento, registro.intento),
		ne(insuranceInvoiceSubmissions.status, "enviado"),
	);
}

// `correo` es el guardado en el registro para este intento.
async function enviarYRegistrar(params: {
	registro: { id: string; intento: number };
	destinatarios: string[];
	archivo: { key: string; nombre: string };
	correo: { asunto: string; html: string };
}): Promise<EstadoEnvioFactura> {
	if (params.destinatarios.length === 0) return "sin_destinatario";

	const resultado = await enviarCorreoFacturaSeguro({
		destinatarios: params.destinatarios,
		archivo: params.archivo,
		correo: params.correo,
		idempotencyKey: llaveDeEnvio(params.registro.id, params.registro.intento),
	});
	const ahora = new Date();

	if (resultado.ok) {
		await db
			.update(insuranceInvoiceSubmissions)
			.set({ status: "enviado", error: null, sentAt: ahora, updatedAt: ahora })
			.where(mismoIntentoSinEnviar(params.registro));
		return "enviado";
	}
	// Otro proceso tiene la misma llave en Resend: no se toca el registro.
	if (resultado.resultado === "en_curso") return "pendiente";
	// Pudo haber salido: el intento se conserva en `pendiente` (y su llave),
	// así el reenvío lo repite sin duplicar en vez de abrir otro intento.
	if (resultado.resultado === "incierto") {
		await db
			.update(insuranceInvoiceSubmissions)
			.set({ error: resultado.error.slice(0, 2000), updatedAt: ahora })
			.where(mismoIntentoSinEnviar(params.registro));
		return "pendiente";
	}
	await db
		.update(insuranceInvoiceSubmissions)
		.set({
			status: "fallido",
			error: resultado.error.slice(0, 2000),
			sentAt: null,
			updatedAt: ahora,
		})
		.where(mismoIntentoSinEnviar(params.registro));
	return "fallido";
}

function aNumero(valor: string | null | undefined): number | null {
	if (valor == null || valor === "") return null;
	const numero = Number(valor);
	return Number.isFinite(numero) ? numero : null;
}

// El correo se arma antes del bloqueo con los datos de ese momento. Si el caso
// cambió de estado mientras tanto (por ejemplo, se cerró y el cierre eligió su
// cotización), esos datos pueden ser viejos: se rechaza y se reintenta.
function exigirMismoEstado(bajoBloqueo: string | undefined, alEmpezar: string) {
	if (bajoBloqueo !== undefined && bajoBloqueo !== alEmpezar) {
		throw new ORPCError("CONFLICT", {
			message:
				"El caso cambió mientras se procesaba la factura. Vuelve a intentarlo.",
		});
	}
}

/**
 * Antes de subir un "Seguro del Vehículo" desde el CRM: si se mandaría a la
 * aseguradora y a cuál, con las mismas reglas que el envío. Solo lectura; al
 * guardar se vuelve a validar todo.
 */
export async function previsualizarFacturaSeguroDesdeCrm(
	opportunityId: string,
): Promise<
	| { seEnviara: true; aseguradora: Aseguradora }
	| { seEnviara: false; motivo: string }
> {
	const [fila] = await consultaBase()
		.where(eq(opportunities.id, opportunityId))
		.limit(1);
	if (!fila)
		return { seEnviara: false, motivo: "no se encontró la oportunidad" };
	const regla = puedeEnviarFacturaDesdeCrm({
		closurePercentage: fila.closurePercentage,
		status: fila.status,
		companyId: fila.companyId,
		yaSubida: fila.facturaEnvio != null,
	});
	if (!regla.ok) {
		return {
			seEnviara: false,
			motivo: MENSAJE_SIN_ENVIO_DESDE_CRM[regla.motivo],
		};
	}
	const { aseguradora } = await datosDelCorreo(fila);
	return { seEnviara: true, aseguradora };
}

export type ResultadoFacturaDesdeCrm =
	| { enviada: true; envio: EstadoEnvioFactura; aseguradora: Aseguradora }
	| { enviada: false; motivo: string };

/**
 * Un "Seguro del Vehículo" subido desde el CRM sigue el mismo envío que la
 * factura del tracker. El documento ya está guardado: si no corresponde
 * mandarlo, se devuelve el motivo y queda como un documento más.
 */
export async function enviarFacturaSeguroDesdeCrm(params: {
	opportunityId: string;
	documentId: string;
	key: string;
	nombre: string;
	/** El tipo con el que el CRM aceptó el documento. */
	mimeType: string;
	/** La aseguradora a la que el usuario confirmó el envío, si confirmó. */
	aseguradoraConfirmada: Aseguradora | null | undefined;
	userId: string;
	userRole: string | null | undefined;
}): Promise<ResultadoFacturaDesdeCrm> {
	const [fila] = await consultaBase()
		.where(eq(opportunities.id, params.opportunityId))
		.limit(1);
	if (!fila) return { enviada: false, motivo: "no se encontró la oportunidad" };
	const regla = puedeEnviarFacturaDesdeCrm({
		closurePercentage: fila.closurePercentage,
		status: fila.status,
		companyId: fila.companyId,
		yaSubida: fila.facturaEnvio != null,
	});
	if (!regla.ok) {
		return {
			enviada: false,
			motivo: MENSAJE_SIN_ENVIO_DESDE_CRM[regla.motivo],
		};
	}

	// El tamaño se validó con un HEAD, pero la URL firmada pudo reemplazar el
	// archivo después: se baja con tope y se vuelve a medir.
	const contenido = await getFileBuffer(params.key, MAX_FILE_SIZE);
	if (contenido.length > MAX_FILE_SIZE) {
		return {
			enviada: false,
			motivo: `la factura no puede pesar más de ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
		};
	}
	// A la aseguradora va cualquier tipo que el CRM admite. Si el contenido es
	// PDF o imagen, el nombre lleva la extensión de su tipo real.
	const tipoReal = tipoRealDeFactura(contenido);
	const tipo = tipoReal ?? params.mimeType;

	// La URL firmada de la subida se puede reusar 10 minutos: lo que se manda,
	// ahora y en el reintento, es una copia que solo escribe el server, con los
	// bytes que pasaron la validación.
	const nombre = tipoReal
		? nombreDeFactura(params.nombre, tipoReal)
		: params.nombre;
	const copia = `${buildUploadPrefix("opportunity_document", fila.id)}/${generateUniqueFilename(nombre)}`;
	await uploadBufferToR2(copia, contenido, tipo);

	const creadoAt = new Date();
	const registrar = () =>
		db.transaction(async (tx) => {
			const [vigente] = await tx
				.select({
					status: opportunities.status,
					closurePercentage: salesStages.closurePercentage,
					companyId: opportunities.companyId,
					assignedTo: opportunities.assignedTo,
				})
				.from(opportunities)
				.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
				.where(eq(opportunities.id, fila.id))
				.for("update", { of: opportunities });
			const [previa] = await tx
				.select({ id: insuranceInvoiceSubmissions.id })
				.from(insuranceInvoiceSubmissions)
				.where(eq(insuranceInvoiceSubmissions.opportunityId, fila.id));
			if (!vigente || vigente.status !== fila.status) return null;
			// Pudo cambiar de asesor mientras se validaba el archivo.
			if (!puedeReintentarDesdeCrm(params, vigente.assignedTo)) return null;
			const bajoBloqueo = puedeEnviarFacturaDesdeCrm({
				...vigente,
				yaSubida: !!previa,
			});
			if (!bajoBloqueo.ok) return null;

			const { aseguradora, datos, destinatarios } =
				await datosDelCorreoBajoBloqueo(tx, fila);
			// Solo sale lo que el usuario confirmó: la consulta previa pudo decir
			// que no se enviaba, o la aseguradora cambió con el diálogo abierto.
			if (aseguradora !== params.aseguradoraConfirmada) {
				return { sinConfirmar: true as const };
			}

			// El documento pasa a la copia, con el nombre que lleva el adjunto: el
			// reintento lee de aquí.
			await tx
				.update(opportunityDocuments)
				.set({
					filePath: copia,
					filename: copia.split("/").pop() ?? copia,
					originalName: nombre,
					mimeType: tipo,
					size: contenido.length,
				})
				.where(eq(opportunityDocuments.id, params.documentId));
			const correo = armarCorreoFacturaSeguro(datos, creadoAt);
			const [envio] = await tx
				.insert(insuranceInvoiceSubmissions)
				.values({
					opportunityId: fila.id,
					companyId: vigente.companyId,
					documentId: params.documentId,
					insuranceProvider: aseguradora,
					recipients: destinatarios,
					status: destinatarios.length > 0 ? "pendiente" : "sin_destinatario",
					correoAsunto: correo.asunto,
					correoHtml: correo.html,
					submittedBy: params.userId,
					createdAt: creadoAt,
					updatedAt: creadoAt,
				})
				.returning({
					id: insuranceInvoiceSubmissions.id,
					intento: insuranceInvoiceSubmissions.intento,
				});
			return { envio, aseguradora, destinatarios, correo };
		});

	let registro: Awaited<ReturnType<typeof registrar>>;
	try {
		registro = await registrar();
	} catch (error) {
		await deleteFileFromR2(copia).catch(() => {});
		throw error;
	}
	if (!registro) {
		await deleteFileFromR2(copia).catch(() => {});
		return {
			enviada: false,
			motivo: "la oportunidad cambió mientras se guardaba la factura",
		};
	}
	if ("sinConfirmar" in registro) {
		await deleteFileFromR2(copia).catch(() => {});
		return {
			enviada: false,
			motivo:
				"no se confirmó el envío a la aseguradora; vuelve a subirla para enviarla",
		};
	}
	// El archivo de la URL firmada no se borra: la key la manda el cliente y
	// otro documento puede estar usándola.

	const envio = await enviarYRegistrar({
		registro: registro.envio,
		destinatarios: registro.destinatarios,
		archivo: { key: copia, nombre },
		correo: registro.correo,
	});
	return { enviada: true, envio, aseguradora: registro.aseguradora };
}

function mimeDeFactura(file: { name: string; type?: string }) {
	const resuelto = validateResolvedMimeType(file);
	const mime = resuelto.mimeType;
	if (
		!resuelto.valid ||
		!mime ||
		!(MIME_FACTURA_SEGURO as readonly string[]).includes(mime)
	) {
		throw new ORPCError("BAD_REQUEST", {
			message: "La factura debe subirse en PDF o como imagen (JPG, PNG o WebP)",
		});
	}
	return mime;
}

export const changePartnerPasswordInputSchema = z
	.object({
		email: z.string().email(),
		currentPassword: z.string().min(1),
		newPassword: z.string().min(8),
		confirmPassword: z.string().min(8),
	})
	.refine((data) => data.newPassword === data.confirmPassword, {
		message: "Las contraseñas nuevas no coinciden",
		path: ["confirmPassword"],
	})
	// Better Auth acepta un cambio a la misma contraseña: sin esto, repetir la
	// temporal marca passwordChangedAt sin rotar nada de verdad.
	.refine((data) => data.newPassword !== data.currentPassword, {
		message: "La contraseña nueva debe ser distinta de la actual",
		path: ["newPassword"],
	});

export const trackerRouter = {
	getPartnerAgencies: partnerIdentityProcedure.handler(async ({ context }) => {
		return db
			.select({ id: companies.id, name: companies.name })
			.from(companies)
			.where(inArray(companies.id, context.companyIds))
			.orderBy(companies.name);
	}),

	getPartnerPasswordStatus: partnerIdentityProcedure.handler(({ context }) => ({
		mustChangePassword: !context.partnerAccount?.passwordChangedAt,
	})),

	changePartnerPassword: partnerIdentityProcedure
		.input(changePartnerPasswordInputSchema)
		.handler(async ({ input, context }) => {
			// Esta es la vía real que usa la pantalla de cambio de contraseña — la
			// ruta cruda /api/partner-auth/change-password casi nadie la llama
			// directo. Comparte cupo con ella (misma clave) porque ambas validan
			// la misma contraseña actual.
			const ip = extraerIp((nombre) => context.headers.get(nombre));
			if (
				!partnerAuthLimiter.permitir(`${ip}:${PARTNER_CHANGE_PASSWORD_PATH}`)
			) {
				throw new ORPCError("TOO_MANY_REQUESTS", {
					message: partnerAuthLimiter.mensaje,
				});
			}

			if (
				input.email.trim().toLowerCase() !==
				context.user.email.trim().toLowerCase()
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El correo no coincide con la sesión actual",
				});
			}

			// Sin revokeOtherSessions: con true, better-auth rota la sesión actual
			// y su Set-Cookie se perdía (llamada server-side sin asResponse),
			// botando al socio justo después del cambio exitoso. En su lugar,
			// borramos directo las demás sesiones del usuario (ej. una contraseña
			// temporal que alguien más también tenga) sin tocar la actual.
			try {
				await partnerAuth.api.changePassword({
					headers: context.headers,
					body: {
						currentPassword: input.currentPassword,
						newPassword: input.newPassword,
					},
				});
			} catch (error) {
				// Sin este catch, una contraseña actual incorrecta llegaba al socio
				// como un 500 genérico en vez de un mensaje que pudiera entender.
				if (error instanceof APIError) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							error.body?.message === "Invalid password"
								? "La contraseña actual no es correcta"
								: "No se pudo cambiar la contraseña",
					});
				}
				throw error;
			}

			await db
				.delete(session)
				.where(
					and(
						eq(session.userId, context.userId),
						ne(session.id, context.partnerSession.session.id),
					),
				);

			const ahora = new Date();
			await db
				.insert(partnerAccounts)
				.values({
					userId: context.userId,
					passwordChangedAt: ahora,
					createdAt: ahora,
					updatedAt: ahora,
				})
				.onConflictDoUpdate({
					target: partnerAccounts.userId,
					set: {
						passwordChangedAt: ahora,
						updatedAt: ahora,
					},
				});

			return { success: true };
		}),

	// Devuelve el universo completo del socio; el filtrado por período lo hace
	// el front, que necesita el historial para saber cuándo llegó a cada etapa.
	getCasos: partnerProcedure.handler(async ({ context }) => {
		const desde = new Date();
		desde.setUTCMonth(desde.getUTCMonth() - MESES_HISTORICO);

		const filas = await consultaBase()
			.where(
				and(
					condicionDeAlcance(context.membresias),
					dentroDeVentanaDeRetencion(desde),
				),
			)
			.orderBy(desc(opportunities.updatedAt));

		const historiales = await cargarHistoriales(filas);
		return filas.map((fila) =>
			aCaso(fila, historiales.get(fila.id) ?? [], context.membresias),
		);
	}),

	// Misma ventana de retención que getCasos: un caso que ya salió de la lista
	// por antiguo no debe seguir siendo alcanzable por id directo.
	getCasoById: partnerProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const fila = await casoDelSocio(input.id, context.membresias);
			const historiales = await cargarHistoriales([fila]);
			return aCaso(fila, historiales.get(fila.id) ?? [], context.membresias);
		}),

	// El archivo pasa por el server y no por una URL firmada: el CORS del bucket
	// de R2 no admite subidas desde el origen del tracker.
	subirFacturaSeguro: partnerProcedure
		.input(
			z.object({
				opportunityId: z.string().uuid(),
				archivo: z.instanceof(File),
			}),
		)
		.handler(async ({ input, context }) => {
			const fila = await casoDelSocio(input.opportunityId, context.membresias);
			// Antes de escribir en R2: si el caso no califica, no se sube nada.
			exigirReglaFactura(fila, context.membresias);

			mimeDeFactura({
				name: input.archivo.name,
				type: input.archivo.type || undefined,
			});
			if (input.archivo.size === 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El archivo está vacío",
				});
			}
			if (input.archivo.size > MAX_FILE_SIZE) {
				throw new ORPCError("BAD_REQUEST", {
					message: `La factura no puede pesar más de ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
				});
			}

			// El tipo que declara el cliente no alcanza: el archivo sale adjunto
			// en un correo de Club Cash In. Manda el contenido, y el nombre lleva
			// la extensión de ese tipo.
			const contenido = Buffer.from(await input.archivo.arrayBuffer());
			const mimeType = tipoRealDeFactura(contenido);
			if (!mimeType) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El archivo no es un PDF ni una imagen válida (JPG, PNG o WebP)",
				});
			}
			const nombre = nombreDeFactura(input.archivo.name, mimeType);

			// El correo se arma una vez y se guarda: el saludo usa esta misma
			// fecha (createdAt del registro), no la hora de cada reintento.
			const creadoAt = new Date();

			const subido = {
				key: `${buildUploadPrefix("opportunity_document", fila.id)}/${generateUniqueFilename(nombre)}`,
				mimeType,
				size: input.archivo.size,
			};
			await uploadBufferToR2(subido.key, contenido, mimeType);

			const registrar = () =>
				db.transaction(async (tx) => {
					// Oportunidad FOR UPDATE: dos subidas simultáneas se turnan y la
					// segunda ya ve la factura de la primera.
					const [vigente] = await tx
						.select({
							status: opportunities.status,
							closurePercentage: salesStages.closurePercentage,
							companyId: opportunities.companyId,
						})
						.from(opportunities)
						.innerJoin(salesStages, eq(salesStages.id, opportunities.stageId))
						.where(eq(opportunities.id, fila.id))
						.for("update", { of: opportunities });
					exigirMismoEstado(vigente?.status, fila.status);
					// Las membresías también se releen: un admin pudo quitarle el
					// acceso al socio mientras se subía el archivo. El lock del usuario
					// es el mismo con el que asignarAgencias serializa sus cambios.
					await tx
						.select({ id: user.id })
						.from(user)
						.where(eq(user.id, context.userId))
						.for("share");
					const membresias = await resolvePartnerScope(context.userId, tx);
					const [asignado] = await tx
						.select({ sellerId: opportunityAgencySellers.sellerId })
						.from(opportunityAgencySellers)
						.where(eq(opportunityAgencySellers.opportunityId, fila.id));
					const [previa] = await tx
						.select({ id: insuranceInvoiceSubmissions.id })
						.from(insuranceInvoiceSubmissions)
						.where(eq(insuranceInvoiceSubmissions.opportunityId, fila.id));
					exigirReglaFactura(
						{
							...fila,
							status: vigente?.status ?? fila.status,
							closurePercentage:
								vigente?.closurePercentage ?? fila.closurePercentage,
							companyId: vigente?.companyId ?? null,
							sellerId: asignado?.sellerId ?? null,
							facturaEnvio: previa ? "pendiente" : null,
						},
						membresias,
					);

					const { aseguradora, datos, destinatarios } =
						await datosDelCorreoBajoBloqueo(tx, fila);
					const correo = armarCorreoFacturaSeguro(datos, creadoAt);
					const [documento] = await tx
						.insert(opportunityDocuments)
						.values({
							opportunityId: fila.id,
							filename: subido.key.split("/").pop() ?? subido.key,
							originalName: nombre,
							mimeType: subido.mimeType,
							size: subido.size,
							documentType: "seguro_vehiculo",
							description: "Factura del seguro subida desde el tracker",
							uploadedBy: context.userId,
							filePath: subido.key,
						})
						.returning({ id: opportunityDocuments.id });

					const [envio] = await tx
						.insert(insuranceInvoiceSubmissions)
						.values({
							opportunityId: fila.id,
							// La leída bajo el lock: es contra la que se autorizó.
							companyId: vigente?.companyId ?? null,
							documentId: documento.id,
							insuranceProvider: aseguradora,
							recipients: destinatarios,
							status:
								destinatarios.length > 0 ? "pendiente" : "sin_destinatario",
							correoAsunto: correo.asunto,
							correoHtml: correo.html,
							submittedBy: context.userId,
							createdAt: creadoAt,
							updatedAt: creadoAt,
						})
						.returning({
							id: insuranceInvoiceSubmissions.id,
							intento: insuranceInvoiceSubmissions.intento,
						});
					return { envio, aseguradora, destinatarios, correo };
				});

			let registro: Awaited<ReturnType<typeof registrar>>;
			try {
				registro = await registrar();
			} catch (error) {
				// Solo se borra el archivo que esta misma llamada acaba de subir.
				await deleteFileFromR2(subido.key).catch(() => {});
				throw error;
			}

			// Después del commit: un fallo del correo no revierte la factura subida.
			const envio = await enviarYRegistrar({
				registro: registro.envio,
				destinatarios: registro.destinatarios,
				archivo: { key: subido.key, nombre },
				correo: registro.correo,
			});
			return { envio, aseguradora: registro.aseguradora };
		}),

	// Reintento único desde el CRM: usa la factura ya guardada.
	reenviarFacturaSeguro: crmProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const fila = await casoDelCrm(input.opportunityId, context);

			// Se reserva el registro (pasa a `pendiente` bajo bloqueo) antes de
			// mandar: dos clics seguidos no envían dos correos.
			const reservado = await db.transaction(async (tx) => {
				// La oportunidad se relee bajo bloqueo para respetar los cambios
				// de estado y de asesor comercial.
				const [vigente] = await tx
					.select({
						status: opportunities.status,
						assignedTo: opportunities.assignedTo,
					})
					.from(opportunities)
					.where(eq(opportunities.id, fila.id))
					.for("update");
				exigirMismoEstado(vigente?.status, fila.status);
				if (!puedeReintentarDesdeCrm(context, vigente?.assignedTo)) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para reenviar esta factura",
					});
				}
				const [registro] = await tx
					.select({
						id: insuranceInvoiceSubmissions.id,
						status: insuranceInvoiceSubmissions.status,
						intento: insuranceInvoiceSubmissions.intento,
						retryCount: insuranceInvoiceSubmissions.retryCount,
						recipients: insuranceInvoiceSubmissions.recipients,
						correoAsunto: insuranceInvoiceSubmissions.correoAsunto,
						correoHtml: insuranceInvoiceSubmissions.correoHtml,
						createdAt: insuranceInvoiceSubmissions.createdAt,
						insuranceProvider: insuranceInvoiceSubmissions.insuranceProvider,
						actualizadoAt: insuranceInvoiceSubmissions.updatedAt,
						key: opportunityDocuments.filePath,
						nombre: opportunityDocuments.originalName,
					})
					.from(insuranceInvoiceSubmissions)
					.innerJoin(
						opportunityDocuments,
						eq(opportunityDocuments.id, insuranceInvoiceSubmissions.documentId),
					)
					.where(eq(insuranceInvoiceSubmissions.opportunityId, fila.id))
					.for("update", { of: insuranceInvoiceSubmissions });

				const regla = puedeReenviarFacturaSeguro({
					envio: registro?.status ?? null,
					envioActualizadoAt: registro?.actualizadoAt ?? null,
					retryCount: registro?.retryCount ?? 0,
				});
				if (!regla.ok) {
					const codigo =
						regla.motivo === "sin_factura" ? "NOT_FOUND" : "CONFLICT";
					throw new ORPCError(codigo, {
						message: MENSAJE_SIN_REENVIO[regla.motivo],
					});
				}

				const aseguradora = resolverAseguradora(
					registro.insuranceProvider,
					null,
				);
				// Un `pendiente` abandonado tiene resultado desconocido: se repite el
				// mismo intento (misma llave y mismos destinatarios) y Resend no lo
				// duplica si ya salió, dentro de las 24 h de la llave. Pasado ese
				// plazo puede llegar dos veces; se permite igual para que el caso no
				// quede trabado. Solo un envío que falló pasa a otro intento.
				// Siempre se reenvía el correo guardado al subir, con sus datos y su
				// aseguradora; solo los registros previos a guardarlo se arman de nuevo.
				const correoGuardado =
					registro.correoAsunto && registro.correoHtml
						? { asunto: registro.correoAsunto, html: registro.correoHtml }
						: null;
				const repetirIntento = registro.status === "pendiente";
				const intento =
					registro.status === "fallido"
						? registro.intento + 1
						: registro.intento;
				const destinatarios = repetirIntento
					? registro.recipients
					: destinatariosDe(aseguradora);
				if (destinatarios.length === 0) {
					throw new ORPCError("CONFLICT", {
						message:
							"Aún no hay destinatarios configurados para esta aseguradora",
					});
				}
				const correo =
					correoGuardado ??
					armarCorreoFacturaSeguro(
						{ ...(await datosDelCorreo(fila, tx)).datos, aseguradora },
						registro.createdAt,
					);
				await tx
					.update(insuranceInvoiceSubmissions)
					.set({
						status: "pendiente",
						recipients: destinatarios,
						intento,
						retryCount: 1,
						correoAsunto: correo.asunto,
						correoHtml: correo.html,
						error: null,
						updatedAt: new Date(),
					})
					.where(eq(insuranceInvoiceSubmissions.id, registro.id));
				return {
					registro: { ...registro, intento },
					aseguradora,
					destinatarios,
					correo,
				};
			});

			const envio = await enviarYRegistrar({
				registro: reservado.registro,
				destinatarios: reservado.destinatarios,
				archivo: {
					key: reservado.registro.key,
					nombre: reservado.registro.nombre,
				},
				correo: reservado.correo,
			});
			return { envio, aseguradora: reservado.aseguradora };
		}),

	// Solo lectura: la abre cualquiera que tenga el caso a su alcance (el
	// vendedor asignado o el gerente de la agencia).
	verFacturaSeguro: partnerProcedure
		.input(z.object({ opportunityId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			await casoDelSocio(input.opportunityId, context.membresias);
			const [documento] = await db
				.select({ key: opportunityDocuments.filePath })
				.from(insuranceInvoiceSubmissions)
				.innerJoin(
					opportunityDocuments,
					eq(opportunityDocuments.id, insuranceInvoiceSubmissions.documentId),
				)
				.where(
					eq(insuranceInvoiceSubmissions.opportunityId, input.opportunityId),
				)
				.limit(1);
			if (!documento) {
				throw new ORPCError("NOT_FOUND", {
					message: "Este caso todavía no tiene factura del seguro",
				});
			}
			return { url: await getFileUrl(documento.key) };
		}),
};
