import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type {
	FilaCartera,
	FilaCola,
} from "@/components/cobros/asesor/fila-cartera";
import { type client, orpc } from "@/utils/orpc";
import {
	type AlertaConvenio,
	type AlertaPromesa,
	type ConteosSegmentos,
	contarPorCategoria,
	type DetalleSegmento,
	EXTRAS_COLA,
	type ItemCola,
	type Segmento,
	sinRepetidos,
} from "./segmentos";
import type { AsesorOpcion, CasoSinFila } from "./vista-supervision";

/**
 * Datos de la Cartera general del supervisor que Mi Cartera no tenía: la lista
 * de asesores y lo que la fuente de cada segmento (Cola del día, Alertas de
 * promesas y de convenios) dice de cada crédito.
 *
 * Desde S5 (doc 23) la TABLA ya no se arma en el cliente: el contenedor manda
 * el segmento (`cola`, `alertaPromesa`, `alertaConvenio`), el asesor
 * (`asesorId`) y «sin acuerdo» (`sinAcuerdo`) a `getTodosLosCreditos`, que los
 * resuelve en el servidor con total y paginación exactos y los combina con los
 * demás filtros (bucket del motor, búsqueda, período, etiquetas, capital…).
 *
 * Este hook solo decora esa tabla:
 *   - los conteos de los chips de promesas y convenios (del asesor elegido);
 *   - el detalle de la fuente por crédito (columna del segmento) y su orden de
 *     prioridad, para ordenar la página como las páginas viejas;
 *   - los casos del segmento que cartera no devuelve como fila (cancelados…),
 *     para que sigan alcanzables;
 *   - el aviso de ausencia del asesor (su cola la trabaja el suplente).
 * Si una fuente de detalle falla, la tabla sigue: solo se avisa.
 */

type InputCreditos = NonNullable<
	Parameters<typeof client.getTodosLosCreditos>[0]
>;

/** Lo que `getTodosLosCreditos` recibe como filtros (sin paginación ni dueño). */
export type FiltrosCreditos = Omit<
	InputCreditos,
	| "limit"
	| "offset"
	| "numerosSifco"
	| "emailCobrador"
	| "filtroGestion"
	| "asesorId"
	| "cola"
	| "alertaPromesa"
	| "alertaConvenio"
	| "sinAcuerdo"
>;

/** Máximo de `perPage` en `getColaDia` y de `limit` útil para «sin fila». */
export const MAX_SIFCOS = 200;

/**
 * Tope de páginas de la cola que se leen para el detalle (200 por página). La
 * cola completa se guarda 30 s en el servidor, así que cada página es barata;
 * más allá del tope, la columna del segmento queda en «—».
 */
const MAX_PAGINAS_COLA = 25;

/** Junta las páginas 2.. de la cola (función estable: `useQueries` memoriza). */
function combinarPaginasCola(
	resultados: {
		data?: { items?: unknown[] };
		isLoading: boolean;
		error: unknown;
	}[],
) {
	return {
		items: resultados.flatMap((q) => (q.data?.items ?? []) as FilaCola[]),
		cargando: resultados.some((q) => q.isLoading),
		error: resultados.find((q) => q.error)?.error ?? null,
	};
}

/* ── Asesores ───────────────────────────────────────────────────────────────── */

/**
 * `getAsesoresTraslados` es el único que trae, por asesor, el `asesor_id` de
 * cartera (cola, convenios, filtro `asesorId`), el correo de Cash-In (stats) y
 * el `userId` del CRM.
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
		fallo: q.isError,
		refetch: q.refetch,
	};
}

/* ── Filtros del servidor ───────────────────────────────────────────────────── */

/** El segmento elegido como filtro de `getTodosLosCreditos` (S5). */
export function filtroServidorDeSegmento(
	s: Segmento | null,
): Pick<InputCreditos, "cola" | "alertaPromesa" | "alertaConvenio"> {
	if (!s) return {};
	switch (s.tipo) {
		case "cola":
			return { cola: s.valor };
		case "promesa":
			return { alertaPromesa: s.valor };
		case "convenio":
			return { alertaConvenio: s.valor };
	}
}

/* ── Decoración del segmento ────────────────────────────────────────────────── */

export type DecoracionSegmento = {
	/** Lo que la fuente dice de cada crédito (columna del segmento). */
	detalles: Map<string, DetalleSegmento>;
	/** Orden de prioridad de la fuente (SIFCO → posición). */
	posicion: Map<string, number>;
	/** Casos del segmento que cartera no devolvió como fila. */
	sinFila: CasoSinFila[];
	avisos: string[];
};

export function useCarteraGeneral(opts: {
	habilitado: boolean;
	asesorId: number | null;
	segmento: Segmento | null;
	/** Lo que la tabla le pide a `getTodosLosCreditos` (con segmento y asesor). */
	inputLista: InputCreditos;
	/** Filas y total que devolvió la tabla (`undefined` mientras carga). */
	lista: { filas: FilaCartera[]; total: number } | undefined;
	/** Hay filtros además del segmento y el asesor (no se listan los «sin fila»). */
	hayOtrosFiltros: boolean;
}): {
	conteos: Pick<ConteosSegmentos, "promesa" | "convenio">;
	decoracion: DecoracionSegmento | null;
} {
	const { habilitado, asesorId, segmento } = opts;

	/* ── Alertas (siempre, para los conteos de los chips) ─────────────────── */
	const promesasQ = useQuery({
		...orpc.getAlertasPromesas.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	const conveniosQ = useQuery({
		...orpc.getAlertasConvenios.queryOptions({ input: {} }),
		enabled: habilitado,
	});

	// Las dos fuentes traen el asesor_id del dueño en cartera (S5): el filtro
	// por asesor compara ids, como el servidor.
	const promesas = useMemo(() => {
		const todas = (promesasQ.data as AlertaPromesa[] | undefined) ?? [];
		return asesorId === null
			? todas
			: todas.filter((a) => a.asesorId === asesorId);
	}, [promesasQ.data, asesorId]);
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

	/* ── Cola del día (detalle de cada crédito) ───────────────────────────── */
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
		// Coberturas y gestiones cambian desde otras sesiones (como la página vieja).
		refetchInterval: 60_000,
	});
	const paginasCola = Math.min(
		MAX_PAGINAS_COLA,
		Math.ceil((colaQ.data?.total ?? 0) / MAX_SIFCOS),
	);
	const restoColaQ = useQueries({
		queries: Array.from({ length: Math.max(0, paginasCola - 1) }, (_, i) => ({
			...orpc.getColaDia.queryOptions({
				input: { ...inputCola, page: i + 2, perPage: MAX_SIFCOS },
			}),
			enabled: enCola && !!colaQ.data,
			refetchInterval: 60_000,
		})),
		combine: combinarPaginasCola,
	});

	/* ── Fuente del segmento elegido ──────────────────────────────────────── */
	const fuente = useMemo(() => {
		if (!segmento) return null;
		const detalles = new Map<string, DetalleSegmento>();
		if (segmento.tipo === "cola") {
			const items = [
				...((colaQ.data?.items ?? []) as FilaCola[]),
				...restoColaQ.items,
			];
			for (const i of items) {
				if (detalles.has(i.numeroCreditoSifco)) continue;
				detalles.set(i.numeroCreditoSifco, {
					tipo: "cola",
					item: i as unknown as ItemCola,
					mostrarAsesor: asesorId === null,
				});
			}
			const datos = colaQ.data as
				| { ausente?: boolean; asesorForzado?: { nombre: string } | null }
				| undefined;
			const total = colaQ.data?.total ?? 0;
			return {
				detalles,
				orden: sinRepetidos(items.map((i) => i.numeroCreditoSifco)),
				// Solo con la cola completa se sabe qué casos no tienen fila.
				completa: !!colaQ.data && items.length >= total,
				cargando: colaQ.isLoading || restoColaQ.cargando,
				error: colaQ.error ?? restoColaQ.error,
				ausente:
					datos?.ausente && datos.asesorForzado
						? `${datos.asesorForzado.nombre} está registrado como ausente hoy: su cola la está trabajando su suplente.`
						: null,
				nombreFuente: "la Cola del día",
			};
		}
		if (segmento.tipo === "promesa") {
			const filas = promesas.filter(
				(a) => segmento.valor === "todas" || a.categoria === segmento.valor,
			);
			for (const a of filas) {
				if (!a.numeroCreditoSifco) continue;
				const previo = detalles.get(a.numeroCreditoSifco);
				if (previo?.tipo === "promesa") previo.alertas.push(a);
				else
					detalles.set(a.numeroCreditoSifco, { tipo: "promesa", alertas: [a] });
			}
			return {
				detalles,
				orden: sinRepetidos(filas.map((a) => a.numeroCreditoSifco)),
				completa: !!promesasQ.data,
				cargando: promesasQ.isLoading,
				error: promesasQ.error,
				ausente: null,
				nombreFuente: "las alertas de promesas",
			};
		}
		const filas = convenios.filter(
			(a) => segmento.valor === "todas" || a.categoria === segmento.valor,
		);
		for (const a of filas) {
			if (!detalles.has(a.numero_credito_sifco))
				detalles.set(a.numero_credito_sifco, { tipo: "convenio", alerta: a });
		}
		return {
			detalles,
			orden: sinRepetidos(filas.map((a) => a.numero_credito_sifco)),
			completa: !!conveniosQ.data,
			cargando: conveniosQ.isLoading,
			error: conveniosQ.error,
			ausente: null,
			nombreFuente: "las alertas de convenios",
		};
	}, [
		segmento,
		colaQ.data,
		colaQ.isLoading,
		colaQ.error,
		restoColaQ,
		promesasQ.data,
		promesasQ.isLoading,
		promesasQ.error,
		conveniosQ.data,
		conveniosQ.isLoading,
		conveniosQ.error,
		promesas,
		convenios,
		asesorId,
	]);

	/* ── Casos del segmento sin fila en cartera ───────────────────────────── */
	// Las páginas viejas listaban también los casos sin crédito vigente
	// (cancelados…): siguen alcanzables. Se calcula solo sin otros filtros y con
	// un segmento de hasta 200 créditos, comparando la fuente con TODO lo que
	// cartera devuelve del segmento (la página, si ya lo trae todo).
	const lista = opts.lista;
	const faltan =
		!!fuente &&
		fuente.completa &&
		!fuente.error &&
		!opts.hayOtrosFiltros &&
		!!lista &&
		lista.total < fuente.orden.length &&
		fuente.orden.length <= MAX_SIFCOS;
	const paginaCompleta =
		!!lista &&
		lista.filas.length >= lista.total &&
		(opts.inputLista.offset ?? 0) === 0;
	const completaQ = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: { ...opts.inputLista, limit: MAX_SIFCOS, offset: 0 },
		}),
		enabled: habilitado && faltan && !paginaCompleta,
		staleTime: 30_000,
	});

	const decoracion = useMemo<DecoracionSegmento | null>(() => {
		if (!segmento || !fuente) return null;
		const posicion = new Map(fuente.orden.map((s, i) => [s, i]));

		let sinFila: CasoSinFila[] = [];
		const devueltas = paginaCompleta ? lista?.filas : completaQ.data?.data;
		if (faltan && devueltas) {
			const conFila = new Set(devueltas.map((f) => f.numeroCredito));
			sinFila = fuente.orden
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
		}

		const avisos: string[] = [];
		if (fuente.ausente) avisos.push(fuente.ausente);
		if (fuente.error) {
			avisos.push(
				`No se pudo cargar el detalle de ${fuente.nombreFuente}: la tabla está completa, pero la columna del segmento queda vacía.`,
			);
		}
		return { detalles: fuente.detalles, posicion, sinFila, avisos };
	}, [segmento, fuente, faltan, paginaCompleta, lista, completaQ.data]);

	return { conteos, decoracion };
}
