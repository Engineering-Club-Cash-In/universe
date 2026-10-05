import type { CreditoDirectoResponse } from "../types/cartera-back";
import { calcularDiasMoraExactos, diasMoraDelDetalle } from "./mora-utils";

/**
 * Construir el objeto caso para la API de cobros desde la respuesta de cartera-back.
 *
 * Extrae la lógica de construcción del objeto para facilitar testing y reutilización.
 * Incluye:
 * - Cuotas de todas las categorías (pagadas, pendientes, atrasadas)
 * - Cálculo de días de mora (usa diasAtrasoMoraMaximo de cartera o recalcula)
 * - Monto de mora actual
 * - Monto de mora pagada (si cartera lo proporciona)
 */
export function buildCasoFromCartera(creditoData: CreditoDirectoResponse) {
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
		// Días REALES de atraso (cuota vencida más antigua). Acá SÍ vienen
		// las fechas de vencimiento, así que se calculan exactos en vez de
		// aproximar a 30 por cuota, que contradice al monto proporcional.
		diasMora: diasMoraDelDetalle(
			creditoData.diasAtrasoMoraMaximo,
			() => calcularDiasMoraExactos(creditoData.cuotasAtrasadas || []),
		),
		montoMora: creditoData.moraActual, // ya es string
		moraPagada: creditoData.moraPagada,
		moraCondonada: creditoData.moraCondonada,
		cuotasAtrasadas: creditoData.cuotasAtrasadas?.length || 0,
	};
}
