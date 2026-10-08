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
import { agruparCasosVigentesPorSifco } from "./caso-vigente";
import { gtDateStrToDate, toDateStrGT } from "./guatemala-month-window";
import {
	cargarSeguimientoPorCaso,
	DIAS_VENTANA_SEGUIMIENTO,
	type SeguimientoCaso,
} from "./seguimiento-cobros";

export const ESTADOS_BOLETA_POR_CONFIRMAR = [
	"revision_manual",
	"confirmada_a_verificar",
] as const;
export const MIN_INTENTOS_REFERENCIAS = 3;
export const DIAS_SIN_GESTION_REFERENCIAS = 7;

const MS_DIA = 24 * 60 * 60 * 1000;
/** Todos los buckets del motor: limita la consulta a cartera al funnel. */
const BUCKETS_FUNNEL = [0, 1, 2, 3, 4, 5];
/** Tamaño de cada consulta a cartera (la lista va en el body si pasa de 50). */
const LOTE_SIFCOS = 200;

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
 * De `sifcos`, los que hoy están en alguna de las carteras `emailsAsesores`
 * (`email_cash_in`) y dentro del funnel. Son varias cuando hay cobertura
 * (CB-114): la propia más las del titular ausente que el usuario cubre. Una
 * consulta por lote y por cartera a `/getAllCredits`.
 *
 * cartera-back filtra `email_asesor` por SUBCADENA (`ILIKE '%…%'`): con
 * `ana@…` también vendrían los créditos de `juana@…`. Por eso cada crédito se
 * confirma acá contra el correo EXACTO de su asesor.
 */
export async function sifcosEnCarteraDe(
	emailsAsesores: string[],
	sifcos: string[],
): Promise<Set<string>> {
	const unicos = [...new Set(sifcos)];
	const enCartera = new Set<string>();
	for (const emailAsesor of new Set(emailsAsesores)) {
		const email = emailAsesor.trim().toLowerCase();
		for (let i = 0; i < unicos.length; i += LOTE_SIFCOS) {
			const lote = unicos.slice(i, i + LOTE_SIFCOS);
			const resp = await carteraBackClient.getAllCreditos({
				mes: 0,
				anio: 0,
				page: 1,
				perPage: lote.length,
				numeros_credito_sifco: lote,
				email_cobrador: emailAsesor,
				buckets: BUCKETS_FUNNEL,
			});
			for (const c of resp.data) {
				const sifco = c.creditos.numero_credito_sifco;
				const emailDelCredito = c.asesores?.emailCashIn?.trim().toLowerCase();
				if (sifco && emailDelCredito === email) enCartera.add(sifco);
			}
		}
	}
	return enCartera;
}

/**
 * B6: boletas por confirmar de los créditos de las carteras que el usuario
 * trabaja hoy (`emailsAsesores`: la propia y las que cubre).
 */
export async function contarPagosPorConfirmar(
	emailsAsesores: string[],
	ahora: Date = new Date(),
): Promise<number> {
	const sifcos = await sifcosConPagoPorConfirmar(undefined, ahora);
	if (sifcos.size === 0) return 0;
	return (await sifcosEnCarteraDe(emailsAsesores, [...sifcos])).size;
}

/**
 * B7: casos del asesor que piden contactar referencias. El universo son los
 * casos activos que el asesor gestionó en la ventana de seguimiento: los
 * intentos sin contacto son suyos, así que un caso que nunca tocó no puede
 * tener tres.
 */
export async function contarReferenciasPorContactar(
	userId: string,
	emailsAsesores: string[],
	ahora: Date = new Date(),
): Promise<number> {
	const desde = new Date(ahora.getTime() - DIAS_VENTANA_SEGUIMIENTO * MS_DIA);
	const casos = await db
		.selectDistinct({
			casoId: casosCobros.id,
			numeroSifco: casosCobros.numeroCreditoSifco,
		})
		.from(contactosCobros)
		.innerJoin(casosCobros, eq(casosCobros.id, contactosCobros.casoCobroId))
		.where(
			and(
				eq(contactosCobros.realizadoPor, userId),
				gte(contactosCobros.fechaContacto, desde),
				eq(casosCobros.activo, true),
				isNotNull(casosCobros.numeroCreditoSifco),
			),
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
			realizadoPor: userId,
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

	// Se cuentan CRÉDITOS, no casos: `casos_cobros.numero_credito_sifco` no
	// tiene índice único y dos casos del mismo crédito no son dos pendientes.
	const sifcosCandidatos = new Set(
		candidatos.map((c) => c.numeroSifco as string),
	);
	return (await sifcosEnCarteraDe(emailsAsesores, [...sifcosCandidatos])).size;
}
