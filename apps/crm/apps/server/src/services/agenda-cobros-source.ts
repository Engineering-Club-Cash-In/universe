import { and, eq, inArray, isNotNull, isNull, max, or } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros, contactosCobros } from "../db/schema/cobros";
import {
	type AgendaSnapshotItemFuente,
	deduplicarAgenda,
	ventanaDiaGuatemala,
} from "../lib/agenda-cobros-snapshot";
import { agruparCasosVigentesPorSifco } from "../lib/caso-vigente";
import { clasificarCreditoColaDia } from "../lib/cola-dia";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { gtDateStrToDate, toDateStrGT } from "../lib/guatemala-month-window";
import type {
	CarteraColaDiaFila,
	CarteraCuotaProximaVencer,
	CarteraCuotasProximasResponse,
	PoolPorAsesorRow,
} from "../types/cartera-back";
import { carteraBackClient } from "./cartera-back-client";

const PAGE_SIZE_SNAPSHOT = 200;
const MAX_PAGES_PER_DAY = 10_000;

export interface AsesorAgenda {
	userId: string;
	asesorCarteraId: number;
	nombre: string;
}

export type FetchAgendaPage = (
	dia: number,
	page: number,
	asesorId: number,
	perPage: number,
) => Promise<
	Pick<CarteraCuotasProximasResponse, "page" | "totalPages"> & {
		data: Pick<CarteraCuotaProximaVencer, "numero_credito_sifco" | "bucket">[];
	}
>;

const normalizarEmail = (email: string | null | undefined): string | null =>
	email?.trim().toLowerCase() || null;

export function buscarAsesorCarteraPorEmail(
	pool: readonly PoolPorAsesorRow[],
	email: string | null | undefined,
): PoolPorAsesorRow | undefined {
	const normalizado = normalizarEmail(email);
	if (!normalizado) return undefined;
	return pool.find(
		(asesor) => normalizarEmail(asesor.email_cash_in) === normalizado,
	);
}

// Mismos 3 roles que getUsuariosCobros (cobros.ts) considera "equipo de
// cobros" — un usuario que cambió de rol o quedó baneado no debe seguir
// recibiendo snapshot diario ni contar en el ranking de supervisor.
const ROLES_AGENDA_COBROS = new Set(["cobros", "cobros_supervisor", "admin"]);

export function resolverAsesoresAgenda(
	usuarios: readonly {
		id: string;
		email: string;
		role: string;
		banned: boolean | null;
	}[],
	pool: readonly PoolPorAsesorRow[],
): AsesorAgenda[] {
	const usuarioPorEmail = new Map(
		usuarios
			.filter(
				(usuario) => !usuario.banned && ROLES_AGENDA_COBROS.has(usuario.role),
			)
			.map((usuario) => [normalizarEmail(usuario.email), usuario.id]),
	);
	return pool.flatMap((asesor) => {
		const userId = usuarioPorEmail.get(normalizarEmail(asesor.email_cash_in));
		return userId
			? [{ userId, asesorCarteraId: asesor.asesor_id, nombre: asesor.nombre }]
			: [];
	});
}

export function filtrarAsesoresAgenda(
	asesores: readonly AsesorAgenda[],
	asesorUserId?: string,
): AsesorAgenda[] {
	return asesorUserId
		? asesores.filter((asesor) => asesor.userId === asesorUserId)
		: [...asesores];
}

export async function obtenerPaginaAgenda(
	dia: number,
	opciones: { asesorId?: number; page: number; perPage: number },
): Promise<CarteraCuotasProximasResponse> {
	return carteraBackClient.getCuotasProximasVencer([dia], {
		soloAlDia: false,
		asesorId: opciones.asesorId,
		page: opciones.page,
		perPage: opciones.perPage,
	});
}

const fetchAgendaPageProduccion: FetchAgendaPage = (
	dia,
	page,
	asesorId,
	perPage,
) => obtenerPaginaAgenda(dia, { asesorId, page, perPage });

/**
 * Limitación conocida (catch-up de boot tardío): `getCuotasProximasVencer`
 * es un endpoint LIVE de cartera-back, sin cache — refleja pagos y ajustes
 * de fecha al instante (ver el comentario en cartera-back-client.ts junto a
 * esta llamada). Si el boot corre horas después de medianoche GT y una
 * cuota D-0 ya se pagó ANTES de que el catch-up corra, esa cuota ya
 * desapareció de "próximas a vencer" y este fetch nunca la ve — queda fuera
 * del snapshot de "inicio de día" aunque SÍ estaba planificada para hoy. El
 * `hoy` inyectado en obtenerColaOperacionAsesor (más abajo) NO corrige esto:
 * solo fija la clasificación de contacto CRM, no recupera ítems D-0 que la
 * fuente externa ya dejó de reportar. No hay fix limpio sin que cartera-back
 * exponga un endpoint histórico/point-in-time, o que el CRM guarde su
 * propio snapshot de "qué vence hoy" antes de las 00:00 (ninguno existe hoy)
 * (Codex PR #1330).
 */
export async function obtenerAgendaAsesor(
	asesor: AsesorAgenda,
	buscarPagina: FetchAgendaPage = fetchAgendaPageProduccion,
): Promise<AgendaSnapshotItemFuente[]> {
	const items: AgendaSnapshotItemFuente[] = [];
	for (const dia of [0]) {
		let page = 1;
		while (page <= MAX_PAGES_PER_DAY) {
			const respuesta = await buscarPagina(
				dia,
				page,
				asesor.asesorCarteraId,
				PAGE_SIZE_SNAPSHOT,
			);
			for (const cuota of respuesta.data ?? []) {
				items.push({
					asesorId: asesor.userId,
					asesorNombre: asesor.nombre,
					numeroCreditoSifco: cuota.numero_credito_sifco,
					casoCobroId: null,
					bucketSnapshot: cuota.bucket,
					motivoAgenda: `D-${dia}` as AgendaSnapshotItemFuente["motivoAgenda"],
				});
			}

			const totalPages = respuesta.totalPages ?? 1;
			if (page >= totalPages) break;
			page++;
		}
		if (page > MAX_PAGES_PER_DAY) {
			throw new Error(
				`Agenda excedió ${MAX_PAGES_PER_DAY} páginas para asesor ${asesor.asesorCarteraId}, D-${dia}`,
			);
		}
	}
	return items;
}

/**
 * Reutiliza clasificación compartida de Cola del Día, pero solo conserva SLA y
 * promesas que vencen HOY. Las demás categorías son seguimiento, no agenda
 * planificada de cumplimiento diario.
 *
 * `hoy` es inyectable y default a `new Date()` para no romper callers/tests
 * existentes, pero el caller real (`obtenerAgendaTodosAsesores`, desde
 * `ejecutarAgendaCobrosDiaria`) SIEMPRE pasa el instante 00:00 GT del día que
 * se está capturando — no el momento real de ejecución. Si el job corre por
 * el schedule normal (00:05 GT) da igual; si corre por catch-up de boot horas
 * después (deploy tardío, `index.ts`), usar `new Date()` real haría que un
 * crédito ya contactado esa mañana (antes del catch-up) apareciera como
 * `contactadoHoy: true` y quedara AFUERA del snapshot — el "planificado" del
 * asesor saldría artificialmente bajo, inflando su % de cumplimiento.
 */
export async function obtenerColaOperacionAsesor(
	asesor: AsesorAgenda,
	hoy: Date = new Date(),
): Promise<AgendaSnapshotItemFuente[]> {
	const universo = await fetchAllPages(
		async (page) => {
			const respuesta = await carteraBackClient.getColaDiaSLA({
				asesorId: asesor.asesorCarteraId,
				page,
				perPage: 100,
			});
			return { data: respuesta.data, totalPages: respuesta.totalPages ?? 0 };
		},
		{ maxPages: 200 },
	);
	if (universo.length === 0) return [];

	const sifcos = [
		...new Set(universo.map((credito) => credito.numero_credito_sifco)),
	];
	const casos = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, sifcos));
	const casoPorSifco = agruparCasosVigentesPorSifco(casos);
	const casoIds = [...casoPorSifco.values()].map((caso) => caso.id);

	const [promesas, ultimosContactos] = await Promise.all([
		casoIds.length === 0
			? Promise.resolve([])
			: db
					.select({
						casoCobroId: contactosCobros.casoCobroId,
						estadoPromesa: contactosCobros.estadoPromesa,
						fechaProximoContacto: contactosCobros.fechaProximoContacto,
						fechaAlerta: contactosCobros.fechaAlerta,
					})
					.from(contactosCobros)
					.where(
						and(
							inArray(contactosCobros.casoCobroId, casoIds),
							eq(contactosCobros.estadoContacto, "promesa_pago"),
							isNotNull(contactosCobros.fechaProximoContacto),
							or(
								eq(contactosCobros.estadoPromesa, "pendiente"),
								eq(contactosCobros.estadoPromesa, "incumplida"),
								isNull(contactosCobros.estadoPromesa),
							),
						),
					),
		casoIds.length === 0
			? Promise.resolve([])
			: db
					.select({
						casoCobroId: contactosCobros.casoCobroId,
						ultimaFecha: max(contactosCobros.fechaContacto),
					})
					.from(contactosCobros)
					.where(inArray(contactosCobros.casoCobroId, casoIds))
					.groupBy(contactosCobros.casoCobroId),
	]);

	const promesasPorCaso = new Map<
		string,
		Array<{
			estadoPromesa: "pendiente" | "incumplida";
			fechaPrometida: Date;
			fechaAlerta?: Date | null;
		}>
	>();
	for (const promesa of promesas) {
		const estadoPromesa = promesa.estadoPromesa ?? "pendiente";
		if (estadoPromesa === "cumplida") continue;
		const lista = promesasPorCaso.get(promesa.casoCobroId) ?? [];
		lista.push({
			estadoPromesa,
			fechaPrometida: promesa.fechaProximoContacto as Date,
			fechaAlerta: promesa.fechaAlerta,
		});
		promesasPorCaso.set(promesa.casoCobroId, lista);
	}

	const hoyStr = toDateStrGT(hoy);
	const contactadoHoy = new Set(
		ultimosContactos
			.filter((contacto) =>
				contacto.ultimaFecha
					? toDateStrGT(contacto.ultimaFecha) === hoyStr
					: false,
			)
			.map((contacto) => contacto.casoCobroId),
	);
	const hoyMs = gtDateStrToDate(hoyStr).getTime();
	const diasSinContacto = new Map(
		ultimosContactos.flatMap((contacto) => {
			if (!contacto.ultimaFecha) return [];
			const ultimaMs = gtDateStrToDate(
				toDateStrGT(contacto.ultimaFecha),
			).getTime();
			return [
				[contacto.casoCobroId, Math.floor((hoyMs - ultimaMs) / 86_400_000)],
			];
		}),
	);

	return (universo as CarteraColaDiaFila[]).flatMap<AgendaSnapshotItemFuente>(
		(credito) => {
			const caso = casoPorSifco.get(credito.numero_credito_sifco);
			const clasificacion = clasificarCreditoColaDia(
				{
					fechaLimiteSla: credito.fecha_limite_sla,
					contactadoHoy: caso ? contactadoHoy.has(caso.id) : false,
					promesas: caso ? (promesasPorCaso.get(caso.id) ?? []) : [],
					diasSinContacto: caso ? (diasSinContacto.get(caso.id) ?? null) : null,
				},
				hoy,
			);
			const base = {
				asesorId: asesor.userId,
				asesorNombre: asesor.nombre,
				numeroCreditoSifco: credito.numero_credito_sifco,
				casoCobroId: caso?.id ?? null,
				bucketSnapshot: credito.bucket,
			};
			if (clasificacion.slaHoy) return [{ ...base, motivoAgenda: "sla_hoy" }];
			if (clasificacion.promesaHoy)
				return [{ ...base, motivoAgenda: "promesa_hoy" }];
			return [];
		},
	);
}

export async function obtenerAgendaTodosAsesores(
	asesorUserId?: string,
	fechaHoyGT: string = toDateStrGT(new Date()),
): Promise<AgendaSnapshotItemFuente[]> {
	// Instante 00:00 GT del día que se captura — no el momento real de
	// ejecución. Ver comentario de obtenerColaOperacionAsesor: evita que un
	// catch-up de boot tardío (horas después de medianoche) excluya del
	// snapshot créditos que el asesor ya contactó esa mañana.
	const hoy = ventanaDiaGuatemala(fechaHoyGT).desde;
	const [usuarios, pool] = await Promise.all([
		db
			.select({
				id: user.id,
				email: user.email,
				role: user.role,
				banned: user.banned,
			})
			.from(user),
		carteraBackClient.getPoolPorAsesor(),
	]);
	const asesores = filtrarAsesoresAgenda(
		resolverAsesoresAgenda(usuarios, pool),
		asesorUserId,
	);
	const agendas: AgendaSnapshotItemFuente[] = [];
	for (const asesor of asesores) {
		// try/catch por asesor: un fallo transitorio de cartera-back para UNO
		// no debe descartar lo ya acumulado de los demás. Sin esto, un solo
		// asesor caído tumbaba el snapshot del EQUIPO COMPLETO ese día — y
		// como el cierre solo revisita el día inmediatamente anterior, ese
		// día quedaba sin captura para siempre (Codex PR #1330).
		try {
			const [vencenHoy, colaOperacion] = await Promise.all([
				obtenerAgendaAsesor(asesor),
				obtenerColaOperacionAsesor(asesor, hoy),
			]);
			agendas.push(...deduplicarAgenda([...vencenHoy, ...colaOperacion]));
		} catch (error) {
			console.error(
				`[AgendaCobrosSnapshot] Falló la agenda de ${asesor.nombre} (${asesor.userId}); se omite del snapshot de hoy:`,
				error,
			);
		}
	}

	const sifcos = [...new Set(agendas.map((item) => item.numeroCreditoSifco))];
	if (sifcos.length === 0) return [];
	const casos = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			activo: casosCobros.activo,
			updatedAt: casosCobros.updatedAt,
		})
		.from(casosCobros)
		.where(inArray(casosCobros.numeroCreditoSifco, sifcos));
	const casoPorSifco = agruparCasosVigentesPorSifco(casos);
	return agendas.map((item) => ({
		...item,
		casoCobroId: casoPorSifco.get(item.numeroCreditoSifco)?.id ?? null,
	}));
}
