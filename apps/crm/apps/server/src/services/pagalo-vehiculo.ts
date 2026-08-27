import { eq } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";

export type VehiculoCredito = {
	vehiculoMarca: string | null;
	vehiculoModelo: string | null;
	vehiculoYear: number | null;
	vehiculoPlaca: string | null;
};

/**
 * Vehículo de un caso de cobro para el mensaje de Págalo — usado TANTO por
 * el preview (getVehiculoCasoPagalo, cobros.ts) COMO por createPagaloLinks
 * (pagalo-link-orchestrator.ts) para que ambos textos coincidan siempre.
 *
 * Prioriza casosCobros.contratoId -> contratosFinanciamiento.vehicleId
 * (fuente más confiable/actualizada). Casos migrados de cartera-back sin
 * flujo de originación completo no tienen contratoId (caso real:
 * 01010214109410) — en ese caso cae a opportunities.vehicleId por
 * numeroSifco, la misma fuente que usa getDetallesCreditoCarteraBack para
 * el header del caso (hallazgo de Codex, PR #1470).
 */
export async function resolverVehiculoCasoPagalo(
	casoCobroId: string,
): Promise<VehiculoCredito | null> {
	const [fila] = await db
		.select({
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
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
		.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	if (!fila) return null;
	if (fila.vehiculoMarca && fila.vehiculoPlaca) return fila;
	if (!fila.numeroCreditoSifco) return fila;

	const [porOportunidad] = await db
		.select({
			vehiculoMarca: vehicles.make,
			vehiculoModelo: vehicles.model,
			vehiculoYear: vehicles.year,
			vehiculoPlaca: vehicles.licensePlate,
		})
		.from(opportunities)
		.leftJoin(vehicles, eq(opportunities.vehicleId, vehicles.id))
		.where(eq(opportunities.numeroSifco, fila.numeroCreditoSifco))
		.limit(1);
	return porOportunidad?.vehiculoMarca ? porOportunidad : fila;
}

/** "vehículo {marca modelo año} · {placa}" si está cargado, si no "crédito {sifco}". */
export function construirIdentificadorCredito(
	vehiculo: VehiculoCredito | null,
	numeroSifco: string,
): string {
	if (!vehiculo?.vehiculoMarca || !vehiculo?.vehiculoPlaca)
		return `crédito ${numeroSifco}`;
	const descripcion = [
		vehiculo.vehiculoMarca,
		vehiculo.vehiculoModelo,
		vehiculo.vehiculoYear,
	]
		.filter(Boolean)
		.join(" ");
	return `vehículo ${descripcion} · ${vehiculo.vehiculoPlaca}`;
}
