import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	FilaCartera,
	FilaCola,
} from "@/components/cobros/asesor/fila-cartera";
import {
	ORDEN_INICIAL,
	type OrdenCartera,
	ordenarPagina,
	type PeriodoCartera,
	refinarPagina,
} from "@/components/cobros/asesor/filtros-cartera";
import { type client, orpc } from "@/utils/orpc";
import {
	type AlertaConvenio,
	type AlertaPromesa,
	type ConteosSegmentos,
	contarPorCategoria,
	type DetalleSegmento,
	EXTRAS_COLA,
	type ItemCola,
	normalizarNombre,
	type Segmento,
	sinRepetidos,
} from "./segmentos";
import type { AsesorOpcion, CasoSinFila } from "./vista-supervision";

/**
 * Datos de la Cartera general del supervisor que Mi Cartera no tenía: la lista
 * de asesores y los segmentos (Cola del día, Alertas de promesas y de convenios).
 *
 * `getTodosLosCreditos` todavía no filtra por categoría de la cola ni de las
 * alertas (tarea S5 de José). Mientras tanto, cada segmento se arma en el
 * cliente con lo que ya existe:
 *
 *   1. La fuente (`getColaDia`, `getAlertasPromesas` o `getAlertasConvenios`)
 *      da la lista de SIFCOs del segmento, en su orden de prioridad.
 *   2. `getTodosLosCreditos({ numerosSifco })` completa las columnas de la
 *      tabla y aplica los demás filtros (bucket, búsqueda, asesor por correo,
 *      período, etiquetas, capital…). Los créditos en convenio están en
 *      `EN_CONVENIO` y el servidor, sin etapa, solo trae `ACTIVO`: por eso se
 *      pide también `estadoMora: "en_convenio"` y se juntan.
 *   3. Con 200 SIFCOs o menos (el máximo de `numerosSifco`), el total y la
 *      paginación son exactos y se pagina en el cliente. Con más, se pagina la
 *      fuente y los demás filtros se aplican solo sobre cada página (se avisa).
 */

type InputCreditos = NonNullable<
	Parameters<typeof client.getTodosLosCreditos>[0]
>;

/** Lo que `getTodosLosCreditos` recibe como filtros (sin paginación ni dueño). */
export type FiltrosCreditos = Omit<
	InputCreditos,
	"limit" | "offset" | "numerosSifco" | "emailCobrador" | "filtroGestion"
>;

/** Máximo de `numerosSifco` en `getTodosLosCreditos` (y de `perPage` en la cola). */
export const MAX_SIFCOS = 200;

const formatoEntero = new Intl.NumberFormat("es-GT");

/* ── Asesores ───────────────────────────────────────────────────────────────── */

/**
 * `getAsesoresTraslados` es el único que trae, por asesor, el `asesor_id` de
 * cartera (cola, convenios), el correo de Cash-In (getTodosLosCreditos, stats)
 * y el `userId` del CRM.
 */
export function useAsesoresCartera(habilitado: boolean) {
	const q = useQuery({
		...orpc.getAsesoresTraslados.queryOptions(),
		enabled: habilitado,
		staleTime: 5 * 60_000,
	});
	const todos = useMemo<(AsesorOpcion & { activo: boolean })[]>(
		() =>
			(q.data ?? [])
				.map((a) => ({
					asesorId: a.asesor_id,
					nombre: a.nombre,
					email: a.email_cash_in,
					activo: a.activo !== false,
				}))
				.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
		[q.data],
	);
	const activos = useMemo(() => todos.filter((a) => a.activo), [todos]);
	return {
		todos,
		activos,
		cargando: q.isLoading,
		listo: q.isSuccess || q.isError,
	};
}

/* ── Segmentos ──────────────────────────────────────────────────────────────── */

type Fuente = {
	/** SIFCOs a consultar en cartera, en el orden de la fuente. */
	sifcos: string[];
	/** Créditos del segmento (puede ser mayor que `sifcos` si se pagina la fuente). */
	total: number;
	/** true = la fuente tiene más de 200: se pagina allá, no en el cliente. */
	paginaEnFuente: boolean;
	detalles: Map<string, DetalleSegmento>;
	cargando: boolean;
	actualizando: boolean;
	error: unknown;
	refetch: () => void;
	/** Mensaje si el asesor elegido está ausente hoy (su cola la trabaja el suplente). */
	ausente: string | null;
};

export type ResultadoSegmento = {
	filas: FilaCartera[];
	total: number;
	totalPaginas: number;
	cargando: boolean;
	actualizando: boolean;
	error: string | null;
	refetch: () => void;
	detalles: Map<string, DetalleSegmento>;
	sinFila: CasoSinFila[];
	avisos: string[];
};

function mensajeError(e: unknown) {
	return e instanceof Error && e.message
		? e.message
		: "Intente de nuevo en unos minutos.";
}

export function useCarteraGeneral(opts: {
	habilitado: boolean;
	asesorId: number | null;
	asesor: AsesorOpcion | undefined;
	segmento: Segmento | null;
	filtros: FiltrosCreditos;
	periodo: PeriodoCartera;
	etapa: string | null;
	orden: OrdenCartera;
	page: number;
	pageSize: number;
	/** Hay filtros además del segmento y el asesor (no se listan los «sin fila»). */
	hayOtrosFiltros: boolean;
}): {
	conteos: Pick<ConteosSegmentos, "promesa" | "convenio">;
	resultado: ResultadoSegmento | null;
} {
	const { habilitado, asesorId, segmento, page, pageSize } = opts;

	/* ── Alertas (siempre, para los conteos de los chips) ─────────────────── */
	const promesasQ = useQuery({
		...orpc.getAlertasPromesas.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	const conveniosQ = useQuery({
		...orpc.getAlertasConvenios.queryOptions({ input: {} }),
		enabled: habilitado,
	});

	const nombreAsesor = opts.asesor?.nombre ?? null;
	// Las promesas solo traen el nombre del dueño en cartera (no el asesor_id):
	// el filtro por asesor compara nombres. Los convenios sí traen asesor_id.
	const promesas = useMemo(() => {
		const todas = (promesasQ.data as AlertaPromesa[] | undefined) ?? [];
		if (asesorId === null) return todas;
		const n = normalizarNombre(nombreAsesor);
		return todas.filter((a) => normalizarNombre(a.asesorNombre) === n);
	}, [promesasQ.data, asesorId, nombreAsesor]);
	const convenios = useMemo(() => {
		const todas = (conveniosQ.data as AlertaConvenio[] | undefined) ?? [];
		return asesorId === null
			? todas
			: todas.filter((a) => a.asesor_id === asesorId);
	}, [conveniosQ.data, asesorId]);

	const conteos = useMemo(
		() => ({
			promesa: promesasQ.data
				? contarPorCategoria(
						promesas.map((a) => ({
							categoria: a.categoria,
							sifco: a.numeroCreditoSifco,
						})),
					)
				: {},
			convenio: conveniosQ.data
				? contarPorCategoria(
						convenios.map((a) => ({
							categoria: a.categoria,
							sifco: a.numero_credito_sifco,
						})),
					)
				: {},
		}),
		[promesas, convenios, promesasQ.data, conveniosQ.data],
	);

	/* ── Cola del día ─────────────────────────────────────────────────────── */
	const valorCola = segmento?.tipo === "cola" ? segmento.valor : null;
	const enCola = habilitado && valorCola !== null;
	const esExtra = (EXTRAS_COLA as readonly string[]).includes(valorCola ?? "");
	const inputCola = {
		// Cast: ver dashboard-asesor.tsx (union de categorías vs. el problema de ORPC).
		filtro: (valorCola && valorCola !== "todas" && !esExtra
			? valorCola
			: undefined) as never,
		filtroExtra: esExtra
			? (valorCola as (typeof EXTRAS_COLA)[number])
			: undefined,
		asesorId: asesorId ?? undefined,
	};
	const colaQ = useQuery({
		...orpc.getColaDia.queryOptions({
			input: { ...inputCola, page: 1, perPage: MAX_SIFCOS },
		}),
		enabled: enCola,
		placeholderData: keepPreviousData,
		// Coberturas y gestiones cambian desde otras sesiones (como la página vieja).
		refetchInterval: 60_000,
	});
	const colaTotal = colaQ.data?.total ?? 0;
	const colaDesborda = colaTotal > MAX_SIFCOS;
	const colaPaginaQ = useQuery({
		...orpc.getColaDia.queryOptions({
			input: { ...inputCola, page, perPage: pageSize },
		}),
		enabled: enCola && colaDesborda,
		placeholderData: keepPreviousData,
		refetchInterval: 60_000,
	});

	/* ── Fuente del segmento elegido ──────────────────────────────────────── */
	const fuente = useMemo<Fuente | null>(() => {
		if (!segmento) return null;
		if (segmento.tipo === "cola") {
			const q = colaDesborda ? colaPaginaQ : colaQ;
			const items = (q.data?.items ?? []) as FilaCola[];
			const detalles = new Map<string, DetalleSegmento>();
			for (const i of items) {
				detalles.set(i.numeroCreditoSifco, {
					tipo: "cola",
					item: i as unknown as ItemCola,
					mostrarAsesor: asesorId === null,
				});
			}
			const datos = colaQ.data as
				| {
						ausente?: boolean;
						asesorForzado?: { nombre: string } | null;
				  }
				| undefined;
			return {
				sifcos: sinRepetidos(items.map((i) => i.numeroCreditoSifco)),
				total: colaDesborda ? colaTotal : items.length,
				paginaEnFuente: colaDesborda,
				detalles,
				cargando: colaQ.isLoading || (colaDesborda && colaPaginaQ.isLoading),
				actualizando: colaQ.isPlaceholderData || colaPaginaQ.isPlaceholderData,
				error: colaQ.error ?? colaPaginaQ.error,
				refetch: () => {
					void colaQ.refetch();
					if (colaDesborda) void colaPaginaQ.refetch();
				},
				ausente:
					datos?.ausente && datos.asesorForzado
						? `${datos.asesorForzado.nombre} está registrado como ausente hoy: su cola la está trabajando su suplente.`
						: null,
			};
		}
		const detalles = new Map<string, DetalleSegmento>();
		let orden: string[];
		let q: typeof promesasQ | typeof conveniosQ;
		if (segmento.tipo === "promesa") {
			q = promesasQ;
			const filas = promesas.filter(
				(a) => segmento.valor === "todas" || a.categoria === segmento.valor,
			);
			for (const a of filas) {
				if (!a.numeroCreditoSifco) continue;
				const previo = detalles.get(a.numeroCreditoSifco);
				if (previo?.tipo === "promesa") previo.alertas.push(a);
				else
					detalles.set(a.numeroCreditoSifco, {
						tipo: "promesa",
						alertas: [a],
					});
			}
			orden = sinRepetidos(filas.map((a) => a.numeroCreditoSifco));
		} else {
			q = conveniosQ;
			const filas = convenios.filter(
				(a) => segmento.valor === "todas" || a.categoria === segmento.valor,
			);
			for (const a of filas) {
				if (!detalles.has(a.numero_credito_sifco))
					detalles.set(a.numero_credito_sifco, { tipo: "convenio", alerta: a });
			}
			orden = sinRepetidos(filas.map((a) => a.numero_credito_sifco));
		}
		const desborda = orden.length > MAX_SIFCOS;
		return {
			sifcos: desborda
				? orden.slice((page - 1) * pageSize, page * pageSize)
				: orden,
			total: orden.length,
			paginaEnFuente: desborda,
			detalles,
			cargando: q.isLoading,
			actualizando: false,
			error: q.error,
			refetch: () => void q.refetch(),
			ausente: null,
		};
	}, [
		segmento,
		colaQ,
		colaPaginaQ,
		colaDesborda,
		colaTotal,
		promesasQ,
		conveniosQ,
		promesas,
		convenios,
		asesorId,
		page,
		pageSize,
	]);

	/* ── Filas de cartera de esos SIFCOs ──────────────────────────────────── */
	const sifcos = fuente?.sifcos ?? [];
	const inputLista: InputCreditos = {
		...opts.filtros,
		numerosSifco: sifcos,
		limit: MAX_SIFCOS,
		offset: 0,
		emailCobrador: opts.asesor?.email ?? undefined,
	};
	const conLista = habilitado && !!segmento && sifcos.length > 0;
	const listaQ = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({ input: inputLista }),
		enabled: conLista,
		placeholderData: keepPreviousData,
	});
	// Sin etapa elegida el servidor trae solo ACTIVO: los créditos en convenio
	// (EN_CONVENIO) se piden aparte.
	const enConvenioQ = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: { ...inputLista, estadoMora: "en_convenio" },
		}),
		enabled: conLista && !opts.filtros.estadoMora,
		placeholderData: keepPreviousData,
	});

	const resultado = useMemo<ResultadoSegmento | null>(() => {
		if (!segmento || !fuente) return null;
		const vistos = new Set<string>();
		const juntas: FilaCartera[] = [];
		const listas = [
			conLista ? (listaQ.data?.data ?? []) : [],
			conLista && !opts.filtros.estadoMora
				? (enConvenioQ.data?.data ?? [])
				: [],
		];
		for (const lista of listas) {
			for (const f of lista) {
				if (vistos.has(f.contratoId)) continue;
				vistos.add(f.contratoId);
				juntas.push(f);
			}
		}
		const posicion = new Map(fuente.sifcos.map((s, i) => [s, i]));
		const refinadas = refinarPagina(juntas, {
			periodo: opts.periodo,
			etapa: opts.etapa,
		});
		// Por defecto, el orden de prioridad de la fuente (como en las páginas
		// viejas); si se eligió otro orden, ese.
		const ordenadas =
			opts.orden.campo === ORDEN_INICIAL.campo &&
			opts.orden.dir === ORDEN_INICIAL.dir
				? [...refinadas].sort(
						(a, b) =>
							(posicion.get(a.numeroCredito ?? "") ?? Number.MAX_SAFE_INTEGER) -
							(posicion.get(b.numeroCredito ?? "") ?? Number.MAX_SAFE_INTEGER),
					)
				: ordenarPagina(refinadas, opts.orden);

		const total = fuente.paginaEnFuente ? fuente.total : ordenadas.length;
		const filas = fuente.paginaEnFuente
			? ordenadas
			: ordenadas.slice((page - 1) * pageSize, page * pageSize);

		const cargandoLista =
			conLista &&
			(listaQ.isLoading || (!opts.filtros.estadoMora && enConvenioQ.isLoading));
		const cargando = fuente.cargando || cargandoLista;
		const errorFuente = fuente.error ?? listaQ.error ?? enConvenioQ.error;

		// Casos del segmento que cartera no devolvió (cancelados, sin crédito
		// vigente…): las páginas viejas los listaban, así que siguen alcanzables.
		const conFila = new Set(refinadas.map((f) => f.numeroCredito));
		const sinFila: CasoSinFila[] =
			cargando || errorFuente || opts.hayOtrosFiltros
				? []
				: fuente.sifcos
						.filter((s) => !conFila.has(s))
						.map((s) => {
							const d = fuente.detalles.get(s);
							return {
								sifco: s,
								nombre:
									d?.tipo === "cola"
										? d.item.cliente
										: d?.tipo === "promesa"
											? (d.alertas[0]?.clienteNombre ?? null)
											: d?.tipo === "convenio"
												? d.alerta.cliente
												: null,
								casoCobroId:
									d?.tipo === "promesa"
										? (d.alertas[0]?.casoCobroId ?? null)
										: d?.tipo === "convenio"
											? d.alerta.casoCobroId
											: null,
							};
						});

		const avisos: string[] = [];
		if (fuente.ausente) avisos.push(fuente.ausente);
		if (fuente.paginaEnFuente) {
			avisos.push(
				`Este segmento tiene ${formatoEntero.format(fuente.total)} créditos: la tabla avanza por páginas del segmento, y la búsqueda, los demás filtros y el orden se aplican sobre cada página.`,
			);
		}
		if (opts.asesorId !== null && !opts.asesor?.email) {
			avisos.push(
				"El asesor elegido no tiene correo de Cash-In en cartera: la tabla no se puede filtrar por él.",
			);
		}

		return {
			filas,
			total,
			totalPaginas: Math.max(1, Math.ceil(total / pageSize)),
			cargando,
			actualizando: fuente.actualizando || listaQ.isPlaceholderData,
			error: errorFuente ? mensajeError(errorFuente) : null,
			refetch: () => {
				fuente.refetch();
				if (conLista) {
					void listaQ.refetch();
					if (!opts.filtros.estadoMora) void enConvenioQ.refetch();
				}
			},
			detalles: fuente.detalles,
			sinFila,
			avisos,
		};
	}, [
		segmento,
		fuente,
		conLista,
		listaQ,
		enConvenioQ,
		opts.filtros.estadoMora,
		opts.periodo,
		opts.etapa,
		opts.orden,
		opts.hayOtrosFiltros,
		opts.asesorId,
		opts.asesor,
		page,
		pageSize,
	]);

	return { conteos, resultado };
}
