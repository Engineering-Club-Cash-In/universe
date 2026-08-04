import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import { db } from "../database";
import { creditos, promesas_pago_espejo } from "../database/db/schema";
import { hoyGtISO } from "../lib/buckets-classification";

// CB-030 — payload que empuja crm-server (contactos_cobros vive en su propia
// DB; esto es la copia local que consulta procesarMoras). Un solo endpoint
// sirve DOS disparadores: push por evento (array de 1, en cuanto se crea o
// resuelve una promesa) y el job de reconciliación diario (array completo de
// promesas vigentes, idempotente — corrige drift de pushes fallidos).
export type PromesaSync = {
	contacto_cobros_id: string;
	numero_credito_sifco: string;
	cuota_inicio: number | null;
	cuota_fin: number | null;
	incluye_mora: boolean;
	fecha_promesa: string; // YYYY-MM-DD
	activa: boolean;
};

export type SyncPromesasResult = {
	success: boolean;
	message?: string;
	actualizadas?: number;
	noEncontradas?: string[]; // numero_credito_sifco que no resolvieron a un crédito
	// filas rechazadas por validarPromesa (formato inválido) — no abortan el
	// batch, ver syncPromesasPago.
	noValidas?: string[];
	// true cuando TODO el batch cayó en noEncontradas — distingue "nada que
	// sincronizar" (payload vacío, actualizadas=0 normal) de "sync completo
	// fallido" (actualizadas=0 porque NINGÚN sifco resolvió). success sigue
	// true (la operación en sí no reventó), pero el caller debe tratar esto
	// como una alerta, no como "listo".
	fallaTotal?: boolean;
};

function validarPromesa(p: PromesaSync): string | null {
	if (typeof p.contacto_cobros_id !== "string" || p.contacto_cobros_id.trim() === "") {
		return "contacto_cobros_id es requerido";
	}
	if (typeof p.numero_credito_sifco !== "string" || p.numero_credito_sifco.trim() === "") {
		return `numero_credito_sifco es requerido (contacto_cobros_id=${p.contacto_cobros_id})`;
	}
	const tieneInicio = p.cuota_inicio != null;
	const tieneFin = p.cuota_fin != null;
	if (tieneInicio !== tieneFin) {
		return `cuota_inicio y cuota_fin deben venir ambos o ninguno (contacto_cobros_id=${p.contacto_cobros_id})`;
	}
	// Rango invertido no explota — simplemente nunca matchea ninguna cuota en
	// cuotaCubiertaPorPromesa (numeroCuota < inicio || > fin siempre true) y
	// falla en silencio a "no congela nada". Mejor rechazar acá que dejar una
	// promesa vigente que jamás protege ninguna cuota.
	if (
		p.cuota_inicio != null &&
		p.cuota_fin != null &&
		p.cuota_inicio > p.cuota_fin
	) {
		return `cuota_inicio (${p.cuota_inicio}) no puede ser mayor que cuota_fin (${p.cuota_fin}) (contacto_cobros_id=${p.contacto_cobros_id})`;
	}
	if (typeof p.fecha_promesa !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_promesa)) {
		return `fecha_promesa inválida, formato YYYY-MM-DD (contacto_cobros_id=${p.contacto_cobros_id})`;
	}
	return null;
}

/**
 * CB-030 — upsert idempotente por contacto_cobros_id. Resuelve
 * numero_credito_sifco → credito_id acá (cartera-back es dueño de esa
 * correspondencia, el CRM solo conoce el SIFCO). Filas con SIFCO no
 * resuelto (`noEncontradas`) o formato inválido (`noValidas`) se excluyen
 * individualmente y NO abortan el resto del batch (un dato inconsistente
 * no debe bloquear la sincronización de las demás promesas válidas).
 *
 * `modo: "reconciliacion_completa"` (job diario, el batch trae TODAS las
 * promesas vigentes según crm-server) además desactiva cualquier fila
 * activa=true del espejo cuyo contacto_cobros_id NO esté en el batch — sin
 * esto, una promesa cumplida/cancelada cuyo push por evento se perdiera
 * quedaría congelando cuotas para siempre, porque nunca vuelve a aparecer en
 * ningún payload futuro (Codex review PR #1234). El push por evento (array de
 * 1) usa el modo default y NO desactiva nada fuera de su propia fila.
 */
export async function syncPromesasPago(
	promesas: PromesaSync[],
	modo: "evento" | "reconciliacion_completa" = "evento",
): Promise<SyncPromesasResult> {
	if (!Array.isArray(promesas) || promesas.length === 0) {
		return { success: false, message: "Lista de promesas vacía" };
	}

	const noValidas: string[] = [];
	const promesasValidas = promesas.filter((p) => {
		const error = validarPromesa(p);
		if (error) {
			noValidas.push(error);
			return false;
		}
		return true;
	});

	if (promesasValidas.length === 0) {
		return { success: false, message: `[ERROR] Ninguna promesa válida en el batch: ${noValidas.join(" | ")}` };
	}

	const sifcos = [...new Set(promesasValidas.map((p) => p.numero_credito_sifco))];
	const creditosRows = await db
		.select({ credito_id: creditos.credito_id, numero_credito_sifco: creditos.numero_credito_sifco })
		.from(creditos)
		.where(inArray(creditos.numero_credito_sifco, sifcos));

	const creditoIdPorSifco = new Map<string, number>();
	for (const c of creditosRows) {
		if (c.numero_credito_sifco) creditoIdPorSifco.set(c.numero_credito_sifco, c.credito_id);
	}

	let actualizadas = 0;
	const noEncontradas: string[] = [];

	await db.transaction(async (tx) => {
		for (const p of promesasValidas) {
			const creditoId = creditoIdPorSifco.get(p.numero_credito_sifco);
			if (creditoId === undefined) {
				noEncontradas.push(p.numero_credito_sifco);
				continue;
			}

			await tx
				.insert(promesas_pago_espejo)
				.values({
					credito_id: creditoId,
					contacto_cobros_id: p.contacto_cobros_id,
					cuota_inicio: p.cuota_inicio,
					cuota_fin: p.cuota_fin,
					incluye_mora: p.incluye_mora,
					fecha_promesa: p.fecha_promesa,
					activa: p.activa,
					updated_at: new Date(),
				})
				.onConflictDoUpdate({
					target: promesas_pago_espejo.contacto_cobros_id,
					set: {
						credito_id: creditoId,
						cuota_inicio: p.cuota_inicio,
						cuota_fin: p.cuota_fin,
						incluye_mora: p.incluye_mora,
						fecha_promesa: p.fecha_promesa,
						activa: p.activa,
						updated_at: new Date(),
					},
				});
			actualizadas++;
		}

		// Reconciliación completa: el batch representa el 100% de lo vigente
		// según crm-server ahora mismo. Cualquier fila activa=true que no
		// aparezca en NINGUNA posición del batch original (ni siquiera las
		// noEncontradas/noValidas, para no apagar por un error transitorio de
		// resolución de sifco) ya no es vigente y se destraba.
		if (modo === "reconciliacion_completa") {
			const idsEnBatch = promesas.map((p) => p.contacto_cobros_id);
			await tx
				.update(promesas_pago_espejo)
				.set({ activa: false, updated_at: new Date() })
				.where(
					and(
						eq(promesas_pago_espejo.activa, true),
						idsEnBatch.length > 0
							? notInArray(promesas_pago_espejo.contacto_cobros_id, idsEnBatch)
							: undefined,
					),
				);
		}
	});

	const fallaTotal = actualizadas === 0 && noEncontradas.length === promesasValidas.length;

	return {
		success: true,
		actualizadas,
		...(noEncontradas.length > 0 ? { noEncontradas } : {}),
		...(noValidas.length > 0 ? { noValidas } : {}),
		...(fallaTotal ? { fallaTotal: true } : {}),
	};
}

export type PromesaActivaCredito = {
	fecha_promesa: string;
	cuota_inicio: number | null;
	cuota_fin: number | null;
	incluye_mora: boolean;
};

/**
 * CB-030 — señal de solo lectura para el frontend de cartera-back
 * (carteraFront): ¿este crédito tiene una promesa vigente? Vigente = activa
 * Y fecha_promesa NO ha pasado — mismo criterio que el freeze en
 * isOverdueInstallmentForMora (latefee.ts). Si hay varias vigentes, se
 * devuelve la de fecha_promesa más próxima (la primera en vencer).
 */
export async function getPromesaActivaPorCredito(
	creditoId: number,
): Promise<PromesaActivaCredito | null> {
	const hoy = hoyGtISO();
	const [fila] = await db
		.select({
			fecha_promesa: promesas_pago_espejo.fecha_promesa,
			cuota_inicio: promesas_pago_espejo.cuota_inicio,
			cuota_fin: promesas_pago_espejo.cuota_fin,
			incluye_mora: promesas_pago_espejo.incluye_mora,
		})
		.from(promesas_pago_espejo)
		.where(
			and(
				eq(promesas_pago_espejo.credito_id, creditoId),
				eq(promesas_pago_espejo.activa, true),
				gte(promesas_pago_espejo.fecha_promesa, hoy),
			),
		)
		.orderBy(promesas_pago_espejo.fecha_promesa)
		.limit(1);

	return fila ?? null;
}
