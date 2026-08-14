/**
 * CB-128 — persistencia por LOTE de `contactos_cobros.estado_promesa`.
 *
 * Punto único de escritura para los dos caminos que recalculan el estado de una
 * promesa: `getEstadoPromesasPago` (cada apertura de Ficha 360) y el job
 * nocturno `check-promesas-pago.ts`. Los dos hacen exactamente lo mismo —
 * comparar lo calculado contra lo guardado, escribir solo si cambió y auditar
 * la transición— así que viven acá y no duplicados.
 *
 * ── Por qué UNA transacción y no una por fila ─────────────────────────────
 *
 * La primera versión de CB-128 abría `db.transaction` POR PROMESA dentro de un
 * `Promise.allSettled`. Con hasta 100 promesas por ficha eso son 100
 * transacciones concurrentes, cada una reteniendo una conexión mientras
 * mantiene abierto su `SELECT ... FOR UPDATE`. El pool de `node-postgres` sin
 * configurar es de 10 conexiones para TODA la app: un handler de lectura las
 * tomaba todas y el resto del CRM quedaba esperando. Acá es una sola
 * transacción y una sola conexión, sin importar cuántas promesas entren.
 *
 * ── Por qué ORDER BY id en el lock ────────────────────────────────────────
 *
 * Ficha 360 y job nocturno pueden tocar el mismo conjunto de filas a la vez. Si
 * cada uno toma los locks en orden distinto (lo que pasaba con el
 * `allSettled`), dos transacciones que tocan {A,B} en órdenes opuestos se
 * bloquean mutuamente: Postgres mata una, y del lado del job caía en
 * `idsRechazados` como error espurio. Ordenar SIEMPRE por `id` da un orden
 * total de adquisición y hace el deadlock imposible por construcción — por eso
 * el ORDER BY vive acá dentro y no es responsabilidad del caller.
 *
 * ── El guard de no-op y el "de" auditado ──────────────────────────────────
 *
 * La comparación es en JS contra la fila bloqueada, no un `ne()` en el WHERE
 * del UPDATE. El motivo no es solo saltarse la escritura: el valor "de" que se
 * audita tiene que leerse en el mismo instante en que se escribe. Leerlo de un
 * SELECT anterior permitiría que una escritura concurrente dejara registrada
 * una transición que nunca ocurrió — justo lo que el AC-6 prohíbe. Ver la nota
 * larga en `audit-contactos.ts`.
 */

import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { contactosCobros, type estadoPromesaEnum } from "../db/schema/cobros";
import {
	payloadCambioEstado,
	registrarAuditContactoBestEffort,
} from "./audit-contactos";

type EstadoPromesa = (typeof estadoPromesaEnum.enumValues)[number];

/** Una promesa a persistir: el id y el estado que se calculó para ella. */
export interface CambioEstadoPromesa {
	id: string;
	estado: EstadoPromesa;
}

/** Transición que SÍ se escribió, lista para auditar. */
export interface TransicionAplicada {
	id: string;
	casoCobroId: string;
	de: EstadoPromesa | null;
	a: EstadoPromesa;
	/** Instante REAL del UPDATE (dentro de la transacción), no el del INSERT del audit — ver nota en `audit-contactos.ts`. */
	ocurrioEn: Date;
}

/**
 * Aplica el lote en UNA transacción y devuelve solo las transiciones reales.
 *
 * Las filas que no cambiaron —y las que ya no existen— se omiten del
 * resultado: no se escriben ni se auditan.
 */
/**
 * Dedup por id conservando el ÚLTIMO valor.
 *
 * Si el caller mandara el mismo id dos veces, sin esto se auditarían dos
 * transiciones partiendo del mismo "de", y la segunda sería falsa: su "de" real
 * es lo que dejó escrito la primera.
 */
export function deduplicarCambios(
	cambios: readonly CambioEstadoPromesa[],
): Map<string, EstadoPromesa> {
	const estadoPorId = new Map<string, EstadoPromesa>();
	for (const c of cambios) estadoPorId.set(c.id, c.estado);
	return estadoPorId;
}

/** Fila bloqueada por el SELECT ... FOR UPDATE, tal como la lee el batch. */
export interface FilaBloqueada {
	id: string;
	estadoPromesa: EstadoPromesa | null;
	casoCobroId: string;
}

/**
 * Decide qué filas cambian de verdad — la parte pura del batch, separada del
 * I/O para poder probarla sin DB.
 *
 * Descarta las que ya están en el estado calculado (guard de no-op) y las que
 * no venían en el lote. El "de" sale de la fila BLOQUEADA, no de una lectura
 * previa: es lo que hace que la transición auditada sea la que realmente
 * ocurrió.
 *
 * `ocurrioEn` es el instante que el caller va a escribir en `updatedAt` del
 * UPDATE — se propaga a la transición para que el audit (que corre después,
 * fuera de esta transacción) registre el momento REAL de la escritura y no el
 * de su propio INSERT. Ver la nota larga en `audit-contactos.ts`.
 */
export function decidirTransiciones(
	filas: readonly FilaBloqueada[],
	estadoPorId: ReadonlyMap<string, EstadoPromesa>,
	ocurrioEn: Date,
): TransicionAplicada[] {
	const aplicadas: TransicionAplicada[] = [];
	for (const fila of filas) {
		const nuevo = estadoPorId.get(fila.id);
		if (!nuevo) continue;
		if (fila.estadoPromesa === nuevo) continue;
		aplicadas.push({
			id: fila.id,
			casoCobroId: fila.casoCobroId,
			de: fila.estadoPromesa,
			a: nuevo,
			ocurrioEn,
		});
	}
	return aplicadas;
}

export async function aplicarCambiosEstadoPromesa(
	cambios: readonly CambioEstadoPromesa[],
): Promise<TransicionAplicada[]> {
	if (cambios.length === 0) return [];

	const estadoPorId = deduplicarCambios(cambios);
	const ids = Array.from(estadoPorId.keys());

	return await db.transaction(async (tx) => {
		// ORDER BY id: orden total de adquisición de locks, ver nota de arriba.
		const filas = await tx
			.select({
				id: contactosCobros.id,
				estadoPromesa: contactosCobros.estadoPromesa,
				casoCobroId: contactosCobros.casoCobroId,
			})
			.from(contactosCobros)
			.where(inArray(contactosCobros.id, ids))
			.orderBy(contactosCobros.id)
			.for("update");

		const ahora = new Date();
		const aplicadas = decidirTransiciones(filas, estadoPorId, ahora);

		for (const t of aplicadas) {
			await tx
				.update(contactosCobros)
				.set({ estadoPromesa: t.a, updatedAt: ahora })
				.where(eq(contactosCobros.id, t.id));
		}

		return aplicadas;
	});
}

/**
 * Audita en serie las transiciones ya aplicadas, best-effort.
 *
 * Corre FUERA de la transacción de escritura a propósito: el audit de sistema
 * no debe poder tumbar el job ni la carga de la ficha (a diferencia de la
 * edición manual, donde sí va dentro). En serie y no en paralelo por la misma
 * razón que motivó este módulo: N inserts concurrentes vuelven a competir por
 * el pool, y este camino no tiene ninguna urgencia de latencia.
 */
export async function auditarTransiciones(
	transiciones: readonly TransicionAplicada[],
	origen: "sistema_lectura" | "sistema_job",
): Promise<void> {
	for (const t of transiciones) {
		await registrarAuditContactoBestEffort({
			contactoId: t.id,
			casoCobroId: t.casoCobroId,
			accion: "cambio_estado_promesa",
			origen,
			valoresAnteriores: payloadCambioEstado(t.de, t.a),
			editadoEn: t.ocurrioEn,
		});
	}
}
