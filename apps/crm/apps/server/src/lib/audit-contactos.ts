/**
 * CB-128 — auditoría de escrituras sobre `contactos_cobros` (AC-6: "no se
 * eliminan ni alteran registros históricos sin auditoría").
 *
 * `contactos_cobros` es append-only SALVO tres UPDATE, y este módulo es el
 * único punto de escritura de su bitácora. Se centraliza acá para que los tres
 * callers no repitan la forma del payload ni el criterio de best-effort — mismo
 * motivo por el que existen promesa-vigente.ts y caso-vigente.ts.
 *
 * ── Los tres UPDATE y por qué se tratan distinto ──────────────────────────
 *
 *  1. Edición manual de la promesa activa (CB-029, `createContactoCobros` rama
 *     `promesaContactoId`). Baja frecuencia, decisión humana, pisa la fila
 *     ENTERA. Es el ÚNICO caso donde se pierde información irrecuperable: sin
 *     auditoría no queda rastro de que el cliente prometió el día 10 y después
 *     se movió al 20.
 *     → `origen: 'manual'`, snapshot COMPLETO de la fila previa.
 *
 *  2. `getEstadoPromesasPago` — recalcula `estado_promesa` en cada apertura de
 *     Ficha 360.
 *  3. `check-promesas-pago.ts` — mismo recálculo, job nocturno.
 *     → `origen: 'sistema_lectura' | 'sistema_job'`, solo `{de, a}`.
 *
 * El snapshot completo NO se guarda en 2 y 3 porque `estado_promesa` es función
 * pura de columnas que ya persisten (`cuota_inicio`, `cuota_fin`,
 * `incluye_mora`, `fecha_proximo_contacto`) contra el estado del crédito — es
 * exactamente lo que hace `evaluarPromesa()`. Guardarlo sería duplicar un dato
 * reconstruible.
 *
 * ── El guard de no-op es prerequisito, no adorno ──────────────────────────
 *
 * Los UPDATE 2 y 3 escribían INCONDICIONALMENTE (`.set({estadoPromesa})` sin
 * comparar contra lo guardado). Auditarlos así generaría filas
 * `pendiente → pendiente` en masa: con 100 promesas vivas, solo el job nocturno
 * produce ~36,500 filas/año sin información.
 *
 * Ambos callers resuelven esto con un `SELECT ... FOR UPDATE` + comparación en
 * JS DENTRO de una transacción, en vez de un guard en el WHERE del UPDATE. El
 * motivo no es solo saltarse la escritura: el valor "de" que se audita tiene
 * que leerse en el mismo instante en que se escribe. Con el guard en el WHERE,
 * ese "de" venía de un SELECT anterior y una escritura concurrente (la otra
 * Ficha 360, o el job) podía dejar registrada una transición que nunca ocurrió
 * — exactamente lo que el AC-6 prohíbe.
 *
 * ── Lo que NO captura ─────────────────────────────────────────────────────
 *
 *  - Cambios en `casos_cobros` (7 UPDATE: reasignación de responsable,
 *    etiquetas, próximo contacto, sync SIFCO). Fuera del alcance de CB-128, que
 *    es historial de GESTIONES, no de cuentas. Deuda conocida: `casos_cobros`
 *    tiene `updated_at` pero ningún `updated_by`.
 *  - DELETE: no existe ninguno en producción (el único está en `db/clear.ts`,
 *    seed). La FK es ON DELETE CASCADE, así que si algún día se borrara un
 *    contacto su auditoría se iría con él.
 *  - Lecturas: quién consultó el historial no se registra.
 *  - No reemplaza `buckets_historial` ni `credito_asesor_historial`
 *    (cartera-back), que ya tienen su propia bitácora append-only.
 */

import { eq, type SQL } from "drizzle-orm";
import { db } from "../db";
import {
	type contactosCobros,
	contactosCobrosAudit,
	type estadoPromesaEnum,
} from "../db/schema/cobros";

type EstadoPromesa = (typeof estadoPromesaEnum.enumValues)[number];

/** De dónde vino la escritura. Determina si `editadoPor` va poblado. */
export type OrigenAudit = "manual" | "sistema_lectura" | "sistema_job";

/**
 * Payload de auditoría para una edición MANUAL: snapshot completo de la fila
 * antes de que el UPDATE la pise.
 *
 * Se guarda la fila entera y no un diff porque el diff se puede calcular
 * después contra la fila actual, mientras que lo que no se guardó no se
 * recupera. `id`/`caso_cobro_id`/`created_at` se omiten: son inmutables y ya
 * viven en las columnas de la propia tabla de audit.
 */
export function payloadEdicionManual(
	filaPrevia: typeof contactosCobros.$inferSelect,
): Record<string, unknown> {
	const {
		id: _id,
		casoCobroId: _casoCobroId,
		createdAt: _createdAt,
		...resto
	} = filaPrevia;
	return resto as Record<string, unknown>;
}

/** Payload para un cambio de estado de SISTEMA: solo la transición. */
export function payloadCambioEstado(
	de: EstadoPromesa | null,
	a: EstadoPromesa,
): Record<string, unknown> {
	return { de, a };
}

interface RegistrarAuditArgs {
	contactoId: string;
	casoCobroId: string;
	accion: "edicion_promesa" | "cambio_estado_promesa";
	origen: OrigenAudit;
	valoresAnteriores: Record<string, unknown>;
	/** Obligatorio si `origen === 'manual'`; ignorado si no. */
	editadoPor?: string | null;
	/** Para escribir dentro de una transacción del caller. */
	tx?: Pick<typeof db, "insert">;
	/**
	 * Instante REAL de la transición, si el caller ya lo tiene (p.ej. el `ahora`
	 * que usó el propio UPDATE). Sin esto, la columna cae a `defaultNow()` — el
	 * instante del INSERT del audit, no el del UPDATE que audita.
	 *
	 * Importa para los callers de SISTEMA (`promesa-estado-batch.ts`): su audit
	 * corre DESPUÉS del commit, en serie, fuera de la transacción de escritura.
	 * Si otra transacción concurrente audita la misma fila más rápido, su
	 * INSERT (con `defaultNow()`) puede insertarse ANTES que este aunque su
	 * transición haya ocurrido DESPUÉS — `getAuditoriaContacto`, que ordena por
	 * `editadoEn`, mostraría el orden invertido (Codex, PR #1299).
	 */
	editadoEn?: Date;
}

/**
 * Inserta una fila de auditoría.
 *
 * Con `tx` escribe dentro de la transacción del caller (así lo usa la edición
 * manual: el audit y el UPDATE viven o mueren juntos, no puede quedar el UPDATE
 * sin su rastro). Sin `tx` escribe suelto, que es lo correcto para los UPDATE
 * de sistema: son best-effort y no deben poder tumbar el job ni la lectura de
 * la Ficha 360.
 */
export async function registrarAuditContacto({
	contactoId,
	casoCobroId,
	accion,
	origen,
	valoresAnteriores,
	editadoPor,
	tx,
	editadoEn,
}: RegistrarAuditArgs): Promise<void> {
	const ejecutor = tx ?? db;
	await ejecutor.insert(contactosCobrosAudit).values({
		contactoId,
		casoCobroId,
		accion,
		origen,
		valoresAnteriores,
		// Los UPDATE de sistema no tienen usuario. Se fuerza NULL en vez de
		// confiar en el caller para que un origen de sistema nunca quede
		// atribuido a una persona por accidente.
		editadoPor: origen === "manual" ? (editadoPor ?? null) : null,
		// Sin `editadoEn` explícito cae a defaultNow() del schema — correcto para
		// la edición manual, que audita DENTRO de la misma transacción del
		// UPDATE. Los callers de sistema SÍ deben pasarlo (ver la nota del tipo).
		...(editadoEn ? { editadoEn } : {}),
	});
}

/**
 * Igual que `registrarAuditContacto` pero traga el error y lo loguea.
 *
 * Para los UPDATE de sistema (job nocturno y lectura de Ficha 360): perder una
 * fila de auditoría de una transición reconstruible es mucho menos grave que
 * tumbar el job entero o romper la carga de la ficha. Mismo criterio de
 * best-effort que ya usan esos dos callers con `Promise.allSettled`.
 *
 * NO usar en la edición manual — ahí el audit va en la transacción y su fallo
 * SÍ debe abortar el UPDATE (si no, se pierde el dato viejo sin rastro, que es
 * justo lo que el AC-6 prohíbe).
 */
export async function registrarAuditContactoBestEffort(
	args: RegistrarAuditArgs,
): Promise<void> {
	try {
		await registrarAuditContacto(args);
	} catch (error) {
		console.error(
			`[audit-contactos] No se pudo auditar ${args.accion} de ${args.contactoId}:`,
			error,
		);
	}
}

/**
 * Condición de "lo editó un humano", para el lote de marcas del listado.
 *
 * Deliberadamente una query por lote y no un LEFT JOIN LATERAL por fila: con
 * 50 filas por página eso serían 50 subqueries contra una tabla que también
 * crece. Mismo patrón de enriquecimiento con `inArray` que usa `getAgendaDia`
 * para evitar N+1.
 *
 * Filtra `origen = 'manual'` (usa el índice parcial `idx_contactos_audit_manual`):
 * una promesa que solo cambió de estado por el job NO debe verse como "editada"
 * en la UI — el usuario leería "alguien tocó esto" cuando no pasó tal cosa.
 */
export function condicionAuditManual(): SQL {
	return eq(contactosCobrosAudit.origen, "manual");
}
