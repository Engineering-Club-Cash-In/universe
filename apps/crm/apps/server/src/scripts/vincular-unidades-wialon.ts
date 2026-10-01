/**
 * Vincula en masa las unidades de Wialon con los vehículos del CRM, deduciendo
 * por placa. Es lo mismo que hace la Ficha 360 la primera vez que se consulta
 * el GPS de un crédito (matchUnidadPorPlaca + fijarVinculoPorPlaca), pero para
 * todo el catálogo de una vez, sin esperar a que alguien abra cada ficha.
 *
 * Por defecto solo SIMULA e imprime qué haría. Para escribir: --apply.
 *
 *   bun run src/scripts/vincular-unidades-wialon.ts
 *   bun run src/scripts/vincular-unidades-wialon.ts --apply
 *   bun run src/scripts/vincular-unidades-wialon.ts --solo-con-credito --apply
 *
 * Opciones:
 *   --apply             Escribe los vínculos (sin esto es dry-run).
 *   --solo-con-credito  Solo vehículos con oportunidad con SIFCO o contrato.
 *
 * Criterio conservador, igual que la ficha: solo se vincula cuando la placa del
 * vehículo coincide con EXACTAMENTE una unidad. Nunca pisa un vínculo existente
 * (manual o automático) ni una unidad que ya esté en otro vehículo. Si dos
 * vehículos del CRM comparten placa (vehículo duplicado, refinanciamiento) no
 * se adivina cuál es el real: se omiten y se listan para que un supervisor
 * decida desde la ficha.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { vehicles } from "../db/schema/vehicles";
import { fijarVinculoPorPlaca } from "../routers/wialon";
import {
	extraerNucleoPlaca,
	getWialonClient,
	matchUnidadPorPlaca,
} from "../services/wialon/wialon-client";

const args = new Set(Bun.argv.slice(2));
const aplicar = args.has("--apply");
const soloConCredito = args.has("--solo-con-credito");

type Vehiculo = { id: string; placa: string };
type Unidad = { id: number; nm: string };

async function vehiculosSinUnidad(): Promise<Vehiculo[]> {
	const filas = await db
		.select({ id: vehicles.id, placa: vehicles.licensePlate })
		.from(vehicles)
		.where(
			and(isNull(vehicles.wialonUnitId), isNotNull(vehicles.licensePlate)),
		);
	const todos = filas.flatMap((f) =>
		f.placa ? [{ id: f.id, placa: f.placa }] : [],
	);
	if (!soloConCredito) return todos;

	const [porOportunidad, porContrato] = await Promise.all([
		db
			.selectDistinct({ id: opportunities.vehicleId })
			.from(opportunities)
			.where(
				and(
					isNotNull(opportunities.vehicleId),
					isNotNull(opportunities.numeroSifco),
				),
			),
		db
			.selectDistinct({ id: contratosFinanciamiento.vehicleId })
			.from(casosCobros)
			.innerJoin(
				contratosFinanciamiento,
				eq(contratosFinanciamiento.id, casosCobros.contratoId),
			)
			.where(isNotNull(contratosFinanciamiento.vehicleId)),
	]);
	const conCredito = new Set(
		[...porOportunidad, ...porContrato].flatMap((r) => (r.id ? [r.id] : [])),
	);
	return todos.filter((v) => conCredito.has(v.id));
}

async function unidadesYaAsignadas(): Promise<Set<number>> {
	const filas = await db
		.select({ unitId: vehicles.wialonUnitId })
		.from(vehicles)
		.where(isNotNull(vehicles.wialonUnitId));
	return new Set(filas.flatMap((f) => (f.unitId != null ? [f.unitId] : [])));
}

const catalogo: Unidad[] = (await getWialonClient().searchUnits({ flags: 1 }))
	.items;
const candidatos = await vehiculosSinUnidad();
const asignadas = await unidadesYaAsignadas();

console.log(
	`${aplicar ? "APLICANDO" : "DRY-RUN"} · ${catalogo.length} unidades en Wialon · ${candidatos.length} vehículos sin unidad${soloConCredito ? " (solo con crédito)" : ""}`,
);

const sinPlaca: Vehiculo[] = [];
const sinCoincidencia: Vehiculo[] = [];
const ambiguosPorUnidades: { vehiculo: Vehiculo; unidades: Unidad[] }[] = [];
const porUnidad = new Map<number, { unidad: Unidad; vehiculos: Vehiculo[] }>();

for (const vehiculo of candidatos) {
	if (!extraerNucleoPlaca(vehiculo.placa)) {
		sinPlaca.push(vehiculo);
		continue;
	}
	const { unidad, motivo, coincidencias } = matchUnidadPorPlaca(
		vehiculo.placa,
		catalogo,
	);
	if (motivo === "sin_coincidencia") sinCoincidencia.push(vehiculo);
	else if (motivo === "ambiguo")
		ambiguosPorUnidades.push({ vehiculo, unidades: coincidencias });
	else if (motivo === "ok" && unidad) {
		const grupo = porUnidad.get(unidad.id) ?? { unidad, vehiculos: [] };
		grupo.vehiculos.push(vehiculo);
		porUnidad.set(unidad.id, grupo);
	}
}

const aVincular: { unidad: Unidad; vehiculo: Vehiculo }[] = [];
const unidadCompartida: { unidad: Unidad; vehiculos: Vehiculo[] }[] = [];
const unidadYaOcupada: { unidad: Unidad; vehiculo: Vehiculo }[] = [];
for (const { unidad, vehiculos } of porUnidad.values()) {
	if (vehiculos.length > 1) unidadCompartida.push({ unidad, vehiculos });
	else if (asignadas.has(unidad.id))
		unidadYaOcupada.push({ unidad, vehiculo: vehiculos[0] });
	else aVincular.push({ unidad, vehiculo: vehiculos[0] });
}

console.log(`\nSe vincularían:                ${aVincular.length}`);
for (const { unidad, vehiculo } of aVincular)
	console.log(`  ${vehiculo.placa.padEnd(12)} → ${unidad.nm} (${unidad.id})`);

console.log(
	`\nOmitidos — varios vehículos con la misma placa: ${unidadCompartida.length}`,
);
for (const { unidad, vehiculos } of unidadCompartida)
	console.log(
		`  ${unidad.nm} (${unidad.id}): ${vehiculos.map((v) => v.id).join(", ")}`,
	);

console.log(
	`Omitidos — unidad ya asignada a otro vehículo: ${unidadYaOcupada.length}`,
);
console.log(
	`Omitidos — placa en más de una unidad (ambiguo): ${ambiguosPorUnidades.length}`,
);
console.log(`Sin unidad en Wialon con esa placa:  ${sinCoincidencia.length}`);
console.log(`Placa sin formato reconocible:       ${sinPlaca.length}`);

if (!aplicar) {
	console.log("\nDry-run: no se escribió nada. Agrega --apply para vincular.");
	process.exit(0);
}

const resumen = { guardado: 0, asignada_a_otro: 0, ya_vinculado: 0, error: 0 };
for (const { unidad, vehiculo } of aVincular) {
	const resultado = await fijarVinculoPorPlaca(
		vehiculo.id,
		unidad.id,
		unidad.nm,
	);
	resumen[resultado]++;
}
console.log("\nResultado:", resumen);
process.exit(resumen.error > 0 ? 1 : 0);
