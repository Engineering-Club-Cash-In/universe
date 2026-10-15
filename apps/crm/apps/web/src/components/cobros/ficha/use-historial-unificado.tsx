import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	AccesosFallidosBot,
	type InteraccionBot,
	InteraccionesSesionBot,
} from "@/components/cobros/actividad-bot";
import type {
	DatosHistorialUnificado,
	FuenteHistorial,
} from "@/components/cobros/ficha/historial-unificado";
import { AccionesSupervisorPagalo } from "@/components/cobros/pagalo/acciones-supervisor-pagalo";
import {
	type GrupoPagalo,
	GrupoPagaloDetalle,
} from "@/components/cobros/pagalo-historial";
import { authClient } from "@/lib/auth-client";
import {
	cortePeriodoActual,
	type DecisionConvenioFuente,
	type EstadoPromesa,
	type EventoHistorial,
	eventoDeDecisionConvenio,
	eventoDeGrupoPagalo,
	eventoDeHito,
	eventoDeRecordatorio,
	eventosDeBot,
	eventosDeContactos,
	eventosDelPeriodo,
	eventosDePagos,
	type GestionFuente,
	horizonteDeCarga,
	masAntiguo,
	mezclarEventos,
	type RecordatorioFuente,
} from "@/lib/cobros/historial-unificado";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

/**
 * Datos del historial unificado de un caso (Ficha 360 y Workspace).
 *
 * Usa las MISMAS consultas (misma llave) que ya hace la ficha —gestiones con
 * límite 200, recordatorios, plan de pagos, bucket actual, complementos—, así
 * que React Query no las pide dos veces. Lo propio del historial: los links de
 * Págalo (de 50 en 50), la actividad del bot y las decisiones de convenio.
 *
 * Fuentes con tope:
 * - Gestiones: 200 y «Cargar más» sube de 200 en 200 (`limit` no tiene
 *   máximo en el server).
 * - Págalo: páginas de 50 (el máximo del server).
 * - Recordatorios: el server trae los últimos 30 y no acepta más; se avisa al
 *   pie en vez de cortar la lista (no hay cómo cargar los anteriores).
 * Mientras una fuente con tope venga llena, la lista se corta en lo más viejo
 * que trajo (`horizonteDeCarga`): mostrar lo anterior dejaría huecos.
 */

const LIMITE_GESTIONES = 200;
const PAGINA_PAGALO = 50;
/** `getRecordatoriosPremora` corta en 30 (`.limit(30)`). */
const TOPE_RECORDATORIOS = 30;

type PaginaPagalo = { grupos: GrupoPagalo[]; total: number };

/**
 * Las páginas de Págalo en una sola lista. Fuera del hook para que su
 * identidad sea estable: `useQueries` solo vuelve a combinar cuando cambia un
 * resultado.
 */
function combinarPaginasPagalo(
	resultados: Array<{
		data?: unknown;
		isLoading: boolean;
		isError: boolean;
		refetch: () => Promise<unknown>;
	}>,
) {
	const paginas = resultados.map((r) => r.data as PaginaPagalo | undefined);
	return {
		grupos: paginas.flatMap((p) => p?.grupos ?? []),
		total: paginas[0]?.total ?? 0,
		cargando: resultados.some((r) => r.isLoading),
		error: resultados.some((r) => r.isError),
		reintentar: () => {
			for (const r of resultados) if (r.isError) void r.refetch();
		},
	};
}

type HitoComplemento = {
	id: string;
	descripcion: string;
	fecha: string;
	tipo?: string;
};

export function useHistorialUnificado({
	casoCobroId,
	idRuta,
	numeroSifco,
	estadosPromesa,
	habilitado = true,
	conPagalo = true,
}: {
	/** "" si el crédito no tiene caso de cobros. */
	casoCobroId: string;
	/** El id de la ruta (`/cobros/$id`): bucket actual y plan de pagos. */
	idRuta: string;
	/** SIFCO del crédito: recordatorios y créditos del bot. */
	numeroSifco: string;
	/** Estado recién calculado de las promesas (`getEstadoPromesasPago`). */
	estadosPromesa?: Record<string, EstadoPromesa>;
	habilitado?: boolean;
	/** Págalo necesita el crédito de cartera del caso. */
	conPagalo?: boolean;
}): DatosHistorialUnificado & { totalActual: number | undefined } {
	const { data: session } = authClient.useSession();
	const esSupervisor = PERMISSIONS.canAssignCobros(session?.user?.role ?? "");
	const [limiteGestiones, setLimiteGestiones] = useState(LIMITE_GESTIONES);
	const [paginasPagalo, setPaginasPagalo] = useState(1);

	// La ficha se reusa al navegar de un caso a otro (misma ruta): lo cargado
	// de más del caso anterior no viaja al nuevo, y sus datos tampoco se
	// muestran como placeholder (serían links de pago de otro cliente).
	const casoRenderizado = useRef(casoCobroId);
	const casoCambio = casoRenderizado.current !== casoCobroId;
	useEffect(() => {
		casoRenderizado.current = casoCobroId;
		setLimiteGestiones(LIMITE_GESTIONES);
		setPaginasPagalo(1);
	}, [casoCobroId]);

	const conCaso = habilitado && !!casoCobroId;

	const contactos = useQuery({
		...orpc.getHistorialContactos.queryOptions({
			input: { casoCobroId, limit: limiteGestiones },
		}),
		enabled: conCaso,
		// Al pedir más, la lista anterior se queda mientras llega la nueva.
		placeholderData: (previa) => (casoCambio ? undefined : previa),
	});
	const bucketActual = useQuery({
		...orpc.getBucketActualCredito.queryOptions({
			input: { creditoId: idRuta },
		}),
		enabled: habilitado && !!idRuta,
	});
	const complementos = useQuery({
		...orpc.getFichaComplementos.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
		staleTime: 5 * 60 * 1000,
	});
	const recordatorios = useQuery({
		...orpc.getRecordatoriosPremora.queryOptions({ input: { numeroSifco } }),
		enabled: habilitado && !!numeroSifco,
	});
	const pagos = useQuery({
		...orpc.getHistorialPagos.queryOptions({
			input: { numeroSifco: idRuta },
		}),
		enabled: habilitado && !!idRuta,
	});
	const bot = useQuery({
		...orpc.getActividadBot.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	const decisiones = useQuery({
		...orpc.getDecisionesConvenio.queryOptions({ input: { casoCobroId } }),
		enabled: conCaso,
	});
	const pagalo = useQueries({
		queries: Array.from({ length: paginasPagalo }, (_, i) => ({
			...orpc.getPagaloHistorial.queryOptions({
				input: { casoCobroId, page: i + 1, pageSize: PAGINA_PAGALO },
			}),
			enabled: conCaso && conPagalo,
		})),
		combine: combinarPaginasPagalo,
	});

	/* ── Eventos por fuente ─────────────────────────────────────────────────── */

	const filasContactos = contactos.data as GestionFuente[] | undefined;
	const eventosContactos = useMemo(
		() => eventosDeContactos(filasContactos ?? [], estadosPromesa),
		[filasContactos, estadosPromesa],
	);

	const filasRecordatorios = (
		recordatorios.data as { recordatorios?: RecordatorioFuente[] } | undefined
	)?.recordatorios;
	const eventosRecordatorios = useMemo(
		() => (filasRecordatorios ?? []).map(eventoDeRecordatorio),
		[filasRecordatorios],
	);

	const eventosPagos = useMemo(
		() =>
			eventosDePagos(
				(pagos.data as Parameters<typeof eventosDePagos>[0] | undefined) ?? [],
			),
		[pagos.data],
	);

	const gruposPagalo = pagalo.grupos;
	const totalPagalo = pagalo.total;
	const eventosPagalo = useMemo(
		() =>
			gruposPagalo.map(
				(grupo): EventoHistorial => ({
					...eventoDeGrupoPagalo(grupo),
					contenido: {
						// Las acciones de grupo (CB-127) quedan siempre a la vista: un
						// grupo pagado esperando al dispatcher se empuja desde acá. El
						// componente devuelve null si no hay nada que ofrecer.
						// `carteraCreditoId` puede venir null en grupos viejos: solo se
						// usa para invalidar la query del grupo activo.
						extra: (
							<AccionesSupervisorPagalo
								casoCobroId={casoCobroId}
								creditoId={grupo.carteraCreditoId ?? 0}
								groupId={grupo.id}
								status={grupo.status}
							/>
						),
						detalleNodo: (
							<GrupoPagaloDetalle
								grupo={grupo}
								casoCobroId={casoCobroId}
								esSupervisor={esSupervisor}
							/>
						),
					},
				}),
			),
		[gruposPagalo, casoCobroId, esSupervisor],
	);

	const eventosBot = useMemo(
		() =>
			eventosDeBot(bot.data ?? {}).map(
				(e): EventoHistorial =>
					e.datos?.tipo === "bot_sesion"
						? {
								...e,
								contenido: {
									detalleNodo: (
										<InteraccionesSesionBot
											interacciones={
												e.datos.sesion.interacciones as InteraccionBot[]
											}
											numeroSifcoCaso={numeroSifco || null}
										/>
									),
								},
							}
						: e.datos?.tipo === "bot_accesos"
							? {
									...e,
									contenido: {
										detalleNodo: (
											<AccesosFallidosBot
												interacciones={
													e.datos.interacciones as InteraccionBot[]
												}
											/>
										),
									},
								}
							: e,
			),
		[bot.data, numeroSifco],
	);

	const hitos = (
		complementos.data as { historico?: HitoComplemento[] | null } | undefined
	)?.historico;
	const eventosVida = useMemo(
		() => [
			...(hitos ?? []).map(eventoDeHito),
			...((decisiones.data as DecisionConvenioFuente[] | undefined) ?? []).map(
				eventoDeDecisionConvenio,
			),
		],
		[hitos, decisiones.data],
	);

	const eventos = useMemo(
		() =>
			mezclarEventos(
				eventosContactos,
				eventosRecordatorios,
				eventosPagos,
				eventosPagalo,
				eventosBot,
				eventosVida,
			),
		[
			eventosContactos,
			eventosRecordatorios,
			eventosPagos,
			eventosPagalo,
			eventosBot,
			eventosVida,
		],
	);

	/* ── Periodo y horizonte ────────────────────────────────────────────────── */

	const bucket = bucketActual.data;
	const corte = useMemo(
		() =>
			cortePeriodoActual({
				fechaEntradaBucket: bucket?.fecha_entrada_bucket,
				bucket:
					[bucket?.prefijo, bucket?.nombre].filter(Boolean).join(" · ") || null,
				hitos,
			}),
		[bucket, hitos],
	);

	const gestionesTruncadas = (filasContactos?.length ?? 0) >= limiteGestiones;
	const pagaloTruncado = gruposPagalo.length < totalPagalo;
	const horizonte = horizonteDeCarga([
		{ truncada: gestionesTruncadas, masAntiguo: masAntiguo(eventosContactos) },
		{ truncada: pagaloTruncado, masAntiguo: masAntiguo(eventosPagalo) },
	]);

	// Sin gestiones ni bucket no hay cómo ordenar ni cortar. Si el motor no da
	// fecha de entrada, el corte sale de la vida del crédito: hay que esperarla.
	const cargando =
		contactos.isLoading ||
		bucketActual.isLoading ||
		(!bucket?.fecha_entrada_bucket && complementos.isLoading);

	const estadoDe = (q: {
		isLoading: boolean;
		isError: boolean;
	}): FuenteHistorial["estado"] =>
		q.isLoading ? "cargando" : q.isError ? "error" : "ok";

	const fuentes: FuenteHistorial[] = [
		{
			clave: "gestiones",
			etiqueta: "gestiones y promesas de pago",
			estado: estadoDe(contactos),
			onReintentar: () => void contactos.refetch(),
		},
		{
			clave: "pagos",
			etiqueta: "pagos",
			estado: estadoDe(pagos),
			onReintentar: () => void pagos.refetch(),
		},
		{
			clave: "links",
			etiqueta: "links de pago",
			estado: pagalo.cargando ? "cargando" : pagalo.error ? "error" : "ok",
			onReintentar: pagalo.reintentar,
		},
		{
			clave: "recordatorios",
			etiqueta: "recordatorios",
			estado: estadoDe(recordatorios),
			onReintentar: () => void recordatorios.refetch(),
		},
		{
			clave: "bot",
			etiqueta: "bot de WhatsApp",
			estado: estadoDe(bot),
			onReintentar: () => void bot.refetch(),
		},
		{
			clave: "vida",
			etiqueta: "vida del crédito",
			// F4: `historico` en null = cartera no respondió (no es «sin hitos»).
			estado: complementos.isLoading
				? "cargando"
				: complementos.isError || (complementos.data && !hitos)
					? "error"
					: "ok",
			onReintentar: () => void complementos.refetch(),
		},
		{
			clave: "decisiones",
			etiqueta: "aprobaciones del convenio",
			estado: estadoDe(decisiones),
			onReintentar: () => void decisiones.refetch(),
		},
	];

	const avisos =
		(filasRecordatorios?.length ?? 0) >= TOPE_RECORDATORIOS
			? [
					`Solo se consultan los ${TOPE_RECORDATORIOS} recordatorios de pago más recientes.`,
				]
			: [];

	const totalActual = cargando
		? undefined
		: eventosDelPeriodo(eventos, { periodo: "actual", corte, horizonte })
				.length;

	return {
		eventos,
		corte,
		horizonte,
		cargando,
		fuentes,
		hayMasEnServidor: gestionesTruncadas || pagaloTruncado,
		cargandoMas:
			(contactos.isFetching && contactos.isPlaceholderData) ||
			(paginasPagalo > 1 && pagalo.cargando),
		onCargarMas: () => {
			if (gestionesTruncadas) setLimiteGestiones((l) => l + LIMITE_GESTIONES);
			if (pagaloTruncado) setPaginasPagalo((p) => p + 1);
		},
		avisos,
		totalActual,
	};
}
