import { sendPlainEmail } from "@cci/email";
import { ORPCError } from "@orpc/server";
import { SMSClient } from "@repo/sms";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	lte,
	max,
	or,
	sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	carteraBackReferences,
	pagoReferences,
} from "../db/schema/cartera-back";
import {
	casosCobros,
	cierreDiarioCreditoCobros,
	contactosCobros,
	contratosFinanciamiento,
	conveniosPago,
	estadoContactoEnum,
	estadoMoraEnum,
	metasMoraCobros,
	metodoContactoEnum,
	recuperacionesVehiculo,
} from "../db/schema/cobros";
import { cobrosSendLogs } from "../db/schema/cobros-send-logs";
import {
	clients,
	leads,
	opportunities,
	PARENTESCO_VALUES,
	referenciasLead,
	salesStages,
} from "../db/schema/crm";
import { notifications } from "../db/schema/notifications";
import { quotations } from "../db/schema/quotations";
import { recordatoriosPremora } from "../db/schema/recordatorios-premora";
import { vehicles } from "../db/schema/vehicles";
import {
	PREFIJO_PREMORA_AUTO,
	PREFIJO_WSP_MASIVO,
} from "../jobs/cierre-diario-asesores";
import {
	payloadEdicionManual,
	registrarAuditContacto,
} from "../lib/audit-contactos";
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
import {
	deriveHasCapitalData,
	recalculateCobrosPercentagesWithFallback,
} from "../lib/cobros-capital-percentages";
import {
	countRemainingInstallments,
	resolveCreditContractSummary,
	resolveHistoricalInstallment,
	resolveInstallmentAmount,
	resolveOperationalInstallment,
} from "../lib/cobros-credit-detail";
import {
	interpolar as interpolarPlantilla,
	PLANTILLAS_MENSAJES,
	prepararTelefonoAsesorParaEnvio,
} from "../lib/cobros-plantillas";
import { filterCobrosSearchResults } from "../lib/cobros-search";
import {
	CATEGORIAS_COLA_DIA,
	calificaParaColaDia,
	calificaParaFiltro,
	clasificarCreditoColaDia,
	ordenColaDia,
} from "../lib/cola-dia";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { gtDateStrToDate, toDateStrGT } from "../lib/guatemala-month-window";
import {
	getTestPhone,
	isTestModeEnabled,
	TEST_EMAIL,
} from "../lib/messaging-test-mode";
import { calcularDiasMoraExactos } from "../lib/mora-utils";
import {
	ESTADOS_AGING_VALIDOS,
	esperarCatalogoBuckets,
	estadoMoraPorCuotas,
	getBucketsParaUIAsync,
	isDynamicCatalogLoaded,
	MORA_BUCKETS,
	numeroBucketPorCuotas,
	rangoCuotasPorEstadoMora,
	refreshMoraBucketsCache,
} from "../lib/moraBuckets";
import {
	adminProcedure,
	cobrosProcedure,
	cobrosSupervisorProcedure,
	crmCobrosOrInvestmentsProcedure,
	crmOrCobrosProcedure,
} from "../lib/orpc";
import { primerTelefono } from "../lib/phone-utils";
import {
	aplicarCambiosEstadoPromesa,
	auditarTransiciones,
} from "../lib/promesa-estado-batch";
import {
	derivarEstadoCredito,
	type EstadoPromesa,
	evaluarPromesa,
} from "../lib/promesa-pago";
import { condicionesPromesaVigente } from "../lib/promesa-vigente";
import { pushPromesaActivaEnSegundoPlano } from "../lib/push-promesa-cartera-back";
import { resolverNumeroSifco } from "../lib/resolver-numero-sifco";
import { PERMISSIONS } from "../lib/roles";
import {
	sendWhatsappTemplate,
	sendWhatsappTemplateBatch,
} from "../lib/simpletech";
import {
	buscarAsesorCarteraPorEmail,
	obtenerPaginaAgenda,
} from "../services/agenda-cobros-source";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	createPagoInCarteraBack,
	getCreditoReferenceByNumeroSifco,
	isCarteraBackEnabled,
	isCarteraBackPaymentsEnabled,
} from "../services/cartera-back-integration";
import {
	getUltimasSincronizaciones,
	sincronizarCasosCobros,
} from "../services/sync-casos-cobros";
import type { CreditoDirectoResponse } from "../types/cartera-back";
import { createNotification } from "./notifications";

// Helper: Obtener todos los créditos de todos los estados
async function obtenerTodosLosCreditosCarteraBack(params: {
	mes: number;
	anio: number;
	page?: number;
	perPage?: number;
	cuotasMin?: number;
	cuotasMax?: number;
	estado?:
		| "ACTIVO"
		| "CANCELADO"
		| "INCOBRABLE"
		| "PENDIENTE_CANCELACION"
		| "EN_CONVENIO"
		| "MOROSO";
	nombre_usuario?: string;
	numero_credito_sifco?: string;
	numeros_credito_sifco?: string[];
	time?: "WEEK" | "MONTH" | "DUEMONTH" | "TODAY";
	email_cobrador?: string;
	fecha_desde?: string;
	fecha_hasta?: string;
	capital_min?: number;
	capital_max?: number;
	excluir_pagados_mes?: boolean;
}) {
	const estado = params.estado || "ACTIVO";

	// Antes había un .catch que devolvía respuesta vacía si cartera fallaba.
	// Eso enmascaraba errores reales (ej. 414 URI Too Long con listas grandes
	// de SIFCOs) y hacía que la tabla mostrara 0 casos y el envío masivo
	// despachara a 0 destinatarios silenciosamente. Ahora propagamos el error
	// para que el endpoint ORPC lo levante como tal.
	const response = await carteraBackClient.getAllCreditos({
		mes: params.mes,
		anio: params.anio,
		page: params.page,
		perPage: params.perPage,
		estado: estado,
		...(params.cuotasMin !== undefined && {
			cuotas_min: params.cuotasMin,
		}),
		...(params.cuotasMax !== undefined && {
			cuotas_max: params.cuotasMax,
		}),
		...(params.nombre_usuario !== undefined &&
			params.nombre_usuario !== "" && {
				nombre_usuario: params.nombre_usuario,
			}),
		...(params.numero_credito_sifco !== undefined &&
			params.numero_credito_sifco !== "" && {
				numero_credito_sifco: params.numero_credito_sifco,
			}),
		...(params.numeros_credito_sifco !== undefined &&
			params.numeros_credito_sifco.length > 0 && {
				numeros_credito_sifco: params.numeros_credito_sifco,
			}),
		...(params.time !== undefined && { time: params.time }),
		...(params.email_cobrador !== undefined &&
			params.email_cobrador !== "" && {
				email_cobrador: params.email_cobrador,
			}),
		...(params.fecha_desde !== undefined && {
			fecha_desde: params.fecha_desde,
		}),
		...(params.fecha_hasta !== undefined && {
			fecha_hasta: params.fecha_hasta,
		}),
		...(params.capital_min !== undefined && {
			capital_min: params.capital_min,
		}),
		...(params.capital_max !== undefined && {
			capital_max: params.capital_max,
		}),
		...(params.excluir_pagados_mes && {
			excluir_pagados_mes: true,
		}),
	});

	return {
		data: response.data,
		page: response.page,
		perPage: response.perPage,
		totalCount: response.totalCount,
		totalPages: response.totalPages,
	};
}

// Helper: Pagina getAllCreditos hasta traer la cartera completa que matchea
// los filtros. Sin esto, un solo fetch trunca silenciosamente cuando la
// cartera supera el perPage.
async function obtenerTodasLasPaginasCreditos(
	params: Omit<
		Parameters<typeof obtenerTodosLosCreditosCarteraBack>[0],
		"page" | "perPage"
	>,
) {
	const perPage = 100;
	// Tope duro: 200 páginas = 20k créditos, muy por encima de la cartera real.
	const maxPages = 200;

	return fetchAllPages(
		async (page) => {
			const resp = await obtenerTodosLosCreditosCarteraBack({
				...params,
				page,
				perPage,
			});
			return { data: resp.data, totalPages: resp.totalPages ?? 0 };
		},
		{ maxPages },
	);
}

/**
 * Verifica si la auto-creación de datos migrate está habilitada
 */
function isAutoMigrateEnabled(): boolean {
	return process.env.ENABLE_AUTO_MIGRATE_OPPORTUNITIES === "true";
}

/**
 * Parsea nombre completo en componentes (firstName, middleName, lastName, secondLastName)
 */
function parseNombreCompleto(nombreCompleto: string | null | undefined): {
	firstName: string;
	middleName: string | null;
	lastName: string;
	secondLastName: string | null;
} {
	if (!nombreCompleto) {
		return {
			firstName: "N/A",
			middleName: null,
			lastName: "N/A",
			secondLastName: null,
		};
	}
	const partes = nombreCompleto.trim().split(/\s+/);
	if (partes.length === 1)
		return {
			firstName: partes[0],
			middleName: null,
			lastName: "N/A",
			secondLastName: null,
		};
	if (partes.length === 2)
		return {
			firstName: partes[0],
			middleName: null,
			lastName: partes[1],
			secondLastName: null,
		};
	if (partes.length === 3)
		return {
			firstName: partes[0],
			middleName: null,
			lastName: partes[1],
			secondLastName: partes[2],
		};
	return {
		firstName: partes[0],
		middleName: partes[1],
		lastName: partes[2],
		secondLastName: partes.slice(3).join(" "),
	};
}

/**
 * Auto-crea lead, vehículo y oportunidad cuando no se encuentra la oportunidad por número SIFCO.
 * Solo se ejecuta si ENABLE_AUTO_MIGRATE_OPPORTUNITIES=true.
 * Retorna los datos creados para que el endpoint los use, o null si no aplica.
 */
async function autoCrearDatosMigrate({
	numeroSifco,
	nombreCliente,
	deudaTotal,
	cuotaMensual,
	diaPagoMensual,
	tipoCredito,
	userId,
}: {
	numeroSifco: string;
	nombreCliente: string;
	deudaTotal: string;
	cuotaMensual: string;
	diaPagoMensual: number | null;
	tipoCredito: string | null;
	userId: string;
}) {
	if (!isAutoMigrateEnabled()) return null;

	console.log(
		`[AutoMigrate] Creando datos migrate para crédito ${numeroSifco}`,
	);

	const nombre = parseNombreCompleto(nombreCliente);

	// Obtener stage antes de la transacción (solo lectura)
	const [defaultStage] = await db
		.select({ id: salesStages.id })
		.from(salesStages)
		.orderBy(desc(salesStages.order))
		.limit(1);

	if (!defaultStage) {
		console.error("[AutoMigrate] No hay etapas de venta configuradas");
		return null;
	}

	const creditType = tipoCredito?.toLowerCase().includes("autocompra")
		? ("autocompra" as const)
		: ("sobre_vehiculo" as const);

	// Transacción atómica: si algo falla, se revierte todo
	const result = await db.transaction(async (tx) => {
		// 1. Crear Lead con solo el nombre, status "migrate"
		const [nuevoLead] = await tx
			.insert(leads)
			.values({
				firstName: nombre.firstName,
				middleName: nombre.middleName,
				lastName: nombre.lastName,
				secondLastName: nombre.secondLastName,
				email: `migrado_${Date.now()}@placeholder.com`,
				source: "other",
				status: "migrate",
				assignedTo: userId,
				createdBy: userId,
				notes: `Creado automáticamente desde Cartera-Back. Crédito SIFCO: ${numeroSifco}`,
			})
			.returning({ id: leads.id });

		// 2. Crear Vehículo con datos nulos, status "sold"
		const [nuevoVehiculo] = await tx
			.insert(vehicles)
			.values({
				make: "N/A",
				model: "N/A",
				year: 2000,
				color: "N/A",
				vehicleType: "N/A",
				status: "sold",
			})
			.returning({ id: vehicles.id });

		// 3. Crear Oportunidad enlazando lead y vehículo
		await tx.insert(opportunities).values({
			title: `Crédito ${numeroSifco}`,
			leadId: nuevoLead.id,
			vehicleId: nuevoVehiculo.id,
			creditType,
			stageId: defaultStage.id,
			assignedTo: userId,
			createdBy: userId,
			status: "migrate",
			numeroSifco,
			diaPagoMensual: diaPagoMensual,
			cuotaMensual: cuotaMensual,
			value: deudaTotal,
			notes: "Crédito migrado automáticamente desde Cartera-Back.",
		});

		return { leadId: nuevoLead.id, vehiculoId: nuevoVehiculo.id };
	});

	console.log(
		`[AutoMigrate] Datos creados exitosamente para crédito ${numeroSifco} (lead: ${result.leadId}, vehiculo: ${result.vehiculoId})`,
	);

	return {
		leadId: result.leadId,
		vehiculoId: result.vehiculoId,
		leadInfo: {
			nombre: `${nombre.firstName} ${nombre.lastName}`.trim(),
			email: null as string | null,
			telefono: null as string | null,
		},
		vehiculo: {
			make: "N/A" as string | null,
			model: "N/A" as string | null,
			year: 2000 as number | null,
			licensePlate: null as string | null,
			tipo: null as string | null,
			motor: null as string | null,
			chasis: null as string | null,
			asientos: null as number | null,
			uso: null as string | null,
			numeroPoliza: null as string | null,
			fechaInicioSeguro: null as Date | null,
			fechaVencimientoSeguro: null as Date | null,
			montoAsegurado: null as string | null,
		},
		oportunidadData: {
			notes: null as string | null,
			cuotaMensual: cuotaMensual,
			diaPago: diaPagoMensual,
			creditType: creditType as string | null,
		},
	};
}

// CB-020: input de createContactoCobros, extraído como constante exportada
// (Codex, PR #1147) para poder testear los .refine() de promesa_pago
// (rango/mora obligatorio, fecha obligatoria) sin depender de DB/contexto —
// antes vivía inline dentro de .input(), sin forma de importarlo en un test.
export const createContactoCobrosSchema = z
	.object({
		casoCobroId: z.string().uuid(),
		metodoContacto: z.enum(metodoContactoEnum.enumValues),
		estadoContacto: z.enum(estadoContactoEnum.enumValues),
		duracionLlamada: z.number().optional(),
		comentarios: z.string().min(1, "Los comentarios son requeridos"),
		acuerdosAlcanzados: z.string().optional(),
		compromisosPago: z.string().optional(),
		requiereSeguimiento: z.boolean().default(false),
		fechaProximoContacto: z.date().optional(),
		// CB-029: "alerta programada" — cuándo avisar al asesor antes del
		// vencimiento (default D-1 lo pone el modal). Solo para promesa_pago.
		fechaAlerta: z.date().optional(),
		// CB-029: si viene, se EDITA esa promesa activa en vez de crear una nueva
		// (una sola promesa activa por caso; el modal lo pasa al abrir en edición).
		promesaContactoId: z.string().uuid().optional(),
		// CB-025: qué hacer, no cuándo (eso es fechaProximoContacto). Texto
		// libre, opcional — sin catálogo cerrado (ver nota en
		// estadoContactoEnum sobre catálogos pendientes de negocio).
		proximoPaso: z.string().optional(),
		// CB-020: promesa de pago atada a cuotas — solo relevantes cuando
		// estadoContacto = 'promesa_pago'.
		cuotaInicio: z.number().int().positive().optional(),
		cuotaFin: z.number().int().positive().optional(),
		incluyeMora: z.boolean().default(false),
		// CB-025: informativo, no participa en evaluarPromesa — por eso sin
		// .refine() que lo exija. Mismo regex que montoAcordado/
		// montoCuotaConvenio (createConvenioPago, arriba) para no dejar pasar
		// basura a una columna numeric(12,2).
		montoComprometido: z
			.string()
			.regex(/^\d+(\.\d{1,2})?$/, "Formato de monto inválido")
			.optional(),
	})
	// CB-020: promesa_pago exige rango de cuotas y/o mora — una
	// promesa vacía de ambos no verifica nada real. El web (PR
	// #1147, mergeado) ya exige esto en el modal; este .refine()
	// estuvo deshabilitado temporalmente mientras el web viejo en
	// producción todavía mandaba promesa_pago sin ninguno de los
	// dos — repuesto ahora que ese web se reemplazó.
	.refine(
		(v) =>
			v.estadoContacto !== "promesa_pago" ||
			v.cuotaInicio != null ||
			v.cuotaFin != null ||
			v.incluyeMora,
		{
			message: "Indica un rango de cuotas, marca que incluye mora, o ambos",
			path: ["incluyeMora"],
		},
	)
	.refine(
		(v) =>
			v.cuotaInicio == null ||
			v.cuotaFin == null ||
			v.cuotaFin >= v.cuotaInicio,
		{
			message: "cuotaFin debe ser mayor o igual a cuotaInicio",
			path: ["cuotaFin"],
		},
	)
	// CB-020: fechaProximoContacto es la fecha prometida — sin ella,
	// check-promesas-pago.ts (job nocturno) salta la fila para
	// siempre, dejándola "pendiente" eterna. El web (PR #1147,
	// mergeado) ya la exige en el modal (obligatoria al submit);
	// repuesto ahora que ese web se reemplazó.
	.refine(
		(v) =>
			v.estadoContacto !== "promesa_pago" || v.fechaProximoContacto != null,
		{
			message: "La fecha prometida es obligatoria",
			path: ["fechaProximoContacto"],
		},
	)
	.refine(
		// CB-020 (review Codex): el primer .refine() de arriba solo exige
		// "rango completo O incluyeMora" — eso deja pasar un rango A
		// MEDIAS (ej. cuotaInicio=5, cuotaFin=null) siempre que
		// incluyeMora=true, porque esa condición sola ya satisface el
		// OR. evaluarPromesa trata cuotaFin=null como "sin rango, no
		// bloquea" (tieneRango=false), así que la cuota #5 que el
		// usuario SÍ especificó nunca se verifica — una promesa de
		// "mora + cuota" puede marcarse cumplida con solo que se
		// salde la mora. Ambos bounds o ninguno, SIEMPRE, sin
		// importar incluyeMora.
		(v) => (v.cuotaInicio == null) === (v.cuotaFin == null),
		{
			message: "Debes indicar ambas cuotas (desde y hasta) o ninguna",
			path: ["cuotaFin"],
		},
	)
	// CB-029 (Codex PR #1232): la alerta programada no puede ser POSTERIOR a la
	// fecha prometida — una alerta post-vencimiento nunca dispararía (la promesa
	// ya sería incumplida/cumplida). El modal ya lo capa en el picker.
	.refine(
		(v) =>
			v.fechaAlerta == null ||
			v.fechaProximoContacto == null ||
			v.fechaAlerta <= v.fechaProximoContacto,
		{
			message: "La alerta no puede ser posterior a la fecha prometida",
			path: ["fechaAlerta"],
		},
	);

// CB-029: la promesa ACTIVA de un caso = pendiente cuya fecha prometida no ha
// pasado (día GT). A lo sumo una — sirve para el guard "una sola activa por
// caso". El frontend detecta la misma con el estado ya recalculado.
// estado_promesa NULL (promesa vieja aún sin evaluar) cuenta como pendiente —
// mismo criterio que getColaDia/getEstadoPromesasPago (`estadoPromesa ??
// 'pendiente'`); sin el isNull, un caso con una promesa NULL futura burlaba el
// guard y se podía insertar una segunda activa (Codex PR #1232).
async function promesaActivaDelCaso(casoCobroId: string) {
	const [row] = await db
		.select({ id: contactosCobros.id })
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.casoCobroId, casoCobroId),
				...condicionesPromesaVigente(),
			),
		)
		.limit(1);
	return row ?? null;
}

/**
 * CB-128 (AC-2): bucket del crédito al momento de registrar la gestión.
 *
 * BEST-EFFORT por diseño: si el caso no tiene número SIFCO, si cartera-back
 * está caído o si el crédito salió del funnel (EN_CONVENIO/CANCELADO/…, que no
 * tienen bucket), devuelve null y la gestión se guarda igual. Registrar la
 * gestión es lo que no puede fallar — el snapshot es un dato de reportería, y
 * bloquear al asesor por él sería invertir las prioridades.
 *
 * NO PASA POR CACHE: `getBucketActualCredito` va siempre a la red (el cliente
 * de cartera-back no cachea ese endpoint). Es lo que queremos acá — el snapshot
 * debe ser el bucket EXACTO del momento, y un valor cacheado podría ser previo
 * a un cambio reciente y grabar un dato falso justo en la columna que existe
 * para preservar la verdad histórica. Si algún día se le agrega cache a ese
 * endpoint, esta llamada tiene que quedar fuera.
 *
 * Como cada llamada va a la red, se acota con un TIMEOUT CORTO (3s). El default
 * del cliente son 30s con hasta 3 reintentos: en el peor caso serían ~93s
 * colgando el guardado del asesor por un dato de reportería. Con 3s, si
 * cartera-back no responde rápido se graba NULL y la gestión se guarda igual.
 *
 * ── Por qué EN SERIE antes del INSERT y no diferido ───────────────────────
 *
 * Esos 3s de peor caso se pagan en el camino del asesor, así que la alternativa
 * obvia es insertar con NULL y completar el bucket con un UPDATE después de
 * responder. Se descartó: ese UPDATE sería una CUARTA escritura sobre
 * contactos_cobros, y el AC-6 exige que toda alteración quede auditada — habría
 * que auditar cada creación de gestión, llenando la bitácora de ruido para
 * ahorrar una latencia que solo aparece cuando cartera-back está degradado.
 *
 * El caso normal es una llamada rápida; los 3s son el techo, no el costo
 * típico. Si algún día la latencia p95 de getBucketActualCredito se acerca al
 * timeout, la salida correcta NO es diferir el UPDATE sino leer el bucket de
 * `casos_cobros.estado_mora`, que ya está denormalizado localmente y no cuesta
 * red — a costa de ser el estado del último sync y no el del instante exacto.
 */
const TIMEOUT_BUCKET_SNAPSHOT_MS = 3000;

async function capturarBucketSnapshot(
	casoCobroId: string,
): Promise<number | null> {
	// Mismo guard que getBucketActualCredito: sin esto, con la integración
	// apagada, cada gestión manual dispara una llamada real (localhost/auth
	// fallando) que solo se resuelve al vencer la carrera de 3s — un guardado
	// local termina esperando por una integración que se sabe apagada.
	if (!isCarteraBackEnabled()) return null;
	try {
		const [caso] = await db
			.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
			.from(casosCobros)
			.where(eq(casosCobros.id, casoCobroId))
			.limit(1);

		const sifco = caso?.numeroCreditoSifco?.trim();
		if (!sifco) return null;

		// Carrera contra el reloj: lo que gane primero. No se aborta la llamada
		// subyacente (el cliente maneja su propio timeout), simplemente se deja de
		// esperarla — registrar la gestión no puede depender de cartera-back.
		//
		// El timer se limpia en el finally: si gana cartera-back, un setTimeout
		// vivo mantiene el event loop ocupado hasta 3s (en tests eso bloquea el
		// drenaje) y bajo ráfagas se acumulan uno por gestión.
		let timer: ReturnType<typeof setTimeout> | undefined;
		let actual: Awaited<
			ReturnType<typeof carteraBackClient.getBucketActualCredito>
		>;
		try {
			actual = await Promise.race([
				carteraBackClient.getBucketActualCredito(sifco),
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), TIMEOUT_BUCKET_SNAPSHOT_MS);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
		// `bucket` ya viene null cuando el crédito está fuera del funnel.
		return actual?.bucket ?? null;
	} catch (error) {
		console.error(
			`[capturarBucketSnapshot] No se pudo resolver el bucket del caso ${casoCobroId}:`,
			error,
		);
		return null;
	}
}

export const cobrosRouter = {
	// Dashboard de cobros - Vista general del embudo
	getDashboardStats: cobrosProcedure
		.input(
			z
				.object({
					emailCobrador: z.string().optional(),
				})
				.optional(),
		)
		.handler(async ({ input, context }) => {
			// Si la integración con Cartera-Back está habilitada, usar el endpoint de stats
			if (isCarteraBackEnabled()) {
				try {
					console.log(
						`[Cobros] Obteniendo stats desde Cartera-Back endpoint /stats${input?.emailCobrador ? `?email=${input.emailCobrador}` : ""}`,
					);

					// Usar el nuevo endpoint de stats de cartera-back
					const statsResponse = await carteraBackClient.getStats({
						email: input?.emailCobrador,
					});

					// Mapear cuotas atrasadas a estados de mora - usar datos exactos de cartera.
					// `estadoMora` viene del catálogo dinámico (cartera.buckets vía /stats
					// enriquecido); el fallback deriva de MORA_BUCKETS (no un objeto literal
					// capado a "0".."5") para que un bucket nuevo/renumerado tenga fallback
					// también en la ventana en la que /stats aún no lo enriquece.
					// Se itera sobre las keys reales de `porCuotasAtrasadas` (no una lista
					// fija "0".."5") para que un bucket nuevo o renumerado en el catálogo
					// no quede excluido silenciosamente del embudo/porcentajes del CRM.
					const cuotasKeys = Object.keys(statsResponse.porCuotasAtrasadas).sort(
						(a, b) => Number(a) - Number(b),
					);

					const bucketsFunnel = cuotasKeys.map((key) => {
						const bucketStats = statsResponse.porCuotasAtrasadas[key];
						const fallbackEstado =
							MORA_BUCKETS.find((b) => b.key === key)?.estadoMora ?? "al_dia";
						// `estadoMora` de /stats viene del mismo catálogo varchar(24)
						// editable a mano que valida moraBuckets.ts — se aplica la misma
						// whitelist de AGING aquí (no ESTADOS_MORA_VALIDOS completo): estos
						// son buckets de CUOTAS, no filas de status — un "en_convenio"/
						// "pagado"/"incobrable" colado aquí sería válido en el enum pero
						// semánticamente incorrecto para un bucket de aging.
						const estadoMora =
							bucketStats?.estadoMora &&
							ESTADOS_AGING_VALIDOS.has(bucketStats.estadoMora)
								? bucketStats.estadoMora
								: fallbackEstado;
						return {
							estadoMora,
							totalCases: bucketStats?.cantidad || 0,
							montoTotal: bucketStats?.sumaMora || "0",
							// sumaCapitalCruda preserva undefined/null tal como vino en el
							// payload (para deriveHasCapitalData); sumaCapital ya defaultea
							// a "0" para el cálculo de porcentajes.
							sumaCapitalCruda: bucketStats?.sumaCapital,
							sumaCapital: bucketStats?.sumaCapital || "0",
							porcentaje: bucketStats?.porcentaje || "0",
						};
					});

					// Denominador de porcentajes = los estados de aging que realmente
					// llegaron en este funnel (derivado, no un Set fijo de 6) — sin esto,
					// un bucket nuevo/renumerado se lista en el array pero su capital
					// queda fuera del total y nunca recibe porcentaje (ver
					// cobros-capital-percentages.ts).
					const activeEstados = new Set(bucketsFunnel.map((b) => b.estadoMora));

					const statsCrudasParaDerivar = [
						...bucketsFunnel.map((b) => ({
							estadoMora: b.estadoMora,
							sumaCapital: b.sumaCapitalCruda,
						})),
						{
							estadoMora: "completado",
							sumaCapital: statsResponse.porEstado.cancelado?.sumaCapital,
						},
						{
							estadoMora: "incobrable",
							sumaCapital: statsResponse.porEstado.incobrable?.sumaCapital,
						},
					];

					// all-or-nothing: si UN bucket activo no trajo sumaCapital real, la
					// fuente completa se trata como sin capital confiable (ver
					// deriveHasCapitalData) -- evita mezclar buckets con capital real y
					// buckets con capital desconocido-tratado-como-cero en el mismo %.
					const hasCapitalData = deriveHasCapitalData(
						statsCrudasParaDerivar,
						activeEstados,
					);

					const estatusStats = recalculateCobrosPercentagesWithFallback(
						[
							...bucketsFunnel.map(({ sumaCapitalCruda, ...bucket }) => bucket),
							{
								estadoMora: "completado",
								totalCases: statsResponse.porEstado.cancelado?.cantidad || 0,
								montoTotal: statsResponse.porEstado.cancelado?.sumaMora || "0",
								sumaCapital:
									statsResponse.porEstado.cancelado?.sumaCapital || "0",
								porcentaje:
									statsResponse.porEstado.cancelado?.porcentaje || "0",
							},
							{
								estadoMora: "incobrable",
								totalCases: statsResponse.porEstado.incobrable?.cantidad || 0,
								montoTotal: statsResponse.porEstado.incobrable?.sumaMora || "0",
								sumaCapital:
									statsResponse.porEstado.incobrable?.sumaCapital || "0",
								porcentaje:
									statsResponse.porEstado.incobrable?.porcentaje || "0",
							},
						],
						hasCapitalData,
						activeEstados,
					);

					console.log(
						"[Cobros] Stats obtenidas desde endpoint /stats:",
						estatusStats,
					);

					// Contactos realizados hoy
					const contactosHoy = await db
						.select({ count: count() })
						.from(contactosCobros)
						.where(
							gte(
								contactosCobros.fechaContacto,
								new Date(new Date().setHours(0, 0, 0, 0)),
							),
						);

					return {
						estatusStats,
						totalCasosAsignados: statsResponse.totalCreditos,
						efectividad: statsResponse.efectividad,
						contactosHoy: contactosHoy[0]?.count || 0,
						fuente: hasCapitalData
							? ("cartera-back" as const)
							: ("cartera-back-parcial" as const),
					};
				} catch (error) {
					console.error(
						"[Cobros] Error obteniendo stats desde Cartera-Back:",
						error,
					);
					// Fallback a datos locales
				}
			}

			// Fallback: Calcular stats desde la base de datos local
			const estatusStats = await db
				.select({
					estadoContrato: contratosFinanciamiento.estado,
					estadoMora: casosCobros.estadoMora,
					totalCases: count(),
					montoTotal: sql<string>`COALESCE(SUM(CASE WHEN ${casosCobros.montoEnMora} IS NOT NULL THEN ${casosCobros.montoEnMora} ELSE 0 END), 0)`,
				})
				.from(contratosFinanciamiento)
				.leftJoin(
					casosCobros,
					eq(contratosFinanciamiento.id, casosCobros.contratoId),
				)
				.groupBy(contratosFinanciamiento.estado, casosCobros.estadoMora);

			// Procesar estadísticas para el embudo
			const embudoStats = {
				al_dia: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_30: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_60: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_90: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_120: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				mora_120_plus: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				pagado: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				incobrable: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
				completado: {
					totalCases: 0,
					montoTotal: "0",
					sumaCapital: "0",
					porcentaje: "0",
				},
			};

			estatusStats.forEach((stat) => {
				if (stat.estadoContrato === "completado") {
					embudoStats.completado.totalCases += stat.totalCases;
				} else if (
					stat.estadoContrato === "incobrable" ||
					stat.estadoContrato === "recuperado"
				) {
					// Contratos incobrables y recuperados van al bucket "incobrable"
					embudoStats.incobrable.totalCases += stat.totalCases;
					const currentMonto = Number(embudoStats.incobrable.montoTotal);
					embudoStats.incobrable.montoTotal = (
						currentMonto + Number(stat.montoTotal)
					).toString();
				} else if (stat.estadoContrato === "activo" && !stat.estadoMora) {
					// Contratos activos sin caso de cobros = al día
					embudoStats.al_dia.totalCases += stat.totalCases;
				} else if (stat.estadoMora) {
					// Casos con estado de mora específico
					if (stat.estadoMora in embudoStats) {
						embudoStats[
							stat.estadoMora as keyof typeof embudoStats
						].totalCases += stat.totalCases;
						const currentMonto = Number(
							embudoStats[stat.estadoMora as keyof typeof embudoStats]
								.montoTotal,
						);
						embudoStats[
							stat.estadoMora as keyof typeof embudoStats
						].montoTotal = (currentMonto + Number(stat.montoTotal)).toString();
					}
				}
			});

			// Casos asignados al usuario actual
			const casosAsignados = await db
				.select({ count: count() })
				.from(casosCobros)
				.where(
					context.userRole === "admin"
						? eq(casosCobros.activo, true)
						: and(
								eq(casosCobros.activo, true),
								eq(casosCobros.responsableCobros, context.userId),
							),
				);

			// Contactos realizados hoy
			const contactosHoy = await db
				.select({ count: count() })
				.from(contactosCobros)
				.where(
					gte(
						contactosCobros.fechaContacto,
						new Date(new Date().setHours(0, 0, 0, 0)),
					),
				);

			return {
				estatusStats: recalculateCobrosPercentagesWithFallback(
					Object.entries(embudoStats).map(([estado, data]) => ({
						estadoMora: estado,
						...data,
					})),
					// El fallback local nunca calcula sumaCapital (queda en "0" a
					// propósito) -> siempre calcular porcentaje por número de casos.
					false,
				),
				totalCasosAsignados: casosAsignados[0]?.count || 0,
				efectividad: "0",
				contactosHoy: contactosHoy[0]?.count || 0,
				fuente: "local" as const,
			};
		}),

	// Obtener todos los contratos con sus estados (incluyendo al día e incobrables)
	getTodosLosCreditos: cobrosProcedure
		.input(
			z.object({
				limit: z.number().optional(),
				offset: z.number().optional(),
				estadoMora: z.string().optional(),
				searchTerm: z.string().optional(),
				numeroSifco: z.string().optional(),
				time: z.enum(["WEEK", "MONTH", "DUEMONTH", "TODAY"]).optional(),
				emailCobrador: z.string().optional(),
				fechaDesde: z.string().optional(),
				fechaHasta: z.string().optional(),
				etiquetas: z.array(z.string()).optional(),
				capitalMin: z.number().optional(),
				capitalMax: z.number().optional(),
				excluirPagadosMes: z.boolean().optional(),
			}),
		)
		.handler(async ({ input }) => {
			// Si la integración con Cartera-Back está habilitada, obtener datos directamente
			if (isCarteraBackEnabled()) {
				try {
					// Usar mes=0 para obtener TODOS los créditos sin filtrar por mes
					const mes = 0;
					const anio = new Date().getFullYear();

					// Mapear filtro de estadoMora a parámetros de cartera-back.
					// El rango de cuotas por etapa sale de MORA_BUCKETS (fuente única):
					// agregar/mover una etapa se hace ahí, no aquí.
					let cuotasMin: number | undefined;
					let cuotasMax: number | undefined;
					let estadoCartera:
						| "ACTIVO"
						| "CANCELADO"
						| "INCOBRABLE"
						| "PENDIENTE_CANCELACION"
						| "EN_CONVENIO"
						| undefined;
					const searchTerm = input.searchTerm?.trim() || "";
					const numeroSifcoExacto = input.numeroSifco?.trim() || "";
					const hasNumber = /\d/.test(searchTerm);
					// Si hay numeroSifco explícito, ignoramos cualquier búsqueda por
					// cliente/placa: es un equals contra cartera-back y sólo retorna 0 ó 1.
					const isPlateSearch =
						!numeroSifcoExacto && searchTerm.length > 0 && hasNumber;
					const isNameSearch =
						!numeroSifcoExacto && searchTerm.length > 0 && !hasNumber;

					if (input.estadoMora) {
						switch (input.estadoMora) {
							case "incobrable":
								// Solo cambiar el estado, sin filtrar por cuotas
								estadoCartera = "INCOBRABLE";
								break;
							case "completado":
								// Solo cambiar el estado, sin filtrar por cuotas
								estadoCartera = "CANCELADO";
								break;
							case "en_convenio":
								estadoCartera = "EN_CONVENIO";
								break;
							case "pendiente_cancelacion":
								// Solo cambiar el estado, sin filtrar por cuotas
								estadoCartera = "PENDIENTE_CANCELACION";
								break;
							default: {
								// Etapas de aging (al_dia, mora_30/60/90/120, mora_120_plus):
								// tomar el rango de cuotas de la config.
								estadoCartera = "ACTIVO";
								const rango = rangoCuotasPorEstadoMora(input.estadoMora);
								if (rango) {
									cuotasMin = rango.min;
									cuotasMax = rango.max;
								}
							}
						}
					} else {
						// Si no hay filtro, usar ACTIVO por defecto
						estadoCartera = "ACTIVO";
					}

					console.log(
						`[Cobros] Obteniendo créditos de Cartera-Back: mes=${mes} (todos), anio=${anio}, page=${Math.floor((input.offset || 0) / (input.limit || 50)) + 1}, perPage=${input.limit || 50}, cuotasMin=${cuotasMin}, cuotasMax=${cuotasMax}, estado=${estadoCartera}, time=${input.time}, emailCobrador=${input.emailCobrador}, search=${input.searchTerm || ""}, etiquetas=${input.etiquetas?.join(",") || ""}`,
					);

					// Si hay filtro de etiquetas, primero resolver en CRM la lista de
					// numero_credito_sifco cuyos casos_cobros tengan AL MENOS UNA de las
					// etiquetas seleccionadas (criterio OR / overlap con `&&`). Un caso
					// con `{moras_pendientes,cobro}` matchea si el usuario filtra por
					// `{cobro}` o por `{cobro,juridico}`. La lista resuelta se manda a
					// cartera-back vía numeros_credito_sifco para filtrar en origen.
					let sifcosPorEtiquetas: string[] | undefined;
					if (input.etiquetas && input.etiquetas.length > 0) {
						const filas = await db
							.select({
								numeroSifco: casosCobros.numeroCreditoSifco,
								etiquetas: casosCobros.etiquetas,
							})
							.from(casosCobros)
							.where(
								sql`${casosCobros.etiquetas} && ARRAY[${sql.join(
									input.etiquetas.map((e) => sql`${e}`),
									sql`, `,
								)}]::text[]`,
							);
						sifcosPorEtiquetas = filas
							.map((r) => r.numeroSifco)
							.filter((s): s is string => !!s);
						console.log(
							`[Cobros] Filtro etiquetas resolvió ${sifcosPorEtiquetas.length} numero_credito_sifco`,
						);
						if (sifcosPorEtiquetas.length === 0) {
							const limit = input.limit || 50;
							const offset = input.offset || 0;
							return {
								data: [],
								total: 0,
								page: Math.floor(offset / limit) + 1,
								perPage: limit,
								totalPages: 0,
							};
						}
					}

					let creditosResponse;
					if (isPlateSearch) {
						// Buscar primero la placa en el CRM para obtener el número SIFCO
						const matchingOpportunities = await db
							.select({
								numeroSifco: opportunities.numeroSifco,
								placa: vehicles.licensePlate,
							})
							.from(opportunities)
							.innerJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
							.where(
								and(
									sql`LOWER(REPLACE(REPLACE(${vehicles.licensePlate}, '-', ''), ' ', '')) LIKE ${"%" + searchTerm.toLowerCase().replace(/[\s-]+/g, "") + "%"}`,
									sql`${opportunities.numeroSifco} IS NOT NULL`,
								),
							);

						if (matchingOpportunities.length === 0) {
							// No se encontró la placa en el CRM, no tiene sentido buscar en cartera
							creditosResponse = {
								data: [],
								page: 1,
								perPage: 0,
								totalCount: 0,
								totalPages: 0,
							};
						} else if (matchingOpportunities.length === 1) {
							// Una sola coincidencia: buscar directamente por número SIFCO (más rápido).
							// Si además hay filtro de etiquetas y el SIFCO de la placa no está en
							// la lista, la combinación no produce match. Ojo: cartera-back le da
							// prioridad al param multi sobre el single, por eso no mandamos ambos.
							const numeroSifco = matchingOpportunities[0].numeroSifco!;
							if (
								sifcosPorEtiquetas &&
								!sifcosPorEtiquetas.includes(numeroSifco)
							) {
								console.log(
									`[Cobros] Placa ${searchTerm} matcheó SIFCO ${numeroSifco}, pero no está en las etiquetas seleccionadas — respuesta vacía`,
								);
								creditosResponse = {
									data: [],
									page: 1,
									perPage: 0,
									totalCount: 0,
									totalPages: 0,
								};
							} else {
								console.log(
									`[Cobros] Placa ${searchTerm} encontró 1 coincidencia, buscando crédito SIFCO: ${numeroSifco}`,
								);
								creditosResponse = await obtenerTodosLosCreditosCarteraBack({
									mes,
									anio,
									page: 1,
									perPage: 50,
									cuotasMin,
									cuotasMax,
									estado: estadoCartera,
									time: input.time,
									email_cobrador: input.emailCobrador,
									numero_credito_sifco: numeroSifco,
									fecha_desde: input.fechaDesde,
									fecha_hasta: input.fechaHasta,
									capital_min: input.capitalMin,
									capital_max: input.capitalMax,
									excluir_pagados_mes: input.excluirPagadosMes,
								});
							}
						} else {
							// Múltiples coincidencias: si además hay filtro de etiquetas,
							// intersectar la lista de SIFCOs de la placa con la de las
							// etiquetas y mandar la intersección a cartera (en vez de mandar
							// todos los etiquetados o todos los de la placa por separado).
							const sifcosPlaca = matchingOpportunities
								.map((m) => m.numeroSifco)
								.filter((s): s is string => !!s);
							let sifcosFiltro: string[] | undefined;
							if (sifcosPorEtiquetas) {
								const setEtq = new Set(sifcosPorEtiquetas);
								sifcosFiltro = sifcosPlaca.filter((s) => setEtq.has(s));
							} else {
								sifcosFiltro = sifcosPlaca;
							}

							if (sifcosFiltro.length === 0) {
								creditosResponse = {
									data: [],
									page: 1,
									perPage: 0,
									totalCount: 0,
									totalPages: 0,
								};
							} else {
								console.log(
									`[Cobros] Placa ${searchTerm} encontró ${matchingOpportunities.length} coincidencias (intersección con etiquetas: ${sifcosFiltro.length}), trayendo créditos`,
								);
								const perPage = 200;
								const firstPage = await obtenerTodosLosCreditosCarteraBack({
									mes,
									anio,
									page: 1,
									perPage,
									cuotasMin,
									cuotasMax,
									estado: estadoCartera,
									time: input.time,
									email_cobrador: input.emailCobrador,
									fecha_desde: input.fechaDesde,
									fecha_hasta: input.fechaHasta,
									numeros_credito_sifco: sifcosFiltro,
									capital_min: input.capitalMin,
									capital_max: input.capitalMax,
									excluir_pagados_mes: input.excluirPagadosMes,
								});

								const allCredits = [...firstPage.data];

								for (let page = 2; page <= firstPage.totalPages; page++) {
									const nextPage = await obtenerTodosLosCreditosCarteraBack({
										mes,
										anio,
										page,
										perPage,
										cuotasMin,
										cuotasMax,
										estado: estadoCartera,
										time: input.time,
										email_cobrador: input.emailCobrador,
										fecha_desde: input.fechaDesde,
										fecha_hasta: input.fechaHasta,
										numeros_credito_sifco: sifcosFiltro,
										capital_min: input.capitalMin,
										capital_max: input.capitalMax,
										excluir_pagados_mes: input.excluirPagadosMes,
									});
									allCredits.push(...nextPage.data);
								}

								creditosResponse = {
									...firstPage,
									data: allCredits,
									totalCount: allCredits.length,
									page: 1,
									perPage: allCredits.length,
									totalPages: 1,
								};
							}
						}
					} else if (numeroSifcoExacto) {
						// Búsqueda exacta por número SIFCO. Si además hay etiquetas,
						// validamos en el CRM que el SIFCO esté en la lista filtrada,
						// porque cartera-back le da prioridad al multi sobre el single.
						if (
							sifcosPorEtiquetas &&
							!sifcosPorEtiquetas.includes(numeroSifcoExacto)
						) {
							creditosResponse = {
								data: [],
								page: 1,
								perPage: 0,
								totalCount: 0,
								totalPages: 0,
							};
						} else {
							creditosResponse = await obtenerTodosLosCreditosCarteraBack({
								mes,
								anio,
								page: 1,
								perPage: input.limit || 50,
								cuotasMin,
								cuotasMax,
								estado: estadoCartera,
								time: input.time,
								email_cobrador: input.emailCobrador,
								numero_credito_sifco: numeroSifcoExacto,
								fecha_desde: input.fechaDesde,
								fecha_hasta: input.fechaHasta,
								capital_min: input.capitalMin,
								capital_max: input.capitalMax,
								excluir_pagados_mes: input.excluirPagadosMes,
							});
						}
					} else {
						// Búsqueda por nombre (cartera-back filtra) o sin búsqueda
						creditosResponse = await obtenerTodosLosCreditosCarteraBack({
							mes,
							anio,
							page: Math.floor((input.offset || 0) / (input.limit || 50)) + 1,
							perPage: input.limit || 50,
							cuotasMin,
							cuotasMax,
							estado: estadoCartera,
							time: input.time,
							email_cobrador: input.emailCobrador,
							nombre_usuario: isNameSearch ? searchTerm : undefined,
							fecha_desde: input.fechaDesde,
							fecha_hasta: input.fechaHasta,
							numeros_credito_sifco: sifcosPorEtiquetas,
							capital_min: input.capitalMin,
							capital_max: input.capitalMax,
							excluir_pagados_mes: input.excluirPagadosMes,
						});
					}

					// Validar que la respuesta tenga la estructura esperada
					if (!creditosResponse || !creditosResponse.data) {
						console.error(
							"[Cobros] Respuesta inválida de Cartera-Back:",
							creditosResponse,
						);
						throw new ORPCError("BAD_REQUEST", {
							message: "Estructura de respuesta inválida",
						});
					}

					console.log(
						`[Cobros] Obtenidos ${creditosResponse.data.length} créditos de Cartera-Back`,
					);

					// Cargar en una sola query las etiquetas (y el id del caso) de los
					// créditos que ya tienen un caso de cobro asociado, para no hacer
					// una query individual dentro del map.
					const sifcosPagina = creditosResponse.data
						.map((c) => c.creditos.numero_credito_sifco)
						.filter((s): s is string => !!s);
					// Con varios casos por el mismo SIFCO gana el activo y, a igualdad,
					// el más reciente (agruparCasosVigentesPorSifco) — mismo criterio
					// que getAgendaDia/getColaDia. Antes esto hacía un .set()
					// incondicional sobre una query SIN ORDER BY, así que se quedaba
					// con la fila que Postgres devolviera última: arbitraria. De ahí
					// salen casoCobroId, etiquetas y promesaActiva de toda la tabla,
					// o sea el listado podía mostrar los datos de un caso viejo y
					// contradecir al detalle (Codex PR #1238).
					const casosPorSifco = new Map<
						string,
						{ id: string; etiquetas: string[] }
					>();
					if (sifcosPagina.length > 0) {
						const casosRows = await db
							.select({
								id: casosCobros.id,
								numeroCreditoSifco: casosCobros.numeroCreditoSifco,
								etiquetas: casosCobros.etiquetas,
								activo: casosCobros.activo,
								updatedAt: casosCobros.updatedAt,
							})
							.from(casosCobros)
							.where(inArray(casosCobros.numeroCreditoSifco, sifcosPagina));
						for (const [sifco, row] of agruparCasosVigentesPorSifco(
							casosRows,
						)) {
							casosPorSifco.set(sifco, {
								id: row.id,
								etiquetas: row.etiquetas ?? [],
							});
						}
					}

					// CB-030: promesas ACTIVAS de los casos de ESTA página, en UNA
					// query (mismo patrón batch que casosPorSifco arriba). Sirve para
					// el subestado "Promesa activa" de la tabla — el bucket real que
					// ya viene arriba (estadoMora, del motor de cartera-back) YA está
					// congelado por el servidor mientras la promesa esté vigente; esto
					// solo agrega la señal de display de POR QUÉ.
					// Sin índice nuevo: idx_contactos_cobros_caso_fecha ya lidera por
					// caso_cobro_id y la página trae ≤50 casos (decisión explícita).
					// El predicado de vigencia es el compartido (lib/promesa-vigente.ts):
					// incluir 'incumplida' o no filtrar por fecha dejaba el badge
					// "Promesa activa" pegado para siempre en casos con una promesa
					// incumplida vieja.
					const promesaPorCaso = new Set<string>();
					const casoIdsPagina = [...casosPorSifco.values()].map((c) => c.id);
					if (casoIdsPagina.length > 0) {
						const promesasRows = await db
							.select({ casoCobroId: contactosCobros.casoCobroId })
							.from(contactosCobros)
							.where(
								and(
									inArray(contactosCobros.casoCobroId, casoIdsPagina),
									...condicionesPromesaVigente(),
								),
							);
						for (const row of promesasRows) {
							promesaPorCaso.add(row.casoCobroId);
						}
					}

					// Mapear los datos de Cartera-Back al formato esperado por el frontend
					const contratos = await Promise.all(
						creditosResponse.data.map(async (credito) => {
							// Acceder a los datos anidados correctamente
							const statusCredit = credito.creditos.statusCredit;
							const cuotasAtrasadas = credito.mora?.cuotas_atrasadas ?? 0;

							// NOTA: Usamos aproximación (30 días por cuota) porque /getAllCredits
							// NO retorna las fechas de vencimiento de las cuotas individuales.
							// Solo /credito retorna el array completo con fechas para cálculo exacto.
							const diasMora = cuotasAtrasadas * 30;

							// Monto en mora REAL: usamos moras_credito.monto_mora (capital × 1.12% ×
							// cuotas) que /getAllCredits ya trae en `mora`, para que coincida con el
							// embudo (/stats) y la pantalla de detalle (/credito). Antes se aproximaba
							// `cuota × cuotas`, dando un número distinto al del detalle para el mismo crédito.
							const montoEnMora = Number(credito.mora?.monto_mora ?? 0);

							// Determinar estado de mora según statusCredit y cuotas atrasadas
							// (MORA_BUCKETS: 0=al_dia … 4=mora_120, 5+=mora_120_plus).
							let estadoMora: string | null = null;
							if (statusCredit === "EN_CONVENIO") estadoMora = "en_convenio";
							else estadoMora = estadoMoraPorCuotas(cuotasAtrasadas);

							// Determinar estado del contrato según statusCredit
							let estadoContrato = "activo";
							if (statusCredit === "CANCELADO") estadoContrato = "completado";
							else if (statusCredit === "INCOBRABLE")
								estadoContrato = "incobrable";
							else if (statusCredit === "PENDIENTE_CANCELACION")
								estadoContrato = "pendiente_cancelacion";

							// Buscar la oportunidad por número SIFCO para obtener datos del vehículo
							const numeroSifco = credito.creditos.numero_credito_sifco;
							let vehiculoMarca = "-";
							let vehiculoModelo = "-";
							let vehiculoYear: number | null = null;
							let vehiculoPlaca = "-";

							if (numeroSifco) {
								const [oportunidad] = await db
									.select({
										vehicleId: opportunities.vehicleId,
										marca: vehicles.make,
										modelo: vehicles.model,
										year: vehicles.year,
										placa: vehicles.licensePlate,
									})
									.from(opportunities)
									.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
									.where(eq(opportunities.numeroSifco, numeroSifco))
									.limit(1);

								if (oportunidad?.vehicleId) {
									vehiculoMarca = oportunidad.marca || "-";
									vehiculoModelo = oportunidad.modelo || "-";
									vehiculoYear = oportunidad.year;
									vehiculoPlaca = oportunidad.placa || "";
								}
							}

							const casoCobro = numeroSifco
								? casosPorSifco.get(numeroSifco)
								: undefined;

							return {
								contratoId: credito.creditos.credito_id.toString(),
								clienteNombre: credito.usuarios.nombre,
								vehiculoMarca,
								vehiculoModelo,
								vehiculoYear,
								vehiculoPlaca,
								estadoContrato,
								montoFinanciado: credito.creditos.capital.toString(),
								cuotaMensual: credito.creditos.cuota.toString(),
								fechaProximoPago:
									credito.proxima_cuota?.fecha_vencimiento || null,
								responsableCobros: credito.asesores?.nombre || null,
								casoCobroId: casoCobro?.id ?? null,
								estadoMora,
								montoEnMora: montoEnMora.toFixed(2),
								diasMoraMaximo: diasMora,
								cuotasVencidas: cuotasAtrasadas,
								telefonoPrincipal: null,
								proximoContacto: null,
								responsableNombre: null,
								numeroCredito: numeroSifco || null,
								etiquetas: (casoCobro?.etiquetas ?? null) as string[] | null,
								// CB-030: subestado de display, NO altera estadoMora/bucket.
								promesaActiva: casoCobro
									? promesaPorCaso.has(casoCobro.id)
									: false,
								isPool:
									credito.creditos.formato_credito
										?.toUpperCase()
										.includes("POOL") ||
									credito.creditos.tipoCredito
										?.toUpperCase()
										.includes("POOL") ||
									(Array.isArray(credito.inversionistas) &&
										credito.inversionistas.length > 1),
							};
						}),
					);

					console.log(
						`[Cobros] Mapeados ${contratos.length} contratos para el frontend`,
					);

					if (isPlateSearch) {
						const limit = input.limit || 50;
						const offset = input.offset || 0;
						const filtered = filterCobrosSearchResults(
							contratos,
							searchTerm,
							offset,
							limit,
						);

						return {
							data: filtered.items,
							total: filtered.total,
							page: Math.floor(offset / limit) + 1,
							perPage: limit,
							totalPages: Math.max(1, Math.ceil(filtered.total / limit)),
						};
					}

					return {
						data: contratos,
						total: creditosResponse.totalCount,
						page: creditosResponse.page,
						perPage: creditosResponse.perPage,
						totalPages: creditosResponse.totalPages,
					};
				} catch (error) {
					console.error(
						"[Cobros] Error obteniendo datos de Cartera-Back:",
						error,
					);
					// Fallback a datos locales en caso de error
				}
			}

			return {
				data: [],
				total: 0,
				page: 0,
				perPage: 0,
				totalPages: 0,
			};
		}),

	// Obtener casos de cobros con filtros (solo casos activos con mora)
	getCasosCobros: cobrosProcedure
		.input(
			z.object({
				estadoMora: z.enum(estadoMoraEnum.enumValues).optional(),
				responsableCobros: z.string().optional(),
				limit: z.number().default(50),
				offset: z.number().default(0),
			}),
		)
		.handler(async ({ input, context }) => {
			// Construir condiciones WHERE
			const conditions = [eq(casosCobros.activo, true)];

			// Filtros
			if (input.estadoMora) {
				conditions.push(eq(casosCobros.estadoMora, input.estadoMora));
			}

			if (input.responsableCobros) {
				conditions.push(
					eq(casosCobros.responsableCobros, input.responsableCobros),
				);
			}

			// Si no es admin o supervisor de cobros, solo ver casos asignados
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				conditions.push(eq(casosCobros.responsableCobros, context.userId));
			}

			const query = db
				.select({
					id: casosCobros.id,
					contratoId: casosCobros.contratoId,
					estadoMora: casosCobros.estadoMora,
					montoEnMora: casosCobros.montoEnMora,
					diasMoraMaximo: casosCobros.diasMoraMaximo,
					cuotasVencidas: casosCobros.cuotasVencidas,
					responsableCobros: casosCobros.responsableCobros,
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					emailContacto: casosCobros.emailContacto,
					proximoContacto: casosCobros.proximoContacto,
					metodoContactoProximo: casosCobros.metodoContactoProximo,
					createdAt: casosCobros.createdAt,
					updatedAt: casosCobros.updatedAt,
					// Datos del cliente
					clienteNombre: clients.contactPerson,
					// Datos del vehículo
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
					// Datos del responsable
					responsableNombre: user.name,
				})
				.from(casosCobros)
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.leftJoin(user, eq(casosCobros.responsableCobros, user.id))
				.where(and(...conditions));

			const casos = await query
				.orderBy(desc(casosCobros.diasMoraMaximo), desc(casosCobros.updatedAt))
				.limit(input.limit)
				.offset(input.offset);

			return casos;
		}),

	// Obtener detalles de un caso específico
	getCasoCobroById: cobrosProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const whereClause = PERMISSIONS.canViewAllCasosCobros(context.userRole)
				? eq(casosCobros.id, input.id)
				: and(
						eq(casosCobros.id, input.id),
						eq(casosCobros.responsableCobros, context.userId),
					);

			const caso = await db
				.select({
					// Datos del caso
					id: casosCobros.id,
					contratoId: casosCobros.contratoId,
					estadoMora: casosCobros.estadoMora,
					montoEnMora: casosCobros.montoEnMora,
					diasMoraMaximo: casosCobros.diasMoraMaximo,
					cuotasVencidas: casosCobros.cuotasVencidas,
					telefonoPrincipal: casosCobros.telefonoPrincipal,
					telefonoAlternativo: casosCobros.telefonoAlternativo,
					emailContacto: casosCobros.emailContacto,
					direccionContacto: casosCobros.direccionContacto,
					proximoContacto: casosCobros.proximoContacto,
					metodoContactoProximo: casosCobros.metodoContactoProximo,
					// Datos del contrato
					montoFinanciado: contratosFinanciamiento.montoFinanciado,
					cuotaMensual: contratosFinanciamiento.cuotaMensual,
					numeroCuotas: contratosFinanciamiento.numeroCuotas,
					fechaInicio: contratosFinanciamiento.fechaInicio,
					diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
					// Datos del cliente
					clienteNombre: clients.contactPerson,
					// Datos del vehículo
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
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.where(whereClause)
				.limit(1);

			return caso[0] || null;
		}),

	// Registrar contacto de cobros
	createContactoCobros: cobrosProcedure
		.input(createContactoCobrosSchema)
		.handler(async ({ input, context }) => {
			// promesaContactoId no es columna: se separa del payload de escritura.
			const { promesaContactoId, ...datos } = input;
			const esPromesa = datos.estadoContacto === "promesa_pago";
			const estadoPromesa = esPromesa ? ("pendiente" as const) : undefined;

			const inicioHoyGt = gtDateStrToDate(toDateStrGT(new Date()));
			let filas: (typeof contactosCobros.$inferSelect)[];
			if (promesaContactoId) {
				// CB-029: editar la promesa activa EN SITIO (una sola por caso). Se
				// re-abre a 'pendiente' — el job/getEstadoPromesasPago la re-evalúa.
				// El WHERE exige que la fila SIGA activa (pendiente/NULL y fecha no
				// pasada): un promesaContactoId viejo (la promesa ya se cerró o venció
				// entre que se abrió el modal y se guardó) NO debe reabrir/sobrescribir
				// una promesa histórica cerrada (Codex PR #1232).
				//
				// CB-128: este UPDATE es el ÚNICO punto del módulo donde una persona
				// pisa datos históricos, y lo que pisa (fecha prometida, rango de
				// cuotas, monto, comentarios) no se puede reconstruir de ningún lado.
				// Por eso va en transacción con su auditoría: si el audit falla, el
				// UPDATE se revierte. Dejar pasar el UPDATE sin rastro es exactamente
				// lo que el AC-6 prohíbe, así que acá NO se usa la variante
				// best-effort (a diferencia de los UPDATE de sistema, que sí).
				//
				// El bucket_snapshot NO se toca: congela el bucket de cuando NACIÓ la
				// promesa. Re-capturarlo en cada edición reescribiría el pasado.
				filas = await db.transaction(async (tx) => {
					// FOR UPDATE: fija la fila mientras se lee el valor previo y se
					// escribe, para que dos ediciones simultáneas no auditen el mismo
					// "antes" y una pise a la otra sin dejar rastro.
					// El guard de casoCobroId va también acá y no solo en el UPDATE:
					// sin él se puede tomar el lock de CUALQUIER fila pasando un id
					// ajeno al caso, y aunque el UPDATE después no la toque, la fila
					// queda bloqueada hasta el fin de la transacción — suficiente para
					// frenar al job nocturno.
					const [previa] = await tx
						.select()
						.from(contactosCobros)
						.where(
							and(
								eq(contactosCobros.id, promesaContactoId),
								eq(contactosCobros.casoCobroId, datos.casoCobroId),
							),
						)
						.for("update");

					const actualizadas = await tx
						.update(contactosCobros)
						.set({ ...datos, estadoPromesa, updatedAt: new Date() })
						.where(
							and(
								eq(contactosCobros.id, promesaContactoId),
								eq(contactosCobros.casoCobroId, datos.casoCobroId),
								eq(contactosCobros.estadoContacto, "promesa_pago"),
								or(
									eq(contactosCobros.estadoPromesa, "pendiente"),
									isNull(contactosCobros.estadoPromesa),
								),
								gte(contactosCobros.fechaProximoContacto, inicioHoyGt),
							),
						)
						.returning();

					// Sin fila actualizada no hay nada que auditar: la promesa ya no
					// estaba activa y el caller convierte esto en un CONFLICT.
					if (actualizadas.length > 0 && previa) {
						await registrarAuditContacto({
							contactoId: promesaContactoId,
							casoCobroId: previa.casoCobroId,
							accion: "edicion_promesa",
							origen: "manual",
							valoresAnteriores: payloadEdicionManual(previa),
							editadoPor: context.userId,
							tx,
						});
					}

					return actualizadas;
				});
				if (filas.length === 0) {
					throw new ORPCError("CONFLICT", {
						message:
							"La promesa ya no está activa (fue cerrada o venció); registra una nueva.",
					});
				}
			} else {
				// CB-029: una sola promesa activa por caso — si ya hay una, no se crea
				// otra (el modal debió abrir en edición y pasar promesaContactoId).
				if (esPromesa && (await promesaActivaDelCaso(datos.casoCobroId))) {
					throw new ORPCError("CONFLICT", {
						message:
							"Ya existe una promesa activa para este caso; editala en vez de crear otra.",
					});
				}
				// CB-128 (AC-2): bucket del crédito AL MOMENTO de la gestión. Se
				// captura al crear y nunca se recalcula, para que el historial diga en
				// qué etapa estaba la cuenta cuando se gestionó y no en cuál está hoy.
				const bucketSnapshot = await capturarBucketSnapshot(datos.casoCobroId);
				filas = await db
					.insert(contactosCobros)
					.values({
						...datos,
						estadoPromesa,
						realizadoPor: context.userId,
						bucketSnapshot,
					})
					.returning();
			}

			// Actualizar próximo contacto en el caso si se especifica
			if (datos.fechaProximoContacto) {
				await db
					.update(casosCobros)
					.set({
						proximoContacto: datos.fechaProximoContacto,
						metodoContactoProximo: datos.metodoContacto,
						updatedAt: new Date(),
					})
					.where(eq(casosCobros.id, datos.casoCobroId));
			}

			// CB-030: promesa creada o editada → push best-effort hacia cartera-back
			// para que procesarMoras la congele (o actualice el rango) desde la
			// próxima corrida.
			//
			// SIN await: esto está en el camino de un request del asesor. El
			// cliente de cartera-back reintenta 3 veces con timeout de 30s, así
			// que esperarlo colgaría el guardado de la promesa hasta ~127s si
			// cartera-back está caído — inaceptable para un push best-effort cuya
			// red de seguridad es la reconciliación diaria (Codex PR #1237).
			if (esPromesa) {
				pushPromesaActivaEnSegundoPlano({
					id: filas[0].id,
					casoCobroId: datos.casoCobroId,
					cuotaInicio: datos.cuotaInicio ?? null,
					cuotaFin: datos.cuotaFin ?? null,
					incluyeMora: datos.incluyeMora ?? false,
					fechaProximoContacto: datos.fechaProximoContacto ?? null,
					activa: true,
				});
			}

			return filas[0];
		}),

	// Obtener historial de contactos de un caso
	getHistorialContactos: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				limit: z.number().default(20),
			}),
		)
		.handler(async ({ input, context }) => {
			console.log(
				"Obteniendo historial de contactos para el caso:",
				input.casoCobroId,
			);
			console.log("userRole:", context.userRole, "userId:", context.userId);

			const contactos = await db
				.select({
					id: contactosCobros.id,
					fechaContacto: contactosCobros.fechaContacto,
					metodoContacto: contactosCobros.metodoContacto,
					estadoContacto: contactosCobros.estadoContacto,
					duracionLlamada: contactosCobros.duracionLlamada,
					comentarios: contactosCobros.comentarios,
					acuerdosAlcanzados: contactosCobros.acuerdosAlcanzados,
					compromisosPago: contactosCobros.compromisosPago,
					requiereSeguimiento: contactosCobros.requiereSeguimiento,
					fechaProximoContacto: contactosCobros.fechaProximoContacto,
					fechaAlerta: contactosCobros.fechaAlerta,
					proximoPaso: contactosCobros.proximoPaso,
					cuotaInicio: contactosCobros.cuotaInicio,
					cuotaFin: contactosCobros.cuotaFin,
					incluyeMora: contactosCobros.incluyeMora,
					estadoPromesa: contactosCobros.estadoPromesa,
					montoComprometido: contactosCobros.montoComprometido,
					realizadoPorId: contactosCobros.realizadoPor,
					realizadoPor: user.name,
				})
				.from(contactosCobros)
				.leftJoin(user, eq(contactosCobros.realizadoPor, user.id))
				.where(eq(contactosCobros.casoCobroId, input.casoCobroId))
				.orderBy(desc(contactosCobros.fechaContacto))
				.limit(input.limit);

			return contactos;
		}),

	// CB-029 (dashboard): resumen simple de promesas de pago del EQUIPO (casos
	// activos). 3 contadores globales que el dashboard pinta como tiles
	// clickeables hacia la Cola del Día. Sin scope por asesor (MVP simple).
	getResumenPromesas: cobrosProcedure
		.input(z.object({}).optional())
		.handler(async () => {
			const inicioHoyGt = gtDateStrToDate(toDateStrGT(new Date()));
			const finHoyGt = new Date(inicioHoyGt.getTime() + 24 * 60 * 60 * 1000);
			const [row] = await db
				.select({
					activas: sql<string>`count(*) filter (where ${contactosCobros.estadoPromesa} = 'pendiente' and ${contactosCobros.fechaProximoContacto} >= ${inicioHoyGt})`,
					vencenHoy: sql<string>`count(*) filter (where ${contactosCobros.estadoPromesa} = 'pendiente' and ${contactosCobros.fechaProximoContacto} >= ${inicioHoyGt} and ${contactosCobros.fechaProximoContacto} < ${finHoyGt})`,
					incumplidas: sql<string>`count(*) filter (where ${contactosCobros.estadoPromesa} = 'incumplida')`,
				})
				.from(contactosCobros)
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.where(
					and(
						eq(contactosCobros.estadoContacto, "promesa_pago"),
						eq(casosCobros.activo, true),
					),
				);
			return {
				activas: Number(row?.activas ?? 0),
				vencenHoy: Number(row?.vencenHoy ?? 0),
				incumplidas: Number(row?.incumplidas ?? 0),
			};
		}),

	// CB-031: apartado "Alertas de Promesas" (/cobros/promesas). Lista las
	// promesas que HOY requieren acción, leídas del estado VIVO de la promesa
	// (contactos_cobros) — no de la tabla `notifications` — para que siempre
	// esté fresco (una promesa ya pagada = cumplida, deja de ser alerta) y para
	// que los grupos cuadren con las tiles de getResumenPromesas.
	//
	// Cuatro categorías (las 3 primeras con la semántica de las notificaciones
	// de CB-029):
	//   - vencida    → incumplida, o pendiente cuya fecha ya pasó (prioridad alta)
	//   - vence_hoy  → pendiente, fecha prometida = hoy
	//   - por_vencer → pendiente, fecha futura y cuya alerta programada
	//                  (fecha_alerta, default D-1) ya llegó
	//   - programada → pendiente, fecha futura y cuya alerta AÚN no llega (sin
	//                  acción pendiente todavía). Se incluye para que la página
	//                  contenga TODO lo que cuenta la tile "activas".
	//
	// Scope por rol: el asesor ve solo sus casos (responsableCobros); el
	// supervisor/admin ven el equipo completo (mismo criterio que getCasosCobros).
	getAlertasPromesas: cobrosProcedure
		.input(z.object({}).optional())
		.handler(async ({ context }) => {
			const inicioHoyGt = gtDateStrToDate(toDateStrGT(new Date()));
			const finHoyGt = new Date(inicioHoyGt.getTime() + 24 * 60 * 60 * 1000);

			// Traemos todas las promesas vigentes (pendientes o incumplidas) del
			// scope y clasificamos en JS: así las cotas de día son consistentes
			// (siempre `<`, sin el borde lte/lt del SQL) y la página contiene todo
			// lo que cuentan las tiles de getResumenPromesas.
			const conditions = [
				eq(contactosCobros.estadoContacto, "promesa_pago"),
				eq(casosCobros.activo, true),
				inArray(contactosCobros.estadoPromesa, ["pendiente", "incumplida"]),
			];
			// Asesor (no puede ver todo): solo sus casos asignados.
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				conditions.push(eq(casosCobros.responsableCobros, context.userId));
			}

			const rows = await db
				.select({
					id: contactosCobros.id,
					casoCobroId: contactosCobros.casoCobroId,
					numeroCreditoSifco: casosCobros.numeroCreditoSifco,
					clienteNombre: clients.contactPerson,
					asesorNombre: user.name,
					fechaPrometida: contactosCobros.fechaProximoContacto,
					fechaAlerta: contactosCobros.fechaAlerta,
					montoComprometido: contactosCobros.montoComprometido,
					cuotaInicio: contactosCobros.cuotaInicio,
					cuotaFin: contactosCobros.cuotaFin,
					incluyeMora: contactosCobros.incluyeMora,
					estadoPromesa: contactosCobros.estadoPromesa,
				})
				.from(contactosCobros)
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(user, eq(casosCobros.responsableCobros, user.id))
				.where(and(...conditions));

			// Clasificación + orden en JS: vencidas primero (prioridad alta), luego
			// vence hoy, por vencer, y al final las programadas (aún dentro de
			// plazo, sin acción pendiente). Dentro de cada grupo, la más urgente
			// (fecha más próxima) arriba.
			const DIA_MS = 24 * 60 * 60 * 1000;
			const ordenCategoria = {
				vencida: 0,
				vence_hoy: 1,
				por_vencer: 2,
				programada: 3,
			};
			const clasificar = (r: (typeof rows)[number]) => {
				if (r.estadoPromesa === "incumplida") return "vencida" as const;
				const fecha = r.fechaPrometida;
				if (!fecha) return "vencida" as const;
				if (fecha < inicioHoyGt) return "vencida" as const;
				if (fecha < finHoyGt) return "vence_hoy" as const;
				// Futura: ¿su alerta programada (fecha_alerta, o D-1) ya llegó?
				const alertaEf = r.fechaAlerta ?? new Date(fecha.getTime() - DIA_MS);
				return alertaEf < finHoyGt
					? ("por_vencer" as const)
					: ("programada" as const);
			};

			return rows
				.map((r) => ({ ...r, categoria: clasificar(r) }))
				.sort((a, b) => {
					const diff =
						ordenCategoria[a.categoria] - ordenCategoria[b.categoria];
					if (diff !== 0) return diff;
					const fa = a.fechaPrometida?.getTime() ?? 0;
					const fb = b.fechaPrometida?.getTime() ?? 0;
					return fa - fb;
				});
		}),

	// CB-031 (ficha 360): alertas de ESTE caso — las notificaciones de cobros
	// que ya generan los jobs (promesa por vencer / incumplida, cliente subido
	// de bucket, 3 días sin contacto) y las asignaciones manuales. La campanita
	// las muestra mezcladas con todo el CRM; acá viven junto al caso que las
	// originó, que es donde el asesor las va a leer.
	//
	// `filasNotificacionCobros` inserta UNA FILA POR DESTINATARIO (asesor +
	// supervisores), así que la misma alerta llega repetida: se deduplica por
	// (titulo, createdAt) quedándose con la primera.
	getAlertasCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const rows = await db
				.select({
					id: notifications.id,
					titulo: notifications.titulo,
					descripcion: notifications.descripcion,
					cobrosTipo: notifications.cobrosTipo,
					status: notifications.status,
					createdAt: notifications.createdAt,
					assignedTo: notifications.assignedTo,
				})
				.from(notifications)
				// Alcance: el rol `cobros` solo ve alertas de SUS casos. Sin este
				// join, cualquier asesor podía pedir el UUID de otro caso y leer las
				// alertas (y su descripción) de la cartera de un compañero — mismo
				// criterio que getCasoCobroById/getAlertasPromesas (Codex).
				.innerJoin(
					casosCobros,
					and(
						eq(casosCobros.id, notifications.relatedEntityId),
						PERMISSIONS.canViewAllCasosCobros(context.userRole)
							? undefined
							: eq(casosCobros.responsableCobros, context.userId),
					),
				)
				.where(
					and(
						eq(notifications.relatedEntityId, input.casoCobroId),
						eq(notifications.relatedEntityType, "collection_case"),
					),
				)
				.orderBy(desc(notifications.createdAt))
				.limit(50);

			// Agrupa por TIPO de alerta, no por fila: los jobs son diarios, así que
			// "Caso sin contacto reciente" se repite un día tras otro y llenaba la
			// tarjeta con 15 copias del mismo aviso. Se muestra la más reciente de
			// cada tipo con cuántas veces se repitió — el asesor necesita saber
			// QUÉ pasa y desde cuándo, no leer el mismo aviso 15 veces.
			const porTipo = new Map<
				string,
				{
					id: string;
					titulo: string;
					descripcion: string | null;
					cobrosTipo: string | null;
					status: string;
					createdAt: Date;
					repeticiones: number;
					desde: Date;
				}
			>();
			// `filasNotificacionCobros` inserta UNA FILA POR DESTINATARIO (asesor +
			// supervisores) para el MISMO evento. Sin colapsarlas, una sola alerta
			// escalada se contaba como varias repeticiones y podía quedarse con la
			// redacción dirigida al supervisor (Codex). Se deduplica por evento
			// (tipo + instante) prefiriendo la fila del usuario que está mirando,
			// que es la que trae el texto escrito para él.
			const porEvento = new Map<string, (typeof rows)[number]>();
			for (const r of rows) {
				if (!r.createdAt) continue;
				const claveEvento = `${r.cobrosTipo ?? r.titulo}|${r.createdAt.getTime()}`;
				const previa = porEvento.get(claveEvento);
				if (!previa || r.assignedTo === context.userId) {
					porEvento.set(claveEvento, r);
				}
			}

			for (const r of porEvento.values()) {
				if (!r.createdAt) continue;
				// cobros_tipo es null en las notificaciones que no vienen de los jobs
				// de cobros (asignaciones manuales, seguimientos): ahí agrupa el título.
				const clave = r.cobrosTipo ?? r.titulo;
				const previa = porTipo.get(clave);
				if (!previa) {
					porTipo.set(clave, {
						...r,
						createdAt: r.createdAt,
						repeticiones: 1,
						desde: r.createdAt,
					});
					continue;
				}
				previa.repeticiones += 1;
				// `rows` viene ordenado desc, así que la primera es la más reciente y
				// la última que se ve de cada tipo es la más antigua.
				if (r.createdAt < previa.desde) previa.desde = r.createdAt;
			}
			return [...porTipo.values()].slice(0, 10);
		}),

	// LEGACY (tabla CRM `convenios_pago`, no cartera-back): nunca se llama desde
	// la web (0 usos en apps/web) — el convenio real de negocio vive en
	// cartera-back y llega vía getDetallesCreditoCarteraBack.convenioActivo y
	// getConveniosListado (CB-027). Se deja intacto por compatibilidad, no
	// escribir código nuevo contra esta tabla.
	// Crear convenio de pago
	createConvenioPago: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				montoAcordado: z
					.string()
					.regex(/^\d+(\.\d{1,2})?$/, "Formato de monto inválido"),
				numeroCuotasConvenio: z.number().min(1).max(60),
				montoCuotaConvenio: z
					.string()
					.regex(/^\d+(\.\d{1,2})?$/, "Formato de cuota inválido"),
				fechaInicioConvenio: z.date(),
				condicionesEspeciales: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Solo admin, supervisor de cobros o usuario asignado pueden crear convenios
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para crear convenios en este caso",
					});
				}
			}

			const convenio = await db
				.insert(conveniosPago)
				.values({
					...input,
					aprobadoPor: context.userId,
				})
				.returning();

			return convenio[0];
		}),

	// Obtener convenios de pago de un caso
	getConveniosPago: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar acceso
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver convenios de este caso",
					});
				}
			}

			const convenios = await db
				.select({
					id: conveniosPago.id,
					montoAcordado: conveniosPago.montoAcordado,
					numeroCuotasConvenio: conveniosPago.numeroCuotasConvenio,
					montoCuotaConvenio: conveniosPago.montoCuotaConvenio,
					fechaInicioConvenio: conveniosPago.fechaInicioConvenio,
					activo: conveniosPago.activo,
					cumplido: conveniosPago.cumplido,
					cuotasCumplidas: conveniosPago.cuotasCumplidas,
					condicionesEspeciales: conveniosPago.condicionesEspeciales,
					fechaAprobacion: conveniosPago.fechaAprobacion,
					aprobadoPor: user.name,
				})
				.from(conveniosPago)
				.leftJoin(user, eq(conveniosPago.aprobadoPor, user.id))
				.where(eq(conveniosPago.casoCobroId, input.casoCobroId))
				.orderBy(desc(conveniosPago.createdAt));

			return convenios;
		}),

	// CB-027: listado paginado de convenios REALES de cartera-back (cliente,
	// SIFCO, asesor, progreso) para la página /cobros/convenios. Mismo patrón
	// de "asesor forzado" que getColaDia/getAgendaDia — el rol cobros solo ve
	// sus propios convenios (match por email contra cartera-back.getAdvisors).
	getConveniosListado: cobrosProcedure
		.input(
			z.object({
				estado: z.enum(["active", "completed", "inactive", "all"]).optional(),
				// Búsqueda libre: matchea SIFCO O nombre de cliente (cartera-back
				// combina ambos con OR — mandar el mismo texto a los dos campos NO
				// exige que ambos matcheen a la vez, que era el bug original).
				busqueda: z.string().optional(),
				asesorId: z.number().int().positive().optional(),
				page: z.number().int().positive().optional(),
				perPage: z.number().int().min(1).max(100).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (!isCarteraBackEnabled()) {
				return {
					success: true,
					sinAsesor: false,
					asesorForzado: null,
					items: [],
					total: 0,
					page: 1,
					perPage: input.perPage ?? 25,
					totalPages: 1,
				};
			}

			const puedeVerTodos = PERMISSIONS.canAssignCobros(context.userRole ?? "");
			const page = input.page ?? 1;
			const perPage = input.perPage ?? 25;

			let asesorForzado: { asesorId: number; nombre: string } | null = null;
			let asesorIdFiltro: number | undefined = input.asesorId;

			if (!puedeVerTodos) {
				const email = context.session?.user?.email?.trim().toLowerCase();
				// email_cash_in, NO getAdvisors()/platform_users.email: ese campo
				// está desactualizado para varios asesores (Diego Gomez, Samuel
				// Gamboa) y no coincide con el login real del CRM — mismo patrón ya
				// corregido en getCierreDiarioPorRango (ver ese comentario, arriba
				// en este archivo).
				const asesoresConBuckets = await carteraBackClient.getPoolPorAsesor();
				const propio = asesoresConBuckets.find(
					(a) => a.email_cash_in?.trim().toLowerCase() === email,
				);
				if (!propio) {
					return {
						success: true,
						sinAsesor: true,
						asesorForzado: null,
						items: [],
						total: 0,
						page,
						perPage,
						totalPages: 1,
					};
				}
				asesorForzado = { asesorId: propio.asesor_id, nombre: propio.nombre };
				asesorIdFiltro = propio.asesor_id;
			}

			try {
				const resultado = await carteraBackClient.getConveniosListado({
					estado: input.estado,
					numeroCreditoSifco: input.busqueda,
					nombreUsuario: input.busqueda,
					asesorId: asesorIdFiltro,
					page,
					perPage,
				});

				return {
					success: true,
					sinAsesor: false,
					asesorForzado,
					items: resultado.data,
					total: resultado.total,
					page: resultado.page,
					perPage: resultado.perPage,
					totalPages: resultado.totalPages,
				};
			} catch (error) {
				// No devolver success:false disfrazado de 200: React Query solo
				// marca isError ante un fallo real de transporte/oRPC, así que un
				// {success:false, items:[]} silencioso caía en el mismo branch que
				// "0 convenios" en la UI — un outage de cartera-back se veía
				// idéntico a "no hay convenios". Se propaga como error real (mismo
				// criterio que el resto de procedures de este router, p.ej.
				// getColaDia, que no atrapan su propia excepción de cartera-back).
				console.error("[getConveniosListado] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudieron cargar los convenios de pago",
				});
			}
		}),

	// Asignar responsable de cobros
	asignarResponsableCobros: cobrosSupervisorProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				responsableCobros: z.string(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verificar que el responsable tenga rol de cobros
			const responsable = await db
				.select()
				.from(user)
				.where(eq(user.id, input.responsableCobros))
				.limit(1);

			if (!responsable.length) {
				throw new ORPCError("NOT_FOUND", { message: "Usuario no encontrado" });
			}

			if (
				responsable[0].role !== "cobros" &&
				responsable[0].role !== "cobros_supervisor" &&
				responsable[0].role !== "admin"
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El usuario debe tener rol de cobros, supervisor de cobros o admin",
				});
			}

			const casoActualizado = await db
				.update(casosCobros)
				.set({
					responsableCobros: input.responsableCobros,
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, input.casoCobroId))
				.returning();

			// Notificar al nuevo cobrador asignado
			await createNotification({
				titulo: "Caso de cobro asignado",
				descripcion: `Se te ha asignado el caso de cobro #${input.casoCobroId.slice(0, 8)}`,
				type: "aviso",
				createdBy: context.user.id,
				createdByRole: context.user.role,
				assignedToRole: "cobros",
				assignedTo: input.responsableCobros,
				relatedEntityType: "collection_case",
				relatedEntityId: input.casoCobroId,
				redirectPage: "cobros_detail",
			});

			return casoActualizado[0];
		}),

	// Catálogo de buckets para render en la UI (label/color/orden por etapa) —
	// evita que el frontend mantenga sus propias copias hardcodeadas.
	getBucketsCatalogo: cobrosProcedure.handler(async () => {
		return getBucketsParaUIAsync();
	}),

	// CB-020: si el catálogo dinámico ya cargó al menos una vez (vs. seguir en
	// el fallback estático MORA_BUCKETS). Lo usa el modal de config de SLA para
	// no dejar guardar dias_sla placeholder como si fueran los valores reales.
	getBucketsCatalogoCargado: cobrosProcedure.handler(async () => {
		await getBucketsParaUIAsync();
		return { cargado: isDynamicCatalogLoaded() };
	}),

	// CB-006: histórico de migraciones de bucket (motor COBROS-02) desde
	// cartera-back (/buckets/historial). Solo admin/cobros_supervisor: expone
	// movimientos de TODA la cartera, no la porción del asesor.
	getBucketsHistorial: cobrosSupervisorProcedure
		.input(
			z.object({
				desde: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional(),
				hasta: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional(),
				tipoEvento: z.enum(["INICIAL", "SUBIDA", "BAJADA"]).optional(),
				bucketNuevo: z.number().int().min(0).max(5).optional(),
				numeroCreditoSifco: z.string().max(100).optional(),
				nombreUsuario: z.string().max(200).optional(),
				page: z.number().int().min(1).default(1),
				pageSize: z.number().int().min(1).max(100).default(20),
			}),
		)
		.handler(async ({ input }) => {
			try {
				return await carteraBackClient.getBucketsHistorial({
					desde: input.desde,
					hasta: input.hasta,
					tipo_evento: input.tipoEvento,
					bucket_nuevo:
						input.bucketNuevo !== undefined
							? String(input.bucketNuevo)
							: undefined,
					numero_credito_sifco: input.numeroCreditoSifco || undefined,
					nombre_usuario: input.nombreUsuario || undefined,
					page: input.page,
					pageSize: input.pageSize,
				});
			} catch (error) {
				console.error("[getBucketsHistorial] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo obtener el historial de buckets",
				});
			}
		}),

	// CB-006: ficha por cuenta — historial completo de migraciones de UN crédito.
	getBucketsHistorialCredito: cobrosSupervisorProcedure
		.input(z.object({ creditoId: z.number().int().positive() }))
		.handler(async ({ input }) => {
			try {
				return await carteraBackClient.getBucketsHistorialCredito(
					input.creditoId,
				);
			} catch (error) {
				console.error("[getBucketsHistorialCredito] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo obtener el historial del crédito",
				});
			}
		}),

	// Bucket ACTUAL del motor (COBROS-02) para el badge del detalle de cobros.
	// Acepta el mismo `creditoId` que getDetallesCreditoCarteraBack (número
	// SIFCO o UUID de caso) para que la página pase el param de la ruta tal
	// cual. Degrada a null en vez de tirar error: el badge del cliente cae al
	// estadoMora existente cuando esto falla o el motor no tiene bucket.
	getBucketActualCredito: cobrosProcedure
		.input(z.object({ creditoId: z.string().min(1).max(100) }))
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) return null;
			try {
				const numeroSifco = await resolverNumeroSifco(input.creditoId);
				if (!numeroSifco) return null;
				return await carteraBackClient.getBucketActualCredito(numeroSifco);
			} catch (error) {
				console.error("[getBucketActualCredito] Error:", error);
				return null;
			}
		}),

	// CC2-11: Agenda del día — cuotas que vencen HOY (D-0) hasta D-5 de créditos
	// al día, agrupadas por urgencia. El rol cobros SOLO ve su agenda: se fuerza
	// server-side matcheando su email de login contra los asesores de cartera
	// (mismo puente por correo que el resto del módulo — la info del cliente
	// vive en el CRM, la del crédito en cartera). Admin/supervisor eligen
	// asesor con `asesorId` o ven todos.
	getAgendaDia: cobrosProcedure
		.input(
			z.object({
				// Un día del embudo D-0..D-5 por llamada: la Agenda dispara una query
				// por sección y cada una pagina sola (el 15/30 son ~600 cuentas).
				dia: z.number().int().min(0).max(5),
				asesorId: z.number().int().positive().optional(),
				page: z.number().int().positive().optional(),
				perPage: z.number().int().min(1).max(200).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const puedeVerTodos = PERMISSIONS.canAssignCobros(
					context.userRole ?? "",
				);
				const perPage = input.perPage ?? 50;
				const page = input.page ?? 1;

				// Asesor a filtrar EN EL SQL. El rol `cobros` queda FORZADO a su
				// propio asesor (matcheo por correo, nunca ve otro); admin/supervisor
				// eligen uno o ven todos.
				let asesorForzado: { asesorId: number; nombre: string } | null = null;
				let asesorIdFiltro: number | undefined;
				if (!puedeVerTodos) {
					const email = context.session?.user?.email?.trim().toLowerCase();
					// email_cash_in, NO getAdvisors()/platform_users.email: ese campo
					// está desactualizado (o el LEFT JOIN a platform_users no matchea)
					// para varios asesores — Diego Gomez, Samuel Gamboa, Caren Rivera —
					// y su agenda salía vacía con "no estás vinculado a un asesor".
					// Mismo patrón ya corregido en getConveniosListado /
					// getCierreDiarioPorRango.
					const asesoresConBuckets = await carteraBackClient.getPoolPorAsesor();
					const propio = buscarAsesorCarteraPorEmail(asesoresConBuckets, email);
					if (!propio) {
						// Usuario cobros sin asesor de cartera vinculado por correo:
						// agenda vacía con aviso (nunca la de otros).
						return {
							success: true,
							sinAsesor: true,
							asesorForzado: null,
							dia: input.dia,
							items: [],
							total: 0,
							page,
							perPage,
							totalPages: 1,
						};
					}
					asesorForzado = {
						asesorId: propio.asesor_id,
						nombre: propio.nombre,
					};
					asesorIdFiltro = propio.asesor_id;
				} else if (input.asesorId) {
					asesorIdFiltro = input.asesorId;
				}

				// Todo el funnel (soloAlDia: false): la agenda es pareja para todos
				// — cuentas al día Y en mora con cuota próxima. Los recordatorios
				// WhatsApp (premora) siguen siendo solo B0. Filtro de asesor +
				// paginación EN EL SQL: el día pesado llega de a perPage y el LIMIT
				// aplica sobre las filas del asesor, no sobre el universo.
				const respuesta = await obtenerPaginaAgenda(input.dia, {
					asesorId: asesorIdFiltro,
					page,
					perPage,
				});
				const cuotas = respuesta.data ?? [];
				const total = respuesta.total ?? cuotas.length;
				const totalPages = respuesta.totalPages ?? 1;
				// Página EFECTIVA: cartera-back clampa la página a la última válida
				// si la pedida quedó fuera de rango (día encogido); hay que devolver
				// ESA, no la pedida, o el paginador del front queda pegado en una
				// página imposible (review Codex).
				const pageEfectiva = respuesta.page ?? page;

				if (cuotas.length === 0) {
					return {
						success: true,
						sinAsesor: false,
						asesorForzado,
						dia: input.dia,
						items: [],
						total,
						page: pageEfectiva,
						perPage,
						totalPages,
					};
				}

				const sifcos = [...new Set(cuotas.map((c) => c.numero_credito_sifco))];
				const cuotaIds = [...new Set(cuotas.map((c) => c.cuota_id))];

				// Teléfono del cliente: caso de cobros → lead (cartera no tiene
				// teléfonos de clientes). Casos también inactivos: con varios por
				// SIFCO gana el activo y a igualdad el más reciente.
				const casos = await db
					.select({
						id: casosCobros.id,
						numeroCreditoSifco: casosCobros.numeroCreditoSifco,
						telefonoPrincipal: casosCobros.telefonoPrincipal,
						activo: casosCobros.activo,
						updatedAt: casosCobros.updatedAt,
					})
					.from(casosCobros)
					.where(inArray(casosCobros.numeroCreditoSifco, sifcos));
				// Con varios casos por SIFCO gana el activo y a igualdad el más
				// reciente — criterio compartido (lib/caso-vigente.ts).
				const casoPorSifco = agruparCasosVigentesPorSifco(casos);

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

				// Recordatorios premora ya enviados por cuota (badges en la agenda).
				const recordatorios = await db
					.select({
						cuotaId: recordatoriosPremora.cuotaId,
						tipo: recordatoriosPremora.tipo,
						enviadoAt: recordatoriosPremora.enviadoAt,
					})
					.from(recordatoriosPremora)
					.where(inArray(recordatoriosPremora.cuotaId, cuotaIds));
				const recPorCuota = new Map<
					number,
					{ tipo: string; enviadoAt: Date; modoPrueba: boolean }[]
				>();
				for (const rec of recordatorios) {
					const lista = recPorCuota.get(rec.cuotaId) ?? [];
					lista.push({
						tipo: rec.tipo,
						enviadoAt: rec.enviadoAt,
						modoPrueba: false,
					});
					recPorCuota.set(rec.cuotaId, lista);
				}

				// + envíos recientes en cobros_send_logs: el modo test NO escribe
				// claims (a propósito — no consume el recordatorio real), así que
				// sin esto la agenda diría "—" aunque la prueba ya salió. Los logs
				// no traen cuota_id: se mapean por SIFCO+tipo con ventana de 10
				// días (la ventana natural D-5→D-0 de una cuota).
				const enviosRecientes = await db
					.select({
						numeroCreditoSifco: cobrosSendLogs.numeroCreditoSifco,
						plantillaId: cobrosSendLogs.plantillaId,
						providerResponse: cobrosSendLogs.providerResponse,
						createdAt: cobrosSendLogs.createdAt,
					})
					.from(cobrosSendLogs)
					.where(
						and(
							inArray(cobrosSendLogs.numeroCreditoSifco, sifcos),
							inArray(cobrosSendLogs.plantillaId, [
								"premora_5",
								"premora_3",
								"premora_1",
								"premora_0",
								"premora_5_mora",
								"premora_3_mora",
								"premora_1_mora",
								"premora_0_mora",
							]),
							eq(cobrosSendLogs.status, "sent"),
							gte(cobrosSendLogs.createdAt, sql`now() - interval '10 days'`),
						),
					);
				const enviosPorSifco = new Map<
					string,
					Map<string, { enviadoAt: Date; modoPrueba: boolean }>
				>();
				for (const envio of enviosRecientes) {
					const sifco = envio.numeroCreditoSifco ?? "";
					// Tipo BASE (la variante _mora es la misma campaña D-X): así el
					// dedupe contra los claims —que son por tipo base— funciona.
					const tipo = (envio.plantillaId ?? "").replace("_mora", "");
					const porTipo = enviosPorSifco.get(sifco) ?? new Map();
					if (!porTipo.has(tipo)) {
						porTipo.set(tipo, {
							enviadoAt: envio.createdAt,
							modoPrueba: envio.providerResponse?.testMode === true,
						});
					}
					enviosPorSifco.set(sifco, porTipo);
				}

				const items = cuotas.map((c) => {
					const caso = casoPorSifco.get(c.numero_credito_sifco);
					return {
						cuotaId: c.cuota_id,
						creditoId: c.credito_id,
						numeroCuota: c.numero_cuota,
						fechaVencimiento: c.fecha_vencimiento,
						diasParaVencer: c.dias_para_vencer,
						numeroCreditoSifco: c.numero_credito_sifco,
						statusCredit: c.status_credit,
						bucket: c.bucket,
						montoCuota: c.monto_cuota,
						cliente: c.cliente,
						telefono:
							primerTelefono(caso?.telefonoPrincipal) ??
							primerTelefono(leadPhonePorSifco.get(c.numero_credito_sifco)) ??
							null,
						casoId: caso?.id ?? null,
						asesorId: c.asesor_id,
						asesor: c.asesor,
						recordatorios: (() => {
							// Claims exactos por cuota + envíos por SIFCO (dedupe por
							// tipo; el claim real gana sobre el log).
							const lista = [...(recPorCuota.get(c.cuota_id) ?? [])];
							const tipos = new Set(lista.map((r) => r.tipo));
							const envios = enviosPorSifco.get(c.numero_credito_sifco);
							if (envios) {
								for (const [tipo, envio] of envios) {
									if (!tipos.has(tipo)) {
										lista.push({ tipo, ...envio });
									}
								}
							}
							return lista;
						})(),
					};
				});
				// Sin re-ordenar: el SQL ya viene ORDER BY nombre del cliente y ese
				// orden ES el de la paginación (re-ordenar acá partiría las páginas).

				return {
					success: true,
					sinAsesor: false,
					asesorForzado,
					dia: input.dia,
					items,
					total,
					page: pageEfectiva,
					perPage,
					totalPages,
				};
			} catch (error) {
				console.error("[getAgendaDia] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo obtener la agenda del día",
				});
			}
		}),

	// CC2-11: recordatorios premora enviados a un crédito (card del detalle).
	// Fuente = cobros_send_logs (incluye intentos fallidos y envíos en modo
	// prueba, marcados) — la traza completa, no solo los claims.
	getRecordatoriosPremora: cobrosProcedure
		.input(z.object({ numeroSifco: z.string().min(1).max(100) }))
		.handler(async ({ input }) => {
			try {
				const envios = await db
					.select({
						id: cobrosSendLogs.id,
						plantillaId: cobrosSendLogs.plantillaId,
						telefono: cobrosSendLogs.telefono,
						status: cobrosSendLogs.status,
						errorMessage: cobrosSendLogs.errorMessage,
						providerResponse: cobrosSendLogs.providerResponse,
						createdAt: cobrosSendLogs.createdAt,
					})
					.from(cobrosSendLogs)
					.where(
						and(
							eq(cobrosSendLogs.numeroCreditoSifco, input.numeroSifco),
							inArray(cobrosSendLogs.plantillaId, [
								"premora_5",
								"premora_3",
								"premora_1",
								"premora_0",
								"premora_5_mora",
								"premora_3_mora",
								"premora_1_mora",
								"premora_0_mora",
							]),
						),
					)
					.orderBy(desc(cobrosSendLogs.createdAt))
					.limit(30);

				return {
					success: true,
					recordatorios: envios.map((e) => ({
						id: e.id,
						tipo: e.plantillaId,
						telefono: e.telefono,
						enviado: e.status === "sent",
						error: e.errorMessage,
						modoPrueba: e.providerResponse?.testMode === true,
						fecha: e.createdAt,
					})),
				};
			} catch (error) {
				console.error("[getRecordatoriosPremora] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudieron obtener los recordatorios",
				});
			}
		}),

	// Obtener usuarios con rol de cobros para asignación
	getUsuariosCobros: cobrosSupervisorProcedure.handler(async () => {
		const usuarios = await db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			})
			.from(user)
			.where(
				or(
					eq(user.role, "cobros"),
					eq(user.role, "cobros_supervisor"),
					eq(user.role, "admin"),
				),
			)
			.orderBy(asc(user.name));

		return usuarios;
	}),

	// CB-020: estado de cumplimiento de promesas de pago. Cada promesa se
	// verifica con DOS chequeos independientes (ver plan — cartera-back NO
	// separa la mora por cuota, es un monto agregado del crédito):
	//  1. Si tiene rango de cuotas (cuotaInicio/cuotaFin) → TODAS esas cuotas
	//     deben estar pagado=true (cuotasPagadas de getCredito).
	//  2. Si incluyeMora=true → la mora ACTIVA del crédito debe estar saldada
	//     (mora.activa=false o moraActual="0.00").
	// cumplida = los chequeos que apliquen se cumplen; incumplida = la fecha
	// prometida ya pasó y alguno no se cumple; pendiente = la fecha no llega.
	// Persiste el resultado en estadoPromesa (no solo lo devuelve) para que
	// quede disponible sin recalcular en cada lectura.
	//
	// CB-020 (review Codex): el input SOLO manda `id` + `numeroSifco` — los
	// datos de evaluación (cuotaInicio/cuotaFin/incluyeMora/fechaPrometida)
	// se CARGAN de `contactos_cobros` por id, nunca se toman del cliente.
	// Antes el cliente los mandaba directo: un id real con
	// cuotaInicio/cuotaFin/incluyeMora=null/null/false pasaba evaluarPromesa
	// como "cumplida" inmediata (sin rango ni mora que chequear) y ESO se
	// persistía, pisando el estado real de la fila.
	getEstadoPromesasPago: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string().min(1),
				promesaIds: z.array(z.string().uuid()).max(100),
			}),
		)
		.handler(async ({ input }) => {
			if (input.promesaIds.length === 0) return {};

			// Fila real de DB por id — el `numeroSifco` del caso debe coincidir
			// con el pedido, si no la fila se descarta (defensa contra un id de
			// OTRO crédito colado en la lista).
			const filas = await db
				.select({
					id: contactosCobros.id,
					cuotaInicio: contactosCobros.cuotaInicio,
					cuotaFin: contactosCobros.cuotaFin,
					incluyeMora: contactosCobros.incluyeMora,
					fechaProximoContacto: contactosCobros.fechaProximoContacto,
					estadoContacto: contactosCobros.estadoContacto,
					estadoPromesa: contactosCobros.estadoPromesa,
					// CB-128: la auditoría necesita el caso para la FK.
					casoCobroId: contactosCobros.casoCobroId,
					numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				})
				.from(contactosCobros)
				.innerJoin(casosCobros, eq(contactosCobros.casoCobroId, casosCobros.id))
				.where(inArray(contactosCobros.id, input.promesaIds));

			// "cumplida" es TERMINAL — mismo criterio que el job nocturno
			// (check-promesas-pago.ts). Sin este filtro, re-abrir el caso
			// re-evaluaba una promesa YA cumplida contra el estado ACTUAL del
			// crédito: si esa promesa tenía incluyeMora=true y el crédito
			// acumuló mora NUEVA después (de otra cuota, ajena a esta promesa),
			// la promesa pasaba de "cumplida" a "pendiente"/"incumplida" sin que
			// nada relacionado a ELLA hubiera cambiado — sobrescribía un
			// resultado correcto y ya cerrado. El front (getHistorialContactos)
			// ya cae a `promesa.estadoPromesa` (columna DB) cuando el id no
			// viene en este resultado, así que excluirla aquí no pierde el dato.
			const promesasValidas = filas.filter(
				(f) =>
					f.estadoContacto === "promesa_pago" &&
					f.numeroCreditoSifco === input.numeroSifco &&
					f.fechaProximoContacto != null &&
					f.estadoPromesa !== "cumplida",
			);
			if (promesasValidas.length === 0) return {};

			// CB-020 (review Codex): getCredito() usa un cache de 5 min (TTL
			// default) que createPago() intenta invalidar con un patrón que NO
			// matchea la key real (bug preexistente y ajeno a este PR, en
			// cartera-back-client.ts:873 — "credito:${sifco}" vs la key real
			// "GET:.../credito?numero_credito_sifco=${sifco}:{}", confirmado con
			// prueba directa: .includes() da false). Sin este endpoint acá abajo
			// no vale la pena arreglar ESE bug ajeno, pero SÍ evitar que la
			// persistencia de estadoPromesa dependa de un snapshot potencialmente
			// viejo: se invalida la key real ANTES de leer, para esta llamada.
			carteraBackClient.invalidateCache(
				`/credito?numero_credito_sifco=${input.numeroSifco}`,
			);

			let credito: Awaited<ReturnType<typeof carteraBackClient.getCredito>>;
			try {
				credito = await carteraBackClient.getCredito(input.numeroSifco);
			} catch (error) {
				console.error(
					"[getEstadoPromesasPago] Error consultando crédito:",
					error,
				);
				// Sin datos no se puede RE-EVALUAR con certeza — pero forzar
				// "pendiente" a todas (review Codex) pisaba el estado YA
				// GUARDADO: una promesa que ya estaba "incumplida" en DB (dato
				// real, calculado en un ciclo anterior con datos buenos)
				// aparecía como "pendiente" en la UI durante un outage/timeout
				// de cartera-back, ocultando delincuencia real justo cuando
				// más importa. Preserva el estadoPromesa guardado; solo cae a
				// "pendiente" si esa promesa NUNCA se evaluó (null en DB).
				return Object.fromEntries(
					promesasValidas.map((p) => [
						p.id,
						(p.estadoPromesa ?? "pendiente") as EstadoPromesa,
					]),
				);
			}

			const estadoCredito = derivarEstadoCredito(credito);
			const hoy = new Date();
			const resultado: Record<string, EstadoPromesa> = {};
			for (const promesa of promesasValidas) {
				resultado[promesa.id] = evaluarPromesa(
					{
						id: promesa.id,
						cuotaInicio: promesa.cuotaInicio,
						cuotaFin: promesa.cuotaFin,
						incluyeMora: promesa.incluyeMora,
						fechaPrometida: promesa.fechaProximoContacto as Date,
					},
					estadoCredito,
					hoy,
				);
			}

			// Persistir — best-effort, no debe tumbar la respuesta de lectura:
			// `resultado` ya se devuelve al front sin importar cómo salga esto.
			//
			// CB-128: guard de no-op (antes se escribía SIEMPRE, aunque el estado
			// calculado fuera idéntico al guardado — ruido puro en el camino
			// caliente, y auditarlo habría llenado la bitácora de filas
			// 'pendiente → pendiente') + auditoría de la transición real.
			//
			// TODO EL LOTE VA EN UNA SOLA TRANSACCIÓN, no una por promesa. Con
			// `promesaIds` capado a 100, una transacción por fila dentro de un
			// allSettled tomaba hasta 100 conexiones a la vez contra un pool de 10
			// para toda la app — un handler de LECTURA dejaba al resto del CRM
			// esperando. El helper además ordena los locks por id, que es lo que
			// evita el deadlock contra el job nocturno. Ver lib/promesa-estado-batch.ts.
			try {
				const transiciones = await aplicarCambiosEstadoPromesa(
					Object.entries(resultado).map(([id, estado]) => ({ id, estado })),
				);
				await auditarTransiciones(transiciones, "sistema_lectura");
			} catch (error) {
				console.error(
					"[getEstadoPromesasPago] Error persistiendo estadoPromesa:",
					error,
				);
			}

			// CB-030: promesa recién CUMPLIDA → push best-effort marcando
			// activa=false en el espejo de cartera-back (destraba el freeze de
			// inmediato en vez de esperar a que la fecha_promesa pase sola).
			// "incumplida" NO empuja acá: el freeze en cartera-back ya se
			// autodestraba por fecha_promesa < hoy (isOverdueInstallmentForMora),
			// así que ese caso no depende de este push para ser correcto.
			//
			// SIN await, y con más razón que en createContactoCobros: acá el push
			// va DENTRO de un loop, así que esperarlo multiplicaba el peor caso
			// por la cantidad de promesas cumplidas (~127s cada una con
			// cartera-back caído) en un endpoint que corre cada vez que un asesor
			// abre un caso (Codex PR #1237).
			for (const promesa of promesasValidas) {
				if (resultado[promesa.id] === "cumplida") {
					pushPromesaActivaEnSegundoPlano({
						id: promesa.id,
						numeroCreditoSifco: promesa.numeroCreditoSifco,
						cuotaInicio: promesa.cuotaInicio,
						cuotaFin: promesa.cuotaFin,
						incluyeMora: promesa.incluyeMora,
						fechaProximoContacto: promesa.fechaProximoContacto,
						activa: false,
					});
				}
			}

			return resultado;
		}),

	// CB-020: Cola del Día priorizada. Combina el universo SLA de cartera-back
	// (créditos del pool asesor_bucket con su fecha_limite_sla) con las
	// promesas de pago del CRM (contactos_cobros, que solo viven acá) para
	// armar las 3 categorías: SLA vence hoy, promesa vence hoy, incumplida.
	// Mismo patrón de "asesor forzado" que getAgendaDia — el rol cobros solo
	// ve su propia cola (match por email contra cartera-back.getAdvisors).
	getColaDia: cobrosProcedure
		.input(
			z.object({
				filtro: z.enum(CATEGORIAS_COLA_DIA).optional(),
				asesorId: z.number().int().positive().optional(),
				buckets: z.array(z.number().int().min(0).max(5)).optional(),
				page: z.number().int().positive().optional(),
				perPage: z.number().int().min(1).max(200).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				const puedeVerTodos = PERMISSIONS.canAssignCobros(
					context.userRole ?? "",
				);
				const perPage = input.perPage ?? 50;
				const page = input.page ?? 1;

				let asesorForzado: { asesorId: number; nombre: string } | null = null;
				let asesorIdFiltro: number | undefined;
				if (!puedeVerTodos) {
					const email = context.session?.user?.email?.trim().toLowerCase();
					// email_cash_in, NO getAdvisors()/platform_users.email (ver el
					// mismo comentario en getAgendaDia): con /advisor la cola salía
					// vacía para los asesores cuyo platform_users.email no coincide.
					const asesoresConBuckets = await carteraBackClient.getPoolPorAsesor();
					const propio = asesoresConBuckets.find(
						(a) => a.email_cash_in?.trim().toLowerCase() === email,
					);
					if (!propio) {
						return {
							success: true,
							sinAsesor: true,
							asesorForzado: null,
							items: [],
							total: 0,
							page,
							perPage,
							totalPages: 1,
						};
					}
					asesorForzado = {
						asesorId: propio.asesor_id,
						nombre: propio.nombre,
					};
					asesorIdFiltro = propio.asesor_id;
				} else if (input.asesorId) {
					asesorIdFiltro = input.asesorId;
				}

				// Universo SLA: TODOS los créditos del pool del asesor (o de todos
				// los asesores, si no se filtra) — sin paginar acá todavía, porque
				// la paginación real ocurre DESPUÉS de cruzar con promesas y
				// clasificar (un crédito puede calificar o no calificar para la
				// cola; paginar antes de saber eso rompería la página). "Promesa
				// hoy"/"incumplida" son independientes del SLA — cartera-back NO
				// filtra por fecha (no sabe de promesas, viven solo en el CRM), así
				// que hay que traer el universo COMPLETO del pool, no solo lo que
				// vence pronto. fetchAllPages pagina de verdad (perPage 100, en
				// paralelo) en vez de forzar un perPage gigante en una sola
				// llamada — mismo patrón que obtenerTodasLasPaginasCreditos, arriba
				// en este archivo.
				// Cuotas que vencen HOY (D-0) — fuente independiente de SLA
				// (getCuotasProximasVencer, no getColaDiaSLA), mismo helper que usa
				// getAgendaDia. En paralelo con el universo SLA: no dependen entre sí.
				//
				// Sin asesorId acá A PROPÓSITO: getColaDiaSLA filtra por el POOL del
				// bucket del asesor (asesor_bucket — un asesor puede cubrir créditos
				// de OTRO asesor por el pool, ver docs/features/cobros-02/
				// 04-operacion-diaria.md), pero getCuotasProximasVencer filtra
				// asesor_id por el DUEÑO directo del crédito (creditos.asesor_id) —
				// mismo parámetro, distinto eje en cartera-back. Filtrar D-0 acá con
				// asesorIdFiltro dejaba fuera de venceHoySet los créditos que un
				// asesor cubre solo por pool (Codex PR #1334). Sin filtro de asesor,
				// la intersección real ocurre más abajo: venceHoySet solo se
				// consulta para SIFCOs que ya están en `universo` (el pool SLA), así
				// que el scoping correcto lo sigue dando el universo, no esta query.
				const [universoData, cuotasHoyData] = await Promise.all([
					fetchAllPages(
						async (page) => {
							const resp = await carteraBackClient.getColaDiaSLA({
								asesorId: asesorIdFiltro,
								buckets: input.buckets,
								page,
								perPage: 100,
							});
							return { data: resp.data, totalPages: resp.totalPages ?? 0 };
						},
						{ maxPages: 200 }, // 200 * 100 = 20k créditos, muy por encima de la cartera real
					),
					fetchAllPages(
						async (page) => {
							const resp = await obtenerPaginaAgenda(0, {
								page,
								perPage: 200,
							});
							return {
								data: resp.data ?? [],
								totalPages: resp.totalPages ?? 0,
							};
						},
						{ maxPages: 200 },
					),
				]);
				const universo = { data: universoData };
				// venceHoy solo se marca sobre créditos que ya están en el pool SLA
				// (getColaDiaSLA excluye B0 — "Cartera Sana" no tiene SLA). Un
				// crédito B0 con cuota venciendo hoy no entra a esta cola; mismo
				// hueco que ya tenía la tarjeta "Vencen hoy" original. La
				// intersección real contra el universo (pool) ocurre acá: aunque
				// cuotasHoyData trae D-0 de TODA la cartera (sin filtro de asesor),
				// venceHoySet.has() abajo solo se consulta para SIFCOs que ya
				// pasaron el filtro de pool del universo SLA.
				const venceHoySet = new Set(
					cuotasHoyData.map((c) => c.numero_credito_sifco),
				);
				const montoCuotaHoyPorSifco = new Map<string, string>();
				for (const cuota of cuotasHoyData) {
					// Primera cuota gana si un crédito tiene más de una vencer hoy.
					if (!montoCuotaHoyPorSifco.has(cuota.numero_credito_sifco)) {
						montoCuotaHoyPorSifco.set(
							cuota.numero_credito_sifco,
							cuota.monto_cuota,
						);
					}
				}

				if (universo.data.length === 0) {
					return {
						success: true,
						sinAsesor: false,
						asesorForzado,
						items: [],
						total: 0,
						page,
						perPage,
						totalPages: 1,
					};
				}

				const sifcos = [
					...new Set(universo.data.map((c) => c.numero_credito_sifco)),
				];

				// Casos de cobros del CRM por SIFCO (teléfono + id para ir al detalle)
				// y teléfono vía lead (cartera no tiene teléfonos de clientes) — ambas
				// dependen solo de `sifcos`, sin dependencia entre sí → en paralelo.
				const [casos, oportunidades] = await Promise.all([
					db
						.select({
							id: casosCobros.id,
							numeroCreditoSifco: casosCobros.numeroCreditoSifco,
							telefonoPrincipal: casosCobros.telefonoPrincipal,
							activo: casosCobros.activo,
							updatedAt: casosCobros.updatedAt,
							// Vehículo (para identificar la cuenta en la lista, igual que
							// la tabla del dashboard) — cartera-back no lo trae en la cola.
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
						.leftJoin(
							vehicles,
							eq(contratosFinanciamiento.vehicleId, vehicles.id),
						)
						.where(inArray(casosCobros.numeroCreditoSifco, sifcos)),
					db
						.select({
							numeroSifco: opportunities.numeroSifco,
							leadPhone: leads.phone,
						})
						.from(opportunities)
						.leftJoin(leads, eq(opportunities.leadId, leads.id))
						.where(inArray(opportunities.numeroSifco, sifcos)),
				]);

				// Con varios casos por SIFCO gana el activo y a igualdad el más
				// reciente — criterio compartido (lib/caso-vigente.ts).
				const casoPorSifco = agruparCasosVigentesPorSifco(casos);
				const casoIds = [...casoPorSifco.values()].map((c) => c.id);
				const leadPhonePorSifco = new Map(
					oportunidades.map((o) => [o.numeroSifco ?? "", o.leadPhone]),
				);

				// Promesas activas y último contacto por caso — ambas dependen de
				// `casoIds` pero son independientes entre sí → en paralelo.
				const [promesas, ultimosContactos] = await Promise.all([
					// Promesas ACTIVAS (pendiente/incumplida — 'cumplida' es terminal,
					// se excluye), para clasificar. `estadoPromesa IS NULL` (filas
					// legacy nunca evaluadas, o creadas antes de que
					// getEstadoPromesasPago/el job nocturno les asignara un valor)
					// cuenta como "pendiente" — mismo criterio que
					// getEstadoPromesasPago (línea ~2160: `estadoPromesa ?? "pendiente"`)
					// — sin este OR, `eq(estadoPromesa, "pendiente")` nunca matchea
					// NULL en SQL y esas promesas se colaban fuera de la Cola del Día
					// hasta que algo más las recalculara (review Codex).
					casoIds.length === 0
						? Promise.resolve([])
						: db
								.select({
									casoCobroId: contactosCobros.casoCobroId,
									estadoPromesa: contactosCobros.estadoPromesa,
									fechaProximoContacto: contactosCobros.fechaProximoContacto,
									fechaAlerta: contactosCobros.fechaAlerta,
								})
								.from(contactosCobros)
								.where(
									and(
										inArray(contactosCobros.casoCobroId, casoIds),
										eq(contactosCobros.estadoContacto, "promesa_pago"),
										isNotNull(contactosCobros.fechaProximoContacto),
										or(
											eq(contactosCobros.estadoPromesa, "pendiente"),
											eq(contactosCobros.estadoPromesa, "incumplida"),
											isNull(contactosCobros.estadoPromesa),
										),
									),
								),
					// Último contacto (CUALQUIER tipo) por caso — una sola fuente para
					// dos usos: "contactado hoy" (saca la bandera slaHoy si el asesor
					// ya llamó hoy) y "días sin contacto" (categoría sinContacto,
					// CB-020). Mismo patrón que checkCasosSinContacto
					// (jobs/cobros-notifications.ts): MAX(fecha_contacto) agrupado por
					// caso_cobro_id.
					casoIds.length === 0
						? Promise.resolve([])
						: db
								.select({
									casoCobroId: contactosCobros.casoCobroId,
									ultimaFecha: max(contactosCobros.fechaContacto),
								})
								.from(contactosCobros)
								.where(inArray(contactosCobros.casoCobroId, casoIds))
								.groupBy(contactosCobros.casoCobroId),
				]);
				const promesasPorCaso = new Map<
					string,
					Array<{
						estadoPromesa: "pendiente" | "incumplida";
						fechaPrometida: Date;
						fechaAlerta?: Date | null;
					}>
				>();
				for (const p of promesas) {
					if (p.estadoPromesa === "cumplida") continue;
					// NULL (legacy, nunca evaluada) cuenta como "pendiente" — el SQL
					// de arriba ya la deja pasar con isNull(estadoPromesa), acá se
					// resuelve el valor por defecto (mismo criterio que
					// getEstadoPromesasPago: `estadoPromesa ?? "pendiente"`).
					const estadoPromesa = p.estadoPromesa ?? "pendiente";
					const lista = promesasPorCaso.get(p.casoCobroId) ?? [];
					lista.push({
						estadoPromesa,
						fechaPrometida: p.fechaProximoContacto as Date,
						fechaAlerta: p.fechaAlerta,
					});
					promesasPorCaso.set(p.casoCobroId, lista);
				}

				const hoyStr = toDateStrGT(new Date());
				const contactadoHoyPorCaso = new Set<string>();
				const diasSinContactoPorCaso = new Map<string, number>();
				// gtDateStrToDate: medianoche GT del día, no medianoche UTC — misma
				// convención que usa el resto del proyecto para comparar fechas GT
				// por día calendario (ver promesa-pago.ts).
				const hoyMs = gtDateStrToDate(hoyStr).getTime();
				const MS_POR_DIA = 24 * 60 * 60 * 1000;
				for (const c of ultimosContactos) {
					if (!c.ultimaFecha) continue;
					if (toDateStrGT(c.ultimaFecha) === hoyStr) {
						contactadoHoyPorCaso.add(c.casoCobroId);
					}
					const ultimaFechaStr = toDateStrGT(c.ultimaFecha);
					const ultimaMs = gtDateStrToDate(ultimaFechaStr).getTime();
					const dias = Math.floor((hoyMs - ultimaMs) / MS_POR_DIA);
					diasSinContactoPorCaso.set(c.casoCobroId, dias);
				}

				const hoy = new Date();
				const items = universo.data
					.map((credito) => {
						const caso = casoPorSifco.get(credito.numero_credito_sifco);
						const promesasCredito = caso
							? (promesasPorCaso.get(caso.id) ?? [])
							: [];
						const diasSinContacto = caso
							? (diasSinContactoPorCaso.get(caso.id) ?? null)
							: null;
						const clasificacion = clasificarCreditoColaDia(
							{
								fechaLimiteSla: credito.fecha_limite_sla,
								contactadoHoy: caso ? contactadoHoyPorCaso.has(caso.id) : false,
								venceHoy: venceHoySet.has(credito.numero_credito_sifco),
								promesas: promesasCredito,
								diasSinContacto,
							},
							hoy,
						);
						return {
							credito,
							caso,
							promesasCredito,
							clasificacion,
							diasSinContacto,
						};
					})
					.filter(({ clasificacion }) =>
						input.filtro
							? calificaParaFiltro(clasificacion, input.filtro)
							: calificaParaColaDia(clasificacion),
					)
					.sort(
						(a, b) =>
							ordenColaDia(a.clasificacion) - ordenColaDia(b.clasificacion),
					)
					.map(
						({
							credito,
							caso,
							promesasCredito,
							clasificacion,
							diasSinContacto,
						}) => ({
							creditoId: credito.credito_id,
							numeroCreditoSifco: credito.numero_credito_sifco,
							cliente: credito.cliente,
							asesorId: credito.asesor_id,
							asesor: credito.asesor,
							bucket: credito.bucket,
							bucketPrefijo: credito.bucket_prefijo,
							bucketNombre: credito.bucket_nombre,
							fechaLimiteSla: credito.fecha_limite_sla,
							// Próxima promesa activa a mostrar: la más próxima en el tiempo.
							fechaPromesa:
								promesasCredito.length > 0
									? promesasCredito
											.map((p) => p.fechaPrometida)
											.sort((x, y) => x.getTime() - y.getTime())[0]
									: null,
							telefono:
								primerTelefono(caso?.telefonoPrincipal) ??
								primerTelefono(
									leadPhonePorSifco.get(credito.numero_credito_sifco),
								) ??
								null,
							casoId: caso?.id ?? null,
							vehiculoMarca: caso?.vehiculoMarca ?? null,
							vehiculoModelo: caso?.vehiculoModelo ?? null,
							vehiculoYear: caso?.vehiculoYear ?? null,
							vehiculoPlaca: caso?.vehiculoPlaca ?? null,
							slaHoy: clasificacion.slaHoy,
							promesaHoy: clasificacion.promesaHoy,
							venceHoy: clasificacion.venceHoy,
							montoCuotaHoy:
								montoCuotaHoyPorSifco.get(credito.numero_credito_sifco) ?? null,
							incumplida: clasificacion.incumplida,
							promesaProxima: clasificacion.promesaProxima,
							// CB-030: vigencia real, NO derivable de los otros flags —
							// un crédito puede tener incumplida vieja + vigente nueva.
							promesaActiva: clasificacion.promesaActiva,
							sinContacto: clasificacion.sinContacto,
							diasSinContacto,
						}),
					);

				// Conteos por categoria sobre TODO el universo (antes de input.filtro),
				// para la barra "Agenda de hoy" de /cobros/mi-dia. Reclasifica en un pase
				// aparte para no tocar el pipeline paginado de `items`; el pool del asesor
				// es chico. Cada conteo == lo que se ve al filtrar por esa categoria.
				const conteos = (() => {
					const cls = universo.data.map((credito) => {
						const caso = casoPorSifco.get(credito.numero_credito_sifco);
						return clasificarCreditoColaDia(
							{
								fechaLimiteSla: credito.fecha_limite_sla,
								contactadoHoy: caso ? contactadoHoyPorCaso.has(caso.id) : false,
								venceHoy: venceHoySet.has(credito.numero_credito_sifco),
								promesas: caso ? (promesasPorCaso.get(caso.id) ?? []) : [],
								diasSinContacto: caso
									? (diasSinContactoPorCaso.get(caso.id) ?? null)
									: null,
							},
							hoy,
						);
					});
					return Object.fromEntries(
						CATEGORIAS_COLA_DIA.map((cat) => [
							cat,
							cls.filter((c) => calificaParaFiltro(c, cat)).length,
						]),
					) as Record<(typeof CATEGORIAS_COLA_DIA)[number], number>;
				})();

				const total = items.length;
				const totalPages = Math.max(1, Math.ceil(total / perPage));
				const offset = (page - 1) * perPage;

				return {
					success: true,
					sinAsesor: false,
					asesorForzado,
					items: items.slice(offset, offset + perPage),
					total,
					conteos,
					page,
					perPage,
					totalPages,
				};
			} catch (error) {
				console.error("[getColaDia] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "No se pudo obtener la cola del día",
				});
			}
		}),

	// CB-020: actualizar días de SLA (dias_sla) por bucket (B1-B5). Solo supervisor / admin.
	actualizarDiasSlaBuckets: cobrosSupervisorProcedure
		.input(
			z.object({
				configuraciones: z.array(
					z.object({
						bucket: z.number().int().min(1).max(5),
						diasSla: z.number().int().min(1).max(30),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const payload = input.configuraciones.map((c) => ({
					bucket: c.bucket,
					dias_sla: c.diasSla,
				}));
				const res = await carteraBackClient.updateBucketsSLA(payload);
				if (!res.success) {
					throw new ORPCError("BAD_REQUEST", {
						message: res.message ?? "No se pudieron actualizar los días de SLA",
					});
				}
				await refreshMoraBucketsCache();
				return { success: true };
			} catch (error) {
				if (error instanceof ORPCError) throw error;
				console.error("[actualizarDiasSlaBuckets] Error:", error);
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "Error al actualizar la configuración de SLA",
				});
			}
		}),

	// Obtener historial de cuotas de pago de un contrato
	getHistorialPagos: cobrosProcedure
		.input(z.object({ numeroSifco: z.string() }))
		.handler(async ({ input, context }) => {
			try {
				if (!input.numeroSifco) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El número SIFCO es requerido",
					});
				}

				// TODO: Cambiar a verificación por caso de cobros cuando ya no haya datos importados sin responsable
				// Actualmente permitimos a usuarios de cobros ver todos los historiales porque los contratos
				// importados de cartera-back no tienen responsable asignado.
				// Futura implementación (cuando todos los casos tengan responsables):
				// - Buscar caso de cobros asociado al contrato
				// - Verificar que el usuario sea el responsable del caso
				// - Solo permitir acceso si es admin o responsable del caso
				console.log("🔐 Verificando permisos:", {
					esAdmin: context.userRole === "admin",
					esCobros: context.userRole === "cobros",
					esCobrosSupervisor: context.userRole === "cobros_supervisor",
					usuarioActual: context.userId,
					tienePermiso: PERMISSIONS.canAccessCobros(context.userRole),
				});

				if (!PERMISSIONS.canAccessCobros(context.userRole)) {
					console.error("❌ Sin permisos para ver historial");
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver este historial",
					});
				}

				// Verificar si el contrato tiene referencia a cartera-back
				if (isCarteraBackEnabled()) {
					console.log(
						"🔗 Contrato vinculado a cartera-back, obteniendo cuotas de allá",
					);

					try {
						// Obtener crédito completo de cartera-back
						const creditoCompleto = await carteraBackClient.getCredito(
							input.numeroSifco,
						);

						const cuotasCombinadas = [
							...(creditoCompleto.cuotasPagadas || []),
							...(creditoCompleto.cuotasPendientes || []),
							...(creditoCompleto.cuotasAtrasadas || []),
						];

						// Eliminar duplicados basándose en numero_cuota
						// Prioridad: pagadas > atrasadas > pendientes
						const cuotasUnicas = new Map<number, any>();

						for (const cuota of cuotasCombinadas) {
							const numeroCuota = cuota.numero_cuota;
							const existente = cuotasUnicas.get(numeroCuota);

							if (!existente) {
								cuotasUnicas.set(numeroCuota, cuota);
							} else {
								// Si la nueva cuota está pagada, reemplaza la existente
								// Si ambas están pagadas o ninguna, mantiene la primera
								if (cuota.pagado && !existente.pagado) {
									cuotasUnicas.set(numeroCuota, cuota);
								}
							}
						}

						// Mapear a estructura esperada por frontend
						return Array.from(cuotasUnicas.values())
							.sort((a, b) => a.numero_cuota - b.numero_cuota)
							.map((cuota) => {
								const montoMora = cuota.pago_mora ? Number(cuota.pago_mora) : 0;
								const montoCuota = resolveInstallmentAmount(
									cuota.cuota,
									creditoCompleto.credito.cuota,
								);
								const montoPagadoReal =
									cuota.pagado && cuota.monto_boleta
										? Number(cuota.monto_boleta)
										: cuota.pagado
											? Number(montoCuota)
											: null;

								return {
									...cuota,
									id: cuota.cuota_id.toString(),
									numeroCuota: cuota.numero_cuota,
									fechaVencimiento: cuota.fecha_vencimiento,
									montoCuota,
									fechaPago: cuota.pagado ? cuota.fecha_vencimiento : null,
									montoPagado: montoPagadoReal,
									montoMora: montoMora.toString(),
									estadoMora: cuota.pagado ? "pagado" : "pendiente",
									diasMora: 0,
									detallesPago: cuota.pagado
										? {
												abonoCapital: cuota.abono_capital || "0",
												abonoInteres: cuota.abono_interes || "0",
												abonoIva: cuota.abono_iva_12 || "0",
												abonoSeguro: cuota.abono_seguro || "0",
												abonoGps: cuota.abono_gps || "0",
												abonoMembresias: cuota.abono_membresias || "0",
												pagoMora: cuota.pago_mora || "0",
												pagoOtros: cuota.pago_otros || "0",
												capitalRestante: cuota.capital_restante || "0",
												interesRestante: cuota.interes_restante || "0",
											}
										: undefined,
								};
							});
					} catch (error) {
						console.warn(
							`⚠️ No se pudieron obtener cuotas de cartera-back para el contrato ${input.numeroSifco}:`,
							error instanceof Error ? error.message : error,
						);
						console.log(
							"📊 Fallback: intentando obtener cuotas desde DB local...",
						);
						// Continuar con DB local más abajo
					}
				}

				return [];
			} catch (error) {
				console.error("💥 Error en getHistorialPagos:", {
					error: error instanceof Error ? error.message : error,
					stack: error instanceof Error ? error.stack : undefined,
				});
				throw error;
			}
		}),

	// Obtener información de recuperación de vehículo
	getRecuperacionVehiculo: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			// Verificar acceso
			if (!PERMISSIONS.canViewAllCasosCobros(context.userRole)) {
				const caso = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							eq(casosCobros.id, input.casoCobroId),
							eq(casosCobros.responsableCobros, context.userId),
						),
					)
					.limit(1);

				if (!caso.length) {
					throw new ORPCError("FORBIDDEN", {
						message: "No tienes permiso para ver esta información",
					});
				}
			}

			const recuperacion = await db
				.select({
					id: recuperacionesVehiculo.id,
					tipoRecuperacion: recuperacionesVehiculo.tipoRecuperacion,
					fechaRecuperacion: recuperacionesVehiculo.fechaRecuperacion,
					ordenSecuestro: recuperacionesVehiculo.ordenSecuestro,
					numeroExpediente: recuperacionesVehiculo.numeroExpediente,
					juzgadoCompetente: recuperacionesVehiculo.juzgadoCompetente,
					completada: recuperacionesVehiculo.completada,
					observaciones: recuperacionesVehiculo.observaciones,
					responsableRecuperacion: user.name,
				})
				.from(recuperacionesVehiculo)
				.leftJoin(
					user,
					eq(recuperacionesVehiculo.responsableRecuperacion, user.id),
				)
				.where(eq(recuperacionesVehiculo.casoCobroId, input.casoCobroId))
				.limit(1);

			return recuperacion[0] || null;
		}),

	// Obtener detalles de contrato (puede ser caso de cobros o contrato directo)
	getDetallesContrato: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				tipo: z.enum(["caso", "contrato"]).default("caso"),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.tipo === "caso") {
				// Es un caso de cobros
				const whereClause = PERMISSIONS.canViewAllCasosCobros(context.userRole)
					? eq(casosCobros.id, input.id)
					: and(
							eq(casosCobros.id, input.id),
							eq(casosCobros.responsableCobros, context.userId),
						);

				const caso = await db
					.select({
						// Datos del caso
						id: casosCobros.id,
						contratoId: casosCobros.contratoId,
						estadoMora: casosCobros.estadoMora,
						montoEnMora: casosCobros.montoEnMora,
						diasMoraMaximo: casosCobros.diasMoraMaximo,
						cuotasVencidas: casosCobros.cuotasVencidas,
						telefonoPrincipal: casosCobros.telefonoPrincipal,
						telefonoAlternativo: casosCobros.telefonoAlternativo,
						emailContacto: casosCobros.emailContacto,
						direccionContacto: casosCobros.direccionContacto,
						proximoContacto: casosCobros.proximoContacto,
						metodoContactoProximo: casosCobros.metodoContactoProximo,
						// Datos del contrato
						montoFinanciado: contratosFinanciamiento.montoFinanciado,
						cuotaMensual: contratosFinanciamiento.cuotaMensual,
						numeroCuotas: contratosFinanciamiento.numeroCuotas,
						fechaInicio: contratosFinanciamiento.fechaInicio,
						diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
						estadoContrato: contratosFinanciamiento.estado,
						// Datos del cliente
						clienteNombre: clients.contactPerson,
						// Datos del vehículo
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
					.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
					.leftJoin(
						vehicles,
						eq(contratosFinanciamiento.vehicleId, vehicles.id),
					)
					.where(whereClause)
					.limit(1);

				return caso[0] || null;
			}
			// Es un contrato directo (al día o completado)
			const contrato = await db
				.select({
					// Simular estructura de caso
					id: contratosFinanciamiento.id,
					contratoId: contratosFinanciamiento.id,
					estadoMora: sql<string>`'al_dia'`, // Simular estado al día
					montoEnMora: sql<string>`'0'`,
					diasMoraMaximo: sql<number>`0`,
					cuotasVencidas: sql<number>`0`,
					telefonoPrincipal: sql<string>`COALESCE(${casosCobros.telefonoPrincipal}, '')`,
					telefonoAlternativo: sql<string>`COALESCE(${casosCobros.telefonoAlternativo}, '')`,
					emailContacto: sql<string>`COALESCE(${casosCobros.emailContacto}, '')`,
					direccionContacto: sql<string>`COALESCE(${casosCobros.direccionContacto}, '')`,
					proximoContacto: casosCobros.proximoContacto,
					metodoContactoProximo: casosCobros.metodoContactoProximo,
					// Datos del contrato
					montoFinanciado: contratosFinanciamiento.montoFinanciado,
					cuotaMensual: contratosFinanciamiento.cuotaMensual,
					numeroCuotas: contratosFinanciamiento.numeroCuotas,
					fechaInicio: contratosFinanciamiento.fechaInicio,
					diaPagoMensual: contratosFinanciamiento.diaPagoMensual,
					estadoContrato: contratosFinanciamiento.estado,
					// Datos del cliente
					clienteNombre: clients.contactPerson,
					// Datos del vehículo
					vehiculoMarca: vehicles.make,
					vehiculoModelo: vehicles.model,
					vehiculoYear: vehicles.year,
					vehiculoPlaca: vehicles.licensePlate,
				})
				.from(contratosFinanciamiento)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
				.leftJoin(
					casosCobros,
					eq(contratosFinanciamiento.id, casosCobros.contratoId),
				)
				.where(eq(contratosFinanciamiento.id, input.id))
				.limit(1);

			return contrato[0] || null;
		}),

	// Obtener detalles de un crédito desde Cartera-Back
	// Usa el endpoint directo /credito y combina con datos del CRM (vehículo, caso de cobros)
	getDetallesCreditoCarteraBack: cobrosProcedure
		.input(
			z.object({
				creditoId: z.string(), // credito_id como string numérico
			}),
		)
		.handler(async ({ input, context }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con Cartera-Back no está habilitada",
				});
			}

			try {
				const creditoIdInput = input.creditoId ?? "";

				// 0. Si el creditoId es un UUID (viene de una notificación), resolverlo
				//    al numeroCreditoSifco del caso de cobros antes de consultar cartera-back.
				const numeroSifcoResuelto = await resolverNumeroSifco(creditoIdInput);
				if (numeroSifcoResuelto === null) {
					throw new ORPCError("NOT_FOUND", { message: "Caso no encontrado" });
				}
				let numeroSifco: string = numeroSifcoResuelto;

				// 1. Buscar referencia por sifco número de crédito
				let reference = await db
					.select()
					.from(carteraBackReferences)
					.where(eq(carteraBackReferences.numeroCreditoSifco, numeroSifco))
					.limit(1);

				let creditoCompleto: CreditoDirectoResponse | null = null;

				if (reference.length === 0) {
					// Si no hay referencia, buscar el crédito en cartera-back
					// usando getAllCredits para encontrar el número SIFCO
					creditoCompleto = await carteraBackClient.getCredito(numeroSifco);

					await db.insert(carteraBackReferences).values({
						carteraCreditoId: creditoCompleto.credito.credito_id,
						numeroCreditoSifco: numeroSifco,
						syncedAt: new Date(),
						lastSyncStatus: "success",
						createdBy: context.user.id,
					});

					// Reload reference
					reference = await db
						.select()
						.from(carteraBackReferences)
						.where(
							eq(
								carteraBackReferences.carteraCreditoId,
								creditoCompleto.credito.credito_id,
							),
						)
						.limit(1);
				} else {
					numeroSifco = reference[0].numeroCreditoSifco;
				}

				// 2. Obtener detalles completos del crédito de cartera-back
				if (creditoCompleto === null) {
					try {
						creditoCompleto = await carteraBackClient.getCredito(numeroSifco);
					} catch (error) {
						console.error(
							`[Cobros] Error obteniendo detalles de crédito ${numeroSifco}:`,
							error,
						);

						// Si el crédito tiene datos corruptos o circuit breaker está abierto,
						// intentar usar datos del listado como fallback
						if (
							error instanceof Error &&
							(error.message.includes("destructure") ||
								error.message.includes("HTTP 500") ||
								error.message.includes("Circuit breaker is OPEN") ||
								error.message.includes("HTTP 404"))
						) {
							console.warn(
								`[Cobros] Intentando fallback con datos del listado para ${numeroSifco}...`,
							);

							try {
								// Obtener datos del listado como fallback
								// Intentar con todos los estados posibles ya que no sabemos cuál es
								const now = new Date();
								const estadosPosibles: (
									| "ACTIVO"
									| "MOROSO"
									| "CANCELADO"
									| "INCOBRABLE"
								)[] = ["ACTIVO", "MOROSO", "CANCELADO", "INCOBRABLE"];

								let creditoListado = null;
								for (const estado of estadosPosibles) {
									const listado = await carteraBackClient.getAllCreditos({
										mes: 0,
										anio: now.getFullYear(),
										estado,
										numero_credito_sifco: numeroSifco,
										page: 1,
										perPage: 1,
									});

									if (listado.data.length > 0) {
										creditoListado = listado.data[0];
										break;
									}
								}

								if (creditoListado) {
									// Convertir estructura del listado a estructura de detalle
									creditoCompleto = {
										credito: creditoListado.creditos,
										usuario: creditoListado.usuarios,
										asesor: null,
										cuotasPagadas: [],
										cuotasPendientes: [],
										cuotasAtrasadas: [],
										moraActual: creditoListado.mora?.monto_mora || "0.00",
									};
									console.log(
										`[Cobros] ✓ Usando datos del listado (fallback) para ${numeroSifco}`,
									);
								} else {
									console.warn(
										`[Cobros] No se encontró el crédito ${numeroSifco} en ningún estado`,
									);
									return null;
								}
							} catch (fallbackError) {
								console.error(
									`[Cobros] Error en fallback para ${numeroSifco}:`,
									fallbackError,
								);
								return null;
							}
						} else {
							// Re-throw otros errores que no sean de datos corruptos
							throw error;
						}
					}
				}

				if (!creditoCompleto) {
					return null;
				}

				// 3. Buscar oportunidad por número SIFCO para obtener vehículo, lead y dirección
				let vehiculo = null;
				let leadInfo = null;
				let direccion = null;
				const contratoId = reference[0]?.contratoFinanciamientoId || null;

				const oportunidadResult = await db
					.select({
						oportunidadId: opportunities.id,
						vehicleId: opportunities.vehicleId,
						leadId: opportunities.leadId,
						direccion: leads.direccion,
						// Datos de la oportunidad (para fallback)
						oportunidadNotes: opportunities.notes,
						oportunidadCuotaMensual: opportunities.cuotaMensual,
						oportunidadDiaPago: opportunities.diaPagoMensual,
						oportunidadCreditType: opportunities.creditType,
						// Datos del vehículo
						vehiculoMarca: vehicles.make,
						vehiculoModelo: vehicles.model,
						vehiculoYear: vehicles.year,
						vehiculoPlaca: vehicles.licensePlate,
						vehiculoTipo: vehicles.vehicleType,
						vehiculoMotor: vehicles.motorNumber,
						vehiculoChasis: vehicles.series,
						vehiculoAsientos: vehicles.seats,
						vehiculoUso: vehicles.vehicleUse,
						// Datos del seguro del vehículo
						vehiculoNumeroPoliza: vehicles.numeroPoliza,
						vehiculoFechaInicioSeguro: vehicles.fechaInicioSeguro,
						vehiculoFechaVencimientoSeguro: vehicles.fechaVencimientoSeguro,
						vehiculoMontoAsegurado: vehicles.montoAsegurado,
						// Datos del lead
						leadFirstName: leads.firstName,
						leadLastName: leads.lastName,
						leadEmail: leads.email,
						leadTelefono: leads.phone,
					})
					.from(opportunities)
					.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.where(eq(opportunities.numeroSifco, numeroSifco))
					.limit(1);

				// Datos extras de nuestra BD (para fallback si cartera no tiene)
				let oportunidadData: {
					notes: string | null;
					cuotaMensual: string | null;
					diaPago: number | null;
					creditType: string | null;
				} | null = null;

				let vehicleId: string | null = null;

				if (oportunidadResult.length > 0) {
					const opp = oportunidadResult[0];
					vehicleId = opp.vehicleId;
					vehiculo = {
						make: opp.vehiculoMarca,
						model: opp.vehiculoModelo,
						year: opp.vehiculoYear,
						licensePlate: opp.vehiculoPlaca,
						tipo: opp.vehiculoTipo,
						motor: opp.vehiculoMotor,
						chasis: opp.vehiculoChasis,
						asientos: opp.vehiculoAsientos,
						uso: opp.vehiculoUso,
						// Seguro
						numeroPoliza: opp.vehiculoNumeroPoliza,
						fechaInicioSeguro: opp.vehiculoFechaInicioSeguro,
						fechaVencimientoSeguro: opp.vehiculoFechaVencimientoSeguro,
						montoAsegurado: opp.vehiculoMontoAsegurado,
					};
					leadInfo = {
						nombre:
							`${opp.leadFirstName || ""} ${opp.leadLastName || ""}`.trim(),
						email: opp.leadEmail,
						telefono: opp.leadTelefono,
					};
					direccion = opp.direccion;
					oportunidadData = {
						notes: opp.oportunidadNotes,
						cuotaMensual: opp.oportunidadCuotaMensual,
						diaPago: opp.oportunidadDiaPago,
						creditType: opp.oportunidadCreditType,
					};
				} else {
					// No se encontró oportunidad: auto-crear datos migrate si está habilitado
					const datosMigrate = await autoCrearDatosMigrate({
						numeroSifco,
						nombreCliente: creditoCompleto.usuario.nombre,
						deudaTotal: creditoCompleto.credito.deudatotal,
						cuotaMensual: creditoCompleto.credito.cuota,
						diaPagoMensual: null,
						tipoCredito: creditoCompleto.credito.tipoCredito,
						userId: context.user.id,
					});

					if (datosMigrate) {
						vehicleId = datosMigrate.vehiculoId;
						vehiculo = datosMigrate.vehiculo;
						leadInfo = datosMigrate.leadInfo;
						oportunidadData = datosMigrate.oportunidadData;
					}
				}

				// 4. Buscar o crear caso de cobros automáticamente
				let casoCobro = null;

				// Buscar caso activo
				const casosResult = await db
					.select()
					.from(casosCobros)
					.where(
						and(
							contratoId
								? eq(casosCobros.contratoId, contratoId)
								: eq(casosCobros.numeroCreditoSifco, numeroSifco),
							eq(casosCobros.activo, true),
						),
					)
					.limit(1);
				if (
					casosResult.length === 0 &&
					creditoCompleto.credito.statusCredit !== "CANCELADO"
				) {
					// Crear caso de cobros automáticamente
					if (!context.user?.id) {
						throw new ORPCError("UNAUTHORIZED", {
							message: "Usuario no autenticado",
						});
					}

					const cuotasAtrasadas = creditoCompleto?.mora?.cuotas_atrasadas ?? 0;
					const diasMora = calcularDiasMoraExactos(
						creditoCompleto.cuotasAtrasadas || [],
					);
					const montoEnMora = creditoCompleto.moraActual
						? Number(creditoCompleto.moraActual)
						: 0;

					// Etapa según cuotas atrasadas (MORA_BUCKETS: 4=mora_120, 5+=mora_120_plus)
					const estadoMora = estadoMoraPorCuotas(
						cuotasAtrasadas,
					) as (typeof estadoMoraEnum.enumValues)[number];

					const nuevosCasos = await db
						.insert(casosCobros)
						.values({
							contratoId: contratoId,
							activo: true,
							montoEnMora: montoEnMora.toFixed(2),
							diasMoraMaximo: diasMora,
							cuotasVencidas: cuotasAtrasadas,
							estadoMora,
							responsableCobros: context.user.id,
							telefonoPrincipal: leadInfo?.telefono || "00000000",
							emailContacto: leadInfo?.email || "sin-email@example.com",
							direccionContacto: direccion || "Sin dirección",
							numeroCreditoSifco: numeroSifco,
						})
						.returning();
					casoCobro = nuevosCasos[0];
				} else {
					casoCobro = casosResult[0] || null;
				}

				console.log(`COBROSCREDITOSDETALLES ${JSON.stringify(casoCobro)}`);

				// 5. Calcular fecha de inicio (cuota 0) y cuotas restantes
				const todasLasCuotas = [
					...(creditoCompleto.cuotasPagadas || []),
					...(creditoCompleto.cuotasPendientes || []),
					...(creditoCompleto.cuotasAtrasadas || []),
				];
				const cuota0 = todasLasCuotas.find((c) => c.numero_cuota === 0);
				const fechaInicioCuota0 = cuota0?.fecha_vencimiento || null;
				const totalCuotas = creditoCompleto.credito.plazo || 0;
				const cuotasRestantes = countRemainingInstallments(
					creditoCompleto.credito.statusCredit,
					totalCuotas,
					creditoCompleto.cuotasPagadas,
					Boolean(cuota0?.pagado),
				);

				// 6. Mapear datos correctamente
				const cuotasAtrasadas = creditoCompleto.cuotasAtrasadas?.length || 0;
				const cuotaMensual = Number(creditoCompleto.credito.cuota ?? 0);
				// Calcular días de mora exactos usando la fecha de vencimiento
				const diasMora = calcularDiasMoraExactos(
					creditoCompleto.cuotasAtrasadas || [],
				);
				const montoEnMora = Number(creditoCompleto.moraActual ?? 0);

				const tieneMoraActiva = creditoCompleto.mora != null;
				const convenioActivoData = creditoCompleto.convenioActivo ?? null;
				const tieneConvenioActivo = convenioActivoData != null;
				let estadoMora: string | null = "al_dia";
				if (tieneConvenioActivo) {
					estadoMora = "en_convenio";
				} else if (tieneMoraActiva) {
					// Etapa según cuotas (MORA_BUCKETS: 4=mora_120, 5+=mora_120_plus)
					estadoMora = estadoMoraPorCuotas(cuotasAtrasadas);
				}

				// Día de pago: extraer desde la fecha_vencimiento de una cuota real
				// de cartera (prioriza pendiente, luego atrasada, luego pagada),
				// con fallback al diaPago de la oportunidad.
				const cuotaParaDiaPago =
					creditoCompleto.cuotasPendientes?.find((c) => c.numero_cuota !== 0) ||
					creditoCompleto.cuotasAtrasadas?.find((c) => c.numero_cuota !== 0) ||
					creditoCompleto.cuotasPagadas?.find((c) => c.numero_cuota !== 0) ||
					null;
				const diaPagoMensual = cuotaParaDiaPago
					? Number.parseInt(
							cuotaParaDiaPago.fecha_vencimiento.substring(8, 10),
							10,
						) ||
						oportunidadData?.diaPago ||
						null
					: oportunidadData?.diaPago || null;

				const statusCredit = creditoCompleto.credito.statusCredit;
				let estadoContrato = "activo";
				if (statusCredit === "CANCELADO") estadoContrato = "completado";
				else if (statusCredit === "INCOBRABLE") estadoContrato = "incobrable";
				else if (statusCredit === "PENDIENTE_CANCELACION")
					estadoContrato = "pendiente_cancelacion";
				const contractSummary = resolveCreditContractSummary(
					statusCredit,
					creditoCompleto.cuotasPagadas,
					creditoCompleto.credito.capital ??
						creditoCompleto.credito.deudatotal ??
						"0.00",
					resolveHistoricalInstallment(
						creditoCompleto.credito.cuota,
						oportunidadData?.cuotaMensual,
					),
					creditoCompleto.contractSummary,
				);

				return {
					// ID del caso de cobros (si existe)
					id: casoCobro?.id || null,
					contratoId: contratoId,

					// Datos de mora / convenio
					estadoMora,
					montoEnMora: montoEnMora.toFixed(2),
					diasMoraMaximo: diasMora,
					cuotasVencidas: cuotasAtrasadas,
					cuotaConvenio: convenioActivoData
						? Number(convenioActivoData.cuota_mensual ?? 0).toFixed(2)
						: null,
					// CB-027: convenio completo (para la card "Convenios de Pago") + su
					// plan de pagos. null cuando no hay convenio activo.
					convenioActivo: convenioActivoData
						? {
								convenioId: convenioActivoData.convenio_id,
								montoTotalConvenio: convenioActivoData.monto_total_convenio,
								cuotaMensual: convenioActivoData.cuota_mensual,
								numeroMeses: convenioActivoData.numero_meses,
								montoPagado: convenioActivoData.monto_pagado ?? "0",
								montoPendiente: convenioActivoData.monto_pendiente ?? "0",
								pagosRealizados: convenioActivoData.pagos_realizados ?? 0,
								pagosPendientes: convenioActivoData.pagos_pendientes ?? 0,
								activo: convenioActivoData.activo,
								completado: convenioActivoData.completado,
								fechaConvenio: convenioActivoData.fecha_convenio,
								motivo: convenioActivoData.motivo ?? null,
								observaciones: convenioActivoData.observaciones ?? null,
							}
						: null,
					// CB-027 review fix: cartera-back anida cuotasConvenioMensuales
					// DENTRO de convenioActivo (no top-level) — carteraFront ya
					// esperaba ese shape (cardInfo.tsx, registerPayment.ts).
					convenioCuotas: (
						convenioActivoData?.cuotasConvenioMensuales ?? []
					).map((c) => ({
						numeroCuota: c.numero_cuota,
						fechaVencimiento: c.fecha_vencimiento,
						fechaPago: c.fecha_pago,
					})),

					// Datos de contacto (del caso de cobros primero, fallback al lead)
					telefonoPrincipal:
						casoCobro?.telefonoPrincipal || leadInfo?.telefono || null,
					telefonoAlternativo: casoCobro?.telefonoAlternativo || null,
					emailContacto: casoCobro?.emailContacto || leadInfo?.email || null,
					direccionContacto: direccion || null,
					proximoContacto: casoCobro?.proximoContacto || null,
					metodoContactoProximo: null,
					etiquetas: casoCobro?.etiquetas || [],

					// Datos del contrato (cartera primero, fallback a nuestra BD)
					montoFinanciado: contractSummary.principal,
					cuotaMensual: resolveOperationalInstallment(
						statusCredit,
						contractSummary.installment,
					),
					cuotaMensualHistorica: contractSummary.installment,
					numeroCuotas: creditoCompleto.credito.plazo,
					fechaInicio: creditoCompleto.credito.fecha_creacion,
					diaPagoMensual,
					estadoContrato,

					// Datos del cliente (de cartera-back o lead)
					clienteNombre: leadInfo?.nombre || creditoCompleto.usuario.nombre,
					clienteNit: creditoCompleto.usuario.nit,

					// Datos del vehículo (de la oportunidad)
					vehicleId,
					vehiculoMarca: vehiculo?.make || "-",
					vehiculoModelo: vehiculo?.model || "-",
					vehiculoYear: vehiculo?.year || null,
					vehiculoPlaca: vehiculo?.licensePlate || null,
					vehiculoTipo: vehiculo?.tipo || null,
					vehiculoMotor: vehiculo?.motor || null,
					vehiculoChasis: vehiculo?.chasis || null,
					vehiculoAsientos: vehiculo?.asientos || null,
					vehiculoUso: vehiculo?.uso || null,
					// Seguro del vehículo
					vehiculoNumeroPoliza: vehiculo?.numeroPoliza || null,
					vehiculoFechaInicioSeguro: vehiculo?.fechaInicioSeguro || null,
					vehiculoFechaVencimientoSeguro:
						vehiculo?.fechaVencimientoSeguro || null,
					vehiculoMontoAsegurado: vehiculo?.montoAsegurado || null,

					// Datos adicionales de Cartera-Back
					numeroCreditoSifco: creditoCompleto.credito.numero_credito_sifco,
					deudaTotal: creditoCompleto.credito.deudatotal,
					asesor: creditoCompleto.asesor
						? {
								asesor_id: creditoCompleto.asesor.asesor_id,
								nombre: creditoCompleto.asesor.nombre,
								telefono: creditoCompleto.asesor.telefono,
								activo: creditoCompleto.asesor.activo,
								emailCashIn: creditoCompleto.asesor.emailCashIn,
							}
						: null,

					// Notas de la oportunidad
					oportunidadNotes: oportunidadData?.notes || null,
					creditType: oportunidadData?.creditType || null,

					// Campos calculados
					fechaInicioCuota0,
					cuotasRestantes,
				};
			} catch (error) {
				console.error("[Cobros] Error obteniendo detalles de crédito:", error);
				throw error;
			}
		}),

	// ========================================================================
	// INTEGRACIÓN CON CARTERA-BACK - PAGOS
	// ========================================================================

	// Registrar pago en cartera-back
	registrarPago: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
				cuotaId: z.number().optional(),
				fechaPago: z.string(), // ISO date string
				montoBoleta: z.number(),
				numeroAutorizacion: z.string().optional(),
				observaciones: z.string().optional(),
				casoCobroId: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Verify the credit exists and user has access
			const reference = await getCreditoReferenceByNumeroSifco(
				input.numeroSifco,
			);

			if (!reference) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Crédito ${input.numeroSifco} no encontrado en el sistema`,
				});
			}

			// Register payment in cartera-back
			const result = await createPagoInCarteraBack({
				credito_numero_sifco: input.numeroSifco,
				cuota_id: input.cuotaId,
				fecha_pago: input.fechaPago,
				monto_boleta: input.montoBoleta,
				numeroAutorizacion: input.numeroAutorizacion,
				observaciones: input.observaciones,
				casoCobroId: input.casoCobroId,
				userId: context.userId,
			});

			if (!result.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error registrando pago: ${result.error}`,
				});
			}

			return {
				success: true,
				pago_id: result.pago_id,
				message: "Pago registrado exitosamente",
			};
		}),

	// CB-128: crédito con cuotas/mora/convenio/saldo a favor para poblar el
	// form "registrar pago" de la Ficha 360 — mismo endpoint y shape que ya
	// consume carteraFront (getCreditoByNumero) vía getCredito().
	getCreditoParaPago: cobrosProcedure
		.input(z.object({ numeroSifco: z.string() }))
		.handler(async ({ input }) => {
			// CB-128: sin cache — el asesor necesita mora/atrasadas/saldo a favor
			// reales al momento de cobrar, no una copia de hasta 5 min de vieja.
			return carteraBackClient.getCredito(input.numeroSifco, false);
		}),

	// Catálogo de bancos para el selector del form de pago.
	getBancosParaPago: cobrosProcedure.handler(async () => {
		return carteraBackClient.getBancos();
	}),

	// Abonos parciales ya hechos a una cuota puntual — insumo del cálculo de
	// excedente (Otros → Mora → Convenio → Cuota), igual que registerPayment.ts
	// en carteraFront.
	getAbonosCuotaParaPago: cobrosProcedure
		.input(z.object({ numeroSifco: z.string(), numeroCuota: z.number().int() }))
		.handler(async ({ input }) => {
			return carteraBackClient.getAbonosCuota(
				input.numeroSifco,
				input.numeroCuota,
			);
		}),

	// Promesa de pago vigente del crédito (o null), para el mismo aviso que
	// muestra carteraFront en el detalle del crédito.
	getPromesaActivaParaPago: cobrosProcedure
		.input(z.object({ creditoId: z.number().int() }))
		.handler(async ({ input }) => {
			return carteraBackClient.getPromesaActivaPorCredito(input.creditoId);
		}),

	// CB-128: registro de pago "igual a carteraFront" desde la Ficha 360 —
	// arma el payload completo que espera pagoSchema en cartera-back (a
	// diferencia de registrarPago arriba, que es el subset mínimo del bot de
	// WhatsApp) y, al confirmarse el pago, además anota la gestión en
	// contactos_cobros para que aparezca en Historial/Cumplimiento de agenda
	// del asesor — el requisito de negocio que originó este endpoint.
	registrarPagoCompleto: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				numeroSifco: z.string(),
				creditoId: z.number().int().positive(),
				usuarioId: z.number().int().positive(),
				cuotaApagar: z.number().int().positive(),
				montoBoleta: z.number().positive(),
				fechaPago: z.string().date(),
				fechaBoleta: z.string().datetime(),
				otros: z.number().nonnegative().optional(),
				abonoDirectoCapital: z.number().nonnegative().optional(),
				bancoId: z.number().int().positive().optional(),
				origenPago: z.enum(["transferencia", "cheque", "boleta"]).optional(),
				numeroAutorizacion: z.string().max(100).optional(),
				observaciones: z.string().max(2000).optional(),
				// Un solo comprobante por pago — el form solo permite adjuntar 1
				// archivo, así que un array más largo no corresponde a ningún caso
				// de uso real y solo ampliaría la superficie de ataque.
				urlBoletas: z.array(z.string().min(1).max(500)).max(1).default([]),
			}),
		)
		.handler(async ({ input, context }) => {
			const [caso] = await db
				.select({
					id: casosCobros.id,
					numeroCreditoSifco: casosCobros.numeroCreditoSifco,
				})
				.from(casosCobros)
				.where(eq(casosCobros.id, input.casoCobroId))
				.limit(1);

			if (!caso) {
				throw new ORPCError("NOT_FOUND", {
					message: "Caso de cobro no encontrado",
				});
			}

			// CB-128: sin este guard, un casoCobroId de un caso distinto al crédito
			// que se está pagando (tab desactualizado, request manipulado) paga el
			// crédito B pero anota la gestión en el historial del caso A —
			// corrompe el historial de ambos créditos.
			if (caso.numeroCreditoSifco !== input.numeroSifco) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El caso de cobro no corresponde al crédito que se está pagando",
				});
			}

			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración de pagos con cartera-back no está habilitada",
				});
			}

			// CB-128: creditoId/usuarioId vienen del cliente (cache de React Query
			// puede quedar stale, o el request se puede manipular) y cartera-back
			// los usa DIRECTO para aplicar fondos y abonar saldo_a_favor — sin
			// validarlos, un numeroSifco correcto (pasa el guard de arriba) podía
			// viajar con creditoId/usuarioId de OTRO crédito/usuario y la plata se
			// aplicaba a la cuenta equivocada. Se resuelven server-side desde el
			// SIFCO ya validado y se ignora lo que mandó el cliente.
			//
			// Corre en paralelo con el snapshot de abajo — son independientes
			// entre sí (uno valida crédito/usuario, el otro solo necesita el
			// SIFCO), así que no hace falta esperar uno para pedir el otro.
			const [creditoReal, pagosPrevios] = await Promise.all([
				carteraBackClient.getCredito(input.numeroSifco),
				// CB-128: snapshot del pago_id más alto ANTES de crear el pago — es
				// el único ancla confiable para reconocer "el pago recién creado"
				// después. Sin esto, en un crédito con pagos previos la lista de
				// getPagosByCredito nunca viene vacía, así que un fallback que solo
				// mira "el más alto de la lista actual" agarra un pago VIEJO con
				// toda confianza cuando /newPayment no trae pago_id inline —
				// pagoReferences y la gestión en contactos_cobros quedan apuntando
				// al pago equivocado, sin ningún error que lo delate.
				carteraBackClient.getPagosByCredito(input.numeroSifco),
			]);
			if (
				creditoReal.credito.credito_id !== input.creditoId ||
				creditoReal.usuario.usuario_id !== input.usuarioId
			) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"El crédito o usuario enviado no corresponde al crédito consultado — refresca la página e intenta de nuevo",
				});
			}

			const pagoIdMaximoPrevio = pagosPrevios.reduce(
				(max, p) => Math.max(max, p.pago_id),
				0,
			);

			// CB-128: fix mínimo de duplicado — un doble-click o un retry tras
			// timeout de red (el asesor no vio la respuesta, pero cartera-back sí
			// recibió el POST) puede reenviar el mismo pago. No hay idempotency
			// key real todavía (deuda pendiente), pero esto cubre el caso común:
			// mismo caso + misma cuota pedida + mismo monto ya registrado en los
			// últimos 2 minutos → se asume que es el mismo submit repetido y se
			// bloquea ANTES de mover dinero en cartera-back.
			const dosMinutosAtras = new Date(Date.now() - 2 * 60 * 1000);
			const [duplicadoReciente] = await db
				.select({ id: pagoReferences.id })
				.from(pagoReferences)
				.where(
					and(
						eq(pagoReferences.casoCobroId, input.casoCobroId),
						eq(pagoReferences.cuotaNumero, input.cuotaApagar),
						eq(pagoReferences.montoBoleta, input.montoBoleta.toString()),
						gte(pagoReferences.registradoEn, dosMinutosAtras),
					),
				)
				.limit(1);

			if (duplicadoReciente) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Ya se registró un pago igual (mismo caso, cuota y monto) hace menos de 2 minutos. Si no fue un envío duplicado, espera un momento antes de reintentar.",
				});
			}

			let respuesta: Awaited<ReturnType<typeof carteraBackClient.createPago>>;
			try {
				respuesta = await carteraBackClient.createPago({
					credito_numero_sifco: input.numeroSifco,
					credito_id: creditoReal.credito.credito_id,
					usuario_id: creditoReal.usuario.usuario_id,
					cuotaApagar: input.cuotaApagar,
					monto_boleta: input.montoBoleta,
					fecha_pago: input.fechaPago,
					fecha_boleta: input.fechaBoleta,
					otros: input.otros,
					abono_directo_capital: input.abonoDirectoCapital,
					banco_id: input.bancoId,
					origen_pago: input.origenPago,
					numeroAutorizacion: input.numeroAutorizacion,
					observaciones: input.observaciones,
					url_boletas: input.urlBoletas,
					registerBy: context.userId,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new ORPCError("BAD_REQUEST", {
					message: `Error registrando pago: ${message}`,
				});
			}

			// CB-128: soloInformativo=true (mora parcial insuficiente, saldo a
			// favor, etc.) NO es un error — cartera-back sí insertó la fila del
			// pago, solo avisa que no alcanzó a cerrar la cuota (mismo mensaje que
			// carteraFront muestra como notificación de éxito, no como rechazo).
			// success===false explícito SÍ es un rechazo real (validación fallida,
			// boleta duplicada, etc.) y ahí sí se bloquea.
			if (!respuesta.success && !respuesta.soloInformativo) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error registrando pago: ${respuesta.message ?? "cartera-back rechazó el pago"}`,
				});
			}

			// CB-128: /newPayment no siempre trae pago_id inline (el camino normal
			// de pago no lo incluye, solo la rama de abono directo a capital) — se
			// resuelve consultando el pago recién creado por SIFCO cuando falta.
			// Filtro primario: registerBy === mi userId — cierra el race condition
			// de dos asesores pagando el mismo crédito casi al mismo tiempo (antes
			// se tomaba "el pago_id más alto de los nuevos" a ciegas, que podía ser
			// el pago del OTRO asesor si ambos insertaron en la misma ventana).
			// pago_id > snapshot se mantiene como filtro extra por si el mismo
			// usuario ya tenía pagos previos con el mismo registerBy (reintentos
			// fallidos anteriores, por ejemplo). Segundo intento con espera corta
			// cubre lag de replicación entre el insert de /newPayment y la lectura
			// de /paymentByCredit.
			const buscarPagoNuevo = async () => {
				const pagos = await carteraBackClient.getPagosByCredito(
					input.numeroSifco,
				);
				const nuevos = pagos.filter(
					(p) =>
						p.pago_id > pagoIdMaximoPrevio && p.registerBy === context.userId,
				);
				return nuevos.sort((a, b) => b.pago_id - a.pago_id)[0];
			};
			let pagoId = respuesta.pago_id;
			// CB-128: cartera-back puede cascadear el pago a una cuota distinta a
			// la pedida (ej. pide pagar la 5, el sistema cierra 5 y 6 si alcanza) —
			// el camino normal de /newPayment solo devuelve un CONTADOR de cuotas
			// cerradas, no sus números, así que no hay forma de saberlo desde la
			// respuesta directa. Se guarda input.cuotaApagar por default (la cuota
			// pedida) y se corrige con el numero_cuota real SOLO cuando se tuvo que
			// consultar el pago igual (fallback de pagoId) — ahí sí se sabe cuál
			// cuota cerró de verdad.
			let cuotaNumeroReal = input.cuotaApagar;
			if (!pagoId) {
				let pagoEncontrado = await buscarPagoNuevo();
				if (!pagoEncontrado) {
					await new Promise((resolve) => setTimeout(resolve, 1500));
					pagoEncontrado = await buscarPagoNuevo();
				}
				pagoId = pagoEncontrado?.pago_id;
				if (pagoEncontrado?.numero_cuota != null) {
					cuotaNumeroReal = pagoEncontrado.numero_cuota;
				}
			}
			if (!pagoId) {
				// El dinero YA se movió en cartera-back (createPago tuvo éxito) —
				// solo falló resolver la referencia local. Mensaje explícito para
				// que el asesor NO reintente (duplicaría el pago) sino que avise a
				// soporte para reconciliar manualmente.
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message:
						"El pago se registró en cartera-back pero el CRM no pudo confirmar su referencia. NO reintentes el pago — contacta a soporte para verificar antes de volver a registrarlo.",
				});
			}

			// Referencia local del pago — misma tabla que ya usa registrarPago/
			// createPagoInCarteraBack arriba.
			const [pagoRef] = await db
				.insert(pagoReferences)
				.values({
					carteraPagoId: pagoId,
					numeroCreditoSifco: input.numeroSifco,
					cuotaNumero: cuotaNumeroReal,
					montoBoleta: input.montoBoleta.toString(),
					fechaPago: new Date(input.fechaPago),
					casoCobroId: input.casoCobroId,
					registradoPor: context.userId,
					syncStatus: "synced",
				})
				.returning();

			// Anotar la gestión en contactos_cobros — best-effort: el pago ya se
			// confirmó en cartera-back (el dinero ya se movió), así que un fallo
			// acá no debe revertirlo ni impedir devolver éxito al asesor. Pero SÍ
			// hay que avisarle que la gestión no quedó registrada — de lo
			// contrario el objetivo original del feature (que el pago cuente para
			// Historial de gestiones y Cumplimiento de agenda) se pierde en
			// silencio detrás de un toast de éxito sin ninguna señal.
			let gestionRegistrada = true;
			try {
				const bucketSnapshot = await capturarBucketSnapshot(input.casoCobroId);
				const partesComentario = [
					`Pago de Q${input.montoBoleta.toFixed(2)} registrado (cuota ${cuotaNumeroReal})`,
					cuotaNumeroReal !== input.cuotaApagar
						? `cascadeado desde cuota ${input.cuotaApagar} solicitada`
						: null,
					input.numeroAutorizacion
						? `autorización ${input.numeroAutorizacion}`
						: null,
					input.observaciones,
				].filter(Boolean);

				await db.insert(contactosCobros).values({
					casoCobroId: input.casoCobroId,
					metodoContacto: "pago",
					estadoContacto: "pago_registrado",
					comentarios: partesComentario.join(" — "),
					realizadoPor: context.userId,
					bucketSnapshot,
					pagoReferenceId: pagoRef?.id,
				});
			} catch (error) {
				gestionRegistrada = false;
				console.error(
					"[registrarPagoCompleto] Pago confirmado en cartera-back pero falló el registro de la gestión en contactos_cobros:",
					error,
				);
			}

			return {
				success: true,
				pago_id: pagoId,
				gestionRegistrada,
				message: respuesta.message ?? "Pago registrado exitosamente",
			};
		}),

	// Obtener historial de pagos de un crédito desde cartera-back
	getHistorialPagosCarteraBack: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración de pagos con cartera-back no está habilitada",
				});
			}

			try {
				const pagos = await carteraBackClient.getPagosByCredito(
					input.numeroSifco,
				);

				return {
					numeroSifco: input.numeroSifco,
					totalPagos: pagos.length,
					pagos: pagos.map((pago) => ({
						pagoId: pago.pago_id,
						fechaPago: pago.fecha_pago,
						cuotaId: pago.cuota_id,
						montoBoleta: pago.monto_boleta,
						abonoCapital: pago.abono_capital,
						abonoInteres: pago.abono_interes,
						abonoIva: pago.abono_iva_12,
						abonoSeguro: pago.abono_seguro,
						abonoGps: pago.abono_gps,
						mora: pago.mora,
						capitalRestante: pago.capital_restante,
						totalRestante: pago.total_restante,
						numeroAutorizacion: pago.numeroAutorizacion,
						observaciones: pago.observaciones,
						pagado: pago.pagado,
						validationStatus: pago.validationStatus,
						// Investor distribution
						distribucionInversionistas: pago.pagos_inversionistas?.map(
							(pi) => ({
								inversionistaId: pi.inversionista_id,
								inversionistaNombre: pi.inversionista?.nombre,
								abonoCapital: pi.abono_capital,
								abonoInteres: pi.abono_interes,
								abonoIva: pi.abono_iva_12,
								porcentajeParticipacion: pi.porcentaje_participacion,
								estadoLiquidacion: pi.estado_liquidacion,
							}),
						),
					})),
				};
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo historial de pagos: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// Obtener detalles completos de un crédito desde cartera-back
	getCreditoCarteraBack: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const creditoData = await carteraBackClient.getCredito(
					input.numeroSifco,
				);

				// Combinar todas las cuotas
				const todasCuotas = [
					...(creditoData.cuotasPagadas || []),
					...(creditoData.cuotasPendientes || []),
					...(creditoData.cuotasAtrasadas || []),
				];

				return {
					creditoId: creditoData.credito.credito_id,
					numeroSifco: creditoData.credito.numero_credito_sifco,
					fechaCreacion: creditoData.credito.fecha_creacion,
					capital: creditoData.credito.capital,
					porcentajeInteres: creditoData.credito.porcentaje_interes,
					deudaTotal: creditoData.credito.deudatotal,
					cuota: creditoData.credito.cuota,
					plazo: creditoData.credito.plazo,
					statusCredit: creditoData.credito.statusCredit,
					observaciones: creditoData.credito.observaciones,
					// Cliente
					usuario: {
						usuarioId: creditoData.usuario.usuario_id,
						nombre: creditoData.usuario.nombre,
						nit: creditoData.usuario.nit,
						categoria: creditoData.usuario.categoria,
						saldoAFavor: creditoData.usuario.saldo_a_favor,
					},
					// Asesor (devuelto por endpoint /credito)
					asesor: creditoData.asesor
						? {
								asesor_id: creditoData.asesor.asesor_id,
								nombre: creditoData.asesor.nombre,
								telefono: creditoData.asesor.telefono,
								activo: creditoData.asesor.activo,
								emailCashIn: creditoData.asesor.emailCashIn,
							}
						: null,
					// Cuotas
					cuotas: todasCuotas.map((cuota) => ({
						cuotaId: cuota.cuota_id,
						numeroCuota: cuota.numero_cuota,
						fechaVencimiento: cuota.fecha_vencimiento,
						pagado: cuota.pagado,
					})),
					// Moras (no disponible en endpoint /credito)
					moras: [],
					// Inversionistas (no disponible en endpoint /credito)
					inversionistas: [],
					// Calculated fields
					cuotasPagadas: creditoData.cuotasPagadas?.length || 0,
					cuotasPendientes: creditoData.cuotasPendientes?.length || 0,
					capitalRestante: null, // No disponible en endpoint /credito
					interesRestante: null, // No disponible en endpoint /credito
					totalRestante: null, // No disponible en endpoint /credito
					diasMora: creditoData.cuotasAtrasadas?.length
						? creditoData.cuotasAtrasadas.length * 30
						: 0,
					montoMora: creditoData.moraActual, // ya es string
					cuotasAtrasadas: creditoData.cuotasAtrasadas?.length || 0,
				};
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo crédito de cartera-back: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// ========================================================================
	// SINCRONIZACIÓN DE CASOS DE COBROS
	// ========================================================================

	// Ejecutar sincronización de casos de cobros (admin y supervisor de cobros)
	sincronizarCasosCobros: cobrosSupervisorProcedure
		.input(
			z.object({
				mes: z.number().min(0).max(12).optional(), // 0 = todos los meses
				anio: z.number().min(2000).max(2100).optional(),
				forceSyncAll: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const result = await sincronizarCasosCobros({
				mes: input.mes,
				anio: input.anio,
				forceSyncAll: input.forceSyncAll,
				userId: context.user.id,
			});

			return {
				success: result.success,
				casosCreados: result.casosCreados,
				casosActualizados: result.casosActualizados,
				casosCerrados: result.casosCerrados,
				errors: result.errors,
				duracionMs: result.duration,
				mensaje:
					result.errors.length > 0
						? `Sincronización completada con ${result.errors.length} errores`
						: "Sincronización completada exitosamente",
			};
		}),

	// Obtener historial de sincronizaciones recientes
	getHistorialSincronizaciones: cobrosSupervisorProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).optional().default(10),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			const sincronizaciones = await getUltimasSincronizaciones(input.limit);

			return {
				total: sincronizaciones.length,
				sincronizaciones,
			};
		}),

	// ========================================================================
	// INVERSIONISTAS
	// ========================================================================

	// Listar todos los inversionistas
	getInversionistas: crmCobrosOrInvestmentsProcedure
		.input(
			z.object({
				id: z.number().int().positive().optional(),
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(20),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				console.log(
					"[getInversionistas] Cartera-back integration is NOT enabled",
				);
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const result = await carteraBackClient.getInvestors({
					id: input.id,
					page: input.page,
					perPage: input.perPage,
				});

				// Obtener bancos para mapear banco_id → nombre
				const bancos = await carteraBackClient.getBancos();
				const bancosMap = new Map(bancos.map((b) => [b.banco_id, b.nombre]));

				// Con id cartera devuelve objeto directo, sin id devuelve array
				const inversionistasList = Array.isArray(result.data)
					? result.data
					: [result.data];

				return {
					inversionistas: inversionistasList.map((inv: any) => ({
						...inv,
						inversionistaId: inv.inversionista_id,
						nombre: inv.nombre,
						dpi: inv.dpi ?? null,
						email: inv.email ?? null,
						emiteFactura: inv.emite_factura,
						reinversion:
							inv.reinversion ?? inv.tipo_reinversion !== "sin_reinversion",
						tipoReinversion: inv.tipo_reinversion ?? "sin_reinversion",
						banco: inv.banco_id
							? (bancosMap.get(inv.banco_id) ?? null)
							: (inv.banco ?? null),
						tipoCuenta: inv.tipo_cuenta ?? null,
						numeroCuenta: inv.numero_cuenta ?? null,
						moneda: inv.moneda ?? "quetzales",
						celular: inv.celular ?? null,
						status: inv.status ?? null,
					})),
					pagination: {
						page: result.page,
						perPage: result.perPage,
						total: result.total,
						totalPages: result.totalPages,
					},
				};
			} catch (error) {
				console.error("[getInversionistas] Error occurred:", error);
				console.error(
					"[getInversionistas] Error stack:",
					error instanceof Error ? error.stack : "No stack",
				);
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo inversionistas: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// Obtener detalle de un inversionista con sus créditos
	getDetalleInversionista: cobrosProcedure
		.input(
			z.object({
				inversionistaId: z.number(),
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(10),
				numeroCreditoSifco: z.string().optional(),
				nombreUsuario: z.string().optional(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const reporte = await carteraBackClient.getInvestorReport({
					id: input.inversionistaId,
					page: input.page,
					perPage: input.perPage,
					numeroCreditoSifco: input.numeroCreditoSifco,
					nombreUsuario: input.nombreUsuario,
				});

				return {
					inversionista: {
						inversionistaId: reporte.inversionista.inversionista_id,
						nombre: reporte.inversionista.nombre,
						emiteFactura: reporte.inversionista.emite_factura,
						reinversion: reporte.inversionista.reinversion,
						banco: reporte.inversionista.banco,
						tipoCuenta: reporte.inversionista.tipo_cuenta,
						numeroCuenta: reporte.inversionista.numero_cuenta,
					},
					creditos: reporte.creditos.map((creditoData) => ({
						// Datos del crédito
						creditoId: creditoData.credito.credito_id,
						numeroSifco: creditoData.credito.numero_credito_sifco,
						capital: creditoData.credito.capital,
						statusCredit: creditoData.credito.statusCredit,
						fechaCreacion: creditoData.credito.fecha_creacion,
						// Datos del cliente
						clienteNombre: creditoData.usuario.nombre,
						clienteNit: creditoData.usuario.nit,
						// Participación del inversionista
						porcentajeParticipacion:
							creditoData.participacion.porcentaje_participacion_inversionista,
						montoAportado: creditoData.participacion.monto_aportado,
						cuotaInversionista: creditoData.participacion.cuota_inversionista,
						// Montos recuperados
						montoRecuperado: creditoData.montoRecuperado,
						montoPendiente: creditoData.montoPendiente,
						// Pagos
						totalPagos: creditoData.pagos.length,
						pagos: creditoData.pagos.map((pagoDetalle) => ({
							pagoId: pagoDetalle.pago.pago_id,
							fechaPago: pagoDetalle.pago.fecha_pago,
							montoBoleta: pagoDetalle.pago.monto_boleta,
							abonoCapital: pagoDetalle.distribucion.abono_capital,
							abonoInteres: pagoDetalle.distribucion.abono_interes,
							abonoIva: pagoDetalle.distribucion.abono_iva_12,
							estadoLiquidacion: pagoDetalle.distribucion.estado_liquidacion,
						})),
					})),
					totales: {
						montoTotalAportado: reporte.totales.montoTotalAportado,
						montoTotalRecuperado: reporte.totales.montoTotalRecuperado,
						montoTotalPendiente: reporte.totales.montoTotalPendiente,
						creditosActivos: reporte.totales.creditosActivos,
						creditosCancelados: reporte.totales.creditosCancelados,
						porcentajeRecuperacion: reporte.totales.porcentajeRecuperacion,
					},
				};
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo detalle de inversionista: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// Obtener inversionistas de un crédito específico
	getInversionistasDelCredito: cobrosProcedure
		.input(
			z.object({
				numeroSifco: z.string(),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			if (!isCarteraBackPaymentsEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			try {
				const creditoData = await carteraBackClient.getCredito(
					input.numeroSifco,
				);

				return {
					numeroSifco: creditoData.credito.numero_credito_sifco,
					capital: creditoData.credito.capital,
					statusCredit: creditoData.credito.statusCredit,
					// El endpoint /credito no incluye inversionistas
					inversionistas: [],
				};

				/* Código original comentado - el endpoint /credito no retorna inversionistas
				return {
					numeroSifco: creditoData.credito.numero_credito_sifco,
					capital: creditoData.credito.capital,
					statusCredit: creditoData.credito.statusCredit,
					inversionistas:
						creditoData.creditos_inversionistas?.map((ci) => ({
							inversionistaId: ci.inversionista_id,
							inversionistaNombre: ci.inversionista?.nombre,
							porcentajeParticipacion:
								ci.porcentaje_participacion_inversionista,
							montoAportado: ci.monto_aportado,
							cuotaInversionista: ci.cuota_inversionista,
							porcentajeCashIn: ci.porcentaje_cash_in,
							ivaInversionista: ci.iva_inversionista,
							montoInversionista: ci.monto_inversionista,
							montoCashIn: ci.monto_cash_in,
						})) || [],
				};
				*/
			} catch (error) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo inversionistas del crédito: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// ========================================================================
	// ASESORES
	// ========================================================================

	// Listar todos los asesores
	getAsesores: crmOrCobrosProcedure
		.input(
			z.object({
				page: z.number().min(1).optional().default(1),
				perPage: z.number().min(1).max(100).optional().default(20),
			}),
		)
		.handler(async ({ input, context: _ }) => {
			console.log("[getAsesores] Handler called with input:", input);

			if (!isCarteraBackPaymentsEnabled()) {
				console.log("[getAsesores] Cartera-back integration is NOT enabled");
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			console.log("[getAsesores] Cartera-back integration is enabled");

			try {
				console.log(
					"[getAsesores] Calling carteraBackClient.getAdvisors with params:",
					{
						page: input.page,
						perPage: input.perPage,
					},
				);

				const result = await carteraBackClient.getAdvisors({
					page: input.page,
					perPage: input.perPage,
				});

				console.log(
					"[getAsesores] Result received:",
					JSON.stringify(result, null, 2),
				);

				return {
					asesores: result.data.map((asesor) => ({
						asesorId: asesor.asesor_id,
						nombre: asesor.nombre,
						activo: asesor.activo,
						email: asesor.email,
						isActive: asesor.is_active,
					})),
					pagination: {
						page: result.page,
						perPage: result.perPage,
						total: result.total,
						totalPages: result.totalPages,
					},
				};
			} catch (error) {
				console.error("[getAsesores] Error occurred:", error);
				console.error(
					"[getAsesores] Error stack:",
					error instanceof Error ? error.stack : "No stack",
				);
				throw new ORPCError("BAD_REQUEST", {
					message: `Error obteniendo asesores: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),

	// ============================================================================
	// ACTUALIZAR INFO DE CONTACTO
	// ============================================================================

	updateContactInfoCobros: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				telefonoPrincipal: z.string().min(1),
				telefonoAlternativo: z.string().optional(),
				emailContacto: z.string().email().optional().or(z.literal("")),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(casosCobros)
				.set({
					telefonoPrincipal: input.telefonoPrincipal,
					telefonoAlternativo: input.telefonoAlternativo || null,
					emailContacto: input.emailContacto || "",
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, input.casoCobroId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Caso de cobros no encontrado",
				});
			}

			return updated;
		}),

	// ============================================================================
	// CRUD DE REFERENCIAS
	// ============================================================================

	getReferencias: cobrosProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const result = await db
				.select()
				.from(referenciasLead)
				.where(eq(referenciasLead.leadId, input.leadId))
				.orderBy(desc(referenciasLead.createdAt));

			return result;
		}),

	createReferencia: cobrosProcedure
		.input(
			z.object({
				leadId: z.string().uuid(),
				nombre: z.string().min(1),
				telefono: z.string().min(1),
				parentesco: z.enum(PARENTESCO_VALUES),
				notas: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const [created] = await db
				.insert(referenciasLead)
				.values({
					leadId: input.leadId,
					nombre: input.nombre,
					telefono: input.telefono,
					parentesco: input.parentesco,
					notas: input.notas || null,
				})
				.returning();

			return created;
		}),

	updateReferencia: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				leadId: z.string().uuid(),
				nombre: z.string().min(1),
				telefono: z.string().min(1),
				parentesco: z.enum(PARENTESCO_VALUES),
				notas: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(referenciasLead)
				.set({
					nombre: input.nombre,
					telefono: input.telefono,
					parentesco: input.parentesco,
					notas: input.notas || null,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(referenciasLead.id, input.id),
						eq(referenciasLead.leadId, input.leadId),
					),
				)
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Referencia no encontrada",
				});
			}

			return updated;
		}),

	deleteReferencia: cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				leadId: z.string().uuid(),
			}),
		)
		.handler(async ({ input }) => {
			const [deleted] = await db
				.delete(referenciasLead)
				.where(
					and(
						eq(referenciasLead.id, input.id),
						eq(referenciasLead.leadId, input.leadId),
					),
				)
				.returning();

			if (!deleted) {
				throw new ORPCError("NOT_FOUND", {
					message: "Referencia no encontrada",
				});
			}

			return { success: true };
		}),

	// ========================================================================
	// METAS DE MORA
	// ========================================================================

	// Obtener metas de mora para un mes/año
	getMetasMora: cobrosProcedure
		.input(
			z.object({
				mes: z.number().min(1).max(12),
				anio: z.number().min(2024),
			}),
		)
		.handler(async ({ input }) => {
			const metas = await db
				.select()
				.from(metasMoraCobros)
				.where(
					and(
						eq(metasMoraCobros.mes, input.mes),
						eq(metasMoraCobros.anio, input.anio),
					),
				);

			return metas;
		}),

	// Obtener metas de mora del año completo
	getMetasMoraAnual: cobrosProcedure
		.input(
			z.object({
				anio: z.number().min(2024),
			}),
		)
		.handler(async ({ input }) => {
			const metas = await db
				.select()
				.from(metasMoraCobros)
				.where(eq(metasMoraCobros.anio, input.anio));

			return metas;
		}),

	// Crear o actualizar metas de mora (solo supervisor/admin)
	upsertMetasMora: cobrosSupervisorProcedure
		.input(
			z.object({
				mes: z.number().min(1).max(12),
				anio: z.number().min(2024),
				metas: z.array(
					z.object({
						categoria: z.enum([
							"mora_total",
							"mora_30",
							"mora_60",
							"mora_90",
							"mora_120",
						]),
						valorObjetivo: z.string(),
					}),
				),
			}),
		)
		.handler(async ({ input }) => {
			const resultados = [];

			for (const meta of input.metas) {
				// Buscar si ya existe
				const existente = await db
					.select({ id: metasMoraCobros.id })
					.from(metasMoraCobros)
					.where(
						and(
							eq(metasMoraCobros.mes, input.mes),
							eq(metasMoraCobros.anio, input.anio),
							eq(metasMoraCobros.categoria, meta.categoria),
						),
					)
					.limit(1);

				if (existente.length > 0) {
					// Actualizar
					const [updated] = await db
						.update(metasMoraCobros)
						.set({
							valorObjetivo: meta.valorObjetivo,
							updatedAt: new Date(),
						})
						.where(eq(metasMoraCobros.id, existente[0].id))
						.returning();
					resultados.push(updated);
				} else {
					// Crear
					const [created] = await db
						.insert(metasMoraCobros)
						.values({
							mes: input.mes,
							anio: input.anio,
							categoria: meta.categoria,
							valorObjetivo: meta.valorObjetivo,
						})
						.returning();
					resultados.push(created);
				}
			}

			return resultados;
		}),

	// ============================================================================
	// ACTUALIZAR ETIQUETAS DEL CASO
	// ============================================================================

	updateEtiquetasCobros: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				etiquetas: z.array(
					z.enum([
						"juridico",
						"convenio",
						"cobro",
						"no_localizable",
						"unidad_a_recuperar",
						"unidad_recuperada",
						"moras_pendientes",
						"compromiso_de_pago",
						"cancelado",
						"reclamo",
					]),
				),
			}),
		)
		.handler(async ({ input }) => {
			const [updated] = await db
				.update(casosCobros)
				.set({
					etiquetas: input.etiquetas,
					updatedAt: new Date(),
				})
				.where(eq(casosCobros.id, input.casoCobroId))
				.returning();

			if (!updated) {
				throw new ORPCError("NOT_FOUND", {
					message: "Caso de cobros no encontrado",
				});
			}

			return updated;
		}),

	// ========================================================================
	// ENVÍO DE MENSAJES (SMS / WhatsApp / Email)
	// ========================================================================

	enviarWhatsappCobros: cobrosProcedure
		.input(
			z.object({
				telefono: z.string().min(8, "Teléfono inválido"),
				mensaje: z.string().min(1, "Mensaje requerido"),
				casoCobroId: z.string().optional(),
				plantillaId: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const numeroSifco = await resolveSifcoFromCaso(input.casoCobroId);
			const testMode = isTestModeEnabled();
			const telefonoDestino = testMode ? getTestPhone() : input.telefono;

			const result = await sendWhatsappTemplate({
				phone: telefonoDestino,
				message: input.mensaje,
				logPrefix: testMode
					? "[SimpleTech][cobros][TEST]"
					: "[SimpleTech][cobros]",
			});

			await persistCobrosSendLog({
				numeroCreditoSifco: numeroSifco,
				canal: "whatsapp",
				telefono: telefonoDestino,
				mensaje: input.mensaje,
				plantillaId: input.plantillaId ?? null,
				providerRequest: result.providerRequest ?? null,
				result: result.success
					? {
							success: true,
							providerResponse: {
								...(result.providerResponse ?? {}),
								templateMessageId: result.templateMessageId,
								testMode,
								realTarget: testMode ? input.telefono : undefined,
							},
						}
					: {
							success: false,
							errorMessage: result.error,
							providerResponse: {
								...(result.providerResponse ?? {}),
								...(testMode ? { testMode, realTarget: input.telefono } : {}),
							},
						},
				createdBy: context.userId,
			});

			if (!result.success) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error enviando WhatsApp: ${result.error ?? "desconocido"}`,
				});
			}

			return {
				success: true,
				templateMessageId: result.templateMessageId,
				casoCobroId: input.casoCobroId,
			};
		}),

	enviarWhatsappMasivoCobros: cobrosProcedure
		.input(
			z.object({
				plantillaId: z.string(),
				// Texto del cuerpo editado por el usuario en la modal. Si viene,
				// se usa este en lugar de `plantilla.cuerpo` para interpolar las
				// variables por crédito. Las variables ({clienteNombre}, etc.)
				// que no se reconozcan quedan literales — comportamiento esperado.
				// Sin este campo, se cae al cuerpo definido en cobros-plantillas.ts.
				cuerpoEditado: z.string().optional(),
				// Mismos filtros que getTodosLosCreditos (salvo emailCobrador, que
				// se deriva del context para evitar que un cobrador mande fuera de
				// su cartera).
				estadoMora: z.string().optional(),
				searchTerm: z.string().optional(),
				numeroSifco: z.string().optional(),
				time: z.enum(["WEEK", "MONTH", "DUEMONTH", "TODAY"]).optional(),
				etiquetas: z.array(z.string()).optional(),
				fechaDesde: z.string().optional(),
				fechaHasta: z.string().optional(),
				excluirPagadosMes: z.boolean().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con Cartera-Back no está habilitada",
				});
			}

			const plantilla = PLANTILLAS_MENSAJES.find(
				(p) => p.id === input.plantillaId,
			);
			if (!plantilla) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Plantilla '${input.plantillaId}' no existe`,
				});
			}

			// Scope server-side: solo supervisores/admins pueden ver toda la
			// cartera; el resto queda restringido a sus propios créditos.
			const emailCobrador = PERMISSIONS.canAssignCobros(context.userRole)
				? undefined
				: context.user?.email;

			// 1. Mapear estadoMora → params de cartera-back (mismo mapping que
			// getTodosLosCreditos). El rango de cuotas por etapa sale de MORA_BUCKETS.
			let cuotasMin: number | undefined;
			let cuotasMax: number | undefined;
			let estadoCartera:
				| "ACTIVO"
				| "CANCELADO"
				| "INCOBRABLE"
				| "PENDIENTE_CANCELACION"
				| undefined = "ACTIVO";
			if (input.estadoMora) {
				switch (input.estadoMora) {
					case "incobrable":
						estadoCartera = "INCOBRABLE";
						break;
					case "completado":
						estadoCartera = "CANCELADO";
						break;
					case "pendiente_cancelacion":
						estadoCartera = "PENDIENTE_CANCELACION";
						break;
					default: {
						estadoCartera = "ACTIVO";
						const rango = rangoCuotasPorEstadoMora(input.estadoMora);
						if (rango) {
							cuotasMin = rango.min;
							cuotasMax = rango.max;
						}
					}
				}
			}

			// 2. Resolver búsqueda igual que getTodosLosCreditos: si el término
			// tiene dígitos se asume placa y se convierte a número SIFCO
			// consultando el CRM; si es alfabético se usa nombre_usuario.
			const searchTerm = input.searchTerm?.trim() || "";
			const numeroSifcoExacto = input.numeroSifco?.trim() || "";
			const hasNumber = /\d/.test(searchTerm);
			// numeroSifco explícito tiene prioridad: ignora plate/name search.
			const isPlateSearch =
				!numeroSifcoExacto && searchTerm.length > 0 && hasNumber;
			const isNameSearch =
				!numeroSifcoExacto && searchTerm.length > 0 && !hasNumber;

			let numeroSifcoFiltro: string | undefined =
				numeroSifcoExacto || undefined;
			let searchPorPlacaSinMatch = false;
			const matchingSifcos = new Set<string>();
			if (isPlateSearch) {
				const matchingOpportunities = await db
					.select({
						numeroSifco: opportunities.numeroSifco,
					})
					.from(opportunities)
					.innerJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
					.where(
						and(
							sql`LOWER(REPLACE(REPLACE(${vehicles.licensePlate}, '-', ''), ' ', '')) LIKE ${"%" + searchTerm.toLowerCase().replaceAll(/[\s-]+/g, "") + "%"}`,
							sql`${opportunities.numeroSifco} IS NOT NULL`,
						),
					);

				if (matchingOpportunities.length === 0) {
					searchPorPlacaSinMatch = true;
				} else if (matchingOpportunities.length === 1) {
					numeroSifcoFiltro = matchingOpportunities[0].numeroSifco ?? undefined;
				}
				for (const m of matchingOpportunities) {
					if (m.numeroSifco) matchingSifcos.add(m.numeroSifco);
				}
			}

			// 2.5 Si hay filtro de etiquetas, resolver primero la lista de
			// numero_credito_sifco que tengan AL MENOS UNA de las etiquetas
			// seleccionadas (operador `&&` / overlap) y mandarla a cartera-back
			// para que filtre en origen, en vez de traer todo y filtrar acá.
			let sifcosPorEtiquetas: string[] | undefined;
			if (input.etiquetas && input.etiquetas.length > 0) {
				const filas = await db
					.select({
						numeroSifco: casosCobros.numeroCreditoSifco,
					})
					.from(casosCobros)
					.where(
						sql`${casosCobros.etiquetas} && ARRAY[${sql.join(
							input.etiquetas.map((e) => sql`${e}`),
							sql`, `,
						)}]::text[]`,
					);
				sifcosPorEtiquetas = filas
					.map((r) => r.numeroSifco)
					.filter((s): s is string => !!s);
				if (sifcosPorEtiquetas.length === 0) {
					return {
						plantillaId: input.plantillaId,
						totalCreditos: 0,
						elegibles: 0,
						enviados: 0,
						fallidos: 0,
						descartados: [],
						detalle: [],
						contactosRegistrados: 0,
						contactosSinCaso: 0,
					};
				}
			}

			// 2.6 Intersectar búsqueda por placa con etiquetas. En cartera-back la
			// lista multi-SIFCO tiene prioridad sobre el single, así que mandar
			// ambos sin intersectar haría que la placa se ignore y el envío
			// masivo salga a destinatarios incorrectos.
			const respuestaVacia = {
				plantillaId: input.plantillaId,
				totalCreditos: 0,
				elegibles: 0,
				enviados: 0,
				fallidos: 0,
				descartados: [] as Array<{
					numeroSifco: string | null;
					clienteNombre: string | null;
					motivo: string;
				}>,
				detalle: [] as Array<{
					numeroSifco: string;
					telefono: string;
					success: boolean;
					error?: string;
				}>,
				contactosRegistrados: 0,
				contactosSinCaso: 0,
			};
			if (sifcosPorEtiquetas && numeroSifcoFiltro) {
				if (sifcosPorEtiquetas.includes(numeroSifcoFiltro)) {
					// La placa única coincide con alguna etiqueta: basta mandar el
					// single y descartar la lista para no perder ese filtro.
					sifcosPorEtiquetas = undefined;
				} else {
					return respuestaVacia;
				}
			} else if (
				sifcosPorEtiquetas &&
				isPlateSearch &&
				matchingSifcos.size > 0
			) {
				// Placa con varias coincidencias + etiquetas: mandar la intersección
				// a cartera para no traer créditos que no son de la placa.
				const setEtq = new Set(sifcosPorEtiquetas);
				sifcosPorEtiquetas = Array.from(matchingSifcos).filter((s) =>
					setEtq.has(s),
				);
				if (sifcosPorEtiquetas.length === 0) return respuestaVacia;
			} else if (
				!sifcosPorEtiquetas &&
				isPlateSearch &&
				!numeroSifcoFiltro &&
				matchingSifcos.size > 0
			) {
				// Placa con varias coincidencias sin etiquetas: en lugar de traer
				// toda la cartera y filtrar después, mandamos directo la lista de
				// SIFCOs de la placa como numeros_credito_sifco.
				sifcosPorEtiquetas = Array.from(matchingSifcos);
			}

			// 3. Paginar getAllCreditos hasta traer todos los matcheos.
			const creditosFiltrados: Awaited<
				ReturnType<typeof carteraBackClient.getAllCreditos>
			>["data"] = [];
			if (!searchPorPlacaSinMatch) {
				const perPage = 100;
				let page = 1;
				while (true) {
					const resp = await obtenerTodosLosCreditosCarteraBack({
						mes: 0,
						anio: new Date().getFullYear(),
						estado: estadoCartera,
						cuotasMin,
						cuotasMax,
						// Mismo criterio que getTodosLosCreditos: si hay rango de fechas
						// custom, ignoramos el preset `time` para que no se pisen.
						time: input.fechaDesde || input.fechaHasta ? undefined : input.time,
						email_cobrador: emailCobrador,
						nombre_usuario: isNameSearch ? searchTerm : undefined,
						numero_credito_sifco: numeroSifcoFiltro,
						numeros_credito_sifco: sifcosPorEtiquetas,
						fecha_desde: input.fechaDesde,
						fecha_hasta: input.fechaHasta,
						excluir_pagados_mes: input.excluirPagadosMes,
						page,
						perPage,
					});
					creditosFiltrados.push(...resp.data);
					if (resp.data.length < perPage) break;
					if (page >= resp.totalPages) break;
					page += 1;
				}
			}

			// 3. Traer en un solo query nuestros datos locales (teléfono, placa,
			// vehículo) indexados por numero_sifco.
			const numerosSifco = creditosFiltrados
				.map((c) => c.creditos.numero_credito_sifco)
				.filter((s): s is string => !!s);

			type LocalInfo = {
				telefono: string | null;
				placa: string | null;
				marca: string | null;
				modelo: string | null;
				year: number | null;
			};
			const locales = new Map<string, LocalInfo>();
			const casoIdPorSifco = new Map<string, string>();

			if (numerosSifco.length > 0) {
				const oppRows = await db
					.select({
						numeroSifco: opportunities.numeroSifco,
						leadPhone: leads.phone,
						placa: vehicles.licensePlate,
						marca: vehicles.make,
						modelo: vehicles.model,
						year: vehicles.year,
					})
					.from(opportunities)
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
					.where(inArray(opportunities.numeroSifco, numerosSifco));

				for (const row of oppRows) {
					if (!row.numeroSifco) continue;
					locales.set(row.numeroSifco, {
						telefono: row.leadPhone,
						placa: row.placa,
						marca: row.marca,
						modelo: row.modelo,
						year: row.year,
					});
				}

				// Casos de cobros pueden tener telefonoPrincipal override.
				// También cargamos el id para registrar historial de contacto en
				// los casos que ya existen.
				const casosRows = await db
					.select({
						id: casosCobros.id,
						numeroSifco: casosCobros.numeroCreditoSifco,
						telefonoPrincipal: casosCobros.telefonoPrincipal,
					})
					.from(casosCobros)
					.where(inArray(casosCobros.numeroCreditoSifco, numerosSifco));

				for (const row of casosRows) {
					if (!row.numeroSifco) continue;
					const prev = locales.get(row.numeroSifco);
					locales.set(row.numeroSifco, {
						telefono: row.telefonoPrincipal ?? prev?.telefono ?? null,
						placa: prev?.placa ?? null,
						marca: prev?.marca ?? null,
						modelo: prev?.modelo ?? null,
						year: prev?.year ?? null,
					});
					casoIdPorSifco.set(row.numeroSifco, row.id);
				}
			}

			// 4. Construir recipients, aplicando reglas de descarte.
			const testMode = isTestModeEnabled();

			// CB-128: una sola espera del catálogo de buckets ANTES del loop. Los
			// helpers de moraBuckets refrescan en background, así que la primera
			// llamada tras un deploy usaría el fallback estático — y acá ese valor
			// no es transitorio: queda CONGELADO en `bucket_snapshot` de cientos de
			// filas de golpe. Una espera para todo el lote, nunca por fila.
			//
			// Se espera TAMBIÉN en test mode: lo único que cambia ahí es el teléfono
			// destino, las gestiones se graban igual y con el mismo bucket_snapshot.
			// Saltarla dejaría al modo de prueba escribiendo buckets distintos a los
			// de producción, que es justo lo contrario de lo que sirve para probar.
			await esperarCatalogoBuckets();

			type Candidato = {
				numeroSifco: string;
				telefono: string; // destino efectivo (test o real)
				telefonoReal: string; // destino original (para trazabilidad)
				mensaje: string;
				casoCobroId: string | null;
				clienteNombre: string | null; // para reportar en descartados si falla
				bucketSnapshot: number | null; // CB-128, derivado de cuotas atrasadas
			};
			const candidatos: Candidato[] = [];
			const descartados: Array<{
				numeroSifco: string | null;
				clienteNombre: string | null;
				motivo: string;
			}> = [];

			for (const credito of creditosFiltrados) {
				const sifco = credito.creditos.numero_credito_sifco;
				const cuota = credito.creditos.cuota;
				const asesor = credito.asesores;
				const info = sifco ? locales.get(sifco) : undefined;
				const telefono = info?.telefono ?? null;
				const clienteNombre = credito.usuarios.nombre ?? null;

				if (!cuota || Number(cuota) === 0) {
					descartados.push({
						numeroSifco: sifco,
						clienteNombre,
						motivo: "sin cuota",
					});
					continue;
				}
				if (!telefono) {
					descartados.push({
						numeroSifco: sifco,
						clienteNombre,
						motivo: "sin teléfono",
					});
					continue;
				}
				if (!asesor) {
					descartados.push({
						numeroSifco: sifco,
						clienteNombre,
						motivo: "sin asesor",
					});
					continue;
				}

				const marcaLineaModelo = [
					info?.marca ?? "",
					info?.modelo ?? "",
					info?.year ? String(info.year) : "",
				]
					.filter(Boolean)
					.join(" ")
					.trim();

				// Total a cobrar = monto en mora + cuota mensual (mismo criterio
				// que se muestra en la pantalla de detalle del caso).
				const montoMora = Number(credito.mora?.monto_mora ?? 0);
				const totalACobrar = montoMora > 0 ? montoMora + Number(cuota) : 0;

				const cuerpoBase = input.cuerpoEditado?.trim()
					? input.cuerpoEditado
					: plantilla.cuerpo;
				const telefonoAsesor = prepararTelefonoAsesorParaEnvio(
					cuerpoBase,
					asesor.telefono,
				);

				if (!telefonoAsesor.enviar) {
					descartados.push({
						numeroSifco: sifco,
						clienteNombre,
						motivo: telefonoAsesor.motivo,
					});
					continue;
				}

				// Día de pago: tomar el día del mes de la fecha de vencimiento de la
				// próxima cuota que devuelve cartera (`proxima_cuota`). Es el mismo
				// criterio que usa el detalle individual de este router, y la única
				// fuente del día de pago que vive en cartera. Sin esto el masivo
				// dejaba "{fechaPago}" vacío ("Su día de pago es el .").
				const diaPago = credito.proxima_cuota?.fecha_vencimiento
					? Number.parseInt(
							credito.proxima_cuota.fecha_vencimiento.substring(8, 10),
							10,
						) || null
					: null;

				const mensaje = interpolarPlantilla(cuerpoBase, {
					clienteNombre: credito.usuarios.nombre ?? "",
					fechaPago: diaPago ? String(diaPago) : "",
					cuotaMensual: String(cuota),
					placa: info?.placa ?? "",
					marcaLineaModelo,
					montoAdeudado:
						totalACobrar > 0
							? totalACobrar.toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})
							: "",
					montoMora:
						montoMora > 0
							? montoMora.toLocaleString("es-GT", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})
							: "",
					cuotasAtraso: credito.mora?.cuotas_atrasadas ?? 0,
					telefonoAsesor: telefonoAsesor.telefonoAsesor,
					nombreAsesor: asesor.nombre ?? "",
				});

				candidatos.push({
					numeroSifco: sifco ?? "",
					telefono: testMode ? getTestPhone(candidatos.length) : telefono,
					telefonoReal: telefono,
					mensaje,
					casoCobroId: sifco ? (casoIdPorSifco.get(sifco) ?? null) : null,
					clienteNombre,
					// CB-128: bucket del momento para el historial de agendas.
					//
					// `credito.bucket` es el AUTORITATIVO: lo arma /getAllCredits desde
					// buckets_historial (última fila del motor), el mismo criterio que
					// getBucketActualCredito usa para las gestiones manuales. Recalcular
					// desde cuotas_atrasadas en vez de leerlo podía divergir cuando el
					// motor y la derivación viva por cuotas no coinciden — p.ej. el
					// motor aún no vio un cambio reciente, o el crédito tiene bucket
					// forzado por estado (INCOBRABLE) (Codex, PR #1300).
					//
					// Fallback a numeroBucketPorCuotas SOLO si `credito.bucket` no vino
					// (ambiente sin la tabla buckets_historial, o crédito que el motor
					// nunca procesó) — no se llama a capturarBucketSnapshot: eso sería
					// una petición de red por destinatario dentro de un envío que puede
					// tener cientos, y con el timeout de 3s haría el envío inviable.
					bucketSnapshot:
						credito.bucket?.numero ??
						numeroBucketPorCuotas(
							credito.mora?.cuotas_atrasadas ?? 0,
							credito.creditos.statusCredit,
						),
				});
			}

			// 5. Enviar en chunks de 100 y loguear cada resultado.
			// batchId agrupa todas las filas de cobros_send_logs de este envío
			// masivo para poder consultarlas como una unidad.
			const CHUNK_SIZE = 100;
			const batchId = crypto.randomUUID();
			let enviados = 0;
			let fallidos = 0;
			const detalle: Array<{
				numeroSifco: string;
				telefono: string;
				success: boolean;
				error?: string;
			}> = [];

			// Buffer para registrar contactos en historial al final, en una sola
			// inserción batch. Solo se registran envíos exitosos a créditos que
			// ya tienen un caso_cobros (la FK es notNull).
			const contactosARegistrar: Array<{
				casoCobroId: string;
				metodoContacto: "whatsapp";
				estadoContacto: "contactado";
				comentarios: string;
				realizadoPor: string;
				bucketSnapshot: number | null;
			}> = [];

			for (let i = 0; i < candidatos.length; i += CHUNK_SIZE) {
				const chunk = candidatos.slice(i, i + CHUNK_SIZE);
				const batch = await sendWhatsappTemplateBatch({
					recipients: chunk.map((c) => ({
						phone: c.telefono,
						message: c.mensaje,
						externalRef: c.numeroSifco,
					})),
					logPrefix: "[SimpleTech][cobros-masivo]",
				});

				const byRef = new Map(
					batch.items.map((item) => [item.externalRef ?? "", item]),
				);

				for (const c of chunk) {
					const res = byRef.get(c.numeroSifco);
					const ok = res?.success === true;
					if (ok) {
						enviados += 1;
					} else {
						fallidos += 1;
						// Los que el proveedor rechazó también se reportan como
						// descartados para que aparezcan en la tabla/CSV y se les
						// pueda dar seguimiento manual, igual que los pre-descartes.
						const motivoFallo = res?.error?.trim()
							? `Falló el envío: ${res.error.trim()}`
							: "Falló el envío";
						descartados.push({
							numeroSifco: c.numeroSifco || null,
							clienteNombre: c.clienteNombre,
							motivo: motivoFallo,
						});
					}

					detalle.push({
						numeroSifco: c.numeroSifco,
						telefono: c.telefono,
						success: ok,
						error: res?.error,
					});

					await persistCobrosSendLog({
						numeroCreditoSifco: c.numeroSifco || null,
						canal: "whatsapp",
						telefono: c.telefono,
						mensaje: c.mensaje,
						plantillaId: input.plantillaId,
						batchId,
						providerRequest: batch.providerRequest ?? null,
						createdBy: context.userId,
						result: ok
							? {
									success: true,
									providerResponse: {
										...(batch.providerResponse ?? {}),
										templateMessageId: res?.templateMessageId,
										testMode,
										realTarget: testMode ? c.telefonoReal : undefined,
									},
								}
							: {
									success: false,
									errorMessage:
										res?.error ?? batch.transportError ?? "Error desconocido",
									providerResponse: {
										...(batch.providerResponse ?? {}),
										...(testMode
											? { testMode, realTarget: c.telefonoReal }
											: {}),
									},
								},
					});

					// Registrar en historial del caso (mismo flujo que contacto-modal)
					// solo cuando el envío fue exitoso y el crédito tiene caso.
					if (ok && c.casoCobroId) {
						// CB-020: prefijo "Envío masivo" identifica el origen del
						// contacto (sin columna "origen" en DB) — un consumidor futuro
						// que necesite distinguir contacto manual del asesor vs envío
						// automático puede filtrar por este prefijo en `comentarios`.
						// No cambiar el texto sin actualizar cualquier filtro que
						// dependa de él.
						contactosARegistrar.push({
							casoCobroId: c.casoCobroId,
							metodoContacto: "whatsapp",
							estadoContacto: "contactado",
							comentarios: `Envío masivo de WhatsApp — Plantilla: ${plantilla.nombre}`,
							realizadoPor: context.userId,
							// CB-128: derivado al armar el candidato, sin llamada de red.
							bucketSnapshot: c.bucketSnapshot,
						});
					}
				}
			}

			// Insertar todo el historial en una sola query.
			let contactosRegistrados = 0;
			let contactosSinCaso = 0;
			for (const c of candidatos) {
				if (!c.casoCobroId) contactosSinCaso += 1;
			}
			if (contactosARegistrar.length > 0) {
				try {
					await db.insert(contactosCobros).values(contactosARegistrar);
					contactosRegistrados = contactosARegistrar.length;
				} catch (error) {
					console.error(
						"[Cobros] Error registrando historial de contactos masivo:",
						error,
					);
				}
			}

			return {
				plantillaId: input.plantillaId,
				batchId,
				totalCreditos: creditosFiltrados.length,
				elegibles: candidatos.length,
				enviados,
				fallidos,
				descartados,
				detalle,
				contactosRegistrados,
				contactosSinCaso,
			};
		}),

	enviarEmailCobros: cobrosProcedure
		.input(
			z.object({
				destinatario: z.string().email("Email inválido"),
				asunto: z.string().min(1, "Asunto requerido").max(200),
				mensaje: z.string().min(1, "Mensaje requerido"),
				casoCobroId: z.string().optional(),
				plantillaId: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const escapeHtml = (s: string) =>
				s
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;")
					.replace(/'/g, "&#039;");

			const html = `<div style="font-family:Arial,sans-serif;color:#111827;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(
				input.mensaje,
			)}</div>`;

			const numeroSifco = await resolveSifcoFromCaso(input.casoCobroId);
			const testMode = isTestModeEnabled();
			const emailDestino = testMode ? TEST_EMAIL : input.destinatario;

			let sendError: string | null = null;
			let emailId: string | undefined;
			try {
				const result = await sendPlainEmail(emailDestino, input.asunto, html);

				if (!result.success) {
					sendError =
						result.error && typeof result.error === "object"
							? JSON.stringify(result.error)
							: String(result.error ?? "desconocido");
				} else {
					emailId = result.data?.id;
				}
			} catch (error) {
				sendError = error instanceof Error ? error.message : String(error);
			}

			await persistCobrosSendLog({
				numeroCreditoSifco: numeroSifco,
				canal: "email",
				email: emailDestino,
				asunto: input.asunto,
				mensaje: input.mensaje,
				plantillaId: input.plantillaId ?? null,
				result: sendError
					? {
							success: false,
							errorMessage: sendError,
							providerResponse: testMode
								? { testMode, realTarget: input.destinatario }
								: undefined,
						}
					: {
							success: true,
							providerResponse: {
								emailId,
								testMode,
								realTarget: testMode ? input.destinatario : undefined,
							},
						},
				createdBy: context.userId,
			});

			if (sendError) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error enviando email: ${sendError}`,
				});
			}

			return {
				success: true,
				emailId,
				casoCobroId: input.casoCobroId,
			};
		}),

	enviarSmsCobros: cobrosProcedure
		.input(
			z.object({
				telefono: z
					.string()
					.min(8, "Teléfono inválido")
					.transform((v) => v.replace(/[^0-9]/g, "")),
				mensaje: z.string().min(1, "Mensaje requerido"),
				casoCobroId: z.string().optional(),
				plantillaId: z.string().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const token = process.env.SMS_TOKEN;
			const apiKeyRaw = process.env.SMS_API_KEY;
			if (!token || !apiKeyRaw) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Credenciales SMS no configuradas",
				});
			}

			const smsClient = new SMSClient({
				credentials: {
					token,
					apiKey: Number.parseInt(apiKeyRaw, 10),
				},
				timeout: 60000, // SMS API a veces tarda >30s, subir a 60s.
			});

			const numeroSifco = await resolveSifcoFromCaso(input.casoCobroId);
			const testMode = isTestModeEnabled();
			// Para SMS el número debe incluir prefijo 502 completo. El input viene
			// validado a solo dígitos; si son 8 (local) le ponemos el 502, si ya
			// trae 502 (p.ej. 50258446376) lo dejamos.
			const ensure502 = (digits: string) =>
				digits.startsWith("502") ? digits : `502${digits}`;
			const telefonoDestino = testMode
				? ensure502(getTestPhone())
				: ensure502(input.telefono);

			let sendError: string | null = null;
			let mailingId: number | undefined;
			try {
				const result = await smsClient.send({
					msisdns: [telefonoDestino],
					message: input.mensaje,
					country: "GT",
					tag: "cobros-contacto",
					dial: 50237633199,
				});

				if (!result.success) {
					sendError =
						result.error?.hint || result.error?.message || "desconocido";
				} else {
					mailingId = result.mailingId;
				}
			} catch (error) {
				sendError = error instanceof Error ? error.message : String(error);
			}

			await persistCobrosSendLog({
				numeroCreditoSifco: numeroSifco,
				canal: "sms",
				telefono: telefonoDestino,
				mensaje: input.mensaje,
				plantillaId: input.plantillaId ?? null,
				result: sendError
					? {
							success: false,
							errorMessage: sendError,
							providerResponse: testMode
								? { testMode, realTarget: input.telefono }
								: undefined,
						}
					: {
							success: true,
							providerResponse: {
								mailingId,
								testMode,
								realTarget: testMode ? input.telefono : undefined,
							},
						},
				createdBy: context.userId,
			});

			if (sendError) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Error enviando SMS: ${sendError}`,
				});
			}

			return {
				success: true,
				mailingId,
				casoCobroId: input.casoCobroId,
			};
		}),

	// ========================================================================
	// MORA POR ETAPA Y ASESOR
	// ========================================================================

	getMoraByEtapaYAsesor: cobrosSupervisorProcedure
		.input(
			z
				.object({
					emailCobrador: z.string().optional(),
					fecha: z.string().optional(),
					asesores: z.array(z.number()).optional(),
				})
				.optional(),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getMoraByEtapaYAsesor({
				emailCobrador: input?.emailCobrador,
				fecha: input?.fecha,
				asesores: input?.asesores,
			});
		}),

	getMoraCobradaPorAsesor: cobrosSupervisorProcedure
		.input(
			z.object({
				mes: z.number(),
				anio: z.number(),
				asesores: z.array(z.number()).optional(),
				emailCobrador: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getMoraCobradaPorAsesor({
				mes: input.mes,
				anio: input.anio,
				asesores: input.asesores,
				emailCobrador: input.emailCobrador,
			});
		}),

	getMoraRecuperacionPorAsesor: cobrosSupervisorProcedure
		.input(
			z.object({
				mes: z.number(),
				anio: z.number(),
				asesores: z.array(z.number()).optional(),
				emailCobrador: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}
			return carteraBackClient.getMoraRecuperacionPorAsesor(input);
		}),

	// ========================================================================
	// CUOTAS POR FECHA (reemplaza Pagos Esperados + Pagos No Recibidos)
	// ========================================================================

	getCuotasPorFecha: cobrosSupervisorProcedure
		.input(
			z.object({
				fechaInicio: z.string(),
				fechaFin: z.string(),
				asesorId: z.number().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			const rows = await carteraBackClient.getCuotasPorFecha({
				fechaInicio: input.fechaInicio,
				fechaFin: input.fechaFin,
				asesorId: input.asesorId,
			});

			const rowsMapped = rows.map((r) => ({ ...r }));

			let capitalEsp = 0;
			let interesEsp = 0;
			let ivaEsp = 0;
			let seguroEsp = 0;
			let gpsEsp = 0;
			let membresiasEsp = 0;
			let totalEsp = 0;
			let totalPag = 0;
			let cuotasTotal = 0;
			let cuotasPagadas = 0;

			for (const r of rowsMapped) {
				capitalEsp += Number(r.capital_esperado);
				interesEsp += Number(r.interes_esperado);
				ivaEsp += Number(r.iva_esperado);
				seguroEsp += Number(r.seguro_esperado);
				gpsEsp += Number(r.gps_esperado);
				membresiasEsp += Number(r.membresias_esperado);
				totalEsp += Number(r.total_esperado);
				totalPag += Number(r.total_pagado);
				cuotasTotal++;
				if (r.pagado) cuotasPagadas++;
			}

			return {
				rows: rowsMapped,
				totales: {
					capitalEsp: capitalEsp.toFixed(2),
					interesEsp: interesEsp.toFixed(2),
					ivaEsp: ivaEsp.toFixed(2),
					seguroEsp: seguroEsp.toFixed(2),
					gpsEsp: gpsEsp.toFixed(2),
					membresiasEsp: membresiasEsp.toFixed(2),
					totalEsp: totalEsp.toFixed(2),
					totalPag: totalPag.toFixed(2),
					totalPendiente: (totalEsp - totalPag).toFixed(2),
					cuotasTotal,
					cuotasPagadas,
				},
			};
		}),

	// ========================================================================
	// COBRANZA DIARIA (Cobrado vs Esperado)
	// ========================================================================

	getCobranzaDiaria: cobrosSupervisorProcedure
		.input(
			z.object({
				anio: z.number(),
				mes: z.number(),
				dia: z.number(),
				asesorId: z.number().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getCobranzaDiaria(input);
		}),

	getCobranzaDiariaDetalle: cobrosSupervisorProcedure
		.input(
			z.object({
				anio: z.number(),
				mes: z.number(),
				dia: z.number(),
				asesorId: z.number(),
				limit: z.number().optional(),
				offset: z.number().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}

			return carteraBackClient.getCobranzaDiariaDetalle(input);
		}),

	// ========================================================================
	// DESCUENTOS / RUBROS POR CRÉDITO
	// ========================================================================

	getDescuentosCRM: cobrosSupervisorProcedure
		.input(
			z.object({
				page: z.number().min(1).default(1),
				pageSize: z.number().min(1).max(100).default(25),
				search: z.string().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const asesorUser = user;

			const latestQuotations = db
				.selectDistinctOn([quotations.opportunityId], {
					opportunityId: quotations.opportunityId,
					finesCost: quotations.finesCost,
					keyCopyCost: quotations.keyCopyCost,
					keyCopyDiffCost: quotations.keyCopyDiffCost,
					circulationTaxCost: quotations.circulationTaxCost,
					mobileGuaranteeCost: quotations.mobileGuaranteeCost,
					licensePlatesCost: quotations.licensePlatesCost,
					leasingContractCost: quotations.leasingContractCost,
					collectionAuthCost: quotations.collectionAuthCost,
					appointmentCost: quotations.appointmentCost,
					addressVerificationCost: quotations.addressVerificationCost,
					vehicleTransferCost: quotations.vehicleTransferCost,
					interestCost: quotations.interestCost,
					rcdpCost: quotations.rcdpCost,
					extraGpsCost: quotations.extraGpsCost,
					extraInsuranceCost: quotations.extraInsuranceCost,
					extraMembershipCost: quotations.extraMembershipCost,
					extraAdminCost: quotations.extraAdminCost,
					freelanceCost: quotations.freelanceCost,
					royalty: quotations.royalty,
					inspectionCost: quotations.inspectionCost,
					legalCost: quotations.legalCost,
				})
				.from(quotations)
				.where(isNotNull(quotations.opportunityId))
				.orderBy(quotations.opportunityId, desc(quotations.createdAt))
				.as("lq");

			const conditions = [isNotNull(opportunities.numeroSifco)];
			if (input.search) {
				const term = `%${input.search}%`;
				const searchCond = or(
					ilike(opportunities.numeroSifco, term),
					ilike(leads.firstName, term),
					ilike(leads.lastName, term),
				);
				if (searchCond) conditions.push(searchCond);
			}

			const totalSql = sql<number>`(
				COALESCE(${latestQuotations.finesCost}::numeric, 0) +
				COALESCE(${latestQuotations.keyCopyCost}::numeric, 0) +
				COALESCE(${latestQuotations.keyCopyDiffCost}::numeric, 0) +
				COALESCE(${latestQuotations.circulationTaxCost}::numeric, 0) +
				COALESCE(${latestQuotations.mobileGuaranteeCost}::numeric, 0) +
				COALESCE(${latestQuotations.licensePlatesCost}::numeric, 0) +
				COALESCE(${latestQuotations.leasingContractCost}::numeric, 0) +
				COALESCE(${latestQuotations.collectionAuthCost}::numeric, 0) +
				COALESCE(${latestQuotations.appointmentCost}::numeric, 0) +
				COALESCE(${latestQuotations.addressVerificationCost}::numeric, 0) +
				COALESCE(${latestQuotations.vehicleTransferCost}::numeric, 0) +
				COALESCE(${latestQuotations.interestCost}::numeric, 0) +
				COALESCE(${latestQuotations.rcdpCost}::numeric, 0) +
				COALESCE(${latestQuotations.extraGpsCost}::numeric, 0) +
				COALESCE(${latestQuotations.extraInsuranceCost}::numeric, 0) +
				COALESCE(${latestQuotations.extraMembershipCost}::numeric, 0) +
				COALESCE(${latestQuotations.extraAdminCost}::numeric, 0) +
				COALESCE(${latestQuotations.freelanceCost}::numeric, 0) +
				COALESCE(${latestQuotations.royalty}::numeric, 0) +
				COALESCE(${latestQuotations.inspectionCost}::numeric, 0) +
				COALESCE(${latestQuotations.legalCost}::numeric, 0)
			)`;

			const baseQuery = db
				.select({
					sifco: opportunities.numeroSifco,
					leadFirstName: leads.firstName,
					leadLastName: leads.lastName,
					finesCost: latestQuotations.finesCost,
					keyCopyCost: latestQuotations.keyCopyCost,
					keyCopyDiffCost: latestQuotations.keyCopyDiffCost,
					circulationTaxCost: latestQuotations.circulationTaxCost,
					mobileGuaranteeCost: latestQuotations.mobileGuaranteeCost,
					licensePlatesCost: latestQuotations.licensePlatesCost,
					leasingContractCost: latestQuotations.leasingContractCost,
					collectionAuthCost: latestQuotations.collectionAuthCost,
					appointmentCost: latestQuotations.appointmentCost,
					addressVerificationCost: latestQuotations.addressVerificationCost,
					vehicleTransferCost: latestQuotations.vehicleTransferCost,
					interestCost: latestQuotations.interestCost,
					rcdpCost: latestQuotations.rcdpCost,
					extraGpsCost: latestQuotations.extraGpsCost,
					extraInsuranceCost: latestQuotations.extraInsuranceCost,
					extraMembershipCost: latestQuotations.extraMembershipCost,
					extraAdminCost: latestQuotations.extraAdminCost,
					freelanceCost: latestQuotations.freelanceCost,
					royalty: latestQuotations.royalty,
					inspectionCost: latestQuotations.inspectionCost,
					legalCost: latestQuotations.legalCost,
					totalDescuentos: totalSql,
				})
				.from(latestQuotations)
				.innerJoin(
					opportunities,
					eq(latestQuotations.opportunityId, opportunities.id),
				)
				.innerJoin(asesorUser, eq(opportunities.assignedTo, asesorUser.id))
				.leftJoin(leads, eq(opportunities.leadId, leads.id))
				.where(and(...conditions, sql`${totalSql} > 0`));

			const [[{ total }], rows] = await Promise.all([
				db
					.select({ total: count() })
					.from(latestQuotations)
					.innerJoin(
						opportunities,
						eq(latestQuotations.opportunityId, opportunities.id),
					)
					.innerJoin(asesorUser, eq(opportunities.assignedTo, asesorUser.id))
					.leftJoin(leads, eq(opportunities.leadId, leads.id))
					.where(and(...conditions, sql`${totalSql} > 0`)),
				baseQuery
					.orderBy(desc(opportunities.createdAt))
					.limit(input.pageSize)
					.offset((input.page - 1) * input.pageSize),
			]);

			const fmt = (v: string | null | undefined) =>
				Number.parseFloat(v || "0").toFixed(2);

			const pageData = rows.map((row) => {
				const clienteNombre =
					[row.leadFirstName, row.leadLastName].filter(Boolean).join(" ") ||
					"Sin cliente";
				return {
					sifco: row.sifco ?? "",
					clienteNombre,
					multas: fmt(row.finesCost),
					copiaDeLlave: fmt(row.keyCopyCost),
					diferenciaCopia: fmt(row.keyCopyDiffCost),
					impuestoCirculacion: fmt(row.circulationTaxCost),
					garantiaMobiliaria: fmt(row.mobileGuaranteeCost),
					placas: fmt(row.licensePlatesCost),
					contratoLeasing: fmt(row.leasingContractCost),
					autenticaCobranza: fmt(row.collectionAuthCost),
					nombramiento: fmt(row.appointmentCost),
					verificacionDireccion: fmt(row.addressVerificationCost),
					traspasoVehiculo: fmt(row.vehicleTransferCost),
					intereses: fmt(row.interestCost),
					rcdp: fmt(row.rcdpCost),
					gps: fmt(row.extraGpsCost),
					seguro: fmt(row.extraInsuranceCost),
					membresia: fmt(row.extraMembershipCost),
					gastosAdmin: fmt(row.extraAdminCost),
					freelance: fmt(row.freelanceCost),
					royalty: fmt(row.royalty),
					inspeccion: fmt(row.inspectionCost),
					gastosLegales: fmt(row.legalCost),
					totalDescuentos: Number(row.totalDescuentos).toFixed(2),
				};
			});

			const totalPages = Math.max(1, Math.ceil(total / input.pageSize));

			return {
				data: pageData,
				total,
				page: input.page,
				pageSize: input.pageSize,
				totalPages,
			};
		}),

	// ────────────────────────────────────────────────────────────────────────
	// COBROS-02 · Reasignación manual de asesor por bucket (supervisor/gerente)
	// ────────────────────────────────────────────────────────────────────────

	// Listado de créditos por bucket — fuente de la tabla de /cobros/buckets.
	getCreditosPorBucket: cobrosSupervisorProcedure
		.input(
			z.object({
				bucket: z.number().int().min(0).optional(),
				page: z.number().int().positive().optional(),
				perPage: z.number().int().positive().max(200).optional(),
				numeroCredito: z.string().optional(),
				nombreCliente: z.string().optional(),
				asesorId: z.number().int().positive().optional(),
			}),
		)
		.handler(async ({ input }) => {
			const resp = await carteraBackClient.getCreditosPorBucket({
				bucket: input.bucket,
				page: input.page ?? 1,
				perPage: input.perPage ?? 20,
				numero_credito_sifco: input.numeroCredito?.trim() || undefined,
				nombre_usuario: input.nombreCliente?.trim() || undefined,
				asesor_id: input.asesorId,
			});
			return {
				data: resp.data.map((c) => ({
					creditoId: c.creditos.credito_id,
					numeroCreditoSifco: c.creditos.numero_credito_sifco,
					cliente: c.usuarios?.nombre ?? "",
					asesorId: c.creditos.asesor_id ?? null,
					asesorNombre: c.asesores?.nombre ?? null,
					bucket: c.bucket ?? null,
				})),
				page: resp.page,
				perPage: resp.perPage,
				total: resp.total,
				totalPages: resp.totalPages,
			};
		}),

	// Pool de asesores elegibles de un bucket (dropdown del modal de reasignar).
	getPoolAsesoresPorBucket: cobrosSupervisorProcedure
		.input(z.object({ bucket: z.number().int().min(0) }))
		.handler(async ({ input }) => {
			return carteraBackClient.getPoolAsesoresPorBucket(input.bucket);
		}),

	// ────────────────────────────────────────────────────────────────────────
	// CB-018 · Carga de cuentas por asesor y bucket (dashboard gerencial)
	// ────────────────────────────────────────────────────────────────────────
	getCargaPorAsesorBucket: cobrosSupervisorProcedure
		.input(
			z.object({
				// Rango del catálogo (0-5), igual que cartera-back (routers/buckets.ts,
				// /buckets/carga) — validado en ambas capas para fallar rápido aquí en
				// vez de depender del 400 que igual devolvería cartera-back.
				bucket: z.number().int().min(0).max(5).optional(),
				asesorId: z.number().int().positive().optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}
			return carteraBackClient.getCargaPorAsesorBucket({
				bucket: input.bucket,
				asesor_id: input.asesorId,
			});
		}),

	// ────────────────────────────────────────────────────────────────────────
	// CB-023 · Apertura matutina del supervisor (8:00 AM)
	// Solo supervisor/admin (cobrosSupervisorProcedure): el ticket es "como
	// supervisor". A diferencia de getAgendaDia, NO hay asesor forzado — no
	// existe el caso "el cobrador ve la suya" para esta vista.
	//
	// Las 4 secciones vienen de /buckets/apertura. La "asignación del día" es
	// el DELTA del día por asesor (a quién le cayó trabajo nuevo anoche), NO el
	// dashboard de capacidad de CB-018.
	// ────────────────────────────────────────────────────────────────────────
	getAperturaDia: cobrosSupervisorProcedure
		.input(
			z.object({
				// YYYY-MM-DD opcional (default hoy GT en cartera-back).
				// El regex solo valida la FORMA: 2026-02-30 la pasa. El refine hace
				// round-trip contra Date para descartar fechas de calendario
				// inexistentes — mismo criterio que `esFecha` en cartera-back
				// (routers/buckets.ts), que si no las rechaza revientan en el
				// ::date de Postgres. Validar aquí evita el viaje de ida y vuelta.
				fecha: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.refine(
						(s) => {
							const [y, m, d] = s.split("-").map(Number);
							const fecha = new Date(Date.UTC(y, m - 1, d));
							return (
								fecha.getUTCFullYear() === y &&
								fecha.getUTCMonth() === m - 1 &&
								fecha.getUTCDate() === d
							);
						},
						{ message: "Fecha inexistente en el calendario" },
					)
					.optional(),
			}),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}
			try {
				return await carteraBackClient.getAperturaDia({ fecha: input.fecha });
			} catch (err) {
				// cartera-back-client.ts (request()) lanza Error en cualquier no-2xx
				// (400/404/500) — el {success:false} del client method nunca se
				// alcanza. Se mapea el mensaje real de cartera-back a BAD_REQUEST en
				// vez de burbujear como 500 genérico (mismo patrón que
				// actualizarCapacidadAsesorBucket / reasignarAsesor más abajo).
				throw new ORPCError("BAD_REQUEST", {
					message:
						err instanceof Error
							? err.message
							: "No se pudo obtener la apertura del día",
				});
			}
		}),

	// ────────────────────────────────────────────────────────────────────────
	// CB-019 · Configurar capacidad_base/margen_alerta por asesor+bucket
	// Solo admin (a diferencia de getCargaPorAsesorBucket, que sigue siendo
	// admin+supervisor): el supervisor puede ver el dashboard pero no editar
	// capacidades, pedido explícito del negocio.
	// ────────────────────────────────────────────────────────────────────────
	actualizarCapacidadAsesorBucket: adminProcedure
		.input(
			z
				.object({
					asesorId: z.number().int().positive(),
					bucket: z.number().int().min(0).max(5),
					// Tope de sanidad (review code-review): un asesor no atiende más de
					// 2000 cuentas en un bucket — evita un fat-finger tipo 999999.
					capacidadBase: z.number().int().positive().max(2000),
					margenAlertaTipo: z.enum(["porcentaje", "fijo"]),
					margenAlertaValor: z.number().min(0),
				})
				.refine(
					(v) =>
						v.margenAlertaTipo !== "porcentaje" || v.margenAlertaValor <= 100,
					{
						message:
							"margenAlertaValor debe ser <= 100 cuando el tipo es porcentaje",
						path: ["margenAlertaValor"],
					},
				)
				.refine(
					(v) => v.margenAlertaTipo !== "fijo" || v.margenAlertaValor <= 500,
					{
						message: "margenAlertaValor debe ser <= 500 cuando el tipo es fijo",
						path: ["margenAlertaValor"],
					},
				),
		)
		.handler(async ({ input }) => {
			if (!isCarteraBackEnabled()) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Integración con cartera-back no está habilitada",
				});
			}
			try {
				return await carteraBackClient.actualizarCapacidadAsesorBucket({
					asesor_id: input.asesorId,
					bucket: input.bucket,
					capacidad_base: input.capacidadBase,
					margen_alerta_tipo: input.margenAlertaTipo,
					margen_alerta_valor: input.margenAlertaValor,
				});
			} catch (err) {
				// cartera-back-client.ts (request()) lanza Error en cualquier no-2xx
				// (400/404/500) — el {success:false} del client method nunca se
				// alcanza (review code-review #1). Se mapea el mensaje real de
				// cartera-back a BAD_REQUEST en vez de burbujear como 500 genérico.
				throw new ORPCError("BAD_REQUEST", {
					message:
						err instanceof Error
							? err.message
							: "No se pudo actualizar la capacidad",
				});
			}
		}),

	// Reasignación manual. Solo supervisor/gerente (cobrosSupervisorProcedure).
	// El email del supervisor va a cartera-back para la bitácora API_MANUAL.
	reasignarAsesorCredito: cobrosSupervisorProcedure
		.input(
			z.object({
				creditoId: z.number().int().positive(),
				asesorNuevoId: z.number().int().positive(),
				motivo: z.string().trim().min(1, "El motivo es obligatorio"),
			}),
		)
		.handler(async ({ input, context }) => {
			try {
				return await carteraBackClient.reasignarAsesor({
					credito_id: input.creditoId,
					asesor_nuevo_id: input.asesorNuevoId,
					motivo: input.motivo,
					usuario_email: context.session.user.email,
				});
			} catch (err) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						err instanceof Error
							? err.message
							: "No se pudo reasignar el asesor",
				});
			}
		}),

	// Bitácora de reasignaciones de asesor (auditoría) — manual + automática.
	getHistorialReasignaciones: cobrosSupervisorProcedure
		.input(
			z.object({
				desde: z.string().optional(),
				hasta: z.string().optional(),
				origen: z.enum(["PROCESO_AUTO", "API_MANUAL"]).optional(),
				bucket: z.number().int().min(0).optional(),
				asesorId: z.number().int().positive().optional(),
				numeroCredito: z.string().optional(),
				creditoId: z.number().int().positive().optional(),
				page: z.number().int().positive().optional(),
				pageSize: z.number().int().positive().max(200).optional(),
			}),
		)
		.handler(async ({ input }) => {
			return carteraBackClient.getAsesorHistorial({
				desde: input.desde,
				hasta: input.hasta,
				origen: input.origen,
				bucket: input.bucket !== undefined ? String(input.bucket) : undefined,
				asesor_nuevo:
					input.asesorId !== undefined ? String(input.asesorId) : undefined,
				numero_credito_sifco: input.numeroCredito?.trim() || undefined,
				credito_id: input.creditoId,
				page: input.page ?? 1,
				pageSize: input.pageSize ?? 20,
			});
		}),

	// CB-024: reporte de cierre diario por rango — agrupa el DETALLE guardado
	// por generarCierreDiario (job de 22:00 GT) en cierre_diario_credito_cobros,
	// no recalcula en vivo contra contactos_cobros/cartera-back. Permite
	// ventanas dinámicas (ej. lun→vie de la semana actual).
	getCierreDiarioPorRango: cobrosSupervisorProcedure
		.input(
			z.object({
				fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				asesorIds: z.array(z.string()).optional(),
			}),
		)
		.handler(async ({ input }) => {
			const conditions = [
				gte(cierreDiarioCreditoCobros.fecha, input.fechaInicio),
				lte(cierreDiarioCreditoCobros.fecha, input.fechaFin),
			];
			if (input.asesorIds && input.asesorIds.length > 0) {
				conditions.push(
					inArray(cierreDiarioCreditoCobros.asesorId, input.asesorIds),
				);
			}

			// Un contacto generado por el sistema (premora / envío masivo) no es
			// gestión del asesor. `es_efectivo_manual` ya lo excluye en el job. Acá
			// se aplica el mismo criterio (prefijo de comentario) a promesas Y al
			// total: el denominador de "efectivos/total" que pide el reporte es
			// "de lo que el asesor REGISTRÓ, cuánto contestó" — un envío automático
			// no es un intento del asesor, así que si se cuela en el total infla el
			// denominador y hace ver el ratio peor de lo real.
			const esAutomatico = sql`(${contactosCobros.comentarios} LIKE ${`${PREFIJO_PREMORA_AUTO}%`} OR ${contactosCobros.comentarios} LIKE ${`${PREFIJO_WSP_MASIVO}%`})`;

			const filas = await db
				.select({
					asesorId: cierreDiarioCreditoCobros.asesorId,
					asesorNombre: user.name,
					// Se usa abajo para cruzar con el pool de buckets de cartera-back.
					asesorEmail: user.email,
					contactosEfectivos: sql<number>`COUNT(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'contacto' AND ${cierreDiarioCreditoCobros.esEfectivoManual})`,
					promesasObtenidas: sql<number>`COUNT(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'contacto' AND ${cierreDiarioCreditoCobros.estadoContacto} = 'promesa_pago' AND NOT ${esAutomatico})`,
					// Promesa se reporta aparte (línea de arriba) — no cuenta en el
					// denominador de "efectivos/total", sería mezclar dos categorías
					// excluyentes en un mismo ratio.
					totalContactos: sql<number>`COUNT(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'contacto' AND ${cierreDiarioCreditoCobros.estadoContacto} != 'promesa_pago' AND NOT ${esAutomatico})`,
					// Movimientos que SALIERON del bucket del pool del asesor ese día.
					subieron: sql<number>`COUNT(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'subida')`,
					bajaron: sql<number>`COUNT(*) FILTER (WHERE ${cierreDiarioCreditoCobros.tipo} = 'bajada')`,
				})
				.from(cierreDiarioCreditoCobros)
				.innerJoin(user, eq(cierreDiarioCreditoCobros.asesorId, user.id))
				.leftJoin(
					contactosCobros,
					eq(cierreDiarioCreditoCobros.contactoId, contactosCobros.id),
				)
				.where(and(...conditions))
				.groupBy(cierreDiarioCreditoCobros.asesorId, user.name, user.email)
				.orderBy(asc(user.name));

			// Pool de buckets al que está asignado cada asesor. Es config ESTABLE
			// (no histórico del día), por eso se consulta acá y no se guarda en el
			// snapshot: guardar "el pool de ayer" no tendría sentido operativo.
			//
			// Fuente: getPoolPorAsesor() (/buckets/pool-por-asesor) — catálogo
			// COMPLETO de asesores con sus buckets activos, sin pasar por
			// creditos (no depende de que el asesor tenga cuentas activas ahora
			// mismo). Reemplaza el intento anterior (getAdvisors + N ×
			// getPoolAsesoresPorBucket cruzados por el email de /advisor): ese
			// email está desactualizado para varios asesores (Diego Gomez,
			// Samuel Gamboa) y no coincidía con `user.email` del CRM.
			// `email_cash_in` (expuesto por este endpoint) sí coincide. Mismo
			// patrón de bug de exclusión-por-créditos-activos ya corregido en
			// cierre-diario-asesores.ts (CB-024, commit 4e6f1ce5).
			//
			// Best-effort: si cartera-back falla, el reporte sigue sirviendo sin
			// la etiqueta de pool.
			const poolPorAsesor = new Map<string, number[]>();
			try {
				const asesoresConBuckets = await carteraBackClient.getPoolPorAsesor();
				const emailToUserId = new Map(
					filas.map((f) => [f.asesorEmail.trim().toLowerCase(), f.asesorId]),
				);
				for (const a of asesoresConBuckets) {
					const email = a.email_cash_in?.trim().toLowerCase();
					if (!email) continue;
					const userId = emailToUserId.get(email);
					if (!userId) continue;
					poolPorAsesor.set(
						userId,
						[...a.buckets].sort((x, y) => x - y),
					);
				}
			} catch (error) {
				console.error("[getCierreDiarioPorRango] Pool de buckets:", error);
			}

			return filas.map((f) => ({
				asesorId: f.asesorId,
				asesorNombre: f.asesorNombre,
				contactosEfectivos: Number(f.contactosEfectivos),
				promesasObtenidas: Number(f.promesasObtenidas),
				totalContactos: Number(f.totalContactos),
				subieron: Number(f.subieron),
				bajaron: Number(f.bajaron),
				bucketsPool: poolPorAsesor.get(f.asesorId) ?? [],
			}));
		}),

	// CB-024: detalle de créditos detrás de los agregados de un asesor+rango —
	// alimenta el acordeón. Lee cierre_diario_credito_cobros (snapshot ya
	// generado), no consulta contactos_cobros/cartera-back en vivo.
	getDetalleCierrePorAsesor: cobrosSupervisorProcedure
		.input(
			z.object({
				asesorId: z.string(),
				fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
				fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			}),
		)
		.handler(async ({ input }) => {
			const filas = await db
				.select({
					id: cierreDiarioCreditoCobros.id,
					tipo: cierreDiarioCreditoCobros.tipo,
					casoCobroId: cierreDiarioCreditoCobros.casoCobroId,
					numeroCreditoSifco: cierreDiarioCreditoCobros.numeroCreditoSifco,
					estadoContacto: cierreDiarioCreditoCobros.estadoContacto,
					esEfectivoManual: cierreDiarioCreditoCobros.esEfectivoManual,
					fechaContacto: cierreDiarioCreditoCobros.fechaContacto,
					bucketAnterior: cierreDiarioCreditoCobros.bucketAnterior,
					bucket: cierreDiarioCreditoCobros.bucket,
					fecha: cierreDiarioCreditoCobros.fecha,
					// Origen del contacto, para que la UI pueda explicar por qué una
					// fila 'contactado' no cuenta como efectiva: los envíos que genera
					// el sistema (premora, WhatsApp masivo) quedan en el historial pero
					// no son gestión del asesor. Se derivan del prefijo de comentario,
					// mismo criterio que usa el job (no hay columna de origen en
					// contactos_cobros).
					origen: sql<string>`CASE
						WHEN ${contactosCobros.comentarios} LIKE ${`${PREFIJO_PREMORA_AUTO}%`} THEN 'premora'
						WHEN ${contactosCobros.comentarios} LIKE ${`${PREFIJO_WSP_MASIVO}%`} THEN 'wsp_masivo'
						ELSE 'manual'
					END`,
				})
				.from(cierreDiarioCreditoCobros)
				.leftJoin(
					contactosCobros,
					eq(cierreDiarioCreditoCobros.contactoId, contactosCobros.id),
				)
				.where(
					and(
						eq(cierreDiarioCreditoCobros.asesorId, input.asesorId),
						gte(cierreDiarioCreditoCobros.fecha, input.fechaInicio),
						lte(cierreDiarioCreditoCobros.fecha, input.fechaFin),
					),
				)
				.orderBy(desc(cierreDiarioCreditoCobros.fecha));

			return filas;
		}),
};

/**
 * Resuelve el número SIFCO del caso de cobros (si existe).
 */
async function resolveSifcoFromCaso(
	casoCobroId: string | undefined,
): Promise<string | null> {
	if (!casoCobroId) return null;
	const [caso] = await db
		.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	return caso?.numeroCreditoSifco ?? null;
}

/**
 * Inserta una fila en cobros_send_logs. Nunca propaga errores: si el log falla
 * (por un problema transitorio de DB) no queremos romper el flujo del envío.
 */
async function persistCobrosSendLog(params: {
	numeroCreditoSifco: string | null;
	canal: "sms" | "email" | "whatsapp";
	telefono?: string;
	email?: string;
	asunto?: string;
	mensaje: string;
	plantillaId?: string | null;
	batchId?: string | null;
	providerRequest?: Record<string, unknown> | null;
	createdBy: string;
	result:
		| { success: true; providerResponse?: Record<string, unknown> }
		| {
				success: false;
				errorMessage?: string;
				providerResponse?: Record<string, unknown>;
		  };
}) {
	try {
		await db.insert(cobrosSendLogs).values({
			numeroCreditoSifco: params.numeroCreditoSifco,
			canal: params.canal,
			telefono: params.telefono,
			email: params.email,
			asunto: params.asunto,
			mensaje: params.mensaje,
			plantillaId: params.plantillaId ?? null,
			batchId: params.batchId ?? null,
			providerRequest: params.providerRequest ?? null,
			status: params.result.success ? "sent" : "failed",
			errorMessage: params.result.success ? null : params.result.errorMessage,
			providerResponse: params.result.providerResponse,
			createdBy: params.createdBy,
			sentAt: params.result.success ? new Date() : null,
		});
	} catch (err) {
		console.error("[cobros_send_logs] Error guardando log:", err);
	}
}
