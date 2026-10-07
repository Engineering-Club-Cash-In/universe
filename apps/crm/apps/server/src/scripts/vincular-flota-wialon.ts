/**
 * Diagnóstico y vinculación del vehículo ↔ unidad de Wialon para toda la
 * flota. Lee el catálogo de Wialon y los vehículos del CRM, cruza por placa y
 * por VIN (ver vincular-flota-wialon.logic.ts) e imprime un resumen. Además
 * deja CSV para revisar caso por caso:
 *
 *   <salida>/vehiculos.csv  un renglón por vehículo del CRM
 *   <salida>/unidades.csv   un renglón por unidad de Wialon
 *   <salida>/plan.csv       los vínculos que se escribirían (o se escribieron)
 *
 * Por defecto es SOLO LECTURA. Con --aplicar escribe el plan (ver
 * vincular-flota-wialon.plan.ts) y deja además resultado.csv y reversa.sql.
 *
 *   bun run src/scripts/vincular-flota-wialon.ts
 *   bun run src/scripts/vincular-flota-wialon.ts --solo-con-credito
 *   bun run src/scripts/vincular-flota-wialon.ts --salida=/tmp/diag-wialon
 *   bun run src/scripts/vincular-flota-wialon.ts --aplicar --confirmar-bd=<host>
 *
 * Opciones de escritura:
 *   --aplicar             Escribe los vínculos propuestos.
 *   --confirmar-bd=<host> Host de DATABASE_URL tecleado a propósito. Producción
 *                         se rechaza siempre.
 *   --incluir-confirmar   Incluye los desempates de duplicados sin crédito
 *                         vigente (por defecto quedan para revisión).
 *   --max=<n>             Escribe solo los primeros n (tanda de prueba).
 *
 * A diferencia de vincular-unidades-wialon.ts (que solo cruza por placa en el
 * nombre), aquí también cuenta el VIN: ~330 unidades se nombran por VIN porque
 * el carro aún no tenía placa cuando se instaló el GPS.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { auditRecord, runWithAudit } from "../lib/audit";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import { getWialonClient } from "../services/wialon/wialon-client";
import {
	aplanarCamposUnidad,
	type CreditoVehiculo,
	celdaCsv,
	diagnosticar,
	type EstadoUnidad,
	type EstadoVehiculo,
	type UnidadWialon,
	type VehiculoCrm,
} from "./vincular-flota-wialon.logic";
import {
	aplicarPlan,
	destinoBd,
	type Escritor,
	type ItemVinculo,
	planificar,
	sqlReversa,
	validarDestinoParaEscribir,
} from "./vincular-flota-wialon.plan";

const argv = Bun.argv.slice(2);
const opcion = (nombre: string) =>
	argv.find((a) => a.startsWith(`--${nombre}=`))?.slice(nombre.length + 3);
const soloConCredito = argv.includes("--solo-con-credito");
const aplicar = argv.includes("--aplicar");
const incluirConfirmar = argv.includes("--incluir-confirmar");
const maxTexto = opcion("max");
const max = maxTexto === undefined ? undefined : Number(maxTexto);
if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
	console.error(`--max inválido: ${maxTexto}`);
	process.exit(1);
}
const salida =
	opcion("salida") ??
	`diagnostico-wialon-${new Date().toISOString().slice(0, 10)}`;

// Antes de leer nada: si se pidió escribir y el destino no vale, ni empezar.
const destino = destinoBd(process.env.DATABASE_URL);
if (aplicar) {
	const validacion = validarDestinoParaEscribir(
		destino,
		opcion("confirmar-bd"),
	);
	if (!validacion.ok) {
		console.error(validacion.motivo);
		process.exit(1);
	}
}

/** SIFCO de cada vehículo: el de su oportunidad y el de su contrato/caso. */
async function sifcosPorVehiculo(): Promise<Map<string, Set<string>>> {
	const [porOportunidad, porContrato] = await Promise.all([
		db
			.selectDistinct({
				id: opportunities.vehicleId,
				sifco: opportunities.numeroSifco,
			})
			.from(opportunities)
			.where(
				and(
					isNotNull(opportunities.vehicleId),
					isNotNull(opportunities.numeroSifco),
				),
			),
		db
			.selectDistinct({
				id: contratosFinanciamiento.vehicleId,
				sifco: casosCobros.numeroCreditoSifco,
			})
			.from(casosCobros)
			.innerJoin(
				contratosFinanciamiento,
				eq(contratosFinanciamiento.id, casosCobros.contratoId),
			)
			.where(isNotNull(contratosFinanciamiento.vehicleId)),
	]);
	const mapa = new Map<string, Set<string>>();
	for (const { id, sifco } of [...porOportunidad, ...porContrato]) {
		if (!id) continue;
		const set = mapa.get(id) ?? new Set<string>();
		if (sifco?.trim()) set.add(sifco.trim());
		mapa.set(id, set);
	}
	return mapa;
}

/**
 * Estado y fecha de cada SIFCO en cartera-back (solo lectura). Null si
 * cartera-back está apagado o falla: sin estados, las disputas entre
 * vehículos duplicados quedan en revisión manual en vez de resolverse a ciegas.
 */
async function estadosEnCartera(
	sifcos: string[],
): Promise<Map<string, { estado: string; fecha: string | null }> | null> {
	if (!isCarteraBackEnabled()) {
		console.warn("cartera-back deshabilitado: las disputas no se desempatan.");
		return null;
	}
	const mapa = new Map<string, { estado: string; fecha: string | null }>();
	try {
		for (let i = 0; i < sifcos.length; i += 500) {
			const tanda = sifcos.slice(i, i + 500);
			const creditos = await fetchAllPages(
				(page) =>
					carteraBackClient.getAllCreditos({
						// mes/anio en 0 = sin filtro por fecha de creación.
						mes: 0,
						anio: 0,
						numeros_credito_sifco: tanda,
						page,
						perPage: 1000,
					}),
				{ concurrency: 2 },
			);
			for (const { creditos: c } of creditos) {
				if (c?.numero_credito_sifco) {
					mapa.set(c.numero_credito_sifco, {
						estado: c.statusCredit,
						fecha: c.fecha_creacion ?? null,
					});
				}
			}
		}
		return mapa;
	} catch (error) {
		console.warn(
			"No se pudo consultar cartera-back: las disputas no se desempatan.",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	}
}

// 8388609 = básico (id, nombre) + campos del vehículo (pflds: vin,
// registration_plate, …). Mismo valor que el ejemplo de la colección de LEGION.
const respuesta = await getWialonClient().searchUnits({ flags: 8388609 });
const unidades: UnidadWialon[] = respuesta.items.map((u) => ({
	id: u.id,
	nm: u.nm,
	campos: aplanarCamposUnidad(u.pflds),
}));

const sifcos = await sifcosPorVehiculo();
const cartera = await estadosEnCartera([
	...new Set([...sifcos.values()].flatMap((s) => [...s])),
]);
const filas = await db
	.select({
		id: vehicles.id,
		placa: vehicles.licensePlate,
		vin: vehicles.vinNumber,
		wialonUnitId: vehicles.wialonUnitId,
		vinculadoPor: vehicles.wialonVinculadoPor,
	})
	.from(vehicles);
const vehiculos: VehiculoCrm[] = filas.map((f) => {
	const propios = [...(sifcos.get(f.id) ?? [])];
	// Sin cartera no se arma la lista: las disputas quedan para revisión.
	const creditos: CreditoVehiculo[] | undefined = cartera
		? propios.map((sifco) => ({
				sifco,
				estado: cartera.get(sifco)?.estado ?? null,
				fechaCreacion: cartera.get(sifco)?.fecha ?? null,
			}))
		: undefined;
	return { ...f, conCredito: propios.length > 0, creditos };
});

// Con --solo-con-credito se cruza igual toda la flota (unidades ocupadas y
// duplicados salen de todos los vehículos); solo se filtra lo que se reporta.
const diag = diagnosticar(unidades, vehiculos, { soloConCredito });

// ── Resumen ──────────────────────────────────────────────────────────────────
const contar = <T extends string>(valores: T[]) => {
	const m = new Map<T, number>();
	for (const v of valores) m.set(v, (m.get(v) ?? 0) + 1);
	return m;
};
const porEstado = contar<EstadoVehiculo>(diag.vehiculos.map((r) => r.estado));
const porMetodo = contar(
	diag.vehiculos.flatMap((r) =>
		r.estado === "propuesto" && r.metodo ? [r.metodo] : [],
	),
);
const porEstadoUnidad = contar<EstadoUnidad>(
	diag.unidades.map((r) => r.estado),
);
const conCreditoPorEstado = contar<EstadoVehiculo>(
	diag.vehiculos.filter((r) => r.vehiculo.conCredito).map((r) => r.estado),
);

const etiquetas: Record<EstadoVehiculo, string> = {
	vinculado_confirmado: "Ya vinculado y la evidencia lo confirma",
	vinculado_sin_evidencia: "Ya vinculado, sin placa/VIN que lo respalde",
	vinculado_contradice: "Ya vinculado, pero la evidencia apunta a OTRA unidad",
	vinculado_unidad_inexistente:
		"Ya vinculado a una unidad que no está en Wialon",
	propuesto: "SE VINCULARÍA",
	conflicto_placa_vin: "Placa y VIN apuntan a unidades distintas",
	ambiguo: "Varias unidades coinciden",
	unidad_ya_asignada: "La unidad ya está en otro vehículo",
	unidad_disputada: "Varios vehículos reclaman la misma unidad",
	duplicado_descartado: "Duplicado: otro vehículo se queda con la unidad",
	sin_coincidencia: "Sin unidad con esa placa ni VIN",
	sin_placa_ni_vin: "Sin placa ni VIN válidos",
};

console.log(
	`DIAGNÓSTICO (solo lectura) · ${unidades.length} unidades en Wialon · ${diag.vehiculos.length} vehículos en el CRM${soloConCredito ? ` (solo con crédito, de ${vehiculos.length})` : ""}`,
);
console.log(
	"\nVehículos por estado                                  total  con crédito",
);
for (const estado of Object.keys(etiquetas) as EstadoVehiculo[]) {
	const n = porEstado.get(estado) ?? 0;
	if (!n) continue;
	console.log(
		`  ${etiquetas[estado].padEnd(52)} ${String(n).padStart(5)}  ${String(conCreditoPorEstado.get(estado) ?? 0).padStart(5)}`,
	);
}
console.log("\nPropuestos por método:");
for (const [metodo, n] of porMetodo) console.log(`  ${metodo.padEnd(20)} ${n}`);
console.log(
	`  (con sugerencia para revisión manual: ${diag.vehiculos.filter((r) => r.sugerencia).length})`,
);
console.log("\nUnidades de Wialon:");
for (const [estado, n] of porEstadoUnidad)
	console.log(`  ${estado.padEnd(20)} ${n}`);

const vinculadas =
	(porEstado.get("vinculado_confirmado") ?? 0) +
	(porEstado.get("vinculado_sin_evidencia") ?? 0) +
	(porEstado.get("vinculado_contradice") ?? 0);
console.log(
	`\nCobertura de unidades: hoy ${vinculadas} con vehículo; tras aplicar las propuestas, ${vinculadas + (porEstado.get("propuesto") ?? 0)} de ${unidades.length}.`,
);

// ── CSV ──────────────────────────────────────────────────────────────────────
mkdirSync(salida, { recursive: true });
const csv = (encabezado: string[], renglones: unknown[][]) =>
	[encabezado, ...renglones].map((r) => r.map(celdaCsv).join(",")).join("\n");

writeFileSync(
	join(salida, "vehiculos.csv"),
	csv(
		[
			"vehicle_id",
			"placa",
			"vin",
			"con_credito",
			"estado",
			"metodo",
			"unit_id",
			"unit_nombre",
			"otras_unidades",
			"sugerencia",
			"detalle",
			"vinculado_por",
			"confirmar",
			"creditos",
		],
		diag.vehiculos.map((r) => [
			r.vehiculo.id,
			r.vehiculo.placa,
			r.vehiculo.vin,
			r.vehiculo.conCredito ? "si" : "no",
			r.estado,
			r.metodo,
			r.unidad?.id,
			r.unidad?.nm,
			r.otras.map((u) => `${u.id}:${u.nm}`).join(" | "),
			r.sugerencia,
			r.detalle,
			r.vehiculo.vinculadoPor,
			r.confirmar ? "si" : "",
			(r.vehiculo.creditos ?? [])
				.map((c) => `${c.sifco}:${c.estado ?? "no_en_cartera"}`)
				.join(" | "),
		]),
	),
);
writeFileSync(
	join(salida, "unidades.csv"),
	csv(
		[
			"unit_id",
			"unit_nombre",
			"estado",
			"nucleo_placa",
			"vin",
			"registration_plate",
			"vin_campo",
			"vehiculos",
			"detalle",
		],
		diag.unidades.map((r) => [
			r.unidad.id,
			r.unidad.nm,
			r.estado,
			r.nucleoPlaca,
			r.vin,
			r.unidad.campos.registration_plate,
			r.unidad.campos.vin,
			r.vehiculos.join(" | "),
			r.detalle,
		]),
	),
);
console.log(
	`\nCSV: ${join(salida, "vehiculos.csv")} y ${join(salida, "unidades.csv")}`,
);

// ── Plan ─────────────────────────────────────────────────────────────────────
const plan = planificar(diag.vehiculos, unidades, { incluirConfirmar, max });
const filaPlan = (item: ItemVinculo, extra: unknown[]) => [
	item.vehicleId,
	item.placa,
	item.vin,
	item.unitId,
	item.unitName,
	item.metodo,
	item.marcador,
	item.confirmar ? "si" : "",
	item.nota,
	...extra,
];
const encabezadoPlan = [
	"vehicle_id",
	"placa",
	"vin",
	"unit_id",
	"unit_nombre",
	"metodo",
	"marcador",
	"confirmar",
	"nota",
];
writeFileSync(
	join(salida, "plan.csv"),
	csv(
		[...encabezadoPlan, "incluido"],
		[
			...plan.items.map((i) => filaPlan(i, ["si"])),
			...plan.excluidos.map(({ item, motivo }) => filaPlan(item, [motivo])),
		],
	),
);
const porMarcador = contar(plan.items.map((i) => i.marcador));
console.log(
	`\nPlan: ${plan.items.length} vínculos (${[...porMarcador].map(([m, n]) => `${m} ${n}`).join(", ")}); excluidos ${plan.excluidos.length}. ${join(salida, "plan.csv")}`,
);

if (!aplicar) {
	console.log("Solo lectura: no se escribió nada en la base de datos.");
	process.exit(0);
}

// ── Aplicación ───────────────────────────────────────────────────────────────

/**
 * Escribe un vínculo con las mismas garantías que la ficha
 * (fijarVinculoPorPlaca): lock por unidad, la unidad no puede estar en otro
 * vehículo y el vehículo no puede tener ya una unidad. Además exige que la
 * placa y el VIN sigan siendo los del diagnóstico. Cada vínculo deja su fila
 * en la bitácora de vehículos.
 */
const escritor: Escritor = {
	vincular: (item) =>
		runWithAudit(
			{
				actorId: null,
				actorRole: null,
				source: "system",
				operation: "script.vincular-flota-wialon",
				input: { vehicleId: item.vehicleId, unitId: item.unitId },
				fallback: null,
			},
			() =>
				db.transaction(async (tx) => {
					await tx.execute(
						sql`select pg_advisory_xact_lock(hashtextextended(${`wialon_unit:${item.unitId}`}, 0))`,
					);
					const [otro] = await tx
						.select({ id: vehicles.id })
						.from(vehicles)
						.where(
							and(
								eq(vehicles.wialonUnitId, item.unitId),
								ne(vehicles.id, item.vehicleId),
							),
						)
						.limit(1);
					if (otro) return "unidad_ocupada" as const;

					const guardados = await tx
						.update(vehicles)
						.set({
							wialonUnitId: item.unitId,
							wialonUnitName: item.unitName,
							wialonVinculadoAt: new Date(),
							wialonVinculadoPor: item.marcador,
						})
						.where(
							and(
								eq(vehicles.id, item.vehicleId),
								isNull(vehicles.wialonUnitId),
								sql`${vehicles.licensePlate} is not distinct from ${item.placa}`,
								sql`${vehicles.vinNumber} is not distinct from ${item.vin}`,
							),
						)
						.returning({ id: vehicles.id });
					if (guardados.length > 0) {
						auditRecord({
							entity: "vehicle",
							id: item.vehicleId,
							action: "wialon_vincular",
							data: {
								unitId: item.unitId,
								unitName: item.unitName,
								automatico: true,
								marcador: item.marcador,
							},
						});
						return "guardado" as const;
					}
					const [actual] = await tx
						.select({ unitId: vehicles.wialonUnitId })
						.from(vehicles)
						.where(eq(vehicles.id, item.vehicleId))
						.limit(1);
					return actual?.unitId != null
						? ("vehiculo_ya_vinculado" as const)
						: ("datos_cambiaron" as const);
				}),
		),
};

console.log(
	`\nAPLICANDO ${plan.items.length} vínculos en ${destino?.host}/${destino?.bd}…`,
);
const inicio = new Date();
const res = await aplicarPlan(plan.items, escritor, {
	alProgresar: (hechos, total) => {
		if (hechos % 100 === 0 || hechos === total)
			console.log(`  ${hechos}/${total}`);
	},
});

writeFileSync(
	join(salida, "resultado.csv"),
	csv(
		[...encabezadoPlan, "resultado", "error"],
		[
			...res.guardados.map((i) => filaPlan(i, ["guardado", ""])),
			...res.omitidos.map(({ item, resultado }) =>
				filaPlan(item, [resultado, ""]),
			),
			...res.errores.map(({ item, error }) => filaPlan(item, ["error", error])),
		],
	),
);
if (res.guardados.length > 0) {
	writeFileSync(join(salida, "reversa.sql"), sqlReversa(res.guardados, inicio));
}

console.log("\nResultado:");
console.log(`  guardados ${res.guardados.length}`);
for (const [r, n] of contar(res.omitidos.map((o) => o.resultado)))
	console.log(`  ${r} ${n}`);
console.log(`  errores ${res.errores.length}`);
for (const { item, error } of res.errores.slice(0, 5))
	console.log(`    ${item.vehicleId} → ${item.unitId}: ${error}`);
if (res.abortado)
	console.log(
		`  ABORTADO por errores: ${res.pendientes} sin intentar (corra de nuevo cuando se resuelva).`,
	);
console.log(
	`\n${join(salida, "resultado.csv")}${res.guardados.length ? ` · reversa: ${join(salida, "reversa.sql")}` : ""}`,
);
process.exit(res.errores.length > 0 ? 1 : 0);
