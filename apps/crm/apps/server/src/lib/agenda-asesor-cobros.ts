/**
 * Contadores de la "Agenda de hoy" del Dashboard del asesor que no salen de
 * la cola del día (doc 13, tareas B6 y B7; reglas de negocio del 2026-10-07):
 *
 *  · B6 · Pagos por confirmar: boletas que el cliente mandó por el bot HOY
 *    (día de Guatemala) y que quedaron en `revision_manual` o
 *    `confirmada_a_verificar`. El contador de la Agenda y la acción «Confirmar
 *    pago · recibido hoy» de la tabla usan la MISMA ventana: con dos, el
 *    contador diría «1» sin ninguna fila marcada. «Hoy» también acota el
 *    contador, porque `confirmada_a_verificar` es un estado TERMINAL (nadie la
 *    mueve después): sin tope, solo crecería. Se mide por `created_at` (cuándo
 *    llegó la boleta), no por `updated_at`, que los avisos y el job de respaldo
 *    vuelven a tocar.
 *  · B7 · Referencias por contactar: casos con MIN_INTENTOS_REFERENCIAS o más
 *    intentos sin contacto al titular seguidos y ninguna gestión a sus
 *    referencias en los últimos DIAS_SIN_GESTION_REFERENCIAS días.
 *
 * Los dos parten de lo pequeño (boletas recientes, casos que el asesor gestionó)
 * y después se confirman contra cartera: quien trabaja el crédito lo dice
 * `creditos.asesor_id`, no el CRM.
 */

import { and, eq, gte, inArray, isNotNull, max } from "drizzle-orm";
import { db } from "../db";
import { botCobrosBoletas } from "../db/schema/bot-cobros-boletas";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import { contactosReferenciasCobros } from "../db/schema/referencias-cobros";
import { carteraBackClient } from "../services/cartera-back-client";
import {
	cargarReferencias,
	resolverContextoCaso,
} from "../services/referencias-cobros-datos";
import { agruparCasosVigentesPorSifco } from "./caso-vigente";
import { fetchAllPages, mapWithConcurrency } from "./fetch-all-pages";
import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";
import {
	cargarSeguimientoPorCaso,
	type SeguimientoCaso,
} from "./seguimiento-cobros";

export const ESTADOS_BOLETA_POR_CONFIRMAR = [
	"revision_manual",
	"confirmada_a_verificar",
] as const;
export const MIN_INTENTOS_REFERENCIAS = 3;
export const DIAS_SIN_GESTION_REFERENCIAS = 7;

const MS_DIA = 24 * 60 * 60 * 1000;
/** Casos cuyas referencias se revisan a la vez (cada uno son varias consultas). */
const CONCURRENCIA_REFERENCIAS = 5;

/** Inicio (medianoche GT) del día en que se miden las boletas «recibidas hoy». */
export function inicioVentanaPagoPorConfirmar(ahora: Date = new Date()): Date {
	return gtDateStrToDate(toDateStrGT(ahora));
}

/**
 * SIFCOs (de `sifcos`, o todos si no se pasa) con una boleta del bot por
 * confirmar que llegó HOY (día GT).
 */
export async function sifcosConPagoPorConfirmar(
	sifcos?: string[],
	ahora: Date = new Date(),
): Promise<Set<string>> {
	if (sifcos && sifcos.length === 0) return new Set();
	const desde = inicioVentanaPagoPorConfirmar(ahora);
	const filas = await db
		.selectDistinct({ numeroSifco: botCobrosBoletas.numeroSifco })
		.from(botCobrosBoletas)
		.where(
			and(
				inArray(botCobrosBoletas.estado, [...ESTADOS_BOLETA_POR_CONFIRMAR]),
				gte(botCobrosBoletas.createdAt, desde),
				sifcos ? inArray(botCobrosBoletas.numeroSifco, sifcos) : undefined,
			),
		);
	return new Set(filas.map((f) => f.numeroSifco));
}

/**
 * ¿El caso pide contactar a las referencias? Puro, para probarlo sin DB.
 * `ultimaGestionReferencias` = la gestión a referencias más reciente del caso.
 */
export function debeContactarReferencias(
	seguimiento: SeguimientoCaso,
	ultimaGestionReferencias: Date | null,
	ahora: Date = new Date(),
): boolean {
	if (seguimiento.intentosSinContacto < MIN_INTENTOS_REFERENCIAS) return false;
	if (!ultimaGestionReferencias) return true;
	return (
		ahora.getTime() - ultimaGestionReferencias.getTime() >
		DIAS_SIN_GESTION_REFERENCIAS * MS_DIA
	);
}

/**
 * SIFCOs del universo de la cola del día de las carteras `asesorIds` (la
 * propia y las que cubre, CB-114): el mismo que usa `getColaDia`, el POOL de
 * buckets del asesor (`asesor_bucket`) vía `/buckets/cola-dia`, no el dueño
 * directo del crédito. Un crédito de otro asesor que cae en su pool también
 * está en su cola, así que cuenta en sus contadores.
 */
export async function sifcosDelUniversoDe(
	asesorIds: number[],
): Promise<Set<string>> {
	const universo = new Set<string>();
	const porAsesor = await Promise.all(
		[...new Set(asesorIds)].map((asesorId) =>
			fetchAllPages(
				async (page) => {
					const resp = await carteraBackClient.getColaDiaSLA({
						asesorId,
						page,
						perPage: 100,
					});
					return { data: resp.data, totalPages: resp.totalPages ?? 0 };
				},
				{ maxPages: 200 },
			),
		),
	);
	for (const filas of porAsesor) {
		for (const f of filas) universo.add(f.numero_credito_sifco);
	}
	return universo;
}

/**
 * B6: boletas por confirmar de los créditos del universo de la cola del
 * asesor (`universo`, ver `sifcosDelUniversoDe`).
 */
export async function contarPagosPorConfirmar(
	universo: ReadonlySet<string>,
	ahora: Date = new Date(),
): Promise<number> {
	if (universo.size === 0) return 0;
	const sifcos = await sifcosConPagoPorConfirmar(undefined, ahora);
	let cuenta = 0;
	for (const sifco of sifcos) if (universo.has(sifco)) cuenta++;
	return cuenta;
}

/**
 * B7: casos del asesor que piden contactar referencias. El universo son los
 * casos activos que el asesor gestionó alguna vez, sin tope de días (la regla
 * B7 no lo tiene): los intentos sin contacto son suyos, así que un caso que
 * nunca tocó no puede tener tres. `gestores` = el usuario y, con cobertura
 * (CB-114), los titulares que cubre: hereda su historial del caso.
 */
export async function contarReferenciasPorContactar(
	gestores: string[],
	universo: ReadonlySet<string>,
	ahora: Date = new Date(),
): Promise<number> {
	const gestionados = await db
		.selectDistinct({
			casoId: casosCobros.id,
			numeroSifco: casosCobros.numeroCreditoSifco,
		})
		.from(contactosCobros)
		.innerJoin(casosCobros, eq(casosCobros.id, contactosCobros.casoCobroId))
		.where(
			and(
				inArray(contactosCobros.realizadoPor, gestores),
				eq(casosCobros.activo, true),
				isNotNull(casosCobros.numeroCreditoSifco),
			),
		);
	// Solo lo que está en la cola del asesor; el resto ni se consulta.
	const casos = gestionados.filter((c) =>
		universo.has(c.numeroSifco as string),
	);
	if (casos.length === 0) return 0;

	// Un SIFCO puede tener varios casos (reaperturas, migraciones): se evalúa
	// solo el VIGENTE, elegido entre TODOS los casos del crédito, no solo entre
	// los que el asesor tocó. Si el vigente es otro, el viejo no cuenta.
	const sifcosGestionados = [
		...new Set(casos.map((c) => c.numeroSifco as string)),
	];
	const todosLosCasos = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, sifcosGestionados));
	const vigentePorSifco = agruparCasosVigentesPorSifco(todosLosCasos);
	const casosVigentes = casos.filter(
		(c) => vigentePorSifco.get(c.numeroSifco as string)?.id === c.casoId,
	);
	if (casosVigentes.length === 0) return 0;

	const casoIds = casosVigentes.map((c) => c.casoId);
	const [seguimientos, gestionesReferencias] = await Promise.all([
		// Solo los intentos del asesor (los de otro no son suyos) y sin tope de
		// 60 días: la regla B7 no lo tiene, la ventana es de la vista de
		// seguimiento.
		cargarSeguimientoPorCaso(casoIds, ahora, {
			realizadoPor: gestores,
			sinTopeDeVentana: true,
		}),
		db
			.select({
				casoId: contactosReferenciasCobros.casoCobroId,
				ultima: max(contactosReferenciasCobros.fechaContacto),
			})
			.from(contactosReferenciasCobros)
			.where(inArray(contactosReferenciasCobros.casoCobroId, casoIds))
			.groupBy(contactosReferenciasCobros.casoCobroId),
	]);
	const ultimaPorCaso = new Map(
		gestionesReferencias.map((g) => [g.casoId, g.ultima]),
	);

	const candidatos = casosVigentes.filter((c) => {
		const seguimiento = seguimientos.get(c.casoId);
		return (
			!!seguimiento &&
			debeContactarReferencias(
				seguimiento,
				ultimaPorCaso.get(c.casoId) ?? null,
				ahora,
			)
		);
	});
	if (candidatos.length === 0) return 0;

	// Sin referencias con teléfono no hay a quién llamar: el caso no es una
	// acción pendiente (hay casos sin lead u oportunidad, o sin referencias
	// cargadas). Cada caso son varias consultas, así que se revisan en
	// paralelo acotado (no una por una, ni todas a la vez contra el pool de DB).
	const contactables = await mapWithConcurrency(
		candidatos,
		CONCURRENCIA_REFERENCIAS,
		(c) => tieneReferenciaContactable(c.casoId),
	);
	const conReferencias = candidatos.filter((_, i) => contactables[i]);

	// Se cuentan CRÉDITOS, no casos: `casos_cobros.numero_credito_sifco` no
	// tiene índice único y dos casos del mismo crédito no son dos pendientes.
	return new Set(conReferencias.map((c) => c.numeroSifco as string)).size;
}

/** ¿El caso tiene al menos una referencia con un teléfono al cual llamar? */
async function tieneReferenciaContactable(casoId: string): Promise<boolean> {
	const ctx = await resolverContextoCaso(casoId);
	const { referencias } = await cargarReferencias(ctx);
	return referencias.some((r) => r.telefonos.length > 0);
}
