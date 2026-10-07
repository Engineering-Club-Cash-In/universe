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
import { MisTareasB3 } from "@/components/cobros/mis-tareas-b3";
import type { Bucket } from "@/components/ds/badges";
import { EmptyState } from "@/components/ui/empty-state";
import { authClient } from "@/lib/auth-client";
import { PERMISSIONS } from "@/lib/roles";
import { orpc, orpcAparte } from "@/utils/orpc";
import type {
	BandejaAprobacion,
	FilaAprobacion,
} from "./aprobaciones-pendientes";
import type { SegmentoBucketEquipo } from "./cartera-equipo-bucket";
import { DashboardSupervisorVista } from "./dashboard-supervisor-vista";
import type { Destino } from "./destino";
import type { EstadoAsesor, FilaEquipo } from "./equipo-tabla";
import { hoyGT, nombreCorto, type Periodo, rangosPeriodo } from "./formato";
import type { ItemPendiente } from "./pendientes-hoy";

/**
 * Contenedor del Dashboard del supervisor (supervisión y admin): hace las
 * consultas y arma las props de `DashboardSupervisorVista`. Cada bloque carga
 * por su cuenta. Lo que no tiene fuente llega de `getSupervisionComplementos`
 * (stubs S1–S4 de José, doc 17) y se muestra con «—» o «Pronto».
 *
 * Identificadores: el asesor_id de cartera (cola, carga, convenios, Págalo) y
 * el userId del CRM (agenda, coberturas) se cruzan con getAsesoresTraslados.
 */

const CARTERA = "/cobros/cartera";
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

type ResumenHistorial = { total: number; efectivos: number };

type CierreFila = { bajaron: number; subieron: number };

type ConvenioPendiente = {
	convenio_id: number;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_nombre: string | null;
	fecha_convenio: string;
};

type Recuperacion = {
	id: string;
	numeroSifco: string | null;
	cliente: string | null;
	solicitante: string | null;
	solicitadoAt: string | Date | null;
};

type Inmovilizacion = {
	id: string;
	numeroCreditoSifco: string;
	accion: string;
	estado: string;
	solicitadoAt: string | Date | null;
	solicitanteNombre: string | null;
	clienteNombre: string | null;
};

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

function aIso(v: string | Date | null | undefined) {
	if (!v) return null;
	return typeof v === "string" ? v : v.toISOString();
}

function estadoPorAgenda(pct: number | null): EstadoAsesor {
	if (pct === null) return "sin_dato";
	if (pct >= 80) return "bien";
	if (pct >= 60) return "atencion";
	return "riesgo";
}

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
	const contactabilidadQuery = useQuery({
		...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
			input: rangos.actual as never,
		}),
		enabled: habilitado,
		placeholderData: keepPreviousData,
	});
	const contactabilidadAntQuery = useQuery({
		...orpcSinTipo.getHistorialAgendasResumen.queryOptions({
			input: rangos.anterior as never,
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

	// Mismo queryKey que usa MisTareasB3: solo para saber si hay tareas.
	const tareasQuery = useQuery({
		...orpc.getMisTareasCobros.queryOptions(),
		enabled: habilitado,
		refetchInterval: 60_000,
	});

	/* ── Derivados ─────────────────────────────────────────────────────────── */

	const complementos = complementosQuery.data;
	// Si los complementos fallan, las cards quedan en «—» y no cargando.
	const sinComplementos = complementosQuery.isError ? null : undefined;

	const aprobaciones = useMemo(() => {
		const convenios = (conveniosQuery.data?.items ??
			[]) as unknown as ConvenioPendiente[];
		const recuperaciones = (recuperacionesQuery.data?.pendientes ??
			[]) as unknown as Recuperacion[];
		const inmovilizaciones = (
			(inmovilizacionesQuery.data ?? []) as unknown as Inmovilizacion[]
		).filter((i) => i.estado === "pendiente_aprobacion");
		const filas: FilaAprobacion[] = [
			...convenios.map(
				(c): FilaAprobacion => ({
					id: `convenio-${c.convenio_id}`,
					tipo: "convenio",
					cliente: c.cliente_nombre,
					credito: c.numero_credito_sifco,
					asesor: nombreCorto(c.asesor_nombre) || null,
					solicitadoEn: c.fecha_convenio,
					destino: { to: "/cobros/convenios" },
				}),
			),
			...recuperaciones.map(
				(r): FilaAprobacion => ({
					id: `recuperacion-${r.id}`,
					tipo: "recuperacion",
					cliente: r.cliente ?? "Sin nombre",
					credito: r.numeroSifco,
					asesor: nombreCorto(r.solicitante) || null,
					solicitadoEn: aIso(r.solicitadoAt),
					destino: { to: "/cobros/recuperaciones" },
				}),
			),
			...inmovilizaciones.map(
				(i): FilaAprobacion => ({
					id: `inmovilizacion-${i.id}`,
					tipo: i.accion === "reactivacion" ? "reactivacion" : "apagado",
					cliente: i.clienteNombre ?? "Sin nombre",
					credito: i.numeroCreditoSifco,
					asesor: nombreCorto(i.solicitanteNombre) || null,
					solicitadoEn: aIso(i.solicitadoAt),
					destino: { to: "/cobros/inmovilizaciones" },
				}),
			),
		];
		// Las más antiguas primero; sin fecha, al final.
		filas.sort((a, b) => {
			if (!a.solicitadoEn) return 1;
			if (!b.solicitadoEn) return -1;
			return (
				new Date(a.solicitadoEn).getTime() - new Date(b.solicitadoEn).getTime()
			);
		});
		const totalConvenios = conveniosQuery.data?.total ?? convenios.length;
		const bandejas: BandejaAprobacion[] = [
			{
				clave: "convenios",
				etiqueta: "Convenios",
				cantidad: conveniosQuery.data ? totalConvenios : null,
				destino: { to: "/cobros/convenios" },
			},
			{
				clave: "recuperaciones",
				etiqueta: "Recuperación del vehículo",
				cantidad: recuperacionesQuery.data ? recuperaciones.length : null,
				destino: { to: "/cobros/recuperaciones" },
			},
			{
				clave: "inmovilizaciones",
				etiqueta: "Apagado y reactivación",
				cantidad: inmovilizacionesQuery.data ? inmovilizaciones.length : null,
				destino: { to: "/cobros/inmovilizaciones" },
			},
		];
		return {
			filas,
			total: totalConvenios + recuperaciones.length + inmovilizaciones.length,
			bandejas,
		};
	}, [
		conveniosQuery.data,
		recuperacionesQuery.data,
		inmovilizacionesQuery.data,
	]);
	const cargandoAprobaciones =
		conveniosQuery.isLoading ||
		recuperacionesQuery.isLoading ||
		inmovilizacionesQuery.isLoading;
	const errorAprobaciones =
		conveniosQuery.isError ||
		recuperacionesQuery.isError ||
		inmovilizacionesQuery.isError;

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
					estado: estadoPorAgenda(extra?.rescate ?? ag),
					destino: cartera({ asesor: String(a.asesor_id) }),
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
	const sinContactoS2 = complementos?.sinContacto3Dias ?? null;
	const s1 = complementos?.pendientes ?? null;
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
			info: "Convenios de pago por aprobar, solicitudes de recuperación del vehículo y de apagado o reactivación.",
		},
		{
			clave: "rebajas",
			icono: BadgePercent,
			tono: "neutral",
			valor: s1?.rebajasPorRevisar ?? null,
			etiqueta: "Rebajas de mora por revisar",
			pronto: s1?.rebajasPorRevisar == null,
		},
		{
			clave: "documentos",
			icono: FileWarning,
			tono: "danger",
			valor: s1?.documentosPorAutorizar ?? null,
			etiqueta: "Documentos por autorizar",
			pronto: s1?.documentosPorAutorizar == null,
		},
		// Mientras no exista el conteo de «> 3 días» (S2), se muestra el de la
		// cola del día, que usa otro umbral (más de 5 días) y se dice en la etiqueta.
		sinContactoS2 !== null
			? {
					clave: "sin_contacto",
					icono: PhoneOff,
					tono: "warning",
					valor: sinContactoS2,
					etiqueta: "Sin contacto > 3 días (equipo)",
					destino: cartera({ cola: "sin_contacto" }),
				}
			: {
					clave: "sin_contacto",
					icono: PhoneOff,
					tono: "warning",
					valor: conteosCola?.sin_contacto ?? null,
					etiqueta: "Sin contacto > 5 días (equipo)",
					info: "Créditos del equipo sin contacto en más de 5 días (criterio de la cola del día). El conteo de más de 3 días hábiles del diseño está pendiente.",
					destino: cartera({ cola: "sin_contacto" }),
				},
		{
			clave: "prejuridico",
			icono: Gavel,
			tono: "warning",
			valor: s1?.listosPrejuridico ?? null,
			etiqueta: "Listos para pasar a Prejurídico",
			pronto: s1?.listosPrejuridico == null,
		},
		{
			clave: "ausentes",
			icono: UserX,
			tono: "danger",
			valor: coberturasQuery.data ? ausentesHoy : null,
			etiqueta: "Asesores ausentes",
			info: "Asesores con una cobertura vigente hoy (vacaciones o permiso).",
			destino: { to: "/cobros/reasignaciones" },
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

	const tieneTareas = (tareasQuery.data?.tareas?.length ?? 0) > 0;

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
					resueltasHoy: s1?.aprobacionesResueltasHoy ?? null,
				},
				cargando: cargandoAprobaciones && coberturasQuery.isLoading,
				tareas: tieneTareas ? (
					<MisTareasB3 onVerCaso={(sifco) => abrirFicha(sifco, "caso")} />
				) : null,
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
					void conveniosQuery.refetch();
					void recuperacionesQuery.refetch();
					void inmovilizacionesQuery.refetch();
				},
				// No hay bandeja única todavía (fase 2): convenios es la más grande.
				verTodas: { to: "/cobros/convenios" },
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
				verEquipo: { to: "/cobros/carga" },
				fechaAgenda: agendaQuery.data?.fecha
					? new Date(`${agendaQuery.data.fecha}T12:00:00`).toLocaleDateString(
							"es-GT",
						)
					: null,
			}}
		/>
	);
}
