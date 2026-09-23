/**
 * Wialon / La Legión GPS Router
 *
 * Módulo independiente para exponer los endpoints de telemática y rastreo GPS
 * hacia el frontend y servicios del CRM vía ORPC.
 *
 * Sigue el mismo patrón desacoplado que pagaloSupervisionRouter y recuperacionVehiculoRouter
 * para evitar el límite de TypeScript (TS7056) en la inferencia de tipos hacia apps/web.
 */

import { ORPCError } from "@orpc/server";
import {
	and,
	count,
	desc,
	eq,
	ilike,
	isNotNull,
	isNull,
	ne,
	notLike,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import { vehicles } from "../db/schema/vehicles";
import {
	adminProcedure,
	cobrosProcedure,
	cobrosSupervisorProcedure,
} from "../lib/orpc";
import {
	extraerNucleoDeNombreUnidad,
	extraerNucleoPlaca,
	getWialonClient,
	matchUnidadPorPlaca,
	resolveWialonEnvironment,
	type WialonClient,
} from "../services/wialon/wialon-client";
import {
	createLocatorLinkInputSchema,
	deleteLocatorLinkInputSchema,
	type GpsVehiculoOutput,
	getUnitDetailInputSchema,
	getUnitsStatusInputSchema,
	gpsBitacoraInputSchema,
	gpsBitacoraOutputSchema,
	gpsVehiculoInputSchema,
	gpsVehiculoOutputSchema,
	searchUnitsInputSchema,
	testWialonConnectionOutputSchema,
	vincularUnidadInputSchema,
	vincularUnidadOutputSchema,
	WialonClientError,
	type WialonDiagnostics,
	wialonDiagnosticsOutputSchema,
	wialonUnitsCatalogInputSchema,
	wialonUnitsCatalogOutputSchema,
} from "../services/wialon/wialon-types";
import { assertAccesoCasoCobro } from "./cobros";

export function mapWialonErrorToOrpc(error: unknown): never {
	if (error instanceof WialonClientError) {
		if (error.code === "WIALON_AUTH_REQUIRED") {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"Token de Wialon no configurado en el servidor (WIALON_TOKEN).",
			});
		}
		if (error.code === "WIALON_INVALID_SESSION") {
			throw new ORPCError("BAD_GATEWAY", {
				message:
					"Fallo de autenticación con el proveedor de Wialon: credenciales upstream no válidas o expiradas.",
			});
		}
		if (error.code === "WIALON_TIMEOUT") {
			throw new ORPCError("GATEWAY_TIMEOUT", {
				message: "La solicitud a la API de Wialon superó el tiempo límite.",
			});
		}
		if (error.code === "WIALON_NETWORK_ERROR") {
			throw new ORPCError("BAD_GATEWAY", {
				message: `Error al conectar con la API de Wialon: ${error.message}`,
			});
		}
		if (error.code === "WIALON_INVALID_RESPONSE") {
			throw new ORPCError("BAD_GATEWAY", {
				message: `Respuesta inválida de Wialon: ${error.message}`,
			});
		}
		if (error.code === "WIALON_API_ERROR") {
			const upstreamFaults = [5, 8, 9, 10, 11, 14]; // 5=ejecución, 8=credenciales inválidas, 9=servidor ocupado, 10=límite peticiones, 11=DB no disponible, 14=facturación
			if (
				typeof error.wialonErrorCode === "number" &&
				upstreamFaults.includes(error.wialonErrorCode)
			) {
				const isAuthFault = error.wialonErrorCode === 8;
				throw new ORPCError("BAD_GATEWAY", {
					message: isAuthFault
						? `Fallo de autenticación con el proveedor de Wialon (credenciales o token inválido): ${error.message}`
						: `Fallo del servicio de Wialon (código ${error.wialonErrorCode}): ${error.message}`,
				});
			}
			if (error.wialonErrorCode === 7) {
				throw new ORPCError("FORBIDDEN", {
					message: `Acceso denegado o permisos insuficientes en Wialon: ${error.message}`,
				});
			}
			throw new ORPCError("BAD_REQUEST", {
				message: error.message,
			});
		}
		throw new ORPCError("BAD_REQUEST", {
			message: error.message,
		});
	}

	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message:
			error instanceof Error
				? error.message
				: "Error interno procesando solicitud de Wialon",
	});
}

/**
 * Lee el vehículo con las columnas de vínculo Wialon (CB-118).
 *
 * OJO — deuda temporal: la migración 0057 está commiteada pero puede no estar
 * aplicada todavía en el ambiente donde corre esto. Mientras no lo esté, un
 * SELECT que nombre `wialon_unit_id` falla con "column does not exist", así que
 * el fallback reintenta pidiendo solo las columnas viejas: la ficha pierde el
 * vínculo persistido pero sigue resolviendo por placa. Ojo: sin la 0057 tampoco
 * existe gps_consulta_logs, y sin auditoría no se muestra ubicación (fail
 * closed), así que en ese ambiente la tarjeta solo informa estados sin
 * ubicación. Cuando 0057 esté aplicada en todos los ambientes, este catch sobra.
 */
async function leerVehiculoParaGps(vehicleId: string): Promise<{
	licensePlate: string | null;
	wialonUnitId: number | null;
	wialonUnitName: string | null;
	wialonVinculadoPor: string | null;
	// false = se leyó por el fallback (0057 sin aplicar): nada que toque las
	// columnas de vínculo puede correr después en esta consulta.
	columnasVinculo: boolean;
} | null> {
	try {
		const filas = await db
			.select({
				licensePlate: vehicles.licensePlate,
				wialonUnitId: vehicles.wialonUnitId,
				wialonUnitName: vehicles.wialonUnitName,
				wialonVinculadoPor: vehicles.wialonVinculadoPor,
			})
			.from(vehicles)
			.where(eq(vehicles.id, vehicleId))
			.limit(1);
		return filas[0] ? { ...filas[0], columnasVinculo: true } : null;
	} catch (error) {
		console.warn("WIALON_VINCULO_COLUMNAS_NO_DISPONIBLES", {
			vehicleId,
			message: error instanceof Error ? error.message : String(error),
		});
		const filas = await db
			.select({ licensePlate: vehicles.licensePlate })
			.from(vehicles)
			.where(eq(vehicles.id, vehicleId))
			.limit(1);
		const fila = filas[0];
		return fila
			? {
					...fila,
					wialonUnitId: null,
					wialonUnitName: null,
					wialonVinculadoPor: null,
					columnasVinculo: false,
				}
			: null;
	}
}

/**
 * Valor de `wialon_vinculado_por` cuando el vínculo lo fijó el sistema al
 * deducirlo por placa y no un supervisor. Distinguirlo es lo que permite que la
 * ficha siga mostrando "identificada automáticamente" (y el atajo para
 * corregirla) en las consultas siguientes, aunque el vínculo ya esté guardado.
 */
export const WIALON_VINCULO_AUTO_PLACA = "auto:placa";

/** Respuesta de getGpsVehiculo antes de agregarle `auditada` (se calcula al final). */
type SinAuditada<T> = T extends unknown ? Omit<T, "auditada"> : never;

/**
 * ¿Un vínculo auto:placa sigue correspondiendo a la placa actual? Mismo
 * criterio con el que se dedujo (matchUnidadPorPlaca) contra el nombre de la
 * unidad guardado al vincular.
 */
function vinculoAutoVigente(
	placa: string | null,
	unitName: string | null,
): boolean {
	if (!placa || !unitName) return false;
	return matchUnidadPorPlaca(placa, [{ id: 0, nm: unitName }]).motivo === "ok";
}

/**
 * Suelta un vínculo auto:placa que dejó de valer. Condicionado a que siga
 * siendo ese mismo vínculo automático: si entretanto un supervisor lo cambió,
 * no se toca. Best-effort: si falla, la consulta sigue como sin vínculo.
 */
async function liberarVinculoAuto(vehicleId: string, unitId: number) {
	try {
		await db
			.update(vehicles)
			.set({
				wialonUnitId: null,
				wialonUnitName: null,
				wialonVinculadoAt: null,
				wialonVinculadoPor: null,
			})
			.where(
				and(
					eq(vehicles.id, vehicleId),
					eq(vehicles.wialonUnitId, unitId),
					eq(vehicles.wialonVinculadoPor, WIALON_VINCULO_AUTO_PLACA),
				),
			);
		console.info("WIALON_VINCULO_AUTO_LIBERADO", { vehicleId, unitId });
	} catch (error) {
		console.warn("WIALON_VINCULO_AUTO_NO_LIBERADO", {
			vehicleId,
			unitId,
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

type TransaccionDb = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializa, dentro de una transacción, todo lo que asigna una unidad de
 * Wialon a un vehículo. Sin UNIQUE en wialon_unit_id (a propósito, ver 0057),
 * dos asignaciones simultáneas de la MISMA unidad a vehículos distintos
 * podían hacer commit las dos. El lock es por unidad (asignar unidades
 * distintas no se bloquea entre sí) y se libera solo al cerrar la transacción.
 */
async function bloquearUnidadWialon(tx: TransaccionDb, unitId: number) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`wialon_unit:${unitId}`}, 0))`,
	);
}

/**
 * Fija el vínculo deducido por placa para que las próximas consultas no
 * vuelvan a recorrer el catálogo. Devuelve qué pasó, porque el handler
 * responde distinto en cada caso:
 *   - "guardado": quedó fijado.
 *   - "asignada_a_otro": la unidad ya está guardada en OTRO vehículo (un
 *     supervisor reasignó el GPS). No se toca: deducir de nuevo desharía la
 *     reasignación y este crédito mostraría la ubicación del otro carro.
 *   - "ya_vinculado": entre leer el vehículo y terminar de recorrer el
 *     catálogo (segundos), un supervisor lo vinculó a mano. Su decisión manda
 *     y el handler tiene que mostrar ESA unidad, no la deducida.
 *   - "error": best-effort, la consulta sigue con la unidad deducida.
 * Chequeo y escritura van en la misma transacción, con el lock de la unidad.
 */
async function fijarVinculoPorPlaca(
	vehicleId: string,
	unitId: number,
	unitName: string,
): Promise<"guardado" | "asignada_a_otro" | "ya_vinculado" | "error"> {
	try {
		return await db.transaction(async (tx) => {
			await bloquearUnidadWialon(tx, unitId);

			const [otro] = await tx
				.select({ vehiculoConUnidad: vehicles.id })
				.from(vehicles)
				.where(
					and(eq(vehicles.wialonUnitId, unitId), ne(vehicles.id, vehicleId)),
				)
				.limit(1);
			if (otro) return "asignada_a_otro" as const;

			const guardados = await tx
				.update(vehicles)
				.set({
					wialonUnitId: unitId,
					wialonUnitName: unitName,
					wialonVinculadoAt: new Date(),
					wialonVinculadoPor: WIALON_VINCULO_AUTO_PLACA,
				})
				.where(and(eq(vehicles.id, vehicleId), isNull(vehicles.wialonUnitId)))
				.returning({ id: vehicles.id });
			return guardados.length > 0
				? ("guardado" as const)
				: ("ya_vinculado" as const);
		});
	} catch (error) {
		console.warn("WIALON_VINCULO_AUTO_NO_GUARDADO", {
			vehicleId,
			unitId,
			message: error instanceof Error ? error.message : String(error),
		});
		return "error";
	}
}

/**
 * Arma la respuesta de una unidad ya resuelta: telemetría + cuándo fue la
 * última señal.
 *
 * La última señal va en su propia llamada (`core/search_item`) porque
 * `unit/calc_last` no la trae, y se pide en paralelo: son dos viajes a Wialon
 * independientes y encadenarlos duplicaría la espera de la ficha. Si esa
 * segunda llamada falla, la telemetría igual se muestra con las fechas en
 * null — media respuesta útil es mejor que ninguna.
 */
async function construirRespuestaVinculada(
	client: WialonClient,
	unitId: number,
	unitName: string,
	vinculoOrigen: "persistido" | "placa",
	placa: string | null,
): Promise<SinAuditada<GpsVehiculoOutput>> {
	const [statusList, fechas] = await Promise.all([
		client.getUnitsStatus([unitId]),
		client
			.getUnitLastTimes(unitId)
			.catch(() => ({ ultimoMensajeAt: null, ultimaPosicionAt: null })),
	]);

	const status = statusList[0];

	return {
		estado: "vinculado",
		unitId,
		unitName,
		vinculoOrigen,
		placa,
		telemetria: {
			mileageKm: status?.mileageKm,
			mileageFormatted: status?.mileageFormatted,
			engineHours: status?.engineHours,
			engineHoursFormatted: status?.engineHoursFormatted,
			speedKmh: status?.speedKmh,
			latitude: status?.latitude,
			longitude: status?.longitude,
			isIgnitionOn: status?.isIgnitionOn,
			ultimaSenalAt: fechas.ultimoMensajeAt,
			ultimaPosicionAt: fechas.ultimaPosicionAt,
		},
	};
}

/**
 * Créditos (SIFCO) de cada unidad del catálogo admin (CB-118).
 *
 * Mismo criterio que la Ficha 360, en sentido inverso:
 *   1. "vinculado": el vehículo tiene la unidad guardada en wialon_unit_id
 *      (sea deducida por placa o fijada por un supervisor). Es la fuente
 *      confiable y, si existe, es la única que se muestra para esa unidad.
 *   2. "placa": sin vínculo guardado, el núcleo de placa del nombre de la
 *      unidad ("P-720GVH SIN APAGADO" → 720GVH) contra las placas del CRM de
 *      vehículos que todavía no tienen unidad. Es una deducción: se marca.
 *
 * Solo SIFCO reales: los "CRM-<uuid>" son identificadores internos de
 * oportunidades sin crédito en cartera y la ficha no los abre. Una unidad
 * puede devolver varios créditos (vehículo duplicado o refinanciado).
 *
 * Best-effort: si la consulta falla (ej. 0057 sin aplicar), el catálogo se
 * muestra igual sin créditos — es información de apoyo, no el catálogo.
 */
async function creditosPorUnidad(
	unidades: { id: number; nm: string }[],
): Promise<
	Map<number, { numeroSifco: string; origen: "vinculado" | "placa" }[]>
> {
	const resultado = new Map<
		number,
		{ numeroSifco: string; origen: "vinculado" | "placa" }[]
	>();
	if (unidades.length === 0) return resultado;

	try {
		// Dos fuentes para responder "qué crédito tiene esta unidad": el
		// vehículo de la oportunidad con ese SIFCO y el del contrato del caso.
		// (La ficha y su GPS usan solo la oportunidad; acá el contrato suma
		// porque el SIFCO igual es correcto.) Duplicados se descartan al agregar.
		const [filasOportunidad, filasContrato] = await Promise.all([
			db
				.select({
					wialonUnitId: vehicles.wialonUnitId,
					wialonVinculadoPor: vehicles.wialonVinculadoPor,
					licensePlate: vehicles.licensePlate,
					numeroSifco: opportunities.numeroSifco,
				})
				.from(vehicles)
				.innerJoin(opportunities, eq(opportunities.vehicleId, vehicles.id))
				.where(
					and(
						isNotNull(opportunities.numeroSifco),
						notLike(opportunities.numeroSifco, "CRM-%"),
					),
				),
			db
				.select({
					wialonUnitId: vehicles.wialonUnitId,
					wialonVinculadoPor: vehicles.wialonVinculadoPor,
					licensePlate: vehicles.licensePlate,
					numeroSifco: casosCobros.numeroCreditoSifco,
				})
				.from(casosCobros)
				.innerJoin(
					contratosFinanciamiento,
					eq(contratosFinanciamiento.id, casosCobros.contratoId),
				)
				.innerJoin(vehicles, eq(vehicles.id, contratosFinanciamiento.vehicleId))
				.where(
					and(
						isNotNull(casosCobros.numeroCreditoSifco),
						notLike(casosCobros.numeroCreditoSifco, "CRM-%"),
					),
				),
		]);
		// Un vínculo auto:placa que ya no coincide con la placa actual (placa
		// corregida después) no cuenta: mismo criterio que getGpsVehiculo, que
		// lo libera al consultar. Esa fila vuelve al pool de deducción.
		const nombrePorUnidad = new Map(unidades.map((u) => [u.id, u.nm]));
		const filas = [...filasOportunidad, ...filasContrato].map((fila) =>
			fila.wialonUnitId != null &&
			fila.wialonVinculadoPor === WIALON_VINCULO_AUTO_PLACA &&
			!vinculoAutoVigente(
				fila.licensePlate,
				nombrePorUnidad.get(fila.wialonUnitId) ?? null,
			)
				? { ...fila, wialonUnitId: null }
				: fila,
		);

		const agregar = (
			unitId: number,
			numeroSifco: string,
			origen: "vinculado" | "placa",
		) => {
			const lista = resultado.get(unitId) ?? [];
			if (!lista.some((c) => c.numeroSifco === numeroSifco)) {
				lista.push({ numeroSifco, origen });
			}
			resultado.set(unitId, lista);
		};

		for (const fila of filas) {
			if (fila.wialonUnitId != null && fila.numeroSifco) {
				agregar(fila.wialonUnitId, fila.numeroSifco, "vinculado");
			}
		}

		// Núcleo de placa → SIFCOs, solo de vehículos aún sin unidad guardada:
		// si ya tienen una, esa decisión manda y no se deduce otra.
		const porNucleo = new Map<string, string[]>();
		for (const fila of filas) {
			if (fila.wialonUnitId != null || !fila.numeroSifco) continue;
			const nucleo = extraerNucleoPlaca(fila.licensePlate);
			if (!nucleo) continue;
			const clave = nucleo.digitos + nucleo.letras;
			porNucleo.set(clave, [...(porNucleo.get(clave) ?? []), fila.numeroSifco]);
		}

		for (const unidad of unidades) {
			if (resultado.has(unidad.id)) continue;
			const nucleo = extraerNucleoDeNombreUnidad(unidad.nm);
			if (!nucleo) continue;
			for (const sifco of porNucleo.get(nucleo.digitos + nucleo.letras) ?? []) {
				agregar(unidad.id, sifco, "placa");
			}
		}
	} catch (error) {
		console.warn("WIALON_CATALOGO_CREDITOS_NO_DISPONIBLES", {
			message: error instanceof Error ? error.message : String(error),
		});
		resultado.clear();
	}

	return resultado;
}

/**
 * Gate de la Ficha 360 antes de consultar el GPS (CB-118).
 *
 * 1. Acceso al caso: el mismo `assertAccesoCasoCobro` que usan los demás
 *    procedures de la ficha — un asesor regular solo ve sus casos asignados.
 *    Sin esto, cualquier usuario de cobros con el UUID de un vehículo ajeno
 *    obtenía su ubicación en vivo.
 * 2. El vehículo tiene que ser EL del caso, resuelto igual que la ficha
 *    (getDetallesCreditoCarteraBack): la oportunidad con el SIFCO del caso.
 *    Si no, el gate del paso 1 se saltaría pasando un caso propio con un
 *    vehículo ajeno. No se acepta el vehículo del contrato: la ficha nunca lo
 *    manda, y una sola fuente evita que ficha y GPS discrepen.
 * 3. El SIFCO para la bitácora sale del caso, no del cliente: antes venía en
 *    el input y podía omitirse o falsearse.
 *
 * Lanza NOT_FOUND (mismo mensaje en ambos casos, para no revelar si el caso o
 * el vehículo existen) y no deja fila de auditoría: no se mostró nada.
 */
async function resolverCasoParaGps(
	casoCobroId: string,
	vehicleId: string,
	userId: string,
	userRole: string,
): Promise<{ numeroCreditoSifco: string | null }> {
	await assertAccesoCasoCobro(casoCobroId, userId, userRole);

	const [fila] = await db
		.select({
			casoSifco: casosCobros.numeroCreditoSifco,
			vehiculoOportunidad: opportunities.vehicleId,
		})
		.from(casosCobros)
		.leftJoin(
			opportunities,
			and(
				eq(opportunities.numeroSifco, casosCobros.numeroCreditoSifco),
				eq(opportunities.vehicleId, vehicleId),
			),
		)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);

	if (!fila || fila.vehiculoOportunidad !== vehicleId) {
		throw new ORPCError("NOT_FOUND", {
			message: "Caso de cobro no encontrado o sin acceso.",
		});
	}
	return { numeroCreditoSifco: fila.casoSifco ?? null };
}

export const wialonRouter = {
	/**
	 * Busca y lista las unidades de rastreo GPS (svc: core/search_items)
	 */
	getWialonUnits: cobrosProcedure
		.input(searchUnitsInputSchema.optional())
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				const result = await client.searchUnits(input);
				return {
					total: result.totalItemsCount,
					from: result.indexFrom,
					to: result.indexTo,
					items: result.items,
				};
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Obtiene el estado telemático consolidado de una o más unidades en tiempo real:
	 * kilometraje, horas de motor, velocidad, coordenadas y sensores formateados (svc: unit/calc_last)
	 */
	getWialonUnitsStatus: cobrosProcedure
		.input(getUnitsStatusInputSchema)
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				return await client.getUnitsStatus(input.unitIds);
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Consulta los detalles completos y mensajes crudos de una unidad (svc: core/search_item)
	 */
	getWialonUnitDetail: cobrosProcedure
		.input(getUnitDetailInputSchema)
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				return await client.getUnitDetail(input.unitId, input.flags);
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Genera un enlace público temporal de rastreo en vivo (Locator) (svc: token/update)
	 * Restringido a supervisores de cobros y administradores por privacidad y seguridad.
	 */
	createWialonTrackingLink: cobrosSupervisorProcedure
		.input(createLocatorLinkInputSchema)
		.handler(async ({ input, context }) => {
			try {
				const client = getWialonClient();
				const result = await client.createLocatorLink(input);
				console.info("WIALON_LOCATOR_LINK_CREATED", {
					userId: context.userId,
					userEmail: context.user?.email || context.session?.user?.email,
					unitId: result.unitId,
					hashPrefix: `${result.hash.slice(0, 8)}...`,
					durationSeconds: result.durationSeconds,
					expiresAt: result.expiresAt,
					timestamp: new Date().toISOString(),
				});
				return result;
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Revoca o cancela anticipadamente un enlace de rastreo en vivo (svc: token/update con callMode: delete)
	 * Restringido a supervisores de cobros y administradores.
	 */
	deleteWialonTrackingLink: cobrosSupervisorProcedure
		.input(deleteLocatorLinkInputSchema)
		.handler(async ({ input, context }) => {
			try {
				const client = getWialonClient();
				const result = await client.deleteLocatorLink(input.hash);
				console.info("WIALON_LOCATOR_LINK_DELETED", {
					userId: context.userId,
					userEmail: context.user?.email || context.session?.user?.email,
					hashPrefix: `${input.hash.slice(0, 8)}...`,
					timestamp: new Date().toISOString(),
				});
				return result;
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Diagnóstico de conexión y estado de sesión con Wialon
	 */
	getWialonConnectionStatus: cobrosProcedure.handler(async () => {
		try {
			const client = getWialonClient();
			const health = await client.checkHealth(false);
			const session = client.getCachedSession();
			return {
				connected: health.status === "connected",
				user: health.user || session?.user || null,
				expiresAt: session?.expiresAt ? new Date(session.expiresAt) : null,
			};
		} catch (error) {
			throw mapWialonErrorToOrpc(error);
		}
	}),

	/**
	 * Diagnóstico enriquecido para el panel de administración: ambiente, latencia,
	 * conteo de flota y configuración efectiva (sin secretos). No lanza ante fallo
	 * upstream: degrada a connected: false con el error incluido en la respuesta,
	 * para que el panel de monitoreo pueda renderizarse siempre.
	 */
	getWialonDiagnostics: adminProcedure
		.output(wialonDiagnosticsOutputSchema)
		.handler(async () => {
			const client = getWialonClient();
			const publicConfig = client.getPublicConfig();
			const checkedAt = new Date();
			const base: Omit<
				WialonDiagnostics,
				| "connected"
				| "user"
				| "sessionExpiresAt"
				| "latencyMs"
				| "unitCount"
				| "error"
			> = {
				environment: resolveWialonEnvironment(publicConfig.baseUrl),
				baseUrl: publicConfig.baseUrl,
				locatorUrl: publicConfig.locatorUrl,
				timeoutMs: publicConfig.timeoutMs,
				tokenConfigured: publicConfig.tokenConfigured,
				checkedAt,
			};

			const startedAt = performance.now();
			try {
				const health = await client.checkHealth(false);
				const session = client.getCachedSession();
				return {
					...base,
					connected: true,
					user: health.user || session?.user || null,
					sessionExpiresAt: session?.expiresAt
						? new Date(session.expiresAt)
						: null,
					latencyMs: Math.round(performance.now() - startedAt),
					unitCount: health.unitCount ?? null,
					error: null,
				} satisfies WialonDiagnostics;
			} catch (error) {
				const code =
					error instanceof WialonClientError ? error.code : "UNKNOWN";
				const message =
					error instanceof Error
						? error.message
						: "Error desconocido al conectar con Wialon";
				return {
					...base,
					connected: false,
					user: null,
					sessionExpiresAt: null,
					latencyMs: null,
					unitCount: null,
					error: { code, message },
				} satisfies WialonDiagnostics;
			}
		}),

	/**
	 * Fuerza una re-autenticación contra Wialon (invalida y renueva la sesión).
	 * A diferencia de getWialonDiagnostics, aquí sí se propaga el error: es una
	 * acción explícita del administrador, no un chequeo pasivo de monitoreo.
	 */
	testWialonConnection: adminProcedure
		.output(testWialonConnectionOutputSchema)
		.handler(async ({ context }) => {
			const auditBase = {
				userId: context.user?.id,
				userEmail: context.user?.email || context.session?.user?.email,
				timestamp: new Date().toISOString(),
			};
			try {
				const client = getWialonClient();
				const health = await client.checkHealth(true);
				console.info("WIALON_CONNECTION_TESTED", {
					...auditBase,
					connected: health.status === "connected",
				});
				return {
					connected: health.status === "connected",
					unitCount: health.unitCount ?? null,
				};
			} catch (error) {
				// Intento fallido (credenciales inválidas, timeout, etc.) también
				// queda auditado: sin esto no hay rastro de pruebas de conexión
				// que fallan, justo el caso que un administrador necesita ver.
				console.info("WIALON_CONNECTION_TESTED", {
					...auditBase,
					connected: false,
					error: error instanceof WialonClientError ? error.code : "UNKNOWN",
				});
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * Catálogo de unidades para el panel de administración. Resguardado con
	 * adminProcedure para no depender del rol de cobros en la vista de
	 * administración. A diferencia de getWialonUnits, fuerza flags:1 (básico)
	 * porque el catálogo solo serializa id/nm — el flags pesado por defecto de
	 * searchUnitsInputSchema traería sensores/posición sin uso y dispararía el
	 * pre-cacheo de sensores en cada búsqueda.
	 */
	getWialonUnitsCatalog: adminProcedure
		.input(wialonUnitsCatalogInputSchema.optional())
		.output(wialonUnitsCatalogOutputSchema)
		.handler(async ({ input }) => {
			try {
				const client = getWialonClient();
				const result = await client.searchUnits({ ...input, flags: 1 });
				const creditos = await creditosPorUnidad(result.items);
				return {
					total: result.totalItemsCount,
					from: result.indexFrom,
					to: result.indexTo,
					items: result.items.map((item) => ({
						...item,
						creditos: creditos.get(item.id) ?? [],
					})),
				};
			} catch (error) {
				throw mapWialonErrorToOrpc(error);
			}
		}),

	/**
	 * GPS del vehículo de un crédito para la Ficha 360 (CB-118).
	 *
	 * Un solo endpoint resuelve las dos preguntas que la ficha necesita —qué
	 * unidad es y cómo está— porque desde la UI son una sola: el asesor abre el
	 * tab Vehículo y quiere ver dónde está el carro.
	 *
	 * NO lanza ante fallo upstream: degrada a `no_disponible`, mismo criterio que
	 * getWialonDiagnostics. Un Wialon caído no puede tumbar el tab Vehículo de un
	 * crédito — el resto de la ficha (placa, motor, chasis, seguro) sigue siendo
	 * información válida y necesaria para gestionar.
	 */
	getGpsVehiculo: cobrosProcedure
		.input(gpsVehiculoInputSchema)
		.output(gpsVehiculoOutputSchema)
		.handler(async ({ input, context }) => {
			// Fuera del try/catch a propósito: sin acceso al caso se responde
			// error, no "no_disponible" — no es una falla de Wialon.
			const { numeroCreditoSifco } = await resolverCasoParaGps(
				input.casoCobroId,
				input.vehicleId,
				context.userId,
				context.userRole,
			);

			// La auditoría se registra ANTES de resolver la unidad y NUNCA aborta
			// la respuesta: la historia pide dejar rastro de que alguien consultó
			// con tal motivo, no solo de las consultas que resultaron en datos.
			// Ver el motivo de alguien que buscó y no encontró unidad importa igual.
			// Una sola fila por consulta: si la resolución ya quedó auditada y
			// después falla la telemetría, el catch no debe registrar otra.
			//
			// Devuelve si la consulta quedó registrada. Las rutas que devuelven
			// UBICACIÓN no la muestran si es false (fail closed): la historia exige
			// auditar cada consulta, y la tarjeta además dice "Consulta registrada".
			// Sin la 0057 la tabla no existe, así que tampoco se muestra ubicación.
			let auditado: boolean | null = null;
			const registrarAuditoria = async (
				unitId: number | null,
				unitName: string | null,
			): Promise<boolean> => {
				if (auditado !== null) return auditado;
				auditado = false;
				const userId = context.userId ?? context.user?.id;
				if (!userId) {
					// cobrosProcedure garantiza sesión; si aun así no hay usuario, un
					// insert con "" solo violaría la FK. Se deja constancia fuerte.
					console.error("GPS_CONSULTA_LOG_SIN_USUARIO", {
						vehicleId: input.vehicleId,
					});
					return false;
				}
				try {
					await db.insert(gpsConsultaLogs).values({
						vehicleId: input.vehicleId,
						numeroCreditoSifco,
						motivo: input.motivo,
						unitId: unitId != null ? String(unitId) : null,
						unitName,
						userId,
					});
					auditado = true;
				} catch (error) {
					console.error("GPS_CONSULTA_LOG_FALLIDO", {
						vehicleId: input.vehicleId,
						message: error instanceof Error ? error.message : String(error),
					});
				}
				return auditado;
			};

			const sinAuditoria = {
				estado: "no_disponible" as const,
				error: {
					code: "AUDITORIA_NO_DISPONIBLE",
					message:
						"No se pudo registrar la consulta; por seguridad no se muestra la ubicación. Intente de nuevo.",
				},
			};

			// Todas las rutas registran la auditoría antes de responder; la
			// respuesta lleva si quedó registrada para que la UI no diga
			// "Consulta registrada" cuando no fue así (incluidas las rutas sin
			// ubicación, que no se bloquean).
			const respuesta = await (async (): Promise<
				SinAuditada<GpsVehiculoOutput>
			> => {
				try {
					let vehiculo = await leerVehiculoParaGps(input.vehicleId);

					if (!vehiculo) {
						await registrarAuditoria(null, null);
						return {
							estado: "no_disponible" as const,
							error: {
								code: "VEHICULO_NO_ENCONTRADO",
								message: "No se encontró el vehículo del crédito",
							},
						};
					}

					const client = getWialonClient();

					// Respuesta con el vínculo guardado en el vehículo (ruta normal, y
					// también cuando un supervisor lo fijó durante esta consulta).
					const responderVinculoGuardado = async (v: {
						wialonUnitId: number;
						wialonUnitName: string | null;
						wialonVinculadoPor: string | null;
						licensePlate: string | null;
					}) => {
						const unitName = v.wialonUnitName ?? String(v.wialonUnitId);
						if (!(await registrarAuditoria(v.wialonUnitId, unitName))) {
							return sinAuditoria;
						}
						return await construirRespuestaVinculada(
							client,
							v.wialonUnitId,
							unitName,
							v.wialonVinculadoPor === WIALON_VINCULO_AUTO_PLACA
								? "placa"
								: "persistido",
							v.licensePlate?.trim() || null,
						);
					};

					// Un vínculo DEDUCIDO se basa en la placa: si la placa se corrigió
					// después (updateVehicle no toca el vínculo), ya no vale y seguir
					// usándolo mostraría la ubicación de otro carro. Se libera y se
					// vuelve a deducir con la placa actual. Los vínculos que fijó un
					// supervisor no se revalidan: esa decisión es explícita.
					if (
						vehiculo.wialonUnitId &&
						vehiculo.wialonVinculadoPor === WIALON_VINCULO_AUTO_PLACA &&
						!vinculoAutoVigente(vehiculo.licensePlate, vehiculo.wialonUnitName)
					) {
						await liberarVinculoAuto(input.vehicleId, vehiculo.wialonUnitId);
						vehiculo = {
							...vehiculo,
							wialonUnitId: null,
							wialonUnitName: null,
							wialonVinculadoPor: null,
						};
					}

					// 1. Vínculo ya fijado: es la ruta normal y no toca el catálogo.
					if (vehiculo.wialonUnitId) {
						return await responderVinculoGuardado({
							...vehiculo,
							wialonUnitId: vehiculo.wialonUnitId,
						});
					}

					// 2. Sin vínculo: se deduce buscando la placa en el catálogo.
					const placa = vehiculo.licensePlate?.trim() || null;
					// Sin núcleo de placa (vacía o de relleno: "NUEVO", "N/A") no hay
					// nada confiable que buscar: cualquier resultado sería adivinar.
					const nucleo = extraerNucleoPlaca(placa);
					if (!placa || !nucleo) {
						await registrarAuditoria(null, null);
						return {
							estado: "sin_vinculo" as const,
							motivo: "sin_placa" as const,
							placa,
							candidatos: [],
						};
					}

					// Wialon filtra por subcadena LITERAL de sys_name, así que la placa
					// cruda del CRM ("P - 278KJQ", "P0-720GVH") no trae la unidad
					// "P-278KJQ ..." / "P-720GVH ...". Se prefiltra solo por los 3
					// dígitos del núcleo (mismo criterio que el selector de la ficha) y
					// matchUnidadPorPlaca descarta lo que no coincide completo.
					// flags:1 = solo id/nm, que es todo lo que el match necesita.
					const catalogo = await client.searchUnits({
						filterName: nucleo.digitos,
						flags: 1,
					});
					const { unidad, motivo, coincidencias } = matchUnidadPorPlaca(
						placa,
						catalogo.items,
					);

					if (!unidad) {
						await registrarAuditoria(null, null);
						return {
							estado: "sin_vinculo" as const,
							motivo: motivo === "ok" ? "sin_coincidencia" : motivo,
							placa,
							// Solo tiene sentido ofrecer candidatos cuando hay de dónde
							// elegir; con cero coincidencias la lista sería ruido.
							candidatos:
								motivo === "ambiguo"
									? coincidencias.map((u) => ({ id: u.id, nm: u.nm }))
									: [],
						};
					}

					// Sin las columnas de la 0057 no se puede guardar ni chequear
					// vínculos: se responde con la deducción, como documenta el fallback.
					const auto = vehiculo.columnasVinculo
						? await fijarVinculoPorPlaca(input.vehicleId, unidad.id, unidad.nm)
						: "sin_columnas";

					if (auto === "asignada_a_otro") {
						await registrarAuditoria(null, null);
						return {
							estado: "sin_vinculo" as const,
							motivo: "asignada_a_otro" as const,
							placa,
							candidatos: [{ id: unidad.id, nm: unidad.nm }],
						};
					}

					if (auto === "ya_vinculado") {
						const actual = await leerVehiculoParaGps(input.vehicleId);
						if (actual?.wialonUnitId) {
							return await responderVinculoGuardado({
								...actual,
								wialonUnitId: actual.wialonUnitId,
							});
						}
					}

					if (!(await registrarAuditoria(unidad.id, unidad.nm))) {
						return sinAuditoria;
					}
					return await construirRespuestaVinculada(
						client,
						unidad.id,
						unidad.nm,
						"placa",
						placa,
					);
				} catch (error) {
					await registrarAuditoria(null, null);
					const code =
						error instanceof WialonClientError ? error.code : "UNKNOWN";
					const message =
						error instanceof Error
							? error.message
							: "Error desconocido al consultar el GPS del vehículo";
					return { estado: "no_disponible" as const, error: { code, message } };
				}
			})();

			return { ...respuesta, auditada: auditado === true };
		}),

	/**
	 * Fija manualmente qué unidad de Wialon corresponde a un vehículo (CB-118).
	 *
	 * Solo supervisores: elegir mal manda a un gestor de campo al vehículo
	 * equivocado. A diferencia de getGpsVehiculo, este sí propaga el error — es
	 * una acción explícita y el supervisor tiene que saber si no quedó guardada.
	 */
	vincularUnidadWialon: cobrosSupervisorProcedure
		.input(vincularUnidadInputSchema)
		.output(vincularUnidadOutputSchema)
		.handler(async ({ input, context }) => {
			const vinculadoAt = new Date();
			const userEmail = context.user?.email || context.session?.user?.email;

			// Reasignar una unidad (ej. el GPS se pasó a otro carro tras una
			// recuperación) la MUEVE: se le quita a cualquier otro vehículo que la
			// tuviera. Si no, el crédito anterior seguiría mostrando la ubicación
			// del carro nuevo. En una transacción: si el vehículo destino no
			// existe, tampoco se desvincula el anterior.
			const { liberados } = await db.transaction(async (tx) => {
				await bloquearUnidadWialon(tx, input.unitId);

				const liberados = await tx
					.update(vehicles)
					.set({
						wialonUnitId: null,
						wialonUnitName: null,
						wialonVinculadoAt: null,
						wialonVinculadoPor: null,
					})
					.where(
						and(
							eq(vehicles.wialonUnitId, input.unitId),
							ne(vehicles.id, input.vehicleId),
						),
					)
					.returning({ id: vehicles.id });

				const actualizados = await tx
					.update(vehicles)
					.set({
						wialonUnitId: input.unitId,
						wialonUnitName: input.unitName,
						wialonVinculadoAt: vinculadoAt,
						wialonVinculadoPor: userEmail ?? context.userId ?? null,
					})
					.where(eq(vehicles.id, input.vehicleId))
					.returning({ id: vehicles.id });

				// Sin esto un vehicleId inexistente respondía success y el
				// supervisor creía haber vinculado algo que no quedó guardado.
				if (actualizados.length === 0) {
					throw new ORPCError("NOT_FOUND", {
						message: "No se encontró el vehículo a vincular",
					});
				}
				return { liberados };
			});

			console.info("WIALON_UNIDAD_VINCULADA", {
				userId: context.userId,
				userEmail,
				vehicleId: input.vehicleId,
				unitId: input.unitId,
				unitName: input.unitName,
				// Vehículos a los que se les quitó la unidad al reasignarla.
				vehiculosDesvinculados: liberados.map((v) => v.id),
				timestamp: vinculadoAt.toISOString(),
			});

			return {
				success: true,
				unitId: input.unitId,
				unitName: input.unitName,
				vinculadoAt,
			};
		}),

	/**
	 * Bitácora de consultas GPS para el panel /admin/gps (CB-118).
	 *
	 * Solo admin: la historia pide auditoría de "cada consulta", y esta es la
	 * vista global de TODOS los asesores, no la de uno solo. Un supervisor de
	 * cobros ya ve el motivo de SU PROPIA consulta en la ficha (queda impreso
	 * bajo la tarjeta tras confirmarlo) — esto es distinto: es fiscalización.
	 */
	getGpsBitacora: adminProcedure
		.input(gpsBitacoraInputSchema)
		.output(gpsBitacoraOutputSchema)
		.handler(async ({ input }) => {
			const offset = (input.page - 1) * input.perPage;
			// "Contiene" y no igualdad: el admin suele pegar un SIFCO parcial
			// (sin ceros iniciales, últimos dígitos). % y _ se escapan para que
			// se busquen literales y no como comodines de LIKE.
			const sifco = input.numeroCreditoSifco?.replace(/[\\%_]/g, "\\$&");
			const filtro = sifco
				? ilike(gpsConsultaLogs.numeroCreditoSifco, `%${sifco}%`)
				: undefined;

			const [filas, totalRows] = await Promise.all([
				db
					.select({
						id: gpsConsultaLogs.id,
						vehicleId: gpsConsultaLogs.vehicleId,
						numeroCreditoSifco: gpsConsultaLogs.numeroCreditoSifco,
						motivo: gpsConsultaLogs.motivo,
						unitId: gpsConsultaLogs.unitId,
						unitName: gpsConsultaLogs.unitName,
						userId: gpsConsultaLogs.userId,
						userNombre: user.name,
						userEmail: user.email,
						createdAt: gpsConsultaLogs.createdAt,
					})
					.from(gpsConsultaLogs)
					.leftJoin(user, eq(gpsConsultaLogs.userId, user.id))
					.where(filtro)
					.orderBy(desc(gpsConsultaLogs.createdAt))
					.limit(input.perPage)
					.offset(offset),
				db.select({ total: count() }).from(gpsConsultaLogs).where(filtro),
			]);

			return {
				total: totalRows[0]?.total ?? 0,
				page: input.page,
				perPage: input.perPage,
				items: filas.map((f) => ({
					...f,
					userNombre: f.userNombre ?? null,
					userEmail: f.userEmail ?? null,
				})),
			};
		}),
};
