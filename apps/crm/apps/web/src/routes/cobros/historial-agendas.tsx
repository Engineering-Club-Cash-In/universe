import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	AlertTriangle,
	CalendarClock,
	FileSpreadsheet,
	Loader2,
	Mail,
	MapPin,
	MessageSquare,
	Pencil,
	Phone,
	RotateCcw,
	ScrollText,
	Send,
	Smartphone,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
	type UsuarioCobros,
	UsuarioCobrosMultiSelect,
} from "@/components/cobros/usuario-cobros-multi-select";
import { DateRangeFilter } from "@/components/reports/date-range-filter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { usePersistedState } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";
import {
	type BucketsCatalogoQueryData,
	bucketDeNumero,
	estiloBucket,
	labelBucketConCodigo,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/historial-agendas")({
	component: HistorialAgendasPage,
});

/** Tope del export — más filas que esto matan al navegador armando el workbook. */
const LIMITE_EXPORT = 20_000;
const PAGE_SIZE_EXPORT = 200;

/**
 * Sentinela del chip "Sin bucket" (gestiones con `bucket_snapshot` NULL).
 *
 * Espejo de `BUCKET_SIN_ASIGNAR` en server/src/lib/historial-agendas.ts —
 * mantener ambos en -1. Se duplica en vez de importarse porque este archivo no
 * importa del server (el tipado del router va por los tipos manuales de abajo,
 * ver la nota de TS7056); el input de zod valida `min(-1)`, así que un cambio
 * de un solo lado se rechaza en el borde en vez de filtrar mal en silencio.
 */
const BUCKET_SIN_ASIGNAR = -1;

const ESTADOS_CONTACTO = [
	{ value: "contactado", label: "Contactado" },
	{ value: "promesa_pago", label: "Promesa de pago" },
	{ value: "acuerdo_parcial", label: "Acuerdo parcial" },
	{ value: "rechaza_pagar", label: "Rechaza pagar" },
	{ value: "no_contesta", label: "No contesta" },
	{ value: "numero_equivocado", label: "Número equivocado" },
] as const;

const METODOS_CONTACTO = [
	{ value: "llamada", label: "Llamada", icono: Phone },
	{ value: "whatsapp", label: "WhatsApp", icono: MessageSquare },
	{ value: "sms", label: "SMS", icono: Smartphone },
	{ value: "email", label: "Email", icono: Mail },
	{ value: "visita_domicilio", label: "Visita", icono: MapPin },
	{ value: "carta_notarial", label: "Carta notarial", icono: Send },
] as const;

const ROLES_FILTRABLES = [
	{ value: "cobros", label: "Asesor de Cobros" },
	{ value: "cobros_supervisor", label: "Supervisor de Cobros" },
	{ value: "admin", label: "Administrador" },
] as const;

const ORIGEN_LABEL: Record<string, string> = {
	manual: "Manual",
	premora: "Premora automático",
	convenio: "Recordatorio de convenio",
	wsp_masivo: "WhatsApp masivo",
};

/**
 * Contrato de `routers/historial-agendas.ts`, escrito a mano.
 *
 * Normalmente esto lo infiere oRPC de punta a punta, pero el tipo del cliente
 * está truncado por TS7056 (ver la nota dentro del componente). Estos tipos son
 * el reemplazo manual mientras eso siga así.
 */
type FilaHistorialData = {
	id: string;
	fechaContacto: string | Date;
	usuarioId: string;
	usuarioNombre: string | null;
	usuarioRol: string | null;
	bucketSnapshot: number | null;
	casoCobroId: string;
	numeroCreditoSifco: string | null;
	clienteNombre: string | null;
	metodoContacto: string | null;
	estadoContacto: string | null;
	comentarios: string | null;
	fechaProximoContacto: string | Date | null;
	proximoPaso: string | null;
	requiereSeguimiento: boolean | null;
	estadoPromesa: string | null;
	cuotaInicio: number | null;
	cuotaFin: number | null;
	incluyeMora: boolean | null;
	montoComprometido: string | null;
	fechaAlerta: string | Date | null;
	/** Última escritura sobre la fila. NULL = nunca se tocó desde que se creó. */
	updatedAt: string | Date | null;
	origen: string;
	fueEditadoManual: boolean;
	ultimaEdicion: string | Date | null;
	vecesEditado: number;
};

type RespuestaHistorial = {
	items: FilaHistorialData[];
	// `null` cuando se pidió con `incluirConteo: false` (el export): ahí el
	// servidor no cuenta, y devolver un número lo dejaría plausible pero mal.
	total: number | null;
	totalEsAproximado: boolean;
	page: number;
	pageSize: number;
	totalPaginas: number | null;
	rangoAplicado: { desde: string; hasta: string; esDefault: boolean };
	verTodos: boolean;
};

type ResumenHistorial = {
	total: number;
	efectivos: number;
	promesas: number;
	sinContacto: number;
	conProximaAccion: number;
	editadas: number;
	porBucket: { bucket: number | null; cantidad: number }[];
};

type EntradaAuditoria = {
	id: string;
	accion: string;
	origen: string;
	valoresAnteriores: unknown;
	editadoPor: string | null;
	editadoPorNombre: string | null;
	editadoEn: string | Date;
};

function etiquetaEstado(valor: string | null): string {
	return ESTADOS_CONTACTO.find((e) => e.value === valor)?.label ?? "—";
}

function etiquetaMetodo(valor: string | null): string {
	return METODOS_CONTACTO.find((m) => m.value === valor)?.label ?? "—";
}

function IconoMetodo({ metodo }: { metodo: string | null }) {
	const def = METODOS_CONTACTO.find((m) => m.value === metodo);
	if (!def) return null;
	const Icono = def.icono;
	return <Icono className="h-3.5 w-3.5 shrink-0 text-gray-400" />;
}

function etiquetaRol(rol: string | null): string {
	return ROLES_FILTRABLES.find((r) => r.value === rol)?.label ?? rol ?? "—";
}

/**
 * `Intl.DateTimeFormat` con zona horaria explícita GT, en vez de `date-fns`
 * puro: `format()` de `date-fns` usa siempre la zona LOCAL del navegador, y las
 * ventanas de este reporte se definen por día calendario de Guatemala en el
 * server. Para un supervisor con el navegador fuera de UTC-6, una gestión
 * cerca de medianoche se mostraba en un día u hora distinto al real GT —y esta
 * fecha alimenta la tabla, el popover de auditoría y el export XLSX, así que
 * podía contradecir el propio rango de fechas que el usuario seleccionó.
 */
const MESES_CORTOS_ES = [
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

/** Partes de un instante en el día calendario y hora de Guatemala. */
function partesGT(fecha: Date) {
	const partes = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).formatToParts(fecha);
	const get = (tipo: string) =>
		partes.find((p) => p.type === tipo)?.value ?? "";
	return {
		dia: get("day"),
		mes: MESES_CORTOS_ES[Number(get("month")) - 1] ?? "",
		anio: get("year"),
		hora: get("hour"),
		minuto: get("minute"),
	};
}

function fechaHora(valor: string | Date | null): string {
	if (!valor) return "—";
	const { dia, mes, anio, hora, minuto } = partesGT(new Date(valor));
	return `${dia} ${mes} ${anio} ${hora}:${minuto}`;
}

function soloFecha(valor: string | Date | null): string {
	if (!valor) return "—";
	const { dia, mes, anio } = partesGT(new Date(valor));
	return `${dia} ${mes} ${anio}`;
}

/** YYYY-MM-DD de un Date local, sin pasar por UTC (que correría el día). */
function aFechaISO(fecha: Date): string {
	const y = fecha.getFullYear();
	const m = String(fecha.getMonth() + 1).padStart(2, "0");
	const d = String(fecha.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Suma días a un Date en horario LOCAL (no UTC), preservando hora/minuto. */
function sumarDiasLocal(fecha: Date, dias: number): Date {
	const copia = new Date(fecha);
	copia.setDate(copia.getDate() + dias);
	return copia;
}

/**
 * YYYY-MM-DD de un instante, en el día calendario de GUATEMALA (no el del
 * navegador). Espejo client-side de `toDateStrGT` del server
 * (`lib/guatemala-month-window.ts`): mismo mecanismo (`Intl.DateTimeFormat`
 * `en-CA` da directo el formato ISO), duplicado porque este archivo no importa
 * del server (ver la nota de TS7056 más abajo). Necesario para convertir
 * `rangoAplicado.hasta` (instante UTC, exclusivo) al día calendario GT que
 * espera `z.string().date()` en el input — usar el día LOCAL del navegador acá
 * correría el día para cualquier usuario fuera de UTC-6.
 */
function aFechaISO_GT(instante: Date): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Guatemala",
	}).format(instante);
}

function HistorialAgendasPage() {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = userRole
		? PERMISSIONS.canViewAllCasosCobros(userRole)
		: false;

	// Los filtros persisten en sessionStorage: el supervisor entra y sale de la
	// ficha de un crédito y vuelve al mismo recorte.
	//
	// El rango va con `usePersistedDateRange` y NO con `usePersistedState`: este
	// último serializa con JSON, que devuelve las fechas como string al recargar
	// — y `aFechaISO()` llamaría `.getFullYear()` sobre un string, tumbando la
	// pantalla. El hook dedicado serializa a ISO y re-hidrata como Date.
	const [rangoFechas, setRangoFechas] = usePersistedDateRange(
		"cobros-historial-agendas-rango",
	);
	// Clave versionada (-v2): el catálogo de usuarios pasó de "todos los roles de
	// cobros" a "solo quien gestionó en el rango", y los ids guardados con el
	// catálogo viejo quedaban aplicando un filtro que ya no aparece en el
	// desplegable. Cambiar la clave descarta ese estado en vez de arrastrarlo.
	const [usuarioIds, setUsuarioIds] = usePersistedState<string[] | null>(
		"cobros-historial-agendas-usuarios-v2",
		null,
	);
	const [buckets, setBuckets] = usePersistedState<number[] | null>(
		"cobros-historial-agendas-buckets",
		null,
	);
	const [rol, setRol] = usePersistedState<string>(
		"cobros-historial-agendas-rol",
		"todos",
	);
	const [estadoContacto, setEstadoContacto] = usePersistedState<string>(
		"cobros-historial-agendas-estado",
		"todos",
	);
	const [metodoContacto, setMetodoContacto] = usePersistedState<string>(
		"cobros-historial-agendas-metodo",
		"todos",
	);
	const [estadoPromesa, setEstadoPromesa] = usePersistedState<string>(
		"cobros-historial-agendas-promesa",
		"todos",
	);
	const [incluirAutomaticos, setIncluirAutomaticos] =
		usePersistedState<boolean>("cobros-historial-agendas-automaticos", false);
	const [busquedaSifco, setBusquedaSifco] = useState("");
	// El input dispara una query por tecla si se usa crudo, y el filtro es por
	// número EXACTO: tecleando "12345" las 4 primeras pulsaciones son queries
	// garantizadas a cero filas contra una tabla que crece a cientos de miles.
	// Mismo patrón (y mismo retardo) que el filtro SIFCO de /cobros.
	const [busquedaSifcoDebounced, setBusquedaSifcoDebounced] = useState("");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(50);
	const [exportando, setExportando] = useState(false);

	// Debounce del filtro SIFCO (1s, igual que /cobros). El reset de página va
	// acá y no en el onChange: cambiar de página en cada tecla haría que el
	// usuario perdiera su posición mientras todavía está escribiendo.
	useEffect(() => {
		const timer = setTimeout(() => {
			setBusquedaSifcoDebounced(busquedaSifco);
			setPage(1);
		}, 1000);
		return () => clearTimeout(timer);
	}, [busquedaSifco]);

	const catalogoQuery = useBucketsCatalogo();
	// `getBucketsCatalogo` cae en el mismo truncado de TS7056 que el resto (ver
	// nota más abajo): el hook devuelve `unknown` aunque el server lo tipa bien.
	const catalogo = catalogoQuery.data as BucketsCatalogoQueryData | undefined;

	// NOTA sobre los casts de `orpc` y de `.data` en este archivo:
	// `cobrosAppRouter` (server) supera el límite de TS7056 y TypeScript trunca
	// el tipo inferido del cliente SIN emitir error — el tipo de `orpc` corta en
	// ~294 keys y las que quedan afuera aparecen como inexistentes. Es un
	// problema preexistente de la rama, no de esta feature: `$id.tsx`,
	// `panel-gestion-rapida.tsx` y `buckets-catalogo.ts` ya conviven con lo
	// mismo y usan este patrón (ver panel-gestion-rapida.tsx:181). Los tipos
	// declarados arriba son el contrato real de `routers/historial-agendas.ts`;
	// si ese cambia, hay que actualizarlos a mano hasta que se parta el router.
	// biome-ignore lint/suspicious/noExplicitAny: ver nota de TS7056 arriba.
	const orpcAny = orpc as any;
	// biome-ignore lint/suspicious/noExplicitAny: idem.
	const clientAny = client as any;

	// Todos los filtros MENOS la selección de usuarios. Se separa porque el
	// catálogo de usuarios se calcula a partir de estos —si incluyera la
	// selección actual, el desplegable se quedaría con un solo nombre y no se
	// podría cambiar de usuario sin limpiar el filtro primero.
	const filtrosBase = useMemo(
		() => ({
			desde: rangoFechas?.from ? aFechaISO(rangoFechas.from) : undefined,
			hasta: rangoFechas?.to ? aFechaISO(rangoFechas.to) : undefined,
			// El selector de rol solo se renderiza para esSupervisor (más abajo en
			// el JSX). Sin este gate, un `rol` heredado en sessionStorage de una
			// sesión previa con más permisos (u otro usuario en el mismo perfil de
			// navegador) se seguiría mandando para un asesor que ni lo ve ni puede
			// cambiarlo — el backend lo combina con su scope forzado por
			// `realizado_por` y devuelve 0 filas sin ninguna pista visible de por
			// qué.
			roles: esSupervisor && rol !== "todos" ? [rol] : undefined,
			buckets: buckets?.length ? buckets : undefined,
			estadoContacto: estadoContacto === "todos" ? undefined : [estadoContacto],
			metodoContacto: metodoContacto === "todos" ? undefined : [metodoContacto],
			estadoPromesa: estadoPromesa === "todos" ? undefined : estadoPromesa,
			numeroCreditoSifco: busquedaSifcoDebounced.trim() || undefined,
			incluirAutomaticos,
		}),
		[
			rangoFechas,
			rol,
			esSupervisor,
			buckets,
			estadoContacto,
			metodoContacto,
			estadoPromesa,
			busquedaSifcoDebounced,
			incluirAutomaticos,
		],
	);

	// Catálogo del filtro de usuario: solo quien TIENE gestiones bajo los filtros
	// activos. No es el catálogo de roles de cobros — ese trae ~15 admins de
	// sistemas y dirección que nunca gestionaron nada. Se re-consulta cuando
	// cambia cualquier filtro, así filtrando por B2 solo aparecen los que
	// gestionaron en B2 y no se ofrecen nombres que darían tabla vacía.
	const usuariosQuery = useQuery({
		...orpcAny.getUsuariosConGestiones.queryOptions({ input: filtrosBase }),
		enabled: !!session && esSupervisor,
	});
	const usuarios = (usuariosQuery.data ?? []) as UsuarioCobros[];

	/**
	 * Selección de usuario que ve y edita el multi-select — DISTINTA del valor
	 * que se manda al backend (ver `usuarioIdsParaBackend` más abajo).
	 *
	 * `[]` ("Deseleccionar todos") y `null` (nunca elegido / "Seleccionar
	 * todos") son estados DIFERENTES para el componente, aunque el backend trate
	 * a ambos como "sin filtro". Colapsarlos acá a uno solo (`undefined`) hacía
	 * que el multi-select recibiera `null` después de un "Deseleccionar todos" y
	 * pintara TODOS los usuarios como marcados (`vigentes === null` → `selected
	 * = allIds`); el siguiente click en un usuario entonces lo SACABA del
	 * conjunto completo en vez de dejarlo como única selección — un supervisor
	 * que quería filtrar por una sola persona terminaba filtrando por todas
	 * menos esa.
	 *
	 * NO se valida contra `usuarios` (el catálogo). Versión anterior descartaba
	 * cualquier id que no apareciera en `usuarios`, tratándolo como "ya no
	 * existe" — pero `getUsuariosConGestiones` recibe `filtrosBase`, que incluye
	 * bucket/resultado/tipo/SIFCO: el catálogo se RESTRINGE por esos filtros. Un
	 * supervisor que elige un usuario y luego aplica un bucket bajo el cual ese
	 * usuario no tiene gestiones ve su selección desaparecer del catálogo —
	 * legítimamente, no por estar "borrada" — y el saneo antiguo lo interpretaba
	 * igual que un id inválido, lo tiraba, y listado/KPIs/export seguían
	 * corriendo SIN el filtro: pasaban de "cero resultados para este usuario" a
	 * "todo el equipo", en silencio.
	 *
	 * El único saneo real que queda: limpiar la selección para quien NO es
	 * supervisor (el filtro no se ve ni se puede tocar). El backend maneja bien
	 * un id que no matchea nada — 0 filas es una respuesta correcta, y sigue
	 * siendo scope-safe: el supervisor solo puede filtrar por ids reales que el
	 * multi-select le ofreció alguna vez.
	 */
	const usuarioIdsUI = esSupervisor ? usuarioIds : null;

	// Persiste a sessionStorage el único caso en que `usuarioIdsUI` difiere de
	// `usuarioIds`: cuando el usuario actual NO es supervisor. Sin esto, un
	// asesor que alguna vez tuvo una selección persistida (rol degradado, sesión
	// compartida) la sigue arrastrando en sessionStorage aunque el filtro nunca
	// se le aplique en memoria — y volvería a aplicarse solo si el rol cambia de
	// vuelta a supervisor sin que el usuario haya vuelto a elegir nada. Se
	// compara por contenido, no por referencia, para no reescribir sessionStorage
	// (y no re-disparar este efecto) en cada render.
	useEffect(() => {
		if (usuarioIdsUI === usuarioIds) return;
		if (
			usuarioIdsUI &&
			usuarioIds &&
			usuarioIdsUI.length === usuarioIds.length &&
			usuarioIdsUI.every((id, i) => id === usuarioIds[i])
		) {
			return;
		}
		setUsuarioIds(usuarioIdsUI);
	}, [usuarioIdsUI, usuarioIds, setUsuarioIds]);

	/**
	 * Valor que se manda al backend: `[]` SÍ se colapsa a `undefined` acá (a
	 * diferencia de `usuarioIdsUI`), porque `whereHistorial` en el server trata
	 * un array vacío como "sin filtro" — mandarlo tal cual sería redundante con
	 * `undefined`, no incorrecto, pero mantener la distinción solo donde importa
	 * (la UI) evita cargar esa sutileza en el resto del archivo.
	 */
	const usuarioIdsParaBackend = usuarioIdsUI?.length ? usuarioIdsUI : undefined;

	const filtros = useMemo(
		() => ({ ...filtrosBase, usuarioIds: usuarioIdsParaBackend }),
		[filtrosBase, usuarioIdsParaBackend],
	);

	// `canAccessCobros`, no solo `!!session`: ambos procedures están gateados
	// por `cobrosProcedure` en el server, así que un usuario autenticado SIN el
	// permiso (que abre la URL directo, sin pasar por el menú que ya la
	// esconde) disparaba las queries igual — el rechazo del backend llegaba
	// como reintentos y toasts de error globales detrás de la pantalla de
	// "Acceso Denegado" que de todas formas se termina mostrando más abajo.
	const puedeConsultar = !!userRole && PERMISSIONS.canAccessCobros(userRole);

	const listado = useQuery({
		...orpcAny.getHistorialAgendas.queryOptions({
			input: { ...filtros, page, pageSize },
		}),
		enabled: !!session && puedeConsultar,
	});

	const resumen = useQuery({
		...orpcAny.getHistorialAgendasResumen.queryOptions({ input: filtros }),
		enabled: !!session && puedeConsultar,
		// No se recalcula al paginar: los agregados no dependen de la página.
		staleTime: 60_000,
	});

	const datos = listado.data as RespuestaHistorial | undefined;
	const resumenData = resumen.data as ResumenHistorial | undefined;
	const items = datos?.items ?? [];
	const totalPaginas = datos?.totalPaginas ?? 1;

	// Con `totalEsAproximado` el servidor capó el COUNT en 10,000 (ver
	// LIMITE_CONTEO), pero el listado en sí no tiene ese techo: sigue sirviendo
	// páginas más allá. Bloquear "Siguiente" con `page >= totalPaginas` (derivado
	// del total capado) dejaba inalcanzables todas las filas después de la
	// 10,000. En el caso aproximado, la página actual llena es la única señal de
	// que puede haber más.
	const hayMasPaginas = datos?.totalEsAproximado
		? items.length === pageSize
		: page < totalPaginas;

	/**
	 * Chips de bucket: los que trae el resumen MÁS los que estén seleccionados
	 * aunque hayan quedado en cero.
	 *
	 * El resumen ignora el filtro de bucket pero sí respeta los demás, así que un
	 * rango de fechas o un usuario sin gestiones lo devuelve vacío. Sin este
	 * merge, el chip que el usuario acababa de tocar desaparecía justo cuando
	 * necesitaba destocarlo. Los agregados van con cantidad 0 y ordenados como el
	 * resto (los reales primero por número, "Sin bucket" al final).
	 */
	const bucketsChips = useMemo(() => {
		const delResumen = resumenData?.porBucket ?? [];
		const presentes = new Set(
			delResumen.map((b) => b.bucket ?? BUCKET_SIN_ASIGNAR),
		);
		const faltantes = (buckets ?? [])
			.filter((v) => !presentes.has(v))
			.map((v) => ({
				bucket: v === BUCKET_SIN_ASIGNAR ? null : v,
				cantidad: 0,
			}));
		return [...delResumen, ...faltantes].sort((a, b) => {
			// `null` ("Sin bucket") siempre al final, como en el orden del servidor.
			if (a.bucket === null) return 1;
			if (b.bucket === null) return -1;
			return a.bucket - b.bucket;
		});
	}, [resumenData?.porBucket, buckets]);

	const filtrosActivos = [
		rangoFechas?.from,
		// El de UI, no el persistido crudo: para un asesor `usuarioIdsUI` es
		// siempre `null` aunque haya algo guardado (el filtro no se le aplica),
		// así que contar el crudo mostraría "Limpiar (1)" sin que haya nada real
		// que limpiar.
		usuarioIdsUI?.length,
		buckets?.length,
		rol !== "todos" || null,
		estadoContacto !== "todos" || null,
		metodoContacto !== "todos" || null,
		estadoPromesa !== "todos" || null,
		busquedaSifco.trim() || null,
		incluirAutomaticos || null,
	].filter(Boolean).length;

	function limpiarFiltros() {
		setRangoFechas(undefined);
		setUsuarioIds(null);
		setBuckets(null);
		setRol("todos");
		setEstadoContacto("todos");
		setMetodoContacto("todos");
		setEstadoPromesa("todos");
		setBusquedaSifco("");
		// También el debounced: si solo se limpiara el crudo, el efecto tardaría
		// 1s en propagarlo y "Limpiar" dejaría el filtro aplicado ese rato.
		setBusquedaSifcoDebounced("");
		setIncluirAutomaticos(false);
		setPage(1);
	}

	/**
	 * Export de la vista filtrada COMPLETA, no solo la página en pantalla.
	 *
	 * Pagina contra el servidor hasta agotar o hasta el tope. El tope no es
	 * decorativo: a 5× volumen un año sin filtros son decenas de miles de filas,
	 * y armar ese workbook en memoria cuelga el navegador. Si el filtro lo
	 * excede se avisa ANTES de descargar, en vez de truncar en silencio.
	 */
	async function exportarXLSX() {
		if (exportando) return;

		const total = datos?.total ?? 0;
		if (total > LIMITE_EXPORT || datos?.totalEsAproximado) {
			const seguir = window.confirm(
				`Tu filtro tiene ${datos?.totalEsAproximado ? "más de " : ""}${total.toLocaleString("es-GT")} registros. ` +
					`Se exportarán los primeros ${LIMITE_EXPORT.toLocaleString("es-GT")}. ` +
					"Acotá el rango de fechas si necesitás el export completo.\n\n¿Continuar?",
			);
			if (!seguir) return;
		}

		// Instante real de inicio del export, no un día calendario: `hasta` que
		// manda el server (z.string().date()) solo tiene granularidad de DÍA, así
		// que fijar `hasta = hoy` (como se hacía antes) seguía dejando abierta toda
		// la ventana restante del día — una gestión registrada 10 minutos después
		// de iniciar el export, mismo día, entraba igual. El corte real pasa acá,
		// en memoria, comparando contra el timestamp exacto.
		const instanteInicio = new Date();

		// El listado ordena por fecha_contacto DESC con OFFSET (no cursor): una
		// gestión nueva insertada entre dos páginas del mismo export va PRIMERA y
		// corre el offset de todo lo que sigue —duplica la que era última fila de
		// una página, y una fila que estaba al final puede salirse de rango sin
		// aparecer—. `hasta` se fija amplio (mañana) para no perder nada por el
		// borde day-granular; el corte real es el filtro por `instanteInicio` de
		// abajo, y el dedup por `id` cubre el caso de duplicado que el offset
		// shift puede producir. Lo que este mecanismo NO puede arreglar es una
		// fila que el corrimiento empuja fuera de las páginas ya visitadas sin
		// duplicarse en ninguna —eso requeriría cursor sobre (fecha_contacto, id)
		// en el propio endpoint, cambio de mayor alcance que el de este archivo.
		//
		// Cuando NI `desde` NI `hasta` vienen del usuario (modo default), fijar
		// solo `hasta` acá dejaba `desde` sin mandar — el server lo re-derivaba
		// como `hasta_nuevo - 30 días` (normalizarRango, rama de "una sola cota
		// dada"), que es UN DÍA MÁS TARDE que el `desde` real que ya calculó y
		// mostró la pantalla (`hoy - 30`, rama "ninguna cota dada"). El export
		// quedaba un día corrido respecto a la tabla y sus KPIs, silenciosamente.
		// La corrección: cuando el usuario no fijó fechas, se usa el rango que el
		// SERVER ya devolvió y la pantalla ya muestra (`datos.rangoAplicado`) para
		// fijar AMBOS extremos, no solo `hasta` — el export refleja exactamente lo
		// que está en pantalla en vez de recalcular una ventana distinta.
		const sinFiltroDeFechas = !filtros.desde && !filtros.hasta;
		const filtrosExport =
			sinFiltroDeFechas && datos?.rangoAplicado
				? {
						...filtros,
						desde: aFechaISO_GT(new Date(datos.rangoAplicado.desde)),
						// `rangoAplicado.hasta` es EXCLUSIVO (medianoche del día
						// siguiente al último día mostrado), pero el `hasta` que espera
						// el input es INCLUSIVO (día calendario). Restar 24h antes de
						// convertir da el último día real que la tabla muestra — sin
						// esto, el server volvía a sumarle 1 día (trata cualquier
						// `hasta` que recibe como inclusivo), agregando un día de más al
						// export que la pantalla no tiene.
						hasta: aFechaISO_GT(
							new Date(
								new Date(datos.rangoAplicado.hasta).getTime() -
									24 * 60 * 60 * 1000,
							),
						),
					}
				: {
						...filtros,
						hasta:
							filtros.hasta ?? aFechaISO(sumarDiasLocal(instanteInicio, 1)),
					};

		setExportando(true);
		try {
			const filas: FilaHistorialData[] = [];
			const idsVistos = new Set<string>();
			let paginaActual = 1;
			let hayMas = true;

			while (hayMas && filas.length < LIMITE_EXPORT) {
				const respuesta = (await clientAny.getHistorialAgendas({
					...filtrosExport,
					page: paginaActual,
					pageSize: PAGE_SIZE_EXPORT,
					// Hasta 100 páginas sobre el mismo filtro: sin esto cada una
					// dispararía el COUNT acotado, cuyo resultado acá no se usa (el
					// corte es "la página vino llena"). A 800k filas son 100 counts de
					// regalo. Las marcas de edición SÍ se piden: alimentan la columna
					// "Editado" del archivo.
					incluirConteo: false,
				})) as RespuestaHistorial;
				for (const fila of respuesta.items) {
					// Filas registradas DESPUÉS de iniciar el export: se descartan acá,
					// no en el filtro del server (que solo distingue días). Y el dedup
					// por id: el corrimiento de offset por una inserción intermedia
					// puede repetir la misma fila en dos páginas consecutivas.
					if (new Date(fila.fechaContacto) > instanteInicio) continue;
					if (idsVistos.has(fila.id)) continue;
					idsVistos.add(fila.id);
					filas.push(fila);
				}
				// El corte es SOLO "la página vino llena", no `totalPaginas`: ese sale
				// del COUNT acotado a 10,001, así que con más de 10k filas el loop
				// habría parado ahí mientras el diálogo prometía 20,000. El tope real
				// es LIMITE_EXPORT, en la condición del while.
				hayMas = respuesta.items.length === PAGE_SIZE_EXPORT;
				paginaActual += 1;
			}

			const recortadas = filas.slice(0, LIMITE_EXPORT);
			const encabezados = [
				"Fecha y hora",
				"Última actualización",
				"Usuario",
				"Rol",
				"Bucket",
				"No. crédito SIFCO",
				"Cliente",
				"Tipo de gestión",
				"Resultado",
				"Origen",
				"Próxima acción (fecha)",
				"Próximo paso",
				"Estado promesa",
				"Cuotas prometidas",
				"Monto comprometido",
				"Editado",
				"Comentarios",
			];
			const cuerpo = recortadas.map((f) => [
				fechaHora(f.fechaContacto),
				fechaHora(f.updatedAt),
				f.usuarioNombre ?? "—",
				etiquetaRol(f.usuarioRol),
				f.bucketSnapshot != null
					? labelBucketConCodigo(bucketDeNumero(f.bucketSnapshot, catalogo))
					: "—",
				f.numeroCreditoSifco ?? "—",
				f.clienteNombre ?? "—",
				etiquetaMetodo(f.metodoContacto),
				etiquetaEstado(f.estadoContacto),
				ORIGEN_LABEL[f.origen] ?? f.origen,
				soloFecha(f.fechaProximoContacto),
				f.proximoPaso ?? "—",
				f.estadoPromesa ?? "—",
				f.cuotaInicio != null && f.cuotaFin != null
					? `${f.cuotaInicio}–${f.cuotaFin}`
					: "—",
				f.montoComprometido ?? "—",
				f.fueEditadoManual ? `Sí (${f.vecesEditado})` : "No",
				f.comentarios ?? "",
			]);

			const hoja = XLSX.utils.aoa_to_sheet([encabezados, ...cuerpo]);
			const libro = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(libro, hoja, "Historial de agendas");
			XLSX.writeFile(libro, `historial-agendas-${aFechaISO(new Date())}.xlsx`);
			toast.success(
				`Se exportaron ${recortadas.length.toLocaleString("es-GT")} registros.`,
			);
		} catch (error) {
			console.error("[historial-agendas] Error exportando:", error);
			toast.error("No se pudo generar el archivo. Intentá de nuevo.");
		} finally {
			setExportando(false);
		}
	}

	if (sesionCargando) {
		return (
			<div className="flex min-h-screen items-center justify-center text-gray-500">
				<Loader2 className="mr-2 h-5 w-5 animate-spin" />
				Cargando…
			</div>
		);
	}

	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						No tenés permiso para ver el historial de agendas.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-[1600px] px-4 py-6">
			<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
				<div className="flex items-center gap-3">
					<ScrollText className="h-7 w-7 text-indigo-500" />
					<div>
						<h1 className="font-bold text-2xl text-gray-900 dark:text-gray-100">
							Historial de agendas
						</h1>
						<p className="text-gray-500 text-sm">
							{esSupervisor
								? "Gestión registrada por todo el equipo, segmentada por bucket."
								: "Tus gestiones registradas, segmentadas por bucket."}
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					{listado.isFetching && !listado.isPending && (
						<Loader2 className="h-4 w-4 animate-spin text-gray-400" />
					)}
					<Button
						variant="outline"
						size="sm"
						onClick={exportarXLSX}
						// Contra el total del FILTRO, no contra la página en pantalla: si
						// el usuario está parado en una página que quedó vacía al cambiar
						// de filtro, el export sigue teniendo miles de filas que traer.
						disabled={exportando || (datos?.total ?? 0) === 0}
					>
						{exportando ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<FileSpreadsheet className="mr-2 h-4 w-4" />
						)}
						{exportando ? "Exportando…" : "Exportar XLSX"}
					</Button>
				</div>
			</div>

			{/* KPIs del conjunto filtrado */}
			<div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
				<TarjetaKpi
					titulo="Actividades"
					valor={resumenData?.total}
					cargando={resumen.isPending}
					error={resumen.isError}
				/>
				<TarjetaKpi
					titulo="Contactos efectivos"
					valor={resumenData?.efectivos}
					cargando={resumen.isPending}
					error={resumen.isError}
				/>
				<TarjetaKpi
					titulo="Promesas"
					valor={resumenData?.promesas}
					cargando={resumen.isPending}
					error={resumen.isError}
				/>
				<TarjetaKpi
					titulo="Sin contacto"
					valor={resumenData?.sinContacto}
					cargando={resumen.isPending}
					error={resumen.isError}
				/>
				<TarjetaKpi
					titulo="Con próxima acción"
					valor={resumenData?.conProximaAccion}
					cargando={resumen.isPending}
					error={resumen.isError}
				/>
				{/* AC-6: cuántos registros editó una persona después de crearlos.
				    Cuenta solo ediciones manuales (audit con origen='manual'), no los
				    recálculos de estado que hace el sistema. */}
				<TarjetaKpi
					titulo="Editadas"
					valor={resumenData?.editadas}
					cargando={resumen.isPending}
					error={resumen.isError}
				/>
			</div>

			{/* Filtros */}
			<Card className="mb-4">
				<CardContent className="space-y-3 py-3">
					<div className="flex flex-wrap items-center gap-2">
						<DateRangeFilter
							dateRange={rangoFechas}
							onDateRangeChange={(r) => {
								setRangoFechas(r);
								setPage(1);
								// NO se limpia `usuarioIds` acá. Versión anterior lo borraba a
								// priori, asumiendo que el usuario elegido podía no tener
								// gestiones en el rango nuevo — la misma suposición que ya se
								// quitó del saneo automático (ver la nota larga en
								// `usuarioIdsUI`), con el mismo problema: si SÍ sigue teniendo
								// gestiones ahí, se le borraba la selección sin necesidad. Si de
								// verdad no tiene, la tabla trae 0 filas — correcto y visible
								// (el multi-select sigue mostrando a quién se filtra).
							}}
						/>

						{esSupervisor && (
							<UsuarioCobrosMultiSelect
								usuarios={usuarios}
								// `usuarioIdsUI`, NO `usuarioIdsParaBackend`: el componente
								// necesita distinguir `[]` ("Deseleccionar todos") de `null`
								// (nunca elegido) para saber si el próximo click selecciona un
								// usuario o lo saca de un conjunto ya completo (ver la nota
								// larga en `usuarioIdsUI` — ese colapso es justo el bug que
								// motivó separar los dos valores).
								value={usuarioIdsUI}
								onChange={(v) => {
									setUsuarioIds(v);
									setPage(1);
								}}
							/>
						)}

						{esSupervisor && (
							<FiltroSelect
								ancho="w-44"
								placeholder="Todos los roles"
								valor={rol}
								onChange={(v) => {
									setRol(v);
									setPage(1);
								}}
								opciones={ROLES_FILTRABLES}
							/>
						)}

						<FiltroSelect
							ancho="w-44"
							placeholder="Todos los resultados"
							valor={estadoContacto}
							onChange={(v) => {
								setEstadoContacto(v);
								setPage(1);
							}}
							opciones={ESTADOS_CONTACTO}
						/>

						<FiltroSelect
							ancho="w-40"
							placeholder="Todos los tipos"
							valor={metodoContacto}
							onChange={(v) => {
								setMetodoContacto(v);
								setPage(1);
							}}
							opciones={METODOS_CONTACTO}
						/>

						<FiltroSelect
							ancho="w-40"
							placeholder="Toda promesa"
							valor={estadoPromesa}
							onChange={(v) => {
								setEstadoPromesa(v);
								setPage(1);
							}}
							opciones={[
								{ value: "pendiente", label: "Promesa pendiente" },
								{ value: "cumplida", label: "Promesa cumplida" },
								{ value: "incumplida", label: "Promesa incumplida" },
							]}
						/>

						{/* El backend filtra por igualdad exacta, no por prefijo: el
						    placeholder lo dice para que un número parcial no se lea como
						    "no hay resultados". El reset de página vive en el efecto de
						    debounce, no acá. */}
						<input
							className="h-8 w-44 rounded-md border border-gray-300 px-2 text-sm dark:border-gray-600 dark:bg-gray-800"
							placeholder="No. SIFCO exacto"
							title="Búsqueda por número de crédito SIFCO exacto (no busca por coincidencia parcial)"
							value={busquedaSifco}
							onChange={(e) => setBusquedaSifco(e.target.value)}
						/>

						<label className="flex items-center gap-1.5 text-gray-600 text-sm dark:text-gray-300">
							<input
								type="checkbox"
								checked={incluirAutomaticos}
								onChange={(e) => {
									setIncluirAutomaticos(e.target.checked);
									setPage(1);
								}}
							/>
							Incluir automáticos
						</label>

						{filtrosActivos > 0 && (
							<Button variant="ghost" size="sm" onClick={limpiarFiltros}>
								<RotateCcw className="mr-1 h-3.5 w-3.5" />
								Limpiar ({filtrosActivos})
							</Button>
						)}
					</div>

					{/* Buckets como chips clicables en vez de un select: son el eje del
					    ticket, así que se ven de un vistazo con su conteo y se filtran
					    con un click. Los conteos vienen SIN el filtro de bucket aplicado
					    (ver getHistorialAgendasResumen), si no al elegir uno
					    desaparecerían los demás y no se podría cambiar de bucket.

					    La fila se muestra también cuando hay un bucket elegido aunque el
					    resumen venga vacío: si OTRO filtro (fecha, usuario, resultado)
					    deja el set en cero, esconderla se llevaba puesto el chip activo y
					    el de "Todos", y el único camino de salida era "Limpiar" — que
					    también borra los filtros que el usuario sí quería conservar. */}
					{(bucketsChips.length > 0 || (buckets?.length ?? 0) > 0) && (
						<div className="flex flex-wrap items-center gap-1.5 border-t pt-3 dark:border-gray-700">
							<span className="mr-1 text-gray-500 text-xs uppercase tracking-wide">
								Bucket
							</span>
							<ChipBucket
								activo={!buckets?.length}
								onClick={() => {
									setBuckets(null);
									setPage(1);
								}}
							>
								Todos
							</ChipBucket>
							{bucketsChips.map((b) => {
								// `null` = gestiones sin bucket registrado (previas a CB-128, o
								// créditos fuera del funnel). Es un chip como cualquier otro:
								// el grupo es grande —toda la mensajería automática de premora
								// y convenio cae ahí— y mostrar un conteo que no se puede
								// aislar sería el único filtro imposible de la pantalla. Viaja
								// como BUCKET_SIN_ASIGNAR y el backend lo traduce a IS NULL.
								const valor = b.bucket ?? BUCKET_SIN_ASIGNAR;
								const info =
									b.bucket == null ? null : bucketDeNumero(b.bucket, catalogo);
								const etiqueta = info
									? labelBucketConCodigo(info)
									: "Sin bucket";
								const seleccionado = buckets?.includes(valor) ?? false;
								return (
									<ChipBucket
										key={valor}
										activo={seleccionado}
										colorHex={info?.colorHex}
										title={
											info
												? undefined
												: "Gestiones sin bucket registrado: anteriores a esta función, o créditos fuera del funnel (convenio, cancelado)"
										}
										onClick={() => {
											// Multi-selección: sumar o quitar del conjunto. Quedarse
											// sin ninguno equivale a "Todos" (null).
											const base = buckets ?? [];
											const next = base.includes(valor)
												? base.filter((x) => x !== valor)
												: [...base, valor];
											setBuckets(next.length ? next : null);
											setPage(1);
										}}
									>
										{etiqueta} · {b.cantidad}
									</ChipBucket>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			{/* Aviso de ventana por defecto: el usuario debe saber que no está
			    viendo toda la historia si no eligió rango. */}
			{datos?.rangoAplicado?.esDefault && (
				<p className="mb-3 flex items-center gap-1.5 text-gray-500 text-xs">
					<CalendarClock className="h-3.5 w-3.5" />
					Mostrando los últimos 30 días. Elegí un rango de fechas para ver otro
					período.
				</p>
			)}

			{listado.isError && (
				<Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
					<CardContent className="flex items-center gap-2 py-4 text-red-700 dark:text-red-300">
						<AlertTriangle className="h-5 w-5" />
						No se pudo cargar el historial. Reintentá en unos segundos.
					</CardContent>
				</Card>
			)}

			{listado.isPending && (
				<div className="flex items-center justify-center py-20 text-gray-500">
					<Loader2 className="mr-2 h-5 w-5 animate-spin" />
					Cargando historial…
				</div>
			)}

			{/* Página vacía CON page > 1: no es "sin resultados con estos filtros",
			    es haber pedido una página que no existe (el caso aproximado permite
			    probar una página más allá del último COUNT exacto, ver
			    hayMasPaginas). El mensaje de "sin gestiones" sería engañoso —el
			    filtro sí tiene resultados, están en páginas anteriores— y esconder
			    la paginación entera dejaría sin botón "Anterior" para volver. */}
			{!listado.isError &&
				!listado.isPending &&
				items.length === 0 &&
				page === 1 && (
					<p className="py-20 text-center text-gray-400 text-sm">
						No hay gestiones registradas con estos filtros.
					</p>
				)}

			{!listado.isError &&
				!listado.isPending &&
				items.length === 0 &&
				page > 1 && (
					<p className="py-10 text-center text-gray-400 text-sm">
						Esta página no tiene resultados. Volvé a la página anterior.
					</p>
				)}

			{!listado.isError &&
				!listado.isPending &&
				(items.length > 0 || page > 1) && (
					<>
						{items.length > 0 && (
							<div className="overflow-x-auto rounded-lg border dark:border-gray-700">
								<table className="w-full text-sm">
									<thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
										<tr className="text-left text-gray-600 text-xs uppercase dark:text-gray-300">
											<th className="px-3 py-2 font-medium">Fecha</th>
											<th className="px-3 py-2 font-medium">Usuario</th>
											<th className="px-3 py-2 font-medium">Bucket</th>
											<th className="px-3 py-2 font-medium">Cuenta</th>
											<th className="px-3 py-2 font-medium">Tipo</th>
											<th className="px-3 py-2 font-medium">Resultado</th>
											<th className="px-3 py-2 font-medium">Próxima acción</th>
											<th className="px-3 py-2 font-medium">Promesa</th>
											<th className="px-3 py-2 font-medium" />
										</tr>
									</thead>
									<tbody>
										{items.map((fila) => (
											<FilaHistorial
												key={fila.id}
												fila={fila}
												catalogo={catalogo}
												esSupervisor={esSupervisor}
											/>
										))}
									</tbody>
								</table>
							</div>
						)}

						<div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
							<span className="text-gray-500">
								{datos?.totalEsAproximado
									? `Más de ${(datos?.total ?? 0).toLocaleString("es-GT")} registros`
									: `${(datos?.total ?? 0).toLocaleString("es-GT")} registros`}
							</span>
							<div className="flex items-center gap-2">
								<Select
									value={String(pageSize)}
									onValueChange={(v) => {
										setPageSize(Number(v));
										setPage(1);
									}}
								>
									<SelectTrigger className="h-8 w-28">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{[25, 50, 100, 200].map((n) => (
											<SelectItem key={n} value={String(n)}>
												{n} / página
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
								>
									Anterior
								</Button>
								<span className="text-gray-500">
									{datos?.totalEsAproximado ? (
										// `totalPaginas` sale del COUNT capado a 10,000
										// (LIMITE_CONTEO), pero `hayMasPaginas` deliberadamente
										// permite seguir navegando más allá de ese tope. Un número
										// fijo se vuelve imposible apenas se cruza ("Página 201 de
										// 200") y sigue subestimando cuántas hay en realidad —se
										// muestra como cota inferior en vez de total exacto.
										<>
											Página {page} de {totalPaginas}+
										</>
									) : (
										<>
											Página {page} de {totalPaginas}
										</>
									)}
								</span>
								<Button
									variant="outline"
									size="sm"
									disabled={!hayMasPaginas}
									onClick={() => setPage((p) => p + 1)}
								>
									Siguiente
								</Button>
							</div>
						</div>
					</>
				)}
		</div>
	);
}

/**
 * Chip de bucket clicable — reemplaza al select de buckets.
 *
 * Se prefiere sobre un `<Select>` porque el bucket es el eje del reporte: con
 * chips el supervisor ve de un vistazo cuántas gestiones hay en cada etapa Y
 * filtra con un click, en vez de abrir un desplegable para descubrirlo.
 *
 * El color del bucket va inline y no por clase de Tailwind: el hex viene del
 * catálogo dinámico de cartera-back, y Tailwind no puede generar clases para un
 * valor arbitrario en build (mismo motivo por el que existe `estiloBucket`).
 */
function ChipBucket({
	activo,
	colorHex,
	title,
	onClick,
	children,
}: {
	activo: boolean;
	colorHex?: string;
	/** Tooltip opcional — lo usa "Sin bucket" para explicar qué agrupa. */
	title?: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	// Sin color (el chip "Todos" y "Sin bucket") cae a un gris neutro.
	const base = colorHex ?? "#6b7280";
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-pressed={activo}
			className="h-7 rounded-full border px-2.5 font-medium text-xs transition-colors"
			style={
				activo
					? // Seleccionado: relleno sólido del color del bucket.
						{ backgroundColor: base, color: "#fff", borderColor: base }
					: // Sin seleccionar: mismo color pero tenue, para que el chip siga
						// leyéndose como "este bucket" y no como un botón neutro.
						{
							backgroundColor: `${base}14`,
							color: base,
							borderColor: `${base}40`,
						}
			}
		>
			{children}
		</button>
	);
}

function TarjetaKpi({
	titulo,
	valor,
	cargando,
	error,
}: {
	titulo: string;
	valor: number | undefined;
	cargando: boolean;
	// Reintentos agotados de getHistorialAgendasResumen: `resumen.data` queda
	// `undefined` con `isPending: false`, igual que "cargó y dio 0" — sin este
	// estado separado, un fallo de red se mostraba como "Actividades: 0" pese a
	// que la tabla de abajo sí tiene filas. Fabrica una métrica del reporte
	// durante una falla parcial en vez de señalarla.
	error: boolean;
}) {
	return (
		<Card>
			<CardContent className="py-3">
				<p className="text-gray-500 text-xs uppercase tracking-wide">
					{titulo}
				</p>
				{cargando ? (
					<div className="mt-1 h-7 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
				) : error ? (
					<p
						className="font-bold text-2xl text-gray-400"
						title="No se pudo cargar este dato"
					>
						—
					</p>
				) : (
					<p className="font-bold text-2xl text-gray-900 dark:text-gray-100">
						{(valor ?? 0).toLocaleString("es-GT")}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function FiltroSelect({
	valor,
	onChange,
	opciones,
	placeholder,
	ancho,
}: {
	valor: string;
	onChange: (v: string) => void;
	opciones: readonly { value: string; label: string }[];
	placeholder: string;
	ancho: string;
}) {
	return (
		<Select value={valor} onValueChange={onChange}>
			<SelectTrigger className={`h-8 ${ancho}`}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="todos">{placeholder}</SelectItem>
				{opciones.map((o) => (
					<SelectItem key={o.value} value={o.value}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function FilaHistorial({
	fila,
	catalogo,
	esSupervisor,
}: {
	fila: FilaHistorialData;
	catalogo: BucketsCatalogoQueryData | undefined;
	esSupervisor: boolean;
}) {
	const bucket =
		fila.bucketSnapshot != null
			? bucketDeNumero(fila.bucketSnapshot, catalogo)
			: null;

	return (
		<tr className="border-t hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/50">
			<td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-300">
				{fechaHora(fila.fechaContacto)}
				{/* AC-2: fecha de actualización. Se muestra solo si la fila cambió
				    alguna vez. Dice "Act." y no "Editado" a propósito — la tocan
				    también los recálculos de estado del sistema, y la marca de
				    edición humana es el ícono de la última columna. */}
				{fila.updatedAt && (
					<div
						className="text-gray-400 text-xs"
						title="Última actualización del registro (incluye recálculos automáticos de estado)"
					>
						Act. {fechaHora(fila.updatedAt)}
					</div>
				)}
			</td>
			<td className="px-3 py-2">
				<div className="font-medium">{fila.usuarioNombre ?? "—"}</div>
				<div className="text-gray-400 text-xs">
					{etiquetaRol(fila.usuarioRol)}
				</div>
			</td>
			<td className="px-3 py-2">
				{bucket ? (
					<Badge variant="outline" style={estiloBucket(bucket.colorHex)}>
						{labelBucketConCodigo(bucket)}
					</Badge>
				) : (
					<span
						className="text-gray-400"
						/* Mismo texto que el chip "Sin bucket" del panel de filtros: el
					   anterior nombraba una sola de las tres causas, y con el código
					   del ticket adentro, que al usuario no le dice nada. */
						title="Sin bucket registrado: gestión anterior a esta función, o crédito fuera del funnel (convenio, cancelado)"
					>
						—
					</span>
				)}
			</td>
			<td className="px-3 py-2">
				<Link
					to="/cobros/$id"
					params={{ id: fila.casoCobroId }}
					// contactos_cobros guarda el id del CASO, no el del crédito de
					// cartera-back — por eso tipo="caso".
					search={{ tipo: "caso" as const }}
					className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
				>
					{fila.numeroCreditoSifco ?? "Sin SIFCO"}
				</Link>
				<div className="max-w-[180px] truncate text-gray-400 text-xs">
					{fila.clienteNombre ?? "—"}
				</div>
			</td>
			<td className="px-3 py-2">
				<div className="flex items-center gap-1.5">
					<IconoMetodo metodo={fila.metodoContacto} />
					<span>{etiquetaMetodo(fila.metodoContacto)}</span>
				</div>
				{fila.origen !== "manual" && (
					<span className="text-amber-600 text-xs dark:text-amber-400">
						{ORIGEN_LABEL[fila.origen] ?? fila.origen}
					</span>
				)}
			</td>
			<td className="px-3 py-2">{etiquetaEstado(fila.estadoContacto)}</td>
			<td className="px-3 py-2">
				<div>{soloFecha(fila.fechaProximoContacto)}</div>
				{fila.proximoPaso && (
					<div className="max-w-[200px] truncate text-gray-400 text-xs">
						{fila.proximoPaso}
					</div>
				)}
			</td>
			<td className="px-3 py-2">
				{fila.estadoPromesa ? (
					<div>
						<span className="capitalize">{fila.estadoPromesa}</span>
						{fila.cuotaInicio != null && fila.cuotaFin != null && (
							<div className="text-gray-400 text-xs">
								Cuotas {fila.cuotaInicio}–{fila.cuotaFin}
							</div>
						)}
					</div>
				) : (
					<span className="text-gray-400">—</span>
				)}
			</td>
			<td className="px-3 py-2">
				{/* AC-6: la marca sale del audit con origen='manual', NO de updated_at
				    — si no, toda promesa se vería "editada" cada vez que pasa el job. */}
				{fila.fueEditadoManual && (
					<AuditoriaPopover
						contactoId={fila.id}
						veces={fila.vecesEditado}
						habilitado={esSupervisor}
					/>
				)}
			</td>
		</tr>
	);
}

/**
 * AC-6 — qué se cambió, cuándo y quién. El detalle solo lo abre el supervisor
 * (el procedure está gateado); al asesor le queda el indicador visual.
 */
function AuditoriaPopover({
	contactoId,
	veces,
	habilitado,
}: {
	contactoId: string;
	veces: number;
	habilitado: boolean;
}) {
	const [abierto, setAbierto] = useState(false);
	// TS7056 — ver la nota del componente principal.
	// biome-ignore lint/suspicious/noExplicitAny: el tipo del cliente oRPC está truncado.
	const orpcAny = orpc as any;
	const auditoriaQuery = useQuery({
		...orpcAny.getAuditoriaContacto.queryOptions({ input: { contactoId } }),
		// Solo se pide al abrir: son N popovers por página.
		enabled: abierto && habilitado,
	});
	const entradas = auditoriaQuery.data as EntradaAuditoria[] | undefined;

	const insignia = (
		<span
			className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 text-xs dark:bg-amber-950/40 dark:text-amber-300"
			title={`Editado ${veces} ${veces === 1 ? "vez" : "veces"}`}
		>
			<Pencil className="h-3 w-3" />
			{veces}
		</span>
	);

	if (!habilitado) return insignia;

	return (
		<Popover open={abierto} onOpenChange={setAbierto}>
			<PopoverTrigger asChild>
				<button type="button">{insignia}</button>
			</PopoverTrigger>
			<PopoverContent className="w-96" align="end">
				<h4 className="mb-2 font-medium text-sm">Historial de cambios</h4>
				{auditoriaQuery.isPending && (
					<div className="flex items-center gap-2 py-3 text-gray-500 text-sm">
						<Loader2 className="h-4 w-4 animate-spin" />
						Cargando…
					</div>
				)}
				{entradas?.length === 0 && (
					<p className="py-2 text-gray-400 text-sm">Sin cambios registrados.</p>
				)}
				<div className="max-h-72 space-y-2 overflow-y-auto">
					{entradas?.map((entrada) => (
						<div
							key={entrada.id}
							className="rounded border p-2 text-xs dark:border-gray-700"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="font-medium">
									{entrada.origen === "manual"
										? (entrada.editadoPorNombre ?? "Usuario")
										: "Sistema"}
								</span>
								<span className="text-gray-400">
									{fechaHora(entrada.editadoEn)}
								</span>
							</div>
							<pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-gray-500 dark:text-gray-400">
								{JSON.stringify(entrada.valoresAnteriores, null, 1)}
							</pre>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
