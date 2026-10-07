import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import type { UsuarioCobros } from "@/components/cobros/usuario-cobros-multi-select";
import { usePersistedDateRange } from "@/hooks/usePersistedDateRange";
import { usePersistedState } from "@/hooks/usePersistedState";
import { authClient } from "@/lib/auth-client";
import {
	type BucketsCatalogoQueryData,
	bucketDeNumero,
	labelBucketConCodigo,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { client, orpc } from "@/utils/orpc";
import { CambiosBucketAsesor } from "./cambios-bucket";
import {
	type CategoriaActividad,
	defCategoria,
	esCategoriaActividad,
} from "./categorias";
import {
	aFechaISO,
	aFechaISO_GT,
	etiquetaEstado,
	etiquetaMetodo,
	etiquetaRol,
	fechaHora,
	ORIGEN_LABEL,
	soloFecha,
	sumarDiasLocal,
} from "./formato";
import {
	BUCKET_SIN_ASIGNAR,
	type FiltrosHistorialUI,
	HistorialGestionesVista,
} from "./historial-gestiones-vista";
import type {
	FilaHistorialData,
	RespuestaHistorial,
	ResumenHistorial,
} from "./tipos";

/**
 * Historial de gestiones (CB-128), extraído de `/cobros/historial-agendas`.
 * Contenedor: estado, persistencia, consultas y export. La presentación está
 * en `historial-gestiones-vista.tsx`.
 *
 *   - **Sin `usuarioFijo`**: la vista de siempre. Para supervisión y admin, todo
 *     el equipo con filtros de usuario y rol; para el asesor, sus propias
 *     gestiones (el server fuerza el alcance por `realizado_por`). Persiste en
 *     sessionStorage con las claves `cobros-historial-agendas-*` (las de
 *     siempre). La usan `/cobros/historial-agendas` (asesor) y Mi equipo › Día
 *     › Gestiones (supervisión).
 *   - **Con `usuarioFijo`**: la pestaña Actividad del Detalle del asesor. Sin
 *     filtros de usuario ni de rol (el usuario va fijo en todas las consultas y
 *     en el export), con los chips de categoría del Figma 4063:12 y el cambio
 *     entre tabla y línea de tiempo. Persiste con `cobros-detalle-asesor-historial-*`
 *     para no pisar los filtros de la vista del equipo.
 */

/** Tope del export — más filas que esto matan al navegador armando el workbook. */
const LIMITE_EXPORT = 20_000;
const PAGE_SIZE_EXPORT = 200;

/** Prefijo de sessionStorage de cada uso (no deben chocar). */
const PREFIJO_EQUIPO = "cobros-historial-agendas";
const PREFIJO_ASESOR = "cobros-detalle-asesor-historial";

export type UsuarioFijo = { userId: string; nombre: string };

export type HistorialGestionesProps = {
	/** Asesor fijo (Detalle del asesor): `user.id` del CRM y su nombre. */
	usuarioFijo?: UsuarioFijo;
	/**
	 * Sin el título grande ni los márgenes de página, para montarlo dentro de
	 * otra pantalla. Por defecto: `true` con `usuarioFijo`, `false` sin él (la
	 * página de siempre).
	 */
	embebido?: boolean;
	/** Título y descripción de la sección cuando va embebido. */
	titulo?: string;
	descripcion?: string;
	/**
	 * Controles extra en el encabezado de la sección embebida, antes de
	 * «Exportar XLSX» (Mi equipo › Día pone ahí su selector de vista).
	 */
	controles?: React.ReactNode;
};

/** "ana lucía díaz" → "ana-lucia-diaz" (nombre del archivo exportado). */
function slug(texto: string) {
	return texto
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export function HistorialGestiones({
	usuarioFijo,
	embebido = !!usuarioFijo,
	titulo,
	descripcion,
	controles,
}: HistorialGestionesProps) {
	const { data: session, isPending: sesionCargando } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = userRole
		? PERMISSIONS.canViewAllCasosCobros(userRole)
		: false;
	// Con asesor fijo no hay filtros de usuario ni de rol: el usuario va fijo.
	const conFiltrosEquipo = esSupervisor && !usuarioFijo;
	// `canAccessCobros`, no solo `!!session`: todo procedure de este archivo
	// (listado, resumen, catálogo de buckets) está gateado por `cobrosProcedure`
	// en el server, así que un usuario autenticado SIN el permiso (que abre la
	// URL directo, sin pasar por el menú que ya la esconde) disparaba las
	// queries igual — el rechazo del backend llegaba como reintentos y toasts de
	// error globales detrás de la pantalla de "Acceso Denegado" que de todas
	// formas se termina mostrando más abajo. Declarado acá arriba, no junto a
	// `listado`/`resumen`, porque `catalogoQuery` también lo necesita y se
	// declara antes.
	const puedeConsultar = !!userRole && PERMISSIONS.canAccessCobros(userRole);
	const P = usuarioFijo ? PREFIJO_ASESOR : PREFIJO_EQUIPO;

	// Los filtros persisten en sessionStorage: el supervisor entra y sale de la
	// ficha de un crédito y vuelve al mismo recorte.
	//
	// El rango va con `usePersistedDateRange` y NO con `usePersistedState`: este
	// último serializa con JSON, que devuelve las fechas como string al recargar
	// — y `aFechaISO()` llamaría `.getFullYear()` sobre un string, tumbando la
	// pantalla. El hook dedicado serializa a ISO y re-hidrata como Date.
	const [rangoFechas, setRangoFechas] = usePersistedDateRange(`${P}-rango`);
	// Clave versionada (-v2): el catálogo de usuarios pasó de "todos los roles de
	// cobros" a "solo quien gestionó en el rango", y los ids guardados con el
	// catálogo viejo quedaban aplicando un filtro que ya no aparece en el
	// desplegable. Cambiar la clave descarta ese estado en vez de arrastrarlo.
	const [usuarioIds, setUsuarioIds] = usePersistedState<string[] | null>(
		`${P}-usuarios-v2`,
		null,
	);
	const [buckets, setBuckets] = usePersistedState<number[] | null>(
		`${P}-buckets`,
		null,
	);
	const [rol, setRol] = usePersistedState<string>(`${P}-rol`, "todos");
	const [estadoContacto, setEstadoContacto] = usePersistedState<string>(
		`${P}-estado`,
		"todos",
	);
	const [metodoContacto, setMetodoContacto] = usePersistedState<string>(
		`${P}-metodo`,
		"todos",
	);
	const [estadoPromesa, setEstadoPromesa] = usePersistedState<string>(
		`${P}-promesa`,
		"todos",
	);
	const [incluirAutomaticos, setIncluirAutomaticos] =
		usePersistedState<boolean>(`${P}-automaticos`, false);
	// Solo con asesor fijo: chip de categoría (Figma 4063:12) y tabla / línea.
	const [categoriaGuardada, setCategoria] =
		usePersistedState<CategoriaActividad>(`${P}-categoria`, "todas");
	const [vistaLista, setVistaLista] = usePersistedState<"tabla" | "linea">(
		`${P}-vista`,
		"linea",
	);
	const categoria: CategoriaActividad =
		usuarioFijo &&
		esCategoriaActividad(categoriaGuardada) &&
		!defCategoria(categoriaGuardada).pronto
			? categoriaGuardada
			: "todas";
	const defCat = defCategoria(categoria);
	const enCambiosBucket = categoria === "cambios_bucket";

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

	const catalogoQuery = useBucketsCatalogo(puedeConsultar);
	// `getBucketsCatalogo` cae en el mismo truncado de TS7056 que el resto (ver
	// nota más abajo): el hook devuelve `unknown` aunque el server lo tipa bien.
	const catalogo = catalogoQuery.data as BucketsCatalogoQueryData | undefined;

	// NOTA sobre los casts de `orpc` y de `.data` en este archivo:
	// `cobrosAppRouter` (server) supera el límite de TS7056 y TypeScript trunca
	// el tipo inferido del cliente SIN emitir error — el tipo de `orpc` corta en
	// ~294 keys y las que quedan afuera aparecen como inexistentes. Es un
	// problema preexistente de la rama, no de esta feature: `$id.tsx`,
	// `panel-gestion-rapida.tsx` y `buckets-catalogo.ts` ya conviven con lo
	// mismo y usan este patrón (ver panel-gestion-rapida.tsx:181). Los tipos de
	// `./tipos` son el contrato real de `routers/historial-agendas.ts`; si ese
	// cambia, hay que actualizarlos a mano hasta que se parta el router.
	// biome-ignore lint/suspicious/noExplicitAny: ver nota de TS7056 arriba.
	const orpcAny = orpc as any;
	// biome-ignore lint/suspicious/noExplicitAny: idem.
	const clientAny = client as any;

	// Con categoría, sus métodos/resultados mandan sobre el filtro «Tipo» o
	// «Resultado» (son excluyentes: elegir uno limpia el otro, ver onFiltros).
	const metodosConsulta = useMemo(
		() =>
			defCat.metodos
				? [...defCat.metodos]
				: metodoContacto === "todos"
					? undefined
					: [metodoContacto],
		[defCat, metodoContacto],
	);
	const estadosConsulta = useMemo(
		() =>
			defCat.estados
				? [...defCat.estados]
				: estadoContacto === "todos"
					? undefined
					: [estadoContacto],
		[defCat, estadoContacto],
	);

	// Todos los filtros MENOS la selección de usuarios. Se separa porque el
	// catálogo de usuarios se calcula a partir de estos —si incluyera la
	// selección actual, el desplegable se quedaría con un solo nombre y no se
	// podría cambiar de usuario sin limpiar el filtro primero.
	const filtrosBase = useMemo(
		() => ({
			desde: rangoFechas?.from ? aFechaISO(rangoFechas.from) : undefined,
			hasta: rangoFechas?.to ? aFechaISO(rangoFechas.to) : undefined,
			// El selector de rol solo se renderiza para la vista del equipo de
			// supervisión. Sin este gate, un `rol` heredado en sessionStorage de una
			// sesión previa con más permisos (u otro usuario en el mismo perfil de
			// navegador) se seguiría mandando para un asesor que ni lo ve ni puede
			// cambiarlo — el backend lo combina con su scope forzado por
			// `realizado_por` y devuelve 0 filas sin ninguna pista visible de por
			// qué.
			roles: conFiltrosEquipo && rol !== "todos" ? [rol] : undefined,
			buckets: buckets?.length ? buckets : undefined,
			estadoContacto: estadosConsulta,
			metodoContacto: metodosConsulta,
			estadoPromesa: estadoPromesa === "todos" ? undefined : estadoPromesa,
			numeroCreditoSifco: busquedaSifcoDebounced.trim() || undefined,
			incluirAutomaticos,
		}),
		[
			rangoFechas,
			rol,
			conFiltrosEquipo,
			buckets,
			estadosConsulta,
			metodosConsulta,
			estadoPromesa,
			busquedaSifcoDebounced,
			incluirAutomaticos,
		],
	);

	// Catálogo del filtro de usuario: solo quien TIENE gestiones bajo los filtros
	// activos. No es el catálogo de roles de cobros — ese trae ~15 admins de
	// sistemas y dirección que nunca gestionaron nada. Se re-consulta cuando
	// cambia cualquier filtro, así filtrando por B2 solo aparecen los que
	// gestionaron en B2 y no se ofrecen nombres que darían tabla vacía. Con
	// asesor fijo no se pide: no hay filtro de usuario.
	const usuariosQuery = useQuery({
		...orpcAny.getUsuariosConGestiones.queryOptions({ input: filtrosBase }),
		enabled: !!session && conFiltrosEquipo,
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
	// Mientras la sesión todavía resuelve, `userRole` es `undefined` y
	// `esSupervisor` da `false` aunque el usuario real SEA supervisor — un hard
	// reload no distingue "es asesor" de "todavía no sabemos el rol". Sin esta
	// rama, `usuarioIdsUI` caía a `null` en ese instante y el efecto de abajo
	// persistía ese `null`, borrando la selección real del supervisor ANTES de
	// que la sesión terminara de cargar — history repite el bug que ya se había
	// corregido para este mismo caso, reintroducido al separar `usuarioIdsUI`
	// de `usuarioIdsParaBackend`.
	const usuarioIdsUI = sesionCargando || conFiltrosEquipo ? usuarioIds : null;

	// Persiste a sessionStorage el único caso en que `usuarioIdsUI` difiere de
	// `usuarioIds`: cuando el usuario actual NO es supervisor (y la sesión ya
	// resolvió). Sin esto, un asesor que alguna vez tuvo una selección
	// persistida (rol degradado, sesión compartida) la sigue arrastrando en
	// sessionStorage aunque el filtro nunca se le aplique en memoria — y
	// volvería a aplicarse solo si el rol cambia de vuelta a supervisor sin que
	// el usuario haya vuelto a elegir nada. Se compara por contenido, no por
	// referencia, para no reescribir sessionStorage (y no re-disparar este
	// efecto) en cada render.
	useEffect(() => {
		if (sesionCargando) return;
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
	}, [usuarioIdsUI, usuarioIds, setUsuarioIds, sesionCargando]);

	/**
	 * Valor que se manda al backend: `[]` SÍ se colapsa a `undefined` acá (a
	 * diferencia de `usuarioIdsUI`), porque `whereHistorial` en el server trata
	 * un array vacío como "sin filtro" — mandarlo tal cual sería redundante con
	 * `undefined`, no incorrecto, pero mantener la distinción solo donde importa
	 * (la UI) evita cargar esa sutileza en el resto del archivo.
	 *
	 * Con asesor fijo es SIEMPRE ese usuario: nunca se cae a "sin filtro" (que
	 * para supervisión sería todo el equipo).
	 */
	const userIdFijo = usuarioFijo?.userId;
	const usuarioIdsParaBackend = useMemo(
		() =>
			userIdFijo
				? [userIdFijo]
				: usuarioIdsUI?.length
					? usuarioIdsUI
					: undefined,
		[userIdFijo, usuarioIdsUI],
	);

	const filtros = useMemo(
		() => ({ ...filtrosBase, usuarioIds: usuarioIdsParaBackend }),
		[filtrosBase, usuarioIdsParaBackend],
	);

	const listado = useQuery({
		...orpcAny.getHistorialAgendas.queryOptions({
			input: { ...filtros, page, pageSize },
		}),
		enabled: !!session && puedeConsultar && !enCambiosBucket,
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
		(conFiltrosEquipo && rol !== "todos") || null,
		estadoContacto !== "todos" || null,
		metodoContacto !== "todos" || null,
		estadoPromesa !== "todos" || null,
		busquedaSifco.trim() || null,
		incluirAutomaticos || null,
		categoria !== "todas" || null,
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
		if (usuarioFijo) setCategoria("todas");
		setPage(1);
	}

	/** Cambios de filtros desde la vista. Todos vuelven a la página 1, salvo el SIFCO (lo hace el debounce). */
	function cambiarFiltros(c: Partial<FiltrosHistorialUI>) {
		if ("rangoFechas" in c) {
			setRangoFechas(c.rangoFechas);
			// NO se limpia `usuarioIds` acá. Versión anterior lo borraba a
			// priori, asumiendo que el usuario elegido podía no tener
			// gestiones en el rango nuevo — la misma suposición que ya se
			// quitó del saneo automático (ver la nota larga en
			// `usuarioIdsUI`), con el mismo problema: si SÍ sigue teniendo
			// gestiones ahí, se le borraba la selección sin necesidad. Si de
			// verdad no tiene, la tabla trae 0 filas — correcto y visible
			// (el multi-select sigue mostrando a quién se filtra).
		}
		if ("usuarioIds" in c) setUsuarioIds(c.usuarioIds ?? null);
		if ("rol" in c && c.rol) setRol(c.rol);
		if ("estadoContacto" in c && c.estadoContacto) {
			setEstadoContacto(c.estadoContacto);
			// Un resultado elegido a mano reemplaza al chip que filtraba por resultado.
			if (c.estadoContacto !== "todos" && defCat.estados) setCategoria("todas");
		}
		if ("metodoContacto" in c && c.metodoContacto) {
			setMetodoContacto(c.metodoContacto);
			// Idem con el tipo y los chips de canal.
			if (c.metodoContacto !== "todos" && defCat.metodos) setCategoria("todas");
		}
		if ("estadoPromesa" in c && c.estadoPromesa)
			setEstadoPromesa(c.estadoPromesa);
		if ("incluirAutomaticos" in c)
			setIncluirAutomaticos(!!c.incluirAutomaticos);
		if ("buckets" in c) setBuckets(c.buckets ?? null);
		if ("busquedaSifco" in c) {
			setBusquedaSifco(c.busquedaSifco ?? "");
			return;
		}
		setPage(1);
	}

	function cambiarCategoria(c: CategoriaActividad) {
		const def = defCategoria(c);
		if (def.pronto) return;
		setCategoria(c);
		// El chip manda sobre el filtro de la misma dimensión: se limpia para no
		// combinar «Llamadas» con «Tipo: WhatsApp» (resultado imposible).
		if (def.metodos) setMetodoContacto("todos");
		if (def.estados) setEstadoContacto("todos");
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
				`El filtro tiene ${datos?.totalEsAproximado ? "más de " : ""}${total.toLocaleString("es-GT")} registros. ` +
					`Se exportarán los primeros ${LIMITE_EXPORT.toLocaleString("es-GT")}. ` +
					"Si necesita la exportación completa, reduzca el rango de fechas.\n\n¿Desea continuar?",
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
			const sufijo = usuarioFijo ? `${slug(usuarioFijo.nombre)}-` : "";
			XLSX.writeFile(
				libro,
				`historial-agendas-${sufijo}${aFechaISO(new Date())}.xlsx`,
			);
			toast.success(
				`Se exportaron ${recortadas.length.toLocaleString("es-GT")} registros.`,
			);
		} catch (error) {
			console.error("[historial-agendas] Error exportando:", error);
			toast.error("No se pudo generar el archivo. Intente de nuevo.");
		} finally {
			setExportando(false);
		}
	}

	if (sesionCargando) {
		return (
			<div
				className={
					embebido
						? "flex items-center justify-center py-16 text-gray-500"
						: "flex min-h-screen items-center justify-center text-gray-500"
				}
			>
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
						No tiene permiso para ver el historial de agendas.
					</p>
				</div>
			</div>
		);
	}

	// Rango de «Cambios de bucket»: el del filtro o, sin filtro, los últimos 30
	// días GT (la misma ventana por defecto del historial).
	const hoyGTISO = aFechaISO_GT(new Date());
	const rangoMovimientos = {
		desde: filtrosBase.desde ?? aFechaISO_GT(sumarDiasLocal(new Date(), -30)),
		hasta: filtrosBase.hasta ?? hoyGTISO,
	};

	return (
		<HistorialGestionesVista
			encabezado={
				embebido
					? { tipo: "seccion", titulo, descripcion, controles }
					: {
							tipo: "pagina",
							titulo: "Historial de agendas",
							descripcion: esSupervisor
								? "Gestión registrada por todo el equipo, segmentada por bucket."
								: "Sus gestiones registradas, segmentadas por bucket.",
						}
			}
			esSupervisor={esSupervisor}
			mostrarFiltrosEquipo={conFiltrosEquipo}
			usuarios={usuarios}
			filtros={{
				rangoFechas,
				usuarioIds: usuarioIdsUI,
				rol,
				estadoContacto,
				metodoContacto,
				estadoPromesa,
				busquedaSifco,
				incluirAutomaticos,
				buckets,
			}}
			onFiltros={cambiarFiltros}
			filtrosActivos={filtrosActivos}
			onLimpiar={limpiarFiltros}
			catalogo={catalogo}
			bucketsChips={bucketsChips}
			resumen={{
				datos: resumenData,
				cargando: resumen.isPending,
				error: resumen.isError,
			}}
			listado={{
				datos,
				cargando: listado.isPending,
				error: listado.isError,
				actualizando: listado.isFetching && !listado.isPending,
			}}
			page={page}
			pageSize={pageSize}
			hayMasPaginas={hayMasPaginas}
			onPage={setPage}
			onPageSize={(n) => {
				setPageSize(n);
				setPage(1);
			}}
			exportacion={{
				exportando,
				// Contra el total del FILTRO, no contra la página en pantalla: si
				// el usuario está parado en una página que quedó vacía al cambiar
				// de filtro, el export sigue teniendo miles de filas que traer.
				deshabilitada: enCambiosBucket || (datos?.total ?? 0) === 0,
				motivo: enCambiosBucket
					? "La exportación es del historial de gestiones. Elija otra categoría para exportar."
					: undefined,
				onExportar: exportarXLSX,
			}}
			categorias={
				usuarioFijo
					? { activa: categoria, onCambiar: cambiarCategoria }
					: undefined
			}
			vistaLista={
				usuarioFijo
					? { valor: vistaLista, onCambiar: setVistaLista }
					: undefined
			}
			contenidoAlterno={
				usuarioFijo && enCambiosBucket ? (
					<CambiosBucketAsesor
						userId={usuarioFijo.userId}
						desde={rangoMovimientos.desde}
						hasta={rangoMovimientos.hasta}
						vista={vistaLista}
						hoy={hoyGTISO}
					/>
				) : undefined
			}
			hoy={hoyGTISO}
		/>
	);
}
