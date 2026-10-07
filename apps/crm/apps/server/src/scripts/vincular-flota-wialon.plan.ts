/**
 * Planificación y aplicación de los vínculos vehículo ↔ unidad de Wialon
 * (ver vincular-flota-wialon.ts). Sin BD ni red: recibe el diagnóstico ya
 * calculado y un `Escritor` por parámetro, así todo lo que puede salir mal
 * (qué se escribe, con qué marcador, cuándo se aborta, a qué base se apunta,
 * cómo se revierte) se prueba sin tocar nada.
 */

import { matchUnidadPorPlaca } from "../services/wialon/wialon-client";
import type {
	Metodo,
	ResultadoVehiculo,
	UnidadWialon,
} from "./vincular-flota-wialon.logic";

// ── Marcadores de `vehicles.wialon_vinculado_por` ────────────────────────────

/**
 * Mismo valor que `WIALON_VINCULO_AUTO_PLACA` del router (un test los
 * compara). La Ficha 360 lo revalida contra el nombre de la unidad en cada
 * consulta y libera el vínculo si la placa dejó de aparecer en él.
 */
export const MARCADOR_PLACA = "auto:placa";

/**
 * Vínculo deducido por VIN. La ficha NO lo revalida (hoy solo conoce
 * `auto:placa`) y lo muestra como fijado: no se libera solo, y un supervisor
 * puede corregirlo igual que cualquier otro.
 */
export const MARCADOR_VIN = "auto:vin";

/** Placa que solo aparece en el campo `registration_plate` de la unidad. */
export const MARCADOR_REGISTRO = "auto:registro";

export const MARCADORES = [MARCADOR_PLACA, MARCADOR_VIN, MARCADOR_REGISTRO];

// ── Plan ─────────────────────────────────────────────────────────────────────

export interface ItemVinculo {
	vehicleId: string;
	placa: string | null;
	vin: string | null;
	unitId: number;
	unitName: string;
	metodo: Metodo;
	marcador: string;
	/** Desempate de duplicados sin crédito vigente: conviene que lo confirme una persona. */
	confirmar: boolean;
	/** Cómo se llegó a esta unidad (desempates), para el CSV. */
	nota: string | null;
}

export type MotivoExclusion = "requiere_confirmacion" | "fuera_del_limite";

export interface Plan {
	items: ItemVinculo[];
	excluidos: { item: ItemVinculo; motivo: MotivoExclusion }[];
}

/**
 * Marcador con el que se guarda el vínculo. `auto:placa` solo si la propia
 * ficha, al revalidarlo, volvería a elegir esa unidad (placa única en el
 * nombre del catálogo completo): si no, la ficha lo soltaría en la primera
 * consulta y todo el trabajo se perdería.
 */
export function marcadorPara(
	r: ResultadoVehiculo,
	unidades: UnidadWialon[],
): string {
	const metodo = r.metodo;
	if (
		(metodo === "placa" || metodo === "placa+vin") &&
		r.vehiculo.placa &&
		r.unidad &&
		matchUnidadPorPlaca(r.vehiculo.placa, unidades).unidad?.id === r.unidad.id
	) {
		return MARCADOR_PLACA;
	}
	if (metodo === "placa_registration") return MARCADOR_REGISTRO;
	return MARCADOR_VIN;
}

/**
 * Qué se escribiría. Solo entran los vehículos `propuesto`: ya vinculados,
 * ambiguos, en conflicto, en disputa o con la unidad ocupada nunca se tocan.
 * Los desempates sin crédito vigente (`confirmar`) quedan afuera salvo que se
 * pidan, y `max` permite escribir una tanda chica de prueba. El orden es
 * estable (por unidad) para que dos corridas elijan lo mismo.
 *
 * Verifica que ninguna unidad ni vehículo aparezca dos veces: el diagnóstico
 * ya lo garantiza, y si algún día deja de hacerlo mejor abortar que escribir
 * un plan que se contradice.
 */
export function planificar(
	resultados: ResultadoVehiculo[],
	unidades: UnidadWialon[],
	opciones: { incluirConfirmar: boolean; max?: number },
): Plan {
	const candidatos: ItemVinculo[] = resultados
		.filter((r) => r.estado === "propuesto" && r.unidad && r.metodo)
		.map((r) => ({
			vehicleId: r.vehiculo.id,
			placa: r.vehiculo.placa,
			vin: r.vehiculo.vin,
			unitId: (r.unidad as UnidadWialon).id,
			unitName: (r.unidad as UnidadWialon).nm,
			metodo: r.metodo as Metodo,
			marcador: marcadorPara(r, unidades),
			confirmar: r.confirmar === true,
			nota: r.sugerencia,
		}))
		.sort(
			(a, b) => a.unitId - b.unitId || a.vehicleId.localeCompare(b.vehicleId),
		);

	const unidadesVistas = new Set<number>();
	const vehiculosVistos = new Set<string>();
	for (const item of candidatos) {
		if (unidadesVistas.has(item.unitId)) {
			throw new Error(
				`Plan inconsistente: la unidad ${item.unitId} aparece en más de un vehículo`,
			);
		}
		if (vehiculosVistos.has(item.vehicleId)) {
			throw new Error(
				`Plan inconsistente: el vehículo ${item.vehicleId} aparece más de una vez`,
			);
		}
		unidadesVistas.add(item.unitId);
		vehiculosVistos.add(item.vehicleId);
	}

	const excluidos: Plan["excluidos"] = [];
	let items = candidatos.filter((item) => {
		if (item.confirmar && !opciones.incluirConfirmar) {
			excluidos.push({ item, motivo: "requiere_confirmacion" });
			return false;
		}
		return true;
	});
	if (opciones.max !== undefined && items.length > opciones.max) {
		for (const item of items.slice(opciones.max)) {
			excluidos.push({ item, motivo: "fuera_del_limite" });
		}
		items = items.slice(0, opciones.max);
	}
	return { items, excluidos };
}

// ── Aplicación ───────────────────────────────────────────────────────────────

export type ResultadoEscritura =
	| "guardado"
	/** Otro vehículo ya tiene esa unidad guardada. */
	| "unidad_ocupada"
	/** El vehículo ya tiene un vínculo (alguien lo fijó mientras corría el script). */
	| "vehiculo_ya_vinculado"
	/** La placa o el VIN del vehículo cambiaron desde el diagnóstico. */
	| "datos_cambiaron";

export interface Escritor {
	vincular(item: ItemVinculo): Promise<ResultadoEscritura>;
}

export interface ResultadoAplicacion {
	guardados: ItemVinculo[];
	omitidos: { item: ItemVinculo; resultado: ResultadoEscritura }[];
	errores: { item: ItemVinculo; error: string }[];
	/** Se detuvo antes de terminar por demasiados errores. */
	abortado: boolean;
	/** Cuántos quedaron sin intentar por el aborto. */
	pendientes: number;
}

/**
 * Envuelve un `Escritor` para registrar cada vínculo apenas ocurre, antes de
 * pasar al siguiente. Cada vínculo se confirma en su propia transacción: si el
 * proceso se corta a la mitad, lo ya escrito tiene que quedar en los archivos
 * de resultado y de reversa, no solo en memoria.
 *
 * Si registrar falla (antes o después de escribir) se lanza `RegistroFallido`
 * y `aplicarPlan` se detiene: seguir escribiendo con el registro roto dejaría
 * vínculos confirmados fuera de la reversa.
 *
 * `antes` corre ANTES de escribir: entre que la transacción confirma y que
 * `despues` registra hay una ventana en la que un corte dejaría un vínculo
 * escrito sin registrar, así que la reversa se prepara incluyéndolo de
 * antemano. `despues` corre con el resultado, o con el error, que se vuelve a
 * lanzar para que `aplicarPlan` lo cuente.
 */
export class RegistroFallido extends Error {
	constructor(
		readonly item: ItemVinculo,
		causa: unknown,
	) {
		super(
			`No se pudo registrar el vínculo ${item.vehicleId} → ${item.unitId}: ${causa instanceof Error ? causa.message : String(causa)}`,
		);
		this.name = "RegistroFallido";
	}
}

export function conRegistro(
	escritor: Escritor,
	registro: {
		antes?: (item: ItemVinculo) => void;
		despues: (
			item: ItemVinculo,
			resultado: ResultadoEscritura | { error: string },
		) => void;
	},
): Escritor {
	return {
		async vincular(item) {
			const registrar = (fn: () => void) => {
				try {
					fn();
				} catch (error) {
					throw new RegistroFallido(item, error);
				}
			};
			registrar(() => registro.antes?.(item));
			let resultado: ResultadoEscritura;
			try {
				resultado = await escritor.vincular(item);
			} catch (error) {
				registrar(() =>
					registro.despues(item, {
						error: error instanceof Error ? error.message : String(error),
					}),
				);
				throw error;
			}
			registrar(() => registro.despues(item, resultado));
			return resultado;
		},
	};
}

/**
 * Escribe de a uno y en orden. Un error de un vínculo no frena a los demás
 * (cada uno va en su propia transacción), pero `maxErrores` seguidos o en
 * total cortan la corrida: si algo está roto (base caída, permisos) no tiene
 * sentido seguir intentando cientos de veces.
 */
export async function aplicarPlan(
	items: ItemVinculo[],
	escritor: Escritor,
	opciones: {
		maxErrores?: number;
		alProgresar?: (hechos: number, total: number) => void;
	} = {},
): Promise<ResultadoAplicacion> {
	const maxErrores = opciones.maxErrores ?? 5;
	const resultado: ResultadoAplicacion = {
		guardados: [],
		omitidos: [],
		errores: [],
		abortado: false,
		pendientes: 0,
	};
	for (const [i, item] of items.entries()) {
		if (resultado.errores.length >= maxErrores) {
			resultado.abortado = true;
			resultado.pendientes = items.length - i;
			break;
		}
		try {
			const r = await escritor.vincular(item);
			if (r === "guardado") resultado.guardados.push(item);
			else resultado.omitidos.push({ item, resultado: r });
		} catch (error) {
			resultado.errores.push({
				item,
				error: error instanceof Error ? error.message : String(error),
			});
			// Sin registro no se sigue: lo ya escrito quedó cubierto por la
			// reversa preparada, y escribir más la dejaría incompleta.
			if (error instanceof RegistroFallido) {
				resultado.abortado = true;
				resultado.pendientes = items.length - i - 1;
				break;
			}
		}
		opciones.alProgresar?.(i + 1, items.length);
	}
	return resultado;
}

// ── Destino de la base ───────────────────────────────────────────────────────

export interface DestinoBd {
	host: string;
	puerto: string;
	bd: string;
}

/** Hosts de producción del CRM: el script jamás escribe ahí. */
const HOSTS_PRODUCCION = ["ep-winter-butterfly"];

/** A qué base apunta una URL, sin credenciales. Null si no es una URL válida. */
export function destinoBd(url: string | undefined): DestinoBd | null {
	if (!url) return null;
	try {
		const u = new URL(url);
		if (!u.hostname) return null;
		return {
			host: u.hostname,
			puerto: u.port || "5432",
			bd: u.pathname.replace(/^\//, ""),
		};
	} catch {
		return null;
	}
}

/**
 * Para escribir hay que haber tecleado el host de la base a propósito
 * (`--confirmar-bd=<host>`): evita aplicar contra la base equivocada por
 * dejar un `.env` apuntando a otro lado. Producción se rechaza siempre.
 */
export function validarDestinoParaEscribir(
	destino: DestinoBd | null,
	confirmar: string | undefined,
): { ok: true } | { ok: false; motivo: string } {
	if (!destino) {
		return {
			ok: false,
			motivo: "DATABASE_URL no está definida o no es válida.",
		};
	}
	if (HOSTS_PRODUCCION.some((h) => destino.host.includes(h))) {
		return {
			ok: false,
			motivo: `${destino.host} es producción: este script nunca escribe ahí.`,
		};
	}
	if (confirmar !== destino.host) {
		return {
			ok: false,
			motivo: `Para escribir en ${destino.host}/${destino.bd} agregue --confirmar-bd=${destino.host}`,
		};
	}
	return { ok: true };
}

// ── Reversa ──────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * SQL que deshace exactamente lo escrito: solo suelta los vehículos que
 * siguen con la misma unidad y el mismo marcador, así no pisa un vínculo que
 * un supervisor corrigió después. Va con BEGIN/COMMIT y el conteo esperado.
 */
export function sqlReversa(guardados: ItemVinculo[], fecha: Date): string {
	// `FROM (VALUES )` no es SQL válido: sin vínculos no hay nada que revertir.
	if (guardados.length === 0) {
		throw new Error("sqlReversa: no hay vínculos guardados que revertir");
	}
	const filas = guardados.map((g) => {
		if (!UUID.test(g.vehicleId)) {
			throw new Error(`vehicleId inválido para la reversa: ${g.vehicleId}`);
		}
		if (!MARCADORES.includes(g.marcador)) {
			throw new Error(`Marcador desconocido para la reversa: ${g.marcador}`);
		}
		return `  ('${g.vehicleId}', ${Number(g.unitId)}, '${g.marcador}')`;
	});
	return [
		`-- Revierte los ${guardados.length} vínculos escritos por vincular-flota-wialon.ts (${fecha.toISOString()}).`,
		"-- Solo suelta un vehículo si sigue con la misma unidad y el mismo marcador.",
		"BEGIN;",
		"UPDATE vehicles v",
		"SET wialon_unit_id = NULL, wialon_unit_name = NULL,",
		"    wialon_vinculado_at = NULL, wialon_vinculado_por = NULL",
		"FROM (VALUES",
		filas.join(",\n"),
		") AS x(id, unit_id, marcador)",
		"WHERE v.id = x.id::uuid",
		"  AND v.wialon_unit_id = x.unit_id",
		"  AND v.wialon_vinculado_por = x.marcador;",
		`-- Debe decir UPDATE ${guardados.length}. Si dice menos, alguien cambió esos vínculos después.`,
		"COMMIT;",
		"",
	].join("\n");
}
