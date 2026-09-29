import { ORPCError } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "../db";
import { opportunities } from "../db/schema/crm";
import {
	opportunityAgencySellers,
	partnerMembers,
} from "../db/schema/partners";
import { vehicles, vehicleVendors } from "../db/schema/vehicles";

/**
 * Vendedores de agencia/predio: viven en `vehicle_vendors` con
 * `vendorType = 'agencia'`, pero no son el vendedor legal del carro (ese es
 * `opportunities.vendorId`, que sale en el contrato). Sirven para acotar qué
 * ve cada usuario del tracker.
 */
export const VENDOR_TYPES = ["individual", "empresa", "agencia"] as const;
export type VendorType = (typeof VENDOR_TYPES)[number];

export const TIPO_VENDEDOR_AGENCIA = "agencia" satisfies VendorType;

export function esVendedorDeAgencia(vendor: {
	vendorType: string | null | undefined;
}): boolean {
	return vendor.vendorType === TIPO_VENDEDOR_AGENCIA;
}

export interface DatosVendedor {
	vendorType: VendorType;
	dpi?: string | null;
	companyId?: string | null;
	email?: string | null;
}

export function erroresDeVendedor(
	data: DatosVendedor,
): { path: "dpi" | "companyId" | "email"; message: string }[] {
	const dpi = data.dpi?.trim() ?? "";
	const errores: { path: "dpi" | "companyId" | "email"; message: string }[] =
		[];

	if (dpi && dpi.length !== 13) {
		errores.push({ path: "dpi", message: "DPI debe tener 13 dígitos" });
	}

	if (data.vendorType === TIPO_VENDEDOR_AGENCIA) {
		if (!data.companyId) {
			errores.push({
				path: "companyId",
				message: "Selecciona la agencia o predio del vendedor",
			});
		}
		if (!data.email?.trim()) {
			errores.push({
				path: "email",
				message: "El correo es requerido para un vendedor de agencia",
			});
		}
	} else if (!dpi) {
		errores.push({ path: "dpi", message: "DPI debe tener 13 dígitos" });
	}

	return errores;
}

/** Lo que se guarda: solo 'agencia' lleva companyId y puede ir sin DPI. */
export function normalizarDatosVendedor<T extends DatosVendedor>(data: T) {
	const esAgencia = data.vendorType === TIPO_VENDEDOR_AGENCIA;
	return {
		...data,
		dpi: data.dpi?.trim() || null,
		companyId: esAgencia ? (data.companyId ?? null) : null,
	};
}

export function vendedorSigueValido(
	sellerCompanyId: string | null | undefined,
	nuevaCompanyId: string | null | undefined,
): boolean {
	return !!sellerCompanyId && sellerCompanyId === nuevaCompanyId;
}

export interface MembresiaInput {
	companyId: string;
	sellerId?: string | null;
}

/**
 * Error de una asignación de agencias a un usuario del tracker, o null si es
 * válida. Cada vendedor tiene que ser de agencia y de esa misma company.
 */
export function errorDeMembresias(
	membresias: MembresiaInput[],
	vendedores: { id: string; vendorType: string; companyId: string | null }[],
): string | null {
	const companyIds = membresias.map((m) => m.companyId);
	if (new Set(companyIds).size !== companyIds.length) {
		return "Una agencia está repetida en la asignación";
	}

	const porId = new Map(vendedores.map((v) => [v.id, v]));
	for (const m of membresias) {
		if (!m.sellerId) continue;
		const vendedor = porId.get(m.sellerId);
		if (!vendedor || !esVendedorDeAgencia(vendedor)) {
			return "Alguno de los vendedores seleccionados ya no existe o no es de agencia";
		}
		if (vendedor.companyId !== m.companyId) {
			return "Un vendedor asignado no pertenece a la agencia seleccionada";
		}
	}
	return null;
}

type Tx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MENSAJE_VENDEDOR_LEGAL_DE_AGENCIA =
	"Un vendedor de agencia no puede ser el vendedor del vehículo en el contrato";

/**
 * Toda ruta que escriba `opportunities.vendorId` pasa por aquí: ese campo sale
 * en el contrato y un vendedor de agencia nunca es el vendedor legal.
 *
 * Hay que llamarla dentro de la misma transacción que la escritura: el
 * FOR SHARE retiene la fila del vendedor hasta el commit, así `vendors.update`
 * (que la toma FOR UPDATE antes de revisar usos) no puede convertirlo en
 * agencia en medio.
 *
 * Orden de bloqueo común a todas las rutas: primero la oportunidad, después el
 * vendedor. Si la transacción va a escribir la fila del vendedor, no usar esto
 * (FOR SHARE → UPDATE se interbloquea); tomarla FOR NO KEY UPDATE.
 */
export async function asegurarVendedorLegal(
	tx: Tx,
	vendorId: string | null | undefined,
): Promise<void> {
	if (!vendorId) return;
	const [vendedor] = await tx
		.select({ vendorType: vehicleVendors.vendorType })
		.from(vehicleVendors)
		.where(eq(vehicleVendors.id, vendorId))
		.for("share")
		.limit(1);
	if (vendedor && esVendedorDeAgencia(vendedor)) {
		throw new ORPCError("BAD_REQUEST", {
			message: MENSAJE_VENDEDOR_LEGAL_DE_AGENCIA,
		});
	}
}

/**
 * Dónde se usa un vendedor: como vendedor legal o como vendedor de agencia.
 * Para que el resultado no quede viejo, llamarla con la fila del vendedor ya
 * tomada FOR UPDATE en la misma transacción.
 */
export async function usosDelVendedor(tx: Tx, vendorId: string) {
	const [legal] = await tx
		.select({ id: opportunities.id })
		.from(opportunities)
		.where(eq(opportunities.vendorId, vendorId))
		.limit(1);
	const [legalVehiculo] = await tx
		.select({ id: vehicles.id })
		.from(vehicles)
		.where(eq(vehicles.vendorId, vendorId))
		.limit(1);
	const [enOportunidad] = await tx
		.select({ id: opportunityAgencySellers.id })
		.from(opportunityAgencySellers)
		.where(eq(opportunityAgencySellers.sellerId, vendorId))
		.limit(1);
	const [enTracker] = await tx
		.select({ id: partnerMembers.id })
		.from(partnerMembers)
		.where(eq(partnerMembers.sellerId, vendorId))
		.limit(1);
	return {
		comoVendedorLegal: !!legal || !!legalVehiculo,
		comoVendedorDeAgencia: !!enOportunidad || !!enTracker,
	};
}

/**
 * Error de un cambio de tipo/agencia sobre un vendedor ya usado, o null.
 * Convertir un vendedor legal en uno de agencia (o al revés) dejaría
 * contratos u oportunidades del tracker apuntando a datos que ya no aplican.
 */
export function errorDeCambioDeVendedor(
	actual: { vendorType: string; companyId: string | null },
	nuevo: { vendorType: string; companyId: string | null },
	usos: { comoVendedorLegal: boolean; comoVendedorDeAgencia: boolean },
): string | null {
	const eraAgencia = actual.vendorType === TIPO_VENDEDOR_AGENCIA;
	const seraAgencia = nuevo.vendorType === TIPO_VENDEDOR_AGENCIA;

	if (!eraAgencia && seraAgencia && usos.comoVendedorLegal) {
		return "No se puede convertir en vendedor de agencia a un vendedor que ya es vendedor del vehículo en oportunidades";
	}
	if (
		eraAgencia &&
		usos.comoVendedorDeAgencia &&
		(!seraAgencia || actual.companyId !== nuevo.companyId)
	) {
		return "No se puede cambiar la agencia ni el tipo de un vendedor que ya tiene oportunidades o usuarios del tracker asignados";
	}
	return null;
}

/**
 * Quita el vendedor de agencia si ya no es de la agencia **vigente** de la
 * oportunidad. La comparación va dentro del mismo DELETE, contra el estado
 * actual de la fila, y no contra un valor leído antes: con dos cambios
 * seguidos (A→B y B→A) una limpieza atrasada no puede borrar una asignación
 * que volvió a ser válida. Devuelve true si quitó algo.
 */
export async function limpiarVendedorSiCambiaAgencia(
	tx: Tx,
	opportunityId: string,
): Promise<boolean> {
	const borradas = await tx
		.delete(opportunityAgencySellers)
		.where(
			and(
				eq(opportunityAgencySellers.opportunityId, opportunityId),
				sql`exists (
					select 1
					from ${vehicleVendors} v
					join ${opportunities} o on o.id = ${opportunityAgencySellers.opportunityId}
					where v.id = ${opportunityAgencySellers.sellerId}
					  and v.company_id is distinct from o.company_id
				)`,
			),
		)
		.returning({ id: opportunityAgencySellers.id });
	return borradas.length > 0;
}
