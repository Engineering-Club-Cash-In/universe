import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { FilaCartera } from "@/components/cobros/asesor/fila-cartera";
import { destinoFicha } from "@/components/cobros/asesor/fila-cartera";
import {
	type AlertaPromesa,
	normalizarNombre,
} from "@/components/cobros/cartera-general/segmentos";
import { CumplimientoAgendaAsesor } from "@/components/cobros/cumplimiento-agenda-panel";
import { ModalesEquipo } from "@/components/cobros/equipo/acciones-equipo";
import {
	coberturaVigente,
	contactabilidadDeResumen,
	DIAS_CONTACTABILIDAD,
	estadoAsesor,
	etiquetaNivel,
	nivelAsesor,
	rangosContactabilidad,
	textoAusencia,
} from "@/components/cobros/equipo/estado-asesor";
import type { AccionEquipo } from "@/components/cobros/equipo/search";
import { HistorialGestiones } from "@/components/cobros/historial/historial-gestiones";
import type {
	RespuestaHistorial,
	ResumenHistorial,
} from "@/components/cobros/historial/tipos";
import { PanelGestionRapida } from "@/components/cobros/panel-gestion-rapida";
import { SolicitudesDeAsesor } from "@/components/cobros/solicitudes/solicitudes-de-asesor";
import { hoyGT } from "@/components/cobros/supervision/formato";
import {
	useWorkspaceCasos,
	WorkspaceModal,
} from "@/components/cobros/workspace/workspace-modal";
import type { Bucket } from "@/components/ds/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS, ROLES } from "@/lib/roles";
import { orpc } from "@/utils/orpc";
import { type CargaDetalle, DetalleAsesorVista } from "./detalle-asesor-vista";
import {
	type DetalleAsesorSearch,
	enlacesAsesor,
	enlacesCriticos,
	type TabDetalle,
} from "./enlaces";
import {
	type ItemCritico,
	ResumenAsesorVista,
	textoBuckets,
} from "./resumen-asesor";

/**
 * Contenedor del Detalle del asesor (`/cobros/equipo/$asesorId`, supervisión y
 * admin por igual): consultas y armado de props. La presentación está en
 * `detalle-asesor-vista.tsx` y `resumen-asesor.tsx`.
 *
 * Identidad: `$asesorId` es el `asesor_id` de cartera. De `getAsesoresTraslados`
 * salen su `userId` del CRM (historial, agenda, cierre, coberturas) y su
 * `email_cash_in` (cartera). Si el asesor no aparece o el catálogo falla, se
 * muestra el error y NUNCA se consulta sin el filtro: sin `userId` o sin
 * correo, las consultas que lo necesitan no se disparan (sin el filtro, el
 * server devolvería todo el equipo).
 *
 * Las consultas del encabezado (carga, último cierre de agenda, coberturas de
 * hoy y contactabilidad) son las mismas de Mi equipo, con las mismas llaves:
 * al llegar desde la tarjeta salen de la caché. Las de cada pestaña se piden
 * solo cuando la pestaña se abre.
 */

type AsesorPool = {
	asesor_id: number;
	nombre: string;
	email_cash_in: string | null;
	activo: boolean | null;
	buckets: number[];
	userId: string | null;
};

type Cobertura = {
	id: string;
	titularId: string;
	motivo: string;
	desde: string;
	hasta: string;
	canceladaEn: string | Date | null;
};

type AgendaItem = {
	asesorId: string;
	atendidos: number;
	planificados: number;
	porcentaje: number;
};

const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];
/** Filas de la «vista rápida» de su cartera (el Figma pide de 5 a 10). */
const FILAS_VISTA_RAPIDA = 8;
/** Gestiones del bloque «Historial de actividad» del Resumen. */
const GESTIONES_RECIENTES = 5;

/** «2026-10-06» → «6 oct». */
function diaCorto(fecha: string) {
	const meses = [
		"ene",
		"feb",
		"mar",
		"abr",
		"may",
		"jun",
		"jul",
		"ago",
		"sep",
		"oct",
		"nov",
		"dic",
	];
	const [, m, d] = fecha.split("-").map(Number);
	return `${d} ${meses[m - 1] ?? ""}`;
}

export function DetalleAsesor({
	asesorId,
	search,
}: {
	asesorId: number;
	search: DetalleAsesorSearch;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role ?? "";
	// Supervisión y admin ven lo mismo (canAssignCobros = ambos roles).
	const habilitado = !!session && PERMISSIONS.canAssignCobros(userRole);
	const esSupervisor = PERMISSIONS.canViewAllCasosCobros(userRole);

	const tab: TabDetalle = search.tab ?? "resumen";
	// Pestañas ya abiertas: siguen montadas (ocultas) y sus consultas, vivas.
	const [montadas, setMontadas] = useState<TabDetalle[]>([tab]);
	if (!montadas.includes(tab)) setMontadas([...montadas, tab]);
	const conResumen = montadas.includes("resumen");

	const irA = useCallback(
		(cambio: { tab?: TabDetalle; fecha?: string; asesor?: number }) => {
			const siguiente: DetalleAsesorSearch = {
				...search,
				...("tab" in cambio ? { tab: cambio.tab } : {}),
				...("fecha" in cambio ? { fecha: cambio.fecha } : {}),
			};
			// Los valores por defecto no se escriben en la URL.
			const limpio: DetalleAsesorSearch = {
				...(siguiente.tab && siguiente.tab !== "resumen"
					? { tab: siguiente.tab }
					: {}),
				...(siguiente.fecha ? { fecha: siguiente.fecha } : {}),
			};
			void navigate({
				to: "/cobros/equipo/$asesorId",
				params: { asesorId: String(cambio.asesor ?? asesorId) },
				search: limpio,
			});
		},
		[navigate, asesorId, search],
	);

	/* ── Catálogo e identidad ──────────────────────────────────────────── */

	const asesoresQuery = useQuery({
		...orpc.getAsesoresTraslados.queryOptions(),
		enabled: habilitado,
		staleTime: 5 * 60_000,
	});
	const pool = (asesoresQuery.data ?? []) as unknown as AsesorPool[];
	const asesor = pool.find((a) => a.asesor_id === asesorId) ?? null;
	const userId = asesor?.userId ?? null;
	const email = asesor?.email_cash_in?.trim() || null;
	const opciones = useMemo(
		() =>
			pool
				.filter((a) => a.activo !== false)
				.map((a) => ({ asesorId: a.asesor_id, nombre: a.nombre }))
				.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
		[pool],
	);

	/* ── Encabezado: estado (mismo criterio y llaves que Mi equipo) ───── */

	const hoy = hoyGT();
	const rangos = rangosContactabilidad(hoy);
	const cargaQuery = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	const agendaQuery = useQuery({
		...orpc.getCumplimientoAgendaResumen.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	const coberturasQuery = useQuery({
		...orpc.listarCoberturas.queryOptions({
			input: { desde: hoy, hasta: hoy },
		}),
		enabled: habilitado,
	});
	// El tipo de getHistorialAgendasResumen llega truncado (TS7056).
	const orpcSinTipo = orpc as unknown as {
		getHistorialAgendasResumen: typeof orpc.getCobrosDashboardStats;
		getHistorialAgendas: typeof orpc.getCobrosDashboardStats;
	};
	const contactabilidadQuery = useQuery({
		...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
			input: {
				...rangos.actual,
				usuarioIds: [userId],
				roles: [ROLES.COBROS],
			} as never,
		}),
		enabled: habilitado && !!userId,
		staleTime: 5 * 60_000,
	});
	const contactabilidadAntQuery = useQuery({
		...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
			input: {
				...rangos.anterior,
				usuarioIds: [userId],
				roles: [ROLES.COBROS],
			} as never,
		}),
		enabled: habilitado && !!userId && conResumen,
		staleTime: 5 * 60_000,
	});

	const coberturas = (coberturasQuery.data ?? []) as unknown as Cobertura[];
	const cobertura = coberturaVigente(coberturas, userId, hoy);
	const agendaItems = (agendaQuery.data?.items ??
		[]) as unknown as AgendaItem[];
	const agendaFila = userId
		? agendaItems.find((x) => x.asesorId === userId)
		: undefined;
	const contactabilidad = contactabilidadDeResumen(
		contactabilidadQuery.data as ResumenHistorial | undefined,
	);
	const contactabilidadAnt = contactabilidadDeResumen(
		contactabilidadAntQuery.data as ResumenHistorial | undefined,
	);
	// Una fuente que falla cuenta como «sin dato» (no marca al asesor).
	const listoEstado =
		!agendaQuery.isPending &&
		!coberturasQuery.isPending &&
		(!userId || !contactabilidadQuery.isPending);
	const estado = listoEstado
		? estadoAsesor({
				ausente: !!cobertura,
				cumplimiento:
					agendaFila && agendaFila.planificados > 0
						? agendaFila.porcentaje
						: null,
				contactabilidad,
			})
		: null;

	/* ── Resumen ───────────────────────────────────────────────────────── */

	const carga = cargaQuery.data?.porAsesor.find(
		(x) => x.asesor_id === asesorId,
	);
	const porBucket = new Map<number, number>();
	for (const d of carga?.porBucket ?? [])
		porBucket.set(d.bucket, (porBucket.get(d.bucket) ?? 0) + d.cuentas);
	const creditos = carga
		? carga.porBucket.reduce((t, d) => t + d.cuentas, 0)
		: cargaQuery.data
			? 0
			: cargaQuery.isError
				? null
				: undefined;

	const conveniosQuery = useQuery({
		...orpc.getConveniosListado.queryOptions({
			input: { estado: "pending", asesorId, page: 1, perPage: 1 },
		}),
		enabled: habilitado && conResumen,
	});
	const sinGestionQuery = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				emailCobrador: email ?? undefined,
				filtroGestion: "sin_gestion_48h",
				limit: 1,
				offset: 0,
			},
		}),
		// Sin correo, el server devolvería todo el equipo: no se consulta.
		enabled: habilitado && conResumen && !!email,
	});
	// Misma llave que la Cartera general (segmento «Alertas de promesas»).
	const promesasQuery = useQuery({
		...orpc.getAlertasPromesas.queryOptions({ input: {} }),
		enabled: habilitado && conResumen && !!asesor,
	});
	const promesasIncumplidas = useMemo(() => {
		if (!promesasQuery.data || !asesor) return undefined;
		// Las alertas solo traen el nombre del dueño en cartera (como en la
		// Cartera general, que filtra por asesor comparando nombres).
		const n = normalizarNombre(asesor.nombre);
		const sifcos = new Set(
			(promesasQuery.data as unknown as AlertaPromesa[])
				.filter(
					(a) =>
						a.categoria === "vencida" &&
						normalizarNombre(a.asesorNombre) === n &&
						a.numeroCreditoSifco,
				)
				.map((a) => a.numeroCreditoSifco),
		);
		return sifcos.size;
	}, [promesasQuery.data, asesor]);

	const criticosEnlaces = enlacesCriticos(asesorId);
	const cantidad = (
		q: { isPending: boolean; isError: boolean },
		valor: number | undefined,
		sinFiltro = false,
	) => (sinFiltro || q.isError ? null : q.isPending ? undefined : valor);
	const itemsCriticos: ItemCritico[] = [
		{
			clave: "convenios",
			cantidad: cantidad(conveniosQuery, conveniosQuery.data?.total),
			etiqueta: "convenios pendientes de aprobación",
			destino: criticosEnlaces.convenios,
		},
		{
			clave: "promesas",
			cantidad: cantidad(promesasQuery, promesasIncumplidas),
			etiqueta: "promesas incumplidas",
			destino: criticosEnlaces.promesas,
			info: "Promesas de pago vencidas sin pago (Alertas de promesas).",
		},
		{
			clave: "sin_gestion",
			cantidad: cantidad(sinGestionQuery, sinGestionQuery.data?.total, !email),
			etiqueta: "sin gestión > 48h",
			destino: criticosEnlaces.sinGestion,
		},
		{
			// TODO(José) · tarea M2: «próximos a subir de bucket» por asesor.
			clave: "proximos_bucket",
			cantidad: null,
			etiqueta: "próximos a subir de bucket",
			pronto: true,
		},
	];
	const conDato = itemsCriticos.filter((i) => !i.pronto);
	const totalCriticos = conDato.some((i) => i.cantidad === undefined)
		? undefined
		: conDato.every((i) => i.cantidad === null)
			? null
			: conDato.reduce((t, i) => t + (i.cantidad ?? 0), 0);

	// Vista rápida de su cartera: reutiliza las filas de Mi Cartera.
	const carteraQuery = useQuery({
		...orpc.getTodosLosCreditos.queryOptions({
			input: {
				emailCobrador: email ?? undefined,
				limit: FILAS_VISTA_RAPIDA,
				offset: 0,
			},
		}),
		enabled: habilitado && conResumen && !!email,
	});
	const filasCartera = (carteraQuery.data?.data ?? []) as FilaCartera[];

	const recientesQuery = useQuery({
		...orpcSinTipo.getHistorialAgendas.queryOptions({
			input: {
				usuarioIds: [userId],
				page: 1,
				pageSize: GESTIONES_RECIENTES,
				incluirConteo: false,
			} as never,
		}),
		enabled: habilitado && conResumen && !!userId,
	});
	const recientes = recientesQuery.data as unknown as
		| RespuestaHistorial
		| undefined;

	// Workspace (como en la Cartera general) y vista rápida de un crédito.
	const refrescarCartera = useCallback(() => {
		void queryClient.invalidateQueries({
			queryKey: orpc.getTodosLosCreditos.key(),
		});
	}, [queryClient]);
	const workspace = useWorkspaceCasos({ alCerrar: refrescarCartera });
	const [panel, setPanel] = useState<string | null>(null);
	// «Trasladar cartera» y «Marcar ausente» abren los mismos modales de Mi
	// equipo, aquí mismo y con este asesor elegido.
	const [accion, setAccion] = useState<AccionEquipo | undefined>();

	/* ── Carga del encabezado ─────────────────────────────────────────── */

	const cargaDetalle: CargaDetalle = asesoresQuery.isPending
		? { tipo: "cargando" }
		: asesoresQuery.isError
			? {
					tipo: "error",
					titulo: "No se pudo cargar el catálogo de asesores",
					descripcion:
						"Sin el catálogo no se puede saber quién es este asesor. Intente de nuevo en unos segundos.",
					onReintentar: () => void asesoresQuery.refetch(),
				}
			: !asesor
				? {
						tipo: "error",
						titulo: "Asesor no encontrado",
						descripcion: `No hay un asesor con el número ${asesorId} en el pool de cartera. Elija otro asesor o vuelva a Mi equipo.`,
					}
				: {
						tipo: "listo",
						asesor: {
							asesorId,
							nombre: asesor.nombre,
							nivel: nivelAsesor(asesor.buckets),
							estado,
							ausencia: cobertura ? textoAusencia(cobertura) : null,
						},
					};

	const avisos: string[] = [];
	if (asesor && !userId) {
		avisos.push(
			"Este asesor no tiene un usuario del CRM vinculado a su correo de Cash-In: su agenda, su historial y su contactabilidad no se pueden consultar.",
		);
	}
	if (asesor && !email) {
		avisos.push(
			"Este asesor no tiene correo de Cash-In en cartera: su cartera y los casos sin gestión no se pueden filtrar por él.",
		);
	}

	if (!habilitado) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<EmptyState
					variant="no-permission"
					title="Acceso denegado"
					description="Solo supervisión y administración pueden ver el detalle de un asesor."
				/>
			</div>
		);
	}

	const nombre = asesor?.nombre ?? "";
	const sinUsuario = (
		<EmptyState
			variant="no-data"
			title="Sin usuario del CRM"
			description="Este asesor no tiene un usuario del CRM vinculado a su correo de Cash-In, así que no se pueden consultar sus gestiones ni su agenda."
		/>
	);
	const enlaces = enlacesAsesor(asesorId);

	return (
		<>
			<DetalleAsesorVista
				asesorId={asesorId}
				carga={cargaDetalle}
				asesores={opciones}
				onCambiarAsesor={(id) => irA({ asesor: id })}
				tab={tab}
				onTab={(t) => irA({ tab: t })}
				montadas={montadas}
				avisos={avisos}
				onTrasladar={() => setAccion("trasladar")}
				onMarcarAusente={() => setAccion("ausente")}
				contenido={{
					resumen: asesor ? (
						<ResumenAsesorVista
							nombre={nombre}
							kpis={{
								creditos,
								cumplimiento: agendaQuery.isPending
									? undefined
									: agendaFila
										? {
												atendidos: agendaFila.atendidos,
												planificados: agendaFila.planificados,
												fecha: agendaQuery.data?.fecha
													? diaCorto(agendaQuery.data.fecha)
													: null,
											}
										: null,
								contactabilidad: !userId
									? null
									: contactabilidadQuery.isPending
										? undefined
										: contactabilidadQuery.isError
											? null
											: {
													actual: contactabilidad,
													anterior: contactabilidadAnt,
												},
								comparacion: `vs. ${DIAS_CONTACTABILIDAD} días previos`,
								infoContactabilidad: `Contactos efectivos / gestiones registradas en los últimos ${DIAS_CONTACTABILIDAD} días (hoy incluido), frente a los ${DIAS_CONTACTABILIDAD} días anteriores.`,
							}}
							distribucion={
								cargaQuery.isPending
									? undefined
									: cargaQuery.isError
										? {
												segmentos: [],
												total: 0,
												pool: etiquetaNivel(nivelAsesor(asesor.buckets)),
												error: true,
											}
										: {
												segmentos: BUCKETS.map((bucket, numero) => ({
													bucket,
													cuentas: porBucket.get(numero) ?? 0,
												})),
												total: creditos ?? 0,
												pool: `${etiquetaNivel(nivelAsesor(asesor.buckets))} (${textoBuckets(asesor.buckets)})`,
											}
							}
							criticos={{
								items: itemsCriticos,
								total: totalCriticos,
								verCasos: enlaces.casos,
							}}
							cartera={{
								filas: filasCartera,
								total: carteraQuery.data?.total ?? null,
								cargando: !!email && carteraQuery.isPending,
								error: !email
									? "Sin correo de Cash-In: la cartera no se puede filtrar por este asesor."
									: carteraQuery.isError
										? "No se pudo cargar la cartera. Intente de nuevo en unos minutos."
										: null,
								onReintentar: email
									? () => void carteraQuery.refetch()
									: undefined,
								buckets: textoBuckets(asesor.buckets),
								destino: enlaces.casos,
								onAbrir: (i) =>
									workspace.abrir(
										filasCartera.map((f) => ({
											...destinoFicha(f),
											nombre: f.clienteNombre ?? undefined,
										})),
										i,
									),
								onVistaRapida: setPanel,
							}}
							actividad={{
								items: recientes?.items ?? [],
								cargando: !!userId && recientesQuery.isPending,
								error: recientesQuery.isError,
								sinUsuario: !userId,
								esSupervisor,
								onVerTodo: () => irA({ tab: "actividad" }),
							}}
						/>
					) : null,
					agenda: !asesor ? null : userId ? (
						<CumplimientoAgendaAsesor
							key={userId}
							userId={userId}
							nombre={nombre}
							fecha={search.fecha}
							onFecha={(f) => irA({ fecha: f })}
						/>
					) : (
						sinUsuario
					),
					actividad: !asesor ? null : userId ? (
						<HistorialGestiones
							key={userId}
							usuarioFijo={{ userId, nombre }}
							titulo={`Historial de actividad de ${nombre}`}
							descripcion="Todo lo que ha trabajado el asesor · más reciente primero"
						/>
					) : (
						sinUsuario
					),
					solicitudes: asesor ? (
						<SolicitudesDeAsesor
							key={asesorId}
							asesorId={asesorId}
							userId={userId}
							nombre={nombre}
						/>
					) : null,
				}}
			/>
			<PanelGestionRapida
				creditoId={panel}
				open={!!panel}
				onClose={() => setPanel(null)}
			/>
			<WorkspaceModal {...workspace.modal} />
			<ModalesEquipo
				accion={accion}
				asesor={asesorId}
				onCerrar={() => setAccion(undefined)}
				onCoberturaRegistrada={() => {}}
			/>
		</>
	);
}
