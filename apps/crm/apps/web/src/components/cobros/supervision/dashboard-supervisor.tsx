import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	BadgePercent,
	ClipboardCheck,
	FileWarning,
	Gavel,
	PhoneOff,
	UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import { saludoPorHora } from "@/components/cobros/asesor/dashboard-asesor-vista";
import { aprobacionesParaDashboard } from "@/components/cobros/solicitudes/normalizar";
import type { Bucket } from "@/components/ds/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS, ROLES } from "@/lib/roles";
import { orpc, orpcAparte } from "@/utils/orpc";
import type { SegmentoBucketEquipo } from "./cartera-equipo-bucket";
import { DashboardSupervisorVista } from "./dashboard-supervisor-vista";
import type { Destino } from "./destino";
import { estadoDelAsesor, type FilaEquipo } from "./equipo-tabla";
import { hoyGT, nombreCorto, type Periodo, rangosPeriodo } from "./formato";
import type { ItemPendiente } from "./pendientes-hoy";

/**
 * Contenedor del Dashboard del supervisor (supervisión y admin): hace las
 * consultas y arma las props de `DashboardSupervisorVista`. Cada bloque carga
 * por su cuenta. Pendientes, KPIs del equipo y columnas de la tabla Equipo
 * llegan de `getSupervisionComplementos` (S1–S4, doc 23); si una fuente no
 * responde, su campo llega `null` y se muestra «—».
 *
 * Identificadores: el asesor_id de cartera (cola, carga, convenios, Págalo) y
 * el userId del CRM (agenda, coberturas) se cruzan con getAsesoresTraslados.
 */

const CARTERA = "/cobros/cartera";
const SOLICITUDES = "/cobros/solicitudes";
const BUCKETS: Bucket[] = ["B0", "B1", "B2", "B3", "B4", "B5"];
const PAGALO_PENDIENTES = [
	"LINKS_PENDING",
	"PENDING_PAYMENT",
	"PARTIALLY_PAID",
];
const LIMITE_APROBACIONES = 5;
const cartera = (search?: Record<string, string>): Destino => ({
	to: CARTERA,
	search,
});
/** Bandeja de Solicitudes con el chip del tipo. */
const solicitudes = (tipo: string): Destino => ({
	to: SOLICITUDES,
	search: { tipo },
});

type ResumenHistorial = { total: number; efectivos: number };

type CierreFila = { bajaron: number; subieron: number };

type Cobertura = {
	titularId: string;
	motivo: string;
	canceladaEn: string | Date | null;
};

type AsesorPool = {
	asesor_id: number;
	nombre: string;
	activo: boolean | null;
	buckets: number[];
	userId: string | null;
};

type AgendaItem = { asesorId: string; porcentaje: number };

export function DashboardSupervisor() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userRole = session?.user.role ?? "";
	// Admin y supervisor de cobros ven lo mismo (canAssignCobros = ambos roles).
	const habilitado = !!session && PERMISSIONS.canAssignCobros(userRole);

	const [periodo, setPeriodo] = useState<Periodo>("dia");

	const ahora = new Date();
	const hoy = hoyGT(ahora);
	const rangos = rangosPeriodo(periodo, ahora);

	/* ── Consultas ─────────────────────────────────────────────────────────── */

	const statsQuery = useQuery({
		// Solo para el badge «Datos parciales» (fuente distinta de cartera-back).
		...orpc.getCobrosDashboardStats.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	// Aprobaciones: convenios por aprobar, recuperaciones y apagados/reactivaciones.
	const conveniosQuery = useQuery({
		...orpc.getConveniosListado.queryOptions({
			input: { estado: "pending", page: 1, perPage: 100 },
		}),
		enabled: habilitado,
	});
	const recuperacionesQuery = useQuery({
		...orpc.getSolicitudesRecuperacion.queryOptions(),
		enabled: habilitado,
	});
	const inmovilizacionesQuery = useQuery({
		...orpc.getColaInmovilizaciones.queryOptions(),
		enabled: habilitado,
	});
	// Rebajas de mora, documentos y Jurídico (S1). Mismos inputs que la bandeja
	// de /cobros/solicitudes, para compartir la caché.
	const rebajasQuery = useQuery({
		...orpc.getSolicitudesRebajaMora.queryOptions({ input: { limite: 200 } }),
		enabled: habilitado,
	});
	const juridicoQuery = useQuery({
		...orpc.getSolicitudesJuridico.queryOptions({ input: { limite: 200 } }),
		enabled: habilitado,
	});
	const documentosQuery = useQuery({
		...orpcAparte.getSolicitudesDocumentos.queryOptions({
			input: { estado: "pendiente" },
		}),
		enabled: habilitado,
	});
	const fuentesAprobacion = [
		conveniosQuery,
		recuperacionesQuery,
		inmovilizacionesQuery,
		rebajasQuery,
		juridicoQuery,
		documentosQuery,
	];

	const coberturasQuery = useQuery({
		...orpc.listarCoberturas.queryOptions({
			input: { desde: hoy, hasta: hoy },
		}),
		enabled: habilitado,
	});

	// Solo los conteos de la cola (perPage 1): «sin contacto» del equipo.
	const colaQuery = useQuery({
		...orpc.getColaDia.queryOptions({ input: { page: 1, perPage: 1 } }),
		enabled: habilitado,
		refetchInterval: 60_000,
	});

	const complementosQuery = useQuery({
		...orpcAparte.getSupervisionComplementos.queryOptions({
			input: { periodo },
		}),
		enabled: habilitado,
		placeholderData: keepPreviousData,
	});

	// Contactabilidad del período y del anterior (para la tendencia).
	// El tipo de getHistorialAgendasResumen llega truncado (TS7056): se lee a mano.
	const orpcSinTipo = orpc as unknown as {
		getHistorialAgendasResumen: typeof orpc.getCobrosDashboardStats;
	};
	// Solo gestiones de asesores (rol cobros): las que registran admins o
	// supervisores no son del equipo y desalinearían el KPI con la tabla Equipo.
	const ROLES_EQUIPO = [ROLES.COBROS];
	const contactabilidadQuery = useQuery({
		...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
			input: { ...rangos.actual, roles: ROLES_EQUIPO } as never,
		}),
		enabled: habilitado,
		placeholderData: keepPreviousData,
	});
	const contactabilidadAntQuery = useQuery({
		...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
			input: { ...rangos.anterior, roles: ROLES_EQUIPO } as never,
		}),
		enabled: habilitado,
		placeholderData: keepPreviousData,
	});

	const cierreQuery = useQuery({
		...orpc.getCierreDiarioPorRango.queryOptions({
			input: {
				fechaInicio: rangos.actual.desde,
				fechaFin: rangos.actual.hasta,
			},
		}),
		enabled: habilitado,
		placeholderData: keepPreviousData,
	});

	const pagaloPendientesQuery = useQuery({
		...orpc.getPagaloSupervision.queryOptions({
			input: { soloProblematicos: false, incluirKpis: true, limit: 1 },
		}),
		enabled: habilitado,
	});
	const pagaloVencidosQuery = useQuery({
		...orpc.getPagaloSupervision.queryOptions({
			input: { problemasLink: ["EXPIRED"], incluirKpis: false, limit: 1 },
		}),
		enabled: habilitado,
	});

	const cargaQuery = useQuery({
		...orpc.getCargaPorAsesorBucket.queryOptions({ input: {} }),
		enabled: habilitado,
	});
	const asesoresQuery = useQuery({
		...orpc.getAsesoresTraslados.queryOptions(),
		enabled: habilitado,
	});
	// Último día con agenda cerrada (la de hoy se cierra a la noche).
	const agendaQuery = useQuery({
		...orpc.getCumplimientoAgendaResumen.queryOptions({ input: {} }),
		enabled: habilitado,
	});

	/* ── Derivados ─────────────────────────────────────────────────────────── */

	const complementos = complementosQuery.data;
	// Si los complementos fallan, las cards quedan en «—» y no cargando.
	const sinComplementos = complementosQuery.isError ? null : undefined;

	// Normalización compartida con /cobros/solicitudes (solicitudes/normalizar).
	const aprobaciones = useMemo(
		() =>
			aprobacionesParaDashboard({
				convenios: conveniosQuery.data,
				recuperaciones: recuperacionesQuery.data,
				inmovilizaciones: inmovilizacionesQuery.data,
				rebajas: rebajasQuery.data as unknown[] | undefined,
				documentos: documentosQuery.data as unknown[] | undefined,
				juridico: juridicoQuery.data as unknown[] | undefined,
				destinos: {
					convenio: solicitudes("convenio"),
					recuperacion: solicitudes("recuperacion"),
					// Apagados y reactivaciones comparten bandeja: sin chip de tipo.
					inmovilizacion: { to: SOLICITUDES },
					rebaja: solicitudes("rebaja"),
					documentos: solicitudes("documentos"),
					juridico: solicitudes("juridico"),
				},
			}),
		[
			conveniosQuery.data,
			recuperacionesQuery.data,
			inmovilizacionesQuery.data,
			rebajasQuery.data,
			documentosQuery.data,
			juridicoQuery.data,
		],
	);
	// La barra «x de y» y el total esperan a las seis fuentes: con una a medias
	// el denominador quedaría corto frente a las resueltas de hoy.
	const cargandoAprobaciones = fuentesAprobacion.some((q) => q.isLoading);
	const errorAprobaciones = fuentesAprobacion.some((q) => q.isError);

	const asesores = useMemo(
		() =>
			((asesoresQuery.data ?? []) as unknown as AsesorPool[]).filter(
				(a) => a.activo !== false && a.buckets.length > 0,
			),
		[asesoresQuery.data],
	);

	// Coberturas vigentes hoy (no canceladas): titular ausente → motivo.
	const ausencias = useMemo(() => {
		const mapa = new Map<string, string>();
		for (const c of (coberturasQuery.data ?? []) as unknown as Cobertura[]) {
			if (!c.canceladaEn) mapa.set(c.titularId, c.motivo);
		}
		return mapa;
	}, [coberturasQuery.data]);

	const equipo = useMemo((): FilaEquipo[] => {
		const carga = cargaQuery.data?.porAsesor ?? [];
		const agenda = (agendaQuery.data?.items ?? []) as unknown as AgendaItem[];
		const s4 = complementos?.equipo ?? [];
		return asesores
			.map((a): FilaEquipo => {
				const c = carga.find((x) => x.asesor_id === a.asesor_id);
				const casos = c
					? c.porBucket.reduce((t, d) => t + d.cuentas, 0)
					: cargaQuery.data
						? 0
						: null;
				const ag = a.userId
					? (agenda.find((x) => x.asesorId === a.userId)?.porcentaje ?? null)
					: null;
				const extra = s4.find((x) => x.asesorId === a.asesor_id);
				return {
					asesorId: a.asesor_id,
					nombre: nombreCorto(a.nombre),
					casos,
					contactosHoy: extra?.contactosHoy ?? null,
					meta: extra?.meta ?? null,
					rescate: extra?.rescate ?? null,
					agenda: ag,
					ausencia: a.userId ? (ausencias.get(a.userId) ?? null) : null,
					estado: estadoDelAsesor({ meta: extra?.meta ?? null, agenda: ag }),
					// La fila abre el Detalle del asesor (Mi equipo); su cartera se
					// abre desde ahí con «Ver sus casos».
					destino: { to: `/cobros/equipo/${a.asesor_id}` },
				};
			})
			.sort((x, y) => (y.casos ?? 0) - (x.casos ?? 0));
	}, [asesores, cargaQuery.data, agendaQuery.data, complementos, ausencias]);

	const segmentos = useMemo((): SegmentoBucketEquipo[] => {
		const buckets = cargaQuery.data?.buckets ?? [];
		const total = buckets.reduce((t, b) => t + b.cuentas_totales, 0);
		return [...buckets]
			.sort((a, b) => a.numero - b.numero)
			.filter((b) => b.numero >= 0 && b.numero <= 5)
			.map((b) => {
				const bucket = BUCKETS[b.numero];
				return {
					bucket,
					cuentas: b.cuentas_totales,
					porcentaje: total > 0 ? (b.cuentas_totales / total) * 100 : 0,
					destino: cartera({ bucket }),
				};
			});
	}, [cargaQuery.data]);

	const contactabilidad = (() => {
		const act = contactabilidadQuery.data as ResumenHistorial | undefined;
		const ant = contactabilidadAntQuery.data as ResumenHistorial | undefined;
		if (!act) return undefined;
		return {
			efectivos: act.efectivos,
			total: act.total,
			porcentajeAnterior:
				ant && ant.total > 0 ? (ant.efectivos / ant.total) * 100 : null,
		};
	})();

	const migracion = (() => {
		const filas = cierreQuery.data as CierreFila[] | undefined;
		if (!filas) return undefined;
		return {
			bajaron: filas.reduce((t, f) => t + Number(f.bajaron ?? 0), 0),
			subieron: filas.reduce((t, f) => t + Number(f.subieron ?? 0), 0),
		};
	})();

	const pagalo = (() => {
		const conteo = (pagaloPendientesQuery.data?.conteoPorEstado ?? undefined) as
			| Record<string, number>
			| undefined;
		return {
			pendientes: conteo
				? PAGALO_PENDIENTES.reduce((t, e) => t + Number(conteo[e] ?? 0), 0)
				: undefined,
			vencidos: pagaloVencidosQuery.data?.total,
		};
	})();

	const conteosCola = (colaQuery.data as { conteos?: Record<string, number> })
		?.conteos;
	// El conteo S2 y la categoría `sin_contacto` de la cola usan la misma regla
	// (3 días hábiles sin gestión manual): la cola es el respaldo si S2 falla.
	const sinContacto =
		complementos?.sinContacto3Dias ?? conteosCola?.sin_contacto ?? null;
	const s1 = complementos?.pendientes ?? null;
	// «x de y»: las resueltas suman los seis tipos que ya están en los
	// pendientes (convenios, recuperaciones y apagados + rebajas, documentos y
	// Jurídico). Llegan juntas del servidor; si faltan, la barra queda en «—».
	const otras = s1?.otrasResueltasHoy ?? null;
	const resueltasHoy =
		s1?.aprobacionesResueltasHoy != null && otras
			? s1.aprobacionesResueltasHoy +
				otras.rebajas +
				otras.documentos +
				otras.juridico
			: null;
	// Mientras llega el período nuevo, las tarjetas siguen con el anterior.
	const actualizandoDesempeno =
		complementosQuery.isPlaceholderData ||
		contactabilidadQuery.isPlaceholderData ||
		contactabilidadAntQuery.isPlaceholderData ||
		cierreQuery.isPlaceholderData;
	const ausentesHoy = new Set(
		asesores
			.filter((a) => a.userId && ausencias.has(a.userId))
			.map((a) => a.userId),
	).size;

	const itemsPendientes: ItemPendiente[] = [
		{
			clave: "aprobaciones",
			icono: ClipboardCheck,
			tono: "neutral",
			valor: cargandoAprobaciones ? null : aprobaciones.total,
			etiqueta: "Aprobaciones pendientes",
			info: "Convenios de pago por aprobar, solicitudes de recuperación del vehículo, de apagado o reactivación, rebajas de mora, documentos y escalados a Jurídico.",
		},
		{
			clave: "rebajas",
			icono: BadgePercent,
			tono: "neutral",
			valor: s1?.rebajasPorRevisar ?? null,
			etiqueta: "Rebajas de mora por revisar",
			info: "Solicitudes de rebaja de mora pendientes o que no se pudieron aplicar y esperan su decisión.",
			destino: solicitudes("rebaja"),
		},
		{
			clave: "documentos",
			icono: FileWarning,
			tono: "danger",
			valor: s1?.documentosPorAutorizar ?? null,
			etiqueta: "Documentos por autorizar",
			destino: solicitudes("documentos"),
		},
		{
			clave: "sin_contacto",
			icono: PhoneOff,
			tono: "warning",
			valor: sinContacto,
			etiqueta: "Sin contacto en 3 días hábiles (equipo)",
			info: "Créditos del equipo sin gestión manual en al menos 3 días hábiles completos. No cuentan los envíos automáticos ni los links de pago. Es el mismo criterio de la cola del día.",
			destino: cartera({ cola: "sin_contacto" }),
		},
		{
			clave: "prejuridico",
			icono: Gavel,
			tono: "warning",
			valor: s1?.listosPrejuridico ?? null,
			etiqueta: "Listos para pasar a Prejurídico",
			info: "Créditos del equipo en B3, activos o morosos y sin promesa vigente, cuya 4.ª cuota vence en 7 días o menos.",
		},
		{
			clave: "ausentes",
			icono: UserX,
			tono: "danger",
			valor: coberturasQuery.data ? ausentesHoy : null,
			etiqueta: "Asesores ausentes",
			info: "Asesores con una cobertura vigente hoy (vacaciones o permiso).",
			destino: {
				to: "/cobros/equipo",
				search: { tab: "asignacion", seccion: "coberturas" },
			},
		},
	];

	const abrirFicha = (id: string, tipo: "caso" | "contrato") =>
		navigate({ to: "/cobros/$id", params: { id }, search: { tipo } });

	if (!habilitado) {
		return (
			<div className="flex min-h-[60vh] items-center justify-center">
				<EmptyState
					variant="no-permission"
					title="Acceso denegado"
					description="No tiene permisos para acceder a la sección de cobros."
				/>
			</div>
		);
	}

	return (
		<DashboardSupervisorVista
			encabezado={{
				saludo: saludoPorHora(ahora),
				primerNombre: session?.user?.name?.split(" ")[0] ?? "",
				reporteria: { to: "/cobros/reportes" },
				carteraGeneral: cartera(),
				datosParciales:
					statsQuery.data?.fuente != null &&
					statsQuery.data.fuente !== "cartera-back",
			}}
			pendientes={{
				items: itemsPendientes,
				aprobaciones: {
					pendientes: cargandoAprobaciones ? null : aprobaciones.total,
					resueltasHoy,
				},
				cargando: cargandoAprobaciones && coberturasQuery.isLoading,
			}}
			desempeno={{
				periodo,
				onPeriodo: setPeriodo,
				recuperacion: complementos
					? (complementos.kpis?.recuperacion ?? null)
					: sinComplementos,
				cuentasCuradas: complementos
					? (complementos.kpis?.cuentasCuradas ?? null)
					: sinComplementos,
				promesas: complementos
					? (complementos.kpis?.promesasCumplidas ?? null)
					: sinComplementos,
				contactabilidad,
				migracion,
				errorContactabilidad: contactabilidadQuery.isError,
				errorMigracion: cierreQuery.isError,
				actualizando: actualizandoDesempeno,
			}}
			links={{
				pendientes: pagalo.pendientes,
				vencidos: pagalo.vencidos,
				error: pagaloPendientesQuery.isError || pagaloVencidosQuery.isError,
				verTodos: { to: "/cobros/pagalo" },
			}}
			aprobaciones={{
				filas: aprobaciones.filas.slice(0, LIMITE_APROBACIONES),
				total: aprobaciones.total,
				cargando: cargandoAprobaciones,
				error: errorAprobaciones,
				onReintentar: () => {
					for (const q of fuentesAprobacion) if (q.isError) void q.refetch();
				},
				verTodas: { to: SOLICITUDES },
				bandejas: aprobaciones.bandejas,
			}}
			cartera={{
				segmentos,
				total: segmentos.reduce((t, s) => t + s.cuentas, 0),
				cargando: cargaQuery.isLoading,
				error: cargaQuery.isError,
				onReintentar: () => void cargaQuery.refetch(),
				verCartera: cartera(),
			}}
			equipo={{
				filas: equipo,
				cargando: asesoresQuery.isLoading,
				error: asesoresQuery.isError,
				onReintentar: () => void asesoresQuery.refetch(),
				verEquipo: { to: "/cobros/equipo" },
				actualizando: complementosQuery.isPlaceholderData,
				fechaAgenda: agendaQuery.data?.fecha
					? new Date(`${agendaQuery.data.fecha}T12:00:00`).toLocaleDateString(
							"es-GT",
						)
					: null,
			}}
		/>
	);
}
