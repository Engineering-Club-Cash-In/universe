/**
 * Controller para migración masiva de créditos
 * Endpoint REST directo para usar desde Postman
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { leads, opportunities, salesStages } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { carteraBackClient } from "../services/cartera-back-client";

// Tipo del crédito de entrada
interface CreditoInput {
	placa?: string | null;
	no_poliza_vehiculo?: string | null;
	marca?: string | null;
	linea_estilo?: string | null;
	tipo?: string | null;
	modelo?: string | null;
	motor?: string | null;
	chasis?: string | null;
	no_pasajeros?: string | null;
	uso?: string | null;
	fecha_alta?: string | null;
	vigencia_inicial?: string | null;
	vigencia_final?: string | null;
	suma_asegurada?: number | null;
	numero_prestamo?: string | null;
	fecha_de_pago?: number | null;
	nombre_del_cliente?: string | null;
	telefonos?: string[] | null;
	correo?: string | null;
	etapa_general?: string | null;
	cuotas_atrasadas?: number | null;
	cuotas_pagadas?: number | null;
	cuota_mensual?: number | null;
	tipo_de_prestamo?: string | null;
	asesor?: string | null;
	numero_poliza?: string | null;
	capital_cuota?: number | null;
	interes?: number | null;
	extra_financiamiento?: number | null;
	seguro_la_ceiba?: number | null;
	membresia_actual?: number | null;
	seguro_inrexsa?: number | null;
	poliza_inrexsa?: string | null;
	encontrado_en_cobros?: boolean | null;
	metodo_busqueda?: string | null;
}

// Resultado de la migración
interface MigrationResult {
	totalRecibidos: number;
	totalProcesados: number;
	totalExitosos: number;
	totalFallidos: number;
	totalIgnorados: number;
	errores: Array<{
		index: number;
		numeroPrestamo: string | null | undefined;
		error: string;
	}>;
	ignorados: Array<{
		index: number;
		razon: string;
	}>;
}

/**
 * Parsea el nombre completo en sus componentes
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

	if (partes.length === 1) {
		return {
			firstName: partes[0],
			middleName: null,
			lastName: "N/A",
			secondLastName: null,
		};
	}

	if (partes.length === 2) {
		return {
			firstName: partes[0],
			middleName: null,
			lastName: partes[1],
			secondLastName: null,
		};
	}

	if (partes.length === 3) {
		return {
			firstName: partes[0],
			middleName: null,
			lastName: partes[1],
			secondLastName: partes[2],
		};
	}

	return {
		firstName: partes[0],
		middleName: partes[1],
		lastName: partes[2],
		secondLastName: partes.slice(3).join(" "),
	};
}

/**
 * Convierte el tipo de préstamo al enum creditType
 */
function convertirTipoPrestamo(
	tipo: string | null | undefined,
): "autocompra" | "sobre_vehiculo" {
	if (!tipo) return "sobre_vehiculo";

	const tipoLower = tipo.toLowerCase();
	if (
		tipoLower.includes("autocompra") ||
		tipoLower.includes("auto compra") ||
		tipoLower.includes("compra")
	) {
		return "autocompra";
	}

	return "sobre_vehiculo";
}

/**
 * Convierte un valor a número de forma segura
 */
function toSafeNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const num = typeof value === "number" ? value : Number(value);
	return Number.isNaN(num) ? null : num;
}

/**
 * Formatea un número a string con 2 decimales de forma segura
 */
function formatNumber(value: unknown): string | null {
	const num = toSafeNumber(value);
	if (num === null) return null;
	return num.toFixed(2);
}

/**
 * Construye el campo notes de la oportunidad
 */
function construirNotesOportunidad(credito: CreditoInput): string {
	const partes: string[] = [];

	if (credito.asesor) {
		partes.push(`Asesor: ${credito.asesor}`);
	}

	const interes = formatNumber(credito.interes);
	if (interes) {
		partes.push(`Interés: Q${interes}`);
	}

	const seguroCeiba = formatNumber(credito.seguro_la_ceiba);
	if (seguroCeiba) {
		partes.push(`Seguro La Ceiba: Q${seguroCeiba}`);
	}

	const membresia = formatNumber(credito.membresia_actual);
	if (membresia) {
		partes.push(`Membresía Actual: Q${membresia}`);
	}

	const seguroInrexsa = formatNumber(credito.seguro_inrexsa);
	if (seguroInrexsa) {
		partes.push(`Seguro Inrexsa: Q${seguroInrexsa}`);
	}

	if (partes.length === 0) {
		return "Crédito migrado desde sistema anterior";
	}

	return `Crédito migrado desde sistema anterior.\n${partes.join("\n")}`;
}

/**
 * Parsea una fecha string a Date
 */
function parseFecha(fechaStr: string | null | undefined): Date | null {
	if (!fechaStr) return null;

	try {
		const fecha = new Date(fechaStr);
		if (Number.isNaN(fecha.getTime())) return null;
		return fecha;
	} catch {
		return null;
	}
}

/**
 * Procesa un crédito individual
 */
async function procesarCredito(
	credito: CreditoInput,
	defaultUserId: string,
	defaultStageId: string,
): Promise<{ success: boolean; error?: string; yaExiste?: boolean }> {
	try {
		// Verificar si ya existe
		if (credito.numero_prestamo) {
			const [existente] = await db
				.select({ id: opportunities.id })
				.from(opportunities)
				.where(eq(opportunities.numeroSifco, credito.numero_prestamo))
				.limit(1);

			if (existente) {
				return { success: false, yaExiste: true, error: "Ya existe" };
			}
		}

		const nombreParseado = parseNombreCompleto(credito.nombre_del_cliente);

		const telefono =
			credito.telefonos && credito.telefonos.length > 0
				? credito.telefonos.join(", ")
				: null;

		// 1. Crear Lead
		const [nuevoLead] = await db
			.insert(leads)
			.values({
				firstName: nombreParseado.firstName,
				middleName: nombreParseado.middleName,
				lastName: nombreParseado.lastName,
				secondLastName: nombreParseado.secondLastName,
				email: credito.correo || `migrado_${Date.now()}@placeholder.com`,
				phone: telefono,
				source: "other",
				status: "migrate",
				assignedTo: defaultUserId,
				createdBy: defaultUserId,
				notes: `Migrado desde sistema anterior. Número de préstamo: ${credito.numero_prestamo}`,
			})
			.returning({ id: leads.id });

		// 2. Crear Vehículo
		// Parsear año de forma segura (puede venir como "2015" o como número)
		let vehicleYear = 2000; // default
		if (credito.modelo) {
			const parsedYear = Number.parseInt(String(credito.modelo), 10);
			if (!Number.isNaN(parsedYear) && parsedYear > 1900 && parsedYear < 2100) {
				vehicleYear = parsedYear;
			}
		}

		// Parsear asientos de forma segura
		let vehicleSeats: number | null = null;
		if (credito.no_pasajeros) {
			const parsedSeats = Number.parseInt(String(credito.no_pasajeros), 10);
			if (!Number.isNaN(parsedSeats) && parsedSeats > 0) {
				vehicleSeats = parsedSeats;
			}
		}

		const [nuevoVehiculo] = await db
			.insert(vehicles)
			.values({
				make: credito.marca || "N/A",
				model: credito.linea_estilo || "N/A",
				year: vehicleYear,
				color: "N/A",
				vehicleType: credito.tipo || "N/A",
				licensePlate: credito.placa || null,
				motorNumber: credito.motor || null,
				series: credito.chasis || null,
				seats: vehicleSeats,
				vehicleUse: credito.uso || null,
				numeroPoliza: credito.no_poliza_vehiculo || null,
				fechaInicioSeguro: parseFecha(credito.vigencia_inicial),
				fechaVencimientoSeguro: parseFecha(credito.vigencia_final),
				montoAsegurado: credito.suma_asegurada
					? credito.suma_asegurada.toString()
					: null,
				status: "sold",
			})
			.returning({ id: vehicles.id });

		// 3. Crear Oportunidad
		await db.insert(opportunities).values({
			title: `Crédito ${credito.numero_prestamo}`,
			leadId: nuevoLead.id,
			vehicleId: nuevoVehiculo.id,
			creditType: convertirTipoPrestamo(credito.tipo_de_prestamo),
			stageId: defaultStageId,
			assignedTo: defaultUserId,
			createdBy: defaultUserId,
			status: "migrate",
			numeroSifco: credito.numero_prestamo || null,
			diaPagoMensual: credito.fecha_de_pago
				? Math.round(credito.fecha_de_pago)
				: null,
			cuotaMensual: credito.cuota_mensual
				? credito.cuota_mensual.toString()
				: null,
			notes: construirNotesOportunidad(credito),
		});

		return { success: true };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Error desconocido";
		return { success: false, error: errorMessage };
	}
}

/**
 * Función principal de migración
 */
export async function migrarCreditos(
	creditos: CreditoInput[],
): Promise<MigrationResult> {
	console.log(`[Migrate] Iniciando migración de ${creditos.length} créditos`);

	const resultado: MigrationResult = {
		totalRecibidos: creditos.length,
		totalProcesados: 0,
		totalExitosos: 0,
		totalFallidos: 0,
		totalIgnorados: 0,
		errores: [],
		ignorados: [],
	};

	if (!Array.isArray(creditos) || creditos.length === 0) {
		throw new Error("El array de créditos está vacío o no es válido");
	}

	// Obtener el primer usuario como default
	const [defaultUser] = await db.select({ id: user.id }).from(user).limit(1);

	if (!defaultUser) {
		throw new Error("No hay usuarios en el sistema para asignar los créditos");
	}

	// Obtener el primer stage como default
	const [defaultStage] = await db
		.select({ id: salesStages.id })
		.from(salesStages)
		.orderBy(asc(salesStages.order))
		.limit(1);

	if (!defaultStage) {
		throw new Error(
			"No hay etapas de venta configuradas para asignar los créditos",
		);
	}

	// Procesar cada crédito
	for (let i = 0; i < creditos.length; i++) {
		const credito = creditos[i];

		// Ignorar si encontrado_en_cobros es false
		if (credito.encontrado_en_cobros === false) {
			resultado.totalIgnorados++;
			resultado.ignorados.push({
				index: i,
				razon: "encontrado_en_cobros = false",
			});
			continue;
		}

		// Ignorar si no tiene numero_prestamo
		if (!credito.numero_prestamo) {
			resultado.totalIgnorados++;
			resultado.ignorados.push({
				index: i,
				razon: "Sin número de préstamo",
			});
			continue;
		}

		resultado.totalProcesados++;
		const resultadoProceso = await procesarCredito(
			credito,
			defaultUser.id,
			defaultStage.id,
		);

		if (resultadoProceso.success) {
			resultado.totalExitosos++;
		} else if (resultadoProceso.yaExiste) {
			resultado.totalIgnorados++;
			resultado.ignorados.push({
				index: i,
				razon: `numeroSifco ${credito.numero_prestamo} ya existe en BD`,
			});
		} else {
			resultado.totalFallidos++;
			resultado.errores.push({
				index: i,
				numeroPrestamo: credito.numero_prestamo,
				error: resultadoProceso.error || "Error desconocido",
			});
		}
	}

	console.log(
		`[Migrate] Completado: ${resultado.totalExitosos} exitosos, ${resultado.totalFallidos} fallidos, ${resultado.totalIgnorados} ignorados`,
	);

	return resultado;
}

// Resultado de la actualización de values
interface UpdateValueResult {
	totalEncontradas: number;
	totalActualizadas: number;
	totalFallidas: number;
	totalSinSifco: number;
	actualizaciones: Array<{
		opportunityId: string;
		numeroSifco: string;
		valueAnterior: string | null;
		valueNuevo: string;
	}>;
	errores: Array<{
		opportunityId: string;
		numeroSifco: string | null;
		error: string;
	}>;
}

/**
 * Pequeña pausa para evitar sobrecargar cartera-back
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Actualiza el campo value de las oportunidades en estado "migrate" sin value
 * consultando la deuda total desde cartera-back
 */
export async function actualizarValueOportunidades(): Promise<UpdateValueResult> {
	console.log(
		"[UpdateValue] Iniciando actualización de values de oportunidades migradas",
	);

	const resultado: UpdateValueResult = {
		totalEncontradas: 0,
		totalActualizadas: 0,
		totalFallidas: 0,
		totalSinSifco: 0,
		actualizaciones: [],
		errores: [],
	};

	// Buscar oportunidades con status "migrate" y sin value
	const oportunidadesSinValue = await db
		.select({
			id: opportunities.id,
			numeroSifco: opportunities.numeroSifco,
			value: opportunities.value,
		})
		.from(opportunities)
		.where(
			and(eq(opportunities.status, "migrate"), isNull(opportunities.value)),
		);

	resultado.totalEncontradas = oportunidadesSinValue.length;
	console.log(
		`[UpdateValue] Encontradas ${resultado.totalEncontradas} oportunidades sin value`,
	);

	// Delay entre peticiones para no sobrecargar cartera-back (500ms)
	const DELAY_BETWEEN_REQUESTS = 500;

	for (let i = 0; i < oportunidadesSinValue.length; i++) {
		const oportunidad = oportunidadesSinValue[i];

		// Agregar delay entre peticiones (excepto la primera)
		if (i > 0) {
			await delay(DELAY_BETWEEN_REQUESTS);
		}

		// Log de progreso cada 10 oportunidades
		if (i > 0 && i % 10 === 0) {
			console.log(
				`[UpdateValue] Progreso: ${i}/${oportunidadesSinValue.length} procesadas...`,
			);
		}

		// Si no tiene numeroSifco, no podemos consultar cartera
		if (!oportunidad.numeroSifco) {
			resultado.totalSinSifco++;
			resultado.errores.push({
				opportunityId: oportunidad.id,
				numeroSifco: null,
				error: "No tiene número SIFCO",
			});
			continue;
		}

		try {
			// Consultar cartera-back para obtener la deuda total
			const creditoData = await carteraBackClient.getCredito(
				oportunidad.numeroSifco,
			);

			if (!creditoData?.credito?.deudatotal) {
				resultado.totalFallidas++;
				resultado.errores.push({
					opportunityId: oportunidad.id,
					numeroSifco: oportunidad.numeroSifco,
					error: "No se encontró deudatotal en la respuesta de cartera",
				});
				continue;
			}

			const deudaTotal = creditoData.credito.deudatotal;

			// Actualizar el value de la oportunidad
			await db
				.update(opportunities)
				.set({ value: deudaTotal })
				.where(eq(opportunities.id, oportunidad.id));

			resultado.totalActualizadas++;
			resultado.actualizaciones.push({
				opportunityId: oportunidad.id,
				numeroSifco: oportunidad.numeroSifco,
				valueAnterior: oportunidad.value,
				valueNuevo: deudaTotal,
			});

			console.log(
				`[UpdateValue] Actualizada oportunidad ${oportunidad.id}: value=${deudaTotal}`,
			);
		} catch (error) {
			resultado.totalFallidas++;
			const errorMessage =
				error instanceof Error ? error.message : "Error desconocido";
			resultado.errores.push({
				opportunityId: oportunidad.id,
				numeroSifco: oportunidad.numeroSifco,
				error: errorMessage,
			});
			console.error(
				`[UpdateValue] Error actualizando ${oportunidad.id}:`,
				errorMessage,
			);
		}
	}

	console.log(
		`[UpdateValue] Completado: ${resultado.totalActualizadas} actualizadas, ${resultado.totalFallidas} fallidas, ${resultado.totalSinSifco} sin SIFCO`,
	);

	return resultado;
}
