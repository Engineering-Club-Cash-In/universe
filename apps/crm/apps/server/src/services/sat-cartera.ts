import { desc, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { opportunities, vehicles } from "../db/schema";
import { carteraBackClient } from "./cartera-back-client";
import { clavesPlaca, normalizarPlaca } from "./placas";

export const ESTADOS_CREDITO_OPERATIVOS = [
	"ACTIVO",
	"MOROSO",
	"EN_CONVENIO",
] as const;

export type EstadoCreditoOperativo =
	(typeof ESTADOS_CREDITO_OPERATIVOS)[number];
export type CruceCartera = "con_credito" | "disponible" | "sin_registro";

export interface CreditoCarteraVehiculo {
	numeroSifco: string;
	nombreCliente: string;
	estado: EstadoCreditoOperativo;
	fechaCreacion: Date | null;
}

export interface VehiculoCarteraEsperado {
	id: string;
	placa: string | null;
	cruceCartera: Exclude<CruceCartera, "sin_registro">;
	titularCarteraNombre: string | null;
	numeroSifco: string | null;
	estadoCredito: EstadoCreditoOperativo | null;
	fechaCredito: Date | null;
	estaDisponible: boolean;
}

export interface ConflictoCreditosCartera {
	vehicleId: string;
	creditos: CreditoCarteraVehiculo[];
}

export interface ContextoCarteraVehiculos {
	esperados: VehiculoCarteraEsperado[];
	porVehiculo: Map<string, VehiculoCarteraEsperado>;
	porPlaca: Map<string, VehiculoCarteraEsperado>;
	porSufijoPlaca: Map<string, VehiculoCarteraEsperado>;
	conflictos: ConflictoCreditosCartera[];
}

interface OportunidadCrmRow {
	numeroSifco: string | null;
	vehicleId: string | null;
	updatedAt: Date | null;
}

interface VehiculoCrmRow {
	id: string;
	placa: string | null;
	estado: string;
}

function estadoCreditoValido(
	estado: string | null,
): estado is EstadoCreditoOperativo {
	return (ESTADOS_CREDITO_OPERATIVOS as readonly string[]).includes(
		estado ?? "",
	);
}

function fechaComoDate(value: Date | string | null): Date | null {
	if (!value) return null;
	const fecha = value instanceof Date ? value : new Date(value);
	return Number.isNaN(fecha.getTime()) ? null : fecha;
}

function prioridadEstado(estado: EstadoCreditoOperativo): number {
	if (estado === "ACTIVO") return 3;
	if (estado === "MOROSO") return 2;
	return 1;
}

export function compararCreditosCartera(
	a: CreditoCarteraVehiculo,
	b: CreditoCarteraVehiculo,
): number {
	const diferenciaEstado =
		prioridadEstado(b.estado) - prioridadEstado(a.estado);
	if (diferenciaEstado !== 0) return diferenciaEstado;

	const fechaA = a.fechaCreacion?.getTime() ?? 0;
	const fechaB = b.fechaCreacion?.getTime() ?? 0;
	return fechaB - fechaA;
}

export function seleccionarCreditoCartera(
	creditos: CreditoCarteraVehiculo[],
): CreditoCarteraVehiculo | null {
	return [...creditos].sort(compararCreditosCartera)[0] ?? null;
}

async function obtenerCreditosOperativos(): Promise<CreditoCarteraVehiculo[]> {
	const rows = await carteraBackClient.getCreditosOperativosParaSat();

	return rows.flatMap((row) => {
		if (
			!row.numeroCreditoSifco ||
			!row.nombreCliente ||
			!estadoCreditoValido(row.estado)
		) {
			return [];
		}
		return [
			{
				numeroSifco: row.numeroCreditoSifco.trim(),
				nombreCliente: row.nombreCliente.trim(),
				estado: row.estado,
				fechaCreacion: fechaComoDate(row.fechaCreacion),
			},
		];
	});
}

function registrarMejorOportunidad(
	mapa: Map<string, OportunidadCrmRow>,
	oportunidad: OportunidadCrmRow,
) {
	const sifco = oportunidad.numeroSifco?.trim();
	if (!sifco || !oportunidad.vehicleId) return;
	const existente = mapa.get(sifco);
	if (
		!existente ||
		(existente.updatedAt?.getTime() ?? 0) <
			(oportunidad.updatedAt?.getTime() ?? 0)
	) {
		mapa.set(sifco, oportunidad);
	}
}

export async function obtenerContextoCarteraVehiculos(): Promise<ContextoCarteraVehiculos> {
	const [creditos, oportunidades, vehiculos] = await Promise.all([
		obtenerCreditosOperativos(),
		db
			.select({
				numeroSifco: opportunities.numeroSifco,
				vehicleId: opportunities.vehicleId,
				updatedAt: opportunities.updatedAt,
			})
			.from(opportunities)
			.where(isNotNull(opportunities.numeroSifco))
			.orderBy(desc(opportunities.updatedAt)),
		db
			.select({
				id: vehicles.id,
				placa: vehicles.licensePlate,
				estado: vehicles.status,
			})
			.from(vehicles),
	]);

	const oportunidadesPorSifco = new Map<string, OportunidadCrmRow>();
	for (const oportunidad of oportunidades) {
		registrarMejorOportunidad(oportunidadesPorSifco, oportunidad);
	}

	const creditosPorVehiculo = new Map<string, CreditoCarteraVehiculo[]>();
	for (const credito of creditos) {
		const oportunidad = oportunidadesPorSifco.get(credito.numeroSifco);
		if (!oportunidad?.vehicleId) continue;
		const agrupados = creditosPorVehiculo.get(oportunidad.vehicleId) ?? [];
		agrupados.push(credito);
		creditosPorVehiculo.set(oportunidad.vehicleId, agrupados);
	}

	const conflictos = [...creditosPorVehiculo.entries()]
		.filter(([, agrupados]) => agrupados.length > 1)
		.map(([vehicleId, agrupados]) => ({
			vehicleId,
			creditos: [...agrupados].sort(compararCreditosCartera),
		}));

	const esperados: VehiculoCarteraEsperado[] = [];
	for (const vehiculo of vehiculos as VehiculoCrmRow[]) {
		const creditosDelVehiculo = creditosPorVehiculo.get(vehiculo.id) ?? [];
		const credito = seleccionarCreditoCartera(creditosDelVehiculo);
		const estaDisponible = vehiculo.estado === "available";
		if (!estaDisponible && !credito) continue;

		esperados.push({
			id: vehiculo.id,
			placa: vehiculo.placa,
			cruceCartera: credito ? "con_credito" : "disponible",
			titularCarteraNombre: credito?.nombreCliente ?? null,
			numeroSifco: credito?.numeroSifco ?? null,
			estadoCredito: credito?.estado ?? null,
			fechaCredito: credito?.fechaCreacion ?? null,
			estaDisponible,
		});
	}

	const porVehiculo = new Map(
		esperados.map((vehiculo) => [vehiculo.id, vehiculo]),
	);
	const porPlaca = new Map<string, VehiculoCarteraEsperado>();
	const porSufijoPlaca = new Map<string, VehiculoCarteraEsperado>();
	for (const esperado of esperados) {
		const placa = normalizarPlaca(esperado.placa);
		if (placa) porPlaca.set(placa, esperado);
		for (const sufijo of clavesPlaca(esperado.placa)) {
			if (!porSufijoPlaca.has(sufijo)) {
				porSufijoPlaca.set(sufijo, esperado);
			}
		}
	}

	return { esperados, porVehiculo, porPlaca, porSufijoPlaca, conflictos };
}
