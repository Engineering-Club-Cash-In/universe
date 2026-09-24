import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
	CircleCheck,
	ClipboardList,
	Loader2,
	MapPin,
	Plug,
	RefreshCw,
	ShieldAlert,
	TriangleAlert,
	Truck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { orpc } from "@/utils/orpc";
import {
	ESTADO_CONEXION_CONFIG,
	formatDuracion,
	formatFechaHora,
	formatLatency,
	formatPorcentaje,
	RESULTADO_INTENTO_CONFIG,
	resolveEstado,
	SEVERIDAD_CONFIG,
	TIPO_ALERTA_LABEL,
	type TipoAlertaGps,
} from "./-gps-format";

export const Route = createFileRoute("/admin/gps")({
	component: RouteComponent,
});

interface UnidadCatalogo {
	id: number;
	nm: string;
	creditos: { numeroSifco: string; origen: "vinculado" | "placa" }[];
}

const UNIT_COLUMNS: ColumnDef<UnidadCatalogo>[] = [
	{
		accessorKey: "id",
		header: "ID Wialon",
	},
	{
		accessorKey: "nm",
		header: "Nombre de la unidad",
	},
	{
		id: "creditos",
		header: "Crédito (SIFCO)",
		// "vinculado" = la unidad está guardada en el vehículo; "por placa" =
		// deducción por núcleo de placa, todavía sin confirmar (CB-118).
		cell: ({ row }) => {
			const { creditos } = row.original;
			if (creditos.length === 0) return "—";
			return (
				<div className="flex flex-col gap-0.5">
					{creditos.map((c) => (
						<div className="flex items-center gap-2" key={c.numeroSifco}>
							<Link
								className="font-mono text-blue-600 hover:underline"
								params={{ id: c.numeroSifco }}
								search={{ tipo: "contrato" }}
								to="/cobros/$id"
							>
								{c.numeroSifco}
							</Link>
							{c.origen === "placa" && (
								<span className="text-muted-foreground text-xs">por placa</span>
							)}
						</div>
					))}
				</div>
			);
		},
	},
];

interface BitacoraFila {
	id: string;
	numeroCreditoSifco: string | null;
	motivo: string;
	unitName: string | null;
	userNombre: string | null;
	userEmail: string | null;
	createdAt: Date;
}

const BITACORA_COLUMNS: ColumnDef<BitacoraFila>[] = [
	{
		accessorKey: "createdAt",
		header: "Fecha",
		cell: ({ row }) => formatFechaHora(row.original.createdAt),
	},
	{
		accessorKey: "userNombre",
		header: "Usuario",
		cell: ({ row }) => (
			<div>
				<div>{row.original.userNombre ?? "—"}</div>
				<div className="text-muted-foreground text-xs">
					{row.original.userEmail ?? ""}
				</div>
			</div>
		),
	},
	{
		accessorKey: "numeroCreditoSifco",
		header: "Cuenta (SIFCO)",
		// Lleva a la Ficha 360 del crédito (mismo patrón que cobros/reportes):
		// quien fiscaliza la bitácora quiere ver el caso que se consultó.
		cell: ({ row }) => {
			const sifco = row.original.numeroCreditoSifco;
			if (!sifco) return "—";
			return (
				<Link
					className="font-mono text-blue-600 hover:underline"
					params={{ id: sifco }}
					search={{ tipo: "contrato" }}
					to="/cobros/$id"
				>
					{sifco}
				</Link>
			);
		},
	},
	{
		accessorKey: "unitName",
		header: "Unidad consultada",
		cell: ({ row }) => row.original.unitName ?? "—",
	},
	{
		accessorKey: "motivo",
		header: "Motivo",
	},
];

// ── CB-121: bitácora técnica de la integración ────────────────────────────────

interface IntegracionLogFila {
	id: string;
	correlationId: string;
	operacion: string;
	origen: string;
	resultado: "ok" | "error" | "reintentado" | "incierto";
	errorCode: string | null;
	severidad: "info" | "warning" | "critical";
	duracionMs: number;
	numeroCreditoSifco: string | null;
	userNombre: string | null;
	userEmail: string | null;
	createdAt: Date;
}

const INTEGRACION_LOGS_COLUMNS: ColumnDef<IntegracionLogFila>[] = [
	{
		accessorKey: "createdAt",
		header: "Fecha",
		cell: ({ row }) => formatFechaHora(row.original.createdAt),
	},
	{
		accessorKey: "userNombre",
		header: "Usuario",
		cell: ({ row }) => (
			<div>
				<div>{row.original.userNombre ?? "—"}</div>
				<div className="text-muted-foreground text-xs">
					{row.original.userEmail ?? ""}
				</div>
			</div>
		),
	},
	{
		accessorKey: "operacion",
		header: "Operación",
		cell: ({ row }) => (
			<div>
				<div className="font-mono text-xs">{row.original.operacion}</div>
				<div className="text-muted-foreground text-xs">
					{row.original.origen}
				</div>
			</div>
		),
	},
	{
		accessorKey: "resultado",
		header: "Resultado",
		cell: ({ row }) => {
			const config = RESULTADO_INTENTO_CONFIG[row.original.resultado];
			return <Badge className={config.badgeClass}>{config.label}</Badge>;
		},
	},
	{
		accessorKey: "severidad",
		header: "Severidad",
		cell: ({ row }) => {
			const config = SEVERIDAD_CONFIG[row.original.severidad];
			return <Badge className={config.badgeClass}>{config.label}</Badge>;
		},
	},
	{
		accessorKey: "errorCode",
		header: "Código",
		cell: ({ row }) => (
			<span className="font-mono text-xs">{row.original.errorCode ?? "—"}</span>
		),
	},
	{
		accessorKey: "duracionMs",
		header: "Duración",
		cell: ({ row }) => formatDuracion(row.original.duracionMs),
	},
	{
		accessorKey: "numeroCreditoSifco",
		header: "Cuenta (SIFCO)",
		cell: ({ row }) => {
			const sifco = row.original.numeroCreditoSifco;
			if (!sifco) return "—";
			return (
				<Link
					className="font-mono text-blue-600 hover:underline"
					params={{ id: sifco }}
					search={{ tipo: "contrato" }}
					to="/cobros/$id"
				>
					{sifco}
				</Link>
			);
		},
	},
];

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function RouteComponent() {
	const {
		data: session,
		error: sessionError,
		isPending,
	} = authClient.useSession();
	const navigate = Route.useNavigate();
	const [filterName, setFilterName] = useState("");
	const [debouncedFilterName, setDebouncedFilterName] = useState("");

	// Evita disparar una consulta a Wialon (core/search_items) por cada tecla —
	// con el filtro escribiéndose rápido se puede topar el límite de
	// solicitudes concurrentes del proveedor (código de error 10).
	useEffect(() => {
		const timer = setTimeout(
			() => setDebouncedFilterName(filterName.trim()),
			300,
		);
		return () => clearTimeout(timer);
	}, [filterName]);

	const userProfile = useQuery(orpc.getUserProfile.queryOptions());
	const isAdmin = userProfile.data?.role === "admin";

	useEffect(() => {
		if (shouldRedirectToLogin({ error: sessionError, isPending, session })) {
			navigate({ to: "/login" });
		} else if (session && !userProfile.isPending && !isAdmin) {
			navigate({ to: "/dashboard" });
			toast.error("Acceso denegado: se requiere rol de administrador");
		}
	}, [
		session,
		sessionError,
		isPending,
		userProfile.isPending,
		isAdmin,
		navigate,
	]);

	const diagnostics = useQuery({
		...orpc.getWialonDiagnostics.queryOptions(),
		enabled: !!session && isAdmin,
		// Panel de monitoreo: refresco periódico, sin insistir si la pestaña está en segundo plano.
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
	});

	const units = useQuery({
		...orpc.getWialonUnitsCatalog.queryOptions({
			input: debouncedFilterName ? { filterName: debouncedFilterName } : {},
		}),
		enabled: !!session && isAdmin,
		placeholderData: keepPreviousData,
	});

	const testConnection = useMutation({
		...orpc.testWialonConnection.mutationOptions(),
		onSuccess: (data) => {
			toast.success(
				data.connected
					? `Conexión verificada: ${data.unitCount ?? 0} unidades sincronizadas`
					: "La prueba de conexión finalizó sin confirmar el estado",
			);
			diagnostics.refetch();
			// Si el catálogo había fallado con la conexión caída, al recuperarla
			// no queremos dejar la tabla vacía hasta que el admin recargue la página.
			units.refetch();
		},
		onError: (error) => {
			toast.error(
				error.message || "No se pudo verificar la conexión con Wialon",
			);
			// Sin esto, el card de estado sigue mostrando "conectado" (dato
			// cacheado) hasta el próximo poll de 60s, contradiciendo el toast
			// de error que el admin acaba de ver.
			diagnostics.refetch();
		},
	});

	const unitRows: UnidadCatalogo[] = useMemo(
		() =>
			units.data?.items.map((u) => ({
				id: u.id,
				nm: u.nm,
				creditos: u.creditos,
			})) ?? [],
		[units.data],
	);

	const [bitacoraPage, setBitacoraPage] = useState(1);
	const [bitacoraPageSize, setBitacoraPageSize] = useState(25);
	const [bitacoraSifco, setBitacoraSifco] = useState("");
	const [bitacoraSifcoDebounced, setBitacoraSifcoDebounced] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => {
			setBitacoraSifcoDebounced(bitacoraSifco.trim());
			setBitacoraPage(1);
		}, 300);
		return () => clearTimeout(timer);
	}, [bitacoraSifco]);

	const bitacora = useQuery({
		...orpc.getGpsBitacora.queryOptions({
			input: {
				page: bitacoraPage,
				perPage: bitacoraPageSize,
				...(bitacoraSifcoDebounced
					? { numeroCreditoSifco: bitacoraSifcoDebounced }
					: {}),
			},
		}),
		enabled: !!session && isAdmin,
		placeholderData: keepPreviousData,
	});

	const bitacoraRows: BitacoraFila[] = useMemo(
		() =>
			bitacora.data?.items.map((i) => ({
				...i,
				createdAt: new Date(i.createdAt),
			})) ?? [],
		[bitacora.data],
	);

	// ── CB-121: bitácora técnica, salud y alertas ─────────────────────────────
	const [logsPage, setLogsPage] = useState(1);
	const [logsPageSize, setLogsPageSize] = useState(25);
	const [logsReferencia, setLogsReferencia] = useState("");
	const referenciaBuscada = logsReferencia.trim();
	// La referencia que ve el asesor es el correlationId completo; el backend
	// exige un UUID, así que un texto a medias no se envía.
	const referenciaValida = UUID_RE.test(referenciaBuscada);

	const salud = useQuery({
		...orpc.getGpsIntegracionSalud.queryOptions(),
		enabled: !!session && isAdmin,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
	});

	const alertas = useQuery({
		...orpc.getGpsAlertas.queryOptions(),
		enabled: !!session && isAdmin,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
	});

	const integracionLogs = useQuery({
		...orpc.getGpsIntegracionLogs.queryOptions({
			input: {
				page: logsPage,
				perPage: logsPageSize,
				...(referenciaValida ? { correlationId: referenciaBuscada } : {}),
			},
		}),
		enabled: !!session && isAdmin,
		placeholderData: keepPreviousData,
	});

	const integracionLogsRows: IntegracionLogFila[] = useMemo(
		() =>
			integracionLogs.data?.items.map((i) => ({
				...i,
				createdAt: new Date(i.createdAt),
			})) ?? [],
		[integracionLogs.data],
	);

	const [alertaAResolver, setAlertaAResolver] = useState<{
		id: string;
		tipo: TipoAlertaGps;
	} | null>(null);
	const [notaResolucion, setNotaResolucion] = useState("");

	const resolverAlerta = useMutation({
		...orpc.resolverGpsAlerta.mutationOptions(),
		onSuccess: () => {
			toast.success("Alerta resuelta");
			setAlertaAResolver(null);
			setNotaResolucion("");
			alertas.refetch();
			salud.refetch();
		},
		onError: (error) => {
			toast.error(error.message || "No se pudo resolver la alerta");
		},
	});

	if (isPending || userProfile.isPending) {
		return <div className="container mx-auto p-6">Cargando...</div>;
	}

	if (!isAdmin) {
		return null;
	}

	const d = diagnostics.data;
	const estado = d ? resolveEstado(d) : null;
	const estadoConfig = estado ? ESTADO_CONEXION_CONFIG[estado] : null;
	const EstadoIcon = estadoConfig?.icon;

	return (
		<div className="container mx-auto space-y-6 p-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h1 className="flex items-center gap-2 font-bold text-3xl">
						<MapPin className="h-7 w-7" />
						Integración GPS (Wialon / La Legión)
					</h1>
					<p className="text-muted-foreground">
						Estado de conexión, catálogo de unidades, bitácora de consultas y
						salud de la integración
					</p>
				</div>
				<Button
					onClick={() => testConnection.mutate({})}
					disabled={testConnection.isPending}
				>
					{testConnection.isPending ? (
						<Loader2 className="mr-2 h-4 w-4 animate-spin" />
					) : (
						<RefreshCw className="mr-2 h-4 w-4" />
					)}
					Probar conexión
				</Button>
			</div>

			<Tabs className="gap-4" defaultValue="conexion">
				<TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
					<TabsTrigger className="gap-2 px-3" value="conexion">
						<Plug className="h-4 w-4" />
						Conexión
					</TabsTrigger>
					<TabsTrigger className="gap-2 px-3" value="catalogo">
						<Truck className="h-4 w-4" />
						Catálogo de unidades
					</TabsTrigger>
					<TabsTrigger className="gap-2 px-3" value="bitacora">
						<ClipboardList className="h-4 w-4" />
						Bitácora de consultas
					</TabsTrigger>
					<TabsTrigger className="gap-2 px-3" value="fallas">
						<ShieldAlert className="h-4 w-4" />
						Fallas y salud
						{(salud.data?.alertasAbiertas ?? 0) > 0 && (
							<Badge className="h-5 min-w-5 rounded-full bg-amber-500 px-1.5 text-white hover:bg-amber-500">
								{salud.data?.alertasAbiertas}
							</Badge>
						)}
					</TabsTrigger>
				</TabsList>

				<TabsContent className="space-y-6" value="conexion">
					{diagnostics.isPending ? (
						<Card>
							<CardContent className="flex items-center gap-2 p-6 text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								Consultando estado de la conexión...
							</CardContent>
						</Card>
					) : diagnostics.isError ? (
						// Esto es un fallo de la petición ORPC en sí (servidor caído, DB
						// inaccesible, output que no valida, etc.), no un problema de
						// credenciales de Wialon — con d undefined no hay que renderizar
						// "Token configurado: No" ni ningún otro dato como si lo supiéramos.
						<Card className="border-red-200 dark:border-red-900/50">
							<CardContent className="flex items-center justify-between gap-4 p-6">
								<div className="flex items-center gap-2 text-red-600 text-sm dark:text-red-400">
									<TriangleAlert className="h-4 w-4 shrink-0" />
									<span>
										No se pudo consultar el diagnóstico del panel:{" "}
										{diagnostics.error?.message ||
											"error desconocido al contactar el servidor del CRM"}
									</span>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => diagnostics.refetch()}
								>
									Reintentar
								</Button>
							</CardContent>
						</Card>
					) : (
						<>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
								<Card className={estadoConfig?.cardClass}>
									<CardHeader className="pb-2">
										<CardDescription>Estado de conexión</CardDescription>
									</CardHeader>
									<CardContent>
										<Badge className={estadoConfig?.badgeClass}>
											{EstadoIcon && <EstadoIcon className="mr-1 h-3 w-3" />}
											{estadoConfig?.label}
										</Badge>
									</CardContent>
								</Card>
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Latencia</CardDescription>
									</CardHeader>
									<CardContent className="font-semibold text-2xl">
										{formatLatency(d?.latencyMs ?? null)}
									</CardContent>
								</Card>
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Unidades sincronizadas</CardDescription>
									</CardHeader>
									<CardContent className="font-semibold text-2xl">
										{d?.unitCount ?? "—"}
									</CardContent>
								</Card>
								<Card>
									<CardHeader className="pb-2">
										<CardDescription>Usuario Wialon</CardDescription>
									</CardHeader>
									<CardContent className="font-semibold text-lg">
										{d?.user?.nm ?? "—"}
									</CardContent>
								</Card>
							</div>

							{d && !d.connected && d.error && (
								<Card className="border-red-200 dark:border-red-900/50">
									<CardContent className="p-4 text-red-600 text-sm dark:text-red-400">
										<span className="font-semibold">{d.error.code}:</span>{" "}
										{d.error.message}
									</CardContent>
								</Card>
							)}

							<Card>
								<CardHeader>
									<CardTitle>Configuración del proveedor</CardTitle>
									<CardDescription>
										Las credenciales se administran mediante variables de
										entorno del servidor y no son editables desde el CRM.
									</CardDescription>
								</CardHeader>
								<CardContent className="grid gap-3 sm:grid-cols-2">
									<div>
										<div className="text-muted-foreground text-xs">
											Ambiente
										</div>
										<div className="font-medium capitalize">
											{d?.environment ?? "—"}
										</div>
									</div>
									<div>
										<div className="text-muted-foreground text-xs">
											Token configurado
										</div>
										<Badge
											variant={d?.tokenConfigured ? "default" : "destructive"}
										>
											{d?.tokenConfigured ? "Sí" : "No"}
										</Badge>
									</div>
									<div>
										<div className="text-muted-foreground text-xs">
											Base URL
										</div>
										<div className="break-all font-mono text-sm">
											{d?.baseUrl ?? "—"}
										</div>
									</div>
									<div>
										<div className="text-muted-foreground text-xs">
											Locator URL
										</div>
										<div className="break-all font-mono text-sm">
											{d?.locatorUrl ?? "—"}
										</div>
									</div>
									<div>
										<div className="text-muted-foreground text-xs">Timeout</div>
										<div className="font-medium">{d?.timeoutMs ?? "—"} ms</div>
									</div>
									<div>
										<div className="text-muted-foreground text-xs">
											Caché de sesión interna válida hasta
										</div>
										<div className="font-medium">
											{formatFechaHora(d?.sessionExpiresAt ?? null)}
										</div>
										<div className="text-muted-foreground text-xs">
											El token de Wialon es permanente; esto es solo el sid en
											memoria del servidor (se renueva solo cada 2h, sin acción
											requerida).
										</div>
									</div>
								</CardContent>
							</Card>
						</>
					)}
				</TabsContent>

				<TabsContent value="catalogo">
					<Card>
						<CardHeader>
							<CardTitle>Catálogo de unidades</CardTitle>
							<CardDescription>
								Flota sincronizada desde Wialon / La Legión
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<Input
								placeholder="Buscar por nombre de unidad..."
								value={filterName}
								onChange={(e) => setFilterName(e.target.value)}
								className="max-w-sm"
							/>
							{units.isError ? (
								// Igual que con diagnostics: sin esto, un fallo del catálogo
								// (token faltante, Wialon caído) se ve idéntico a una flota
								// realmente vacía — "No se encontraron resultados" engaña.
								<div className="flex items-center justify-between gap-4 rounded-md border border-red-200 p-4 dark:border-red-900/50">
									<div className="flex items-center gap-2 text-red-600 text-sm dark:text-red-400">
										<TriangleAlert className="h-4 w-4 shrink-0" />
										<span>
											No se pudo cargar el catálogo de unidades:{" "}
											{units.error?.message ||
												"error desconocido al contactar el servidor del CRM"}
										</span>
									</div>
									<Button
										variant="outline"
										size="sm"
										onClick={() => units.refetch()}
									>
										Reintentar
									</Button>
								</div>
							) : (
								<DataTable
									columns={UNIT_COLUMNS}
									data={unitRows}
									isLoading={units.isPending}
									hideSearch
								/>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="bitacora">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<ClipboardList className="h-5 w-5" />
								Bitácora de consultas GPS
							</CardTitle>
							<CardDescription>
								Cada vez que un asesor confirma un motivo y ve la ubicación de
								una unidad en la Ficha 360 queda registrado aquí (CB-118).
								Vincular una unidad o generar un enlace de rastreo se auditan
								por separado en los logs del servidor.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<Input
								className="max-w-sm"
								onChange={(e) => setBitacoraSifco(e.target.value)}
								placeholder="Filtrar por número SIFCO..."
								value={bitacoraSifco}
							/>
							{bitacora.isError ? (
								<div className="flex items-center justify-between gap-4 rounded-md border border-red-200 p-4 dark:border-red-900/50">
									<div className="flex items-center gap-2 text-red-600 text-sm dark:text-red-400">
										<TriangleAlert className="h-4 w-4 shrink-0" />
										<span>
											No se pudo cargar la bitácora:{" "}
											{bitacora.error?.message || "error desconocido"}
										</span>
									</div>
									<Button
										onClick={() => bitacora.refetch()}
										size="sm"
										variant="outline"
									>
										Reintentar
									</Button>
								</div>
							) : (
								<DataTable
									columns={BITACORA_COLUMNS}
									data={bitacoraRows}
									hideSearch
									isLoading={bitacora.isPending}
									serverPagination={{
										onPageChange: setBitacoraPage,
										onPageSizeChange: (size) => {
											setBitacoraPageSize(size);
											setBitacoraPage(1);
										},
										page: bitacoraPage,
										pageSize: bitacoraPageSize,
										totalItems: bitacora.data?.total ?? 0,
										totalPages: Math.max(
											1,
											Math.ceil((bitacora.data?.total ?? 0) / bitacoraPageSize),
										),
									}}
								/>
							)}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent className="space-y-6" value="fallas">
					<div>
						<p className="text-muted-foreground text-sm">
							Trazabilidad técnica de cada llamada a Wialon (solicitudes,
							errores, reintentos y tiempos de respuesta) y alertas cuando la
							integración se degrada.
						</p>
					</div>

					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<Card>
							<CardHeader className="pb-2">
								<CardDescription>Tasa de error (última hora)</CardDescription>
							</CardHeader>
							<CardContent className="font-semibold text-2xl">
								{formatPorcentaje(salud.data?.ventana.tasaError ?? null)}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="pb-2">
								<CardDescription>Latencia p95 (última hora)</CardDescription>
							</CardHeader>
							<CardContent className="font-semibold text-2xl">
								{formatDuracion(salud.data?.ventana.p95Ms ?? null)}
							</CardContent>
						</Card>
						<Card
							className={
								salud.data?.circuito.abierto
									? "border-red-200 dark:border-red-900/50"
									: undefined
							}
						>
							<CardHeader className="pb-2">
								<CardDescription>Circuito (reintentos)</CardDescription>
							</CardHeader>
							<CardContent className="flex items-center gap-2 font-semibold text-lg">
								{salud.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
								) : !salud.data ? (
									<span className="text-muted-foreground">Sin datos</span>
								) : salud.data.circuito.abierto ? (
									<>
										<TriangleAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
										Abierto (contingencia)
									</>
								) : (
									<>
										<CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
										Cerrado
									</>
								)}
							</CardContent>
						</Card>
						<Card
							className={
								(salud.data?.alertasAbiertas ?? 0) > 0
									? "border-amber-200 dark:border-amber-900/50"
									: undefined
							}
						>
							<CardHeader className="pb-2">
								<CardDescription>Alertas abiertas</CardDescription>
							</CardHeader>
							<CardContent className="font-semibold text-2xl">
								{salud.data?.alertasAbiertas ?? "—"}
							</CardContent>
						</Card>
					</div>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<TriangleAlert className="h-5 w-5" />
								Alertas de la integración
							</CardTitle>
							<CardDescription>
								Se abren solas cuando la tasa de error, la latencia o los fallos
								consecutivos superan el SLA, o ante un error crítico
								(credenciales, acceso denegado). Las de umbral se cierran solas
								al normalizarse; las críticas requieren resolución manual.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{alertas.isPending ? (
								<div className="flex items-center gap-2 text-muted-foreground text-sm">
									<Loader2 className="h-4 w-4 animate-spin" />
									Cargando alertas...
								</div>
							) : alertas.data?.items.length === 0 ? (
								<div className="flex items-center gap-2 text-muted-foreground text-sm">
									<CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
									Sin alertas registradas.
								</div>
							) : (
								alertas.data?.items.map((a) => (
									<div
										className={`flex items-start justify-between gap-4 rounded-md border p-3 ${
											a.estado === "abierta"
												? "border-amber-200 dark:border-amber-900/50"
												: "opacity-60"
										}`}
										key={a.id}
									>
										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<Badge
													variant={
														a.estado === "abierta" ? "default" : "outline"
													}
												>
													{a.estado === "abierta" ? "Abierta" : "Resuelta"}
												</Badge>
												<span className="font-medium text-sm">
													{TIPO_ALERTA_LABEL[a.tipo]}
												</span>
												<span className="text-muted-foreground text-xs">
													× {a.ocurrencias}
												</span>
											</div>
											<p className="text-sm">{a.detalle}</p>
											<p className="text-muted-foreground text-xs">
												Desde {formatFechaHora(new Date(a.primeraVez))} · última
												vez {formatFechaHora(new Date(a.ultimaVez))}
												{a.notaResolucion ? ` · Nota: ${a.notaResolucion}` : ""}
											</p>
										</div>
										{a.estado === "abierta" && (
											<Button
												onClick={() =>
													setAlertaAResolver({ id: a.id, tipo: a.tipo })
												}
												size="sm"
												variant="outline"
											>
												Resolver
											</Button>
										)}
									</div>
								))
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Bitácora técnica de la integración</CardTitle>
							<CardDescription>
								Cada intento HTTP a Wialon (login, catálogo, telemetría, links
								de rastreo), con su resultado, duración y si se reintentó. Para
								ver quién consultó qué unidad y por qué, use la pestaña
								"Bitácora de consultas".
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-1">
								<Input
									className="max-w-sm font-mono"
									onChange={(e) => {
										setLogsReferencia(e.target.value);
										setLogsPage(1);
									}}
									placeholder="Buscar por referencia de la consulta..."
									value={logsReferencia}
								/>
								{referenciaBuscada && !referenciaValida && (
									<p className="text-muted-foreground text-xs">
										Pegue la referencia completa que ve el asesor en la ficha.
									</p>
								)}
							</div>
							{integracionLogs.isError ? (
								<div className="flex items-center justify-between gap-4 rounded-md border border-red-200 p-4 dark:border-red-900/50">
									<div className="flex items-center gap-2 text-red-600 text-sm dark:text-red-400">
										<TriangleAlert className="h-4 w-4 shrink-0" />
										<span>
											No se pudo cargar la bitácora técnica:{" "}
											{integracionLogs.error?.message || "error desconocido"}
										</span>
									</div>
									<Button
										onClick={() => integracionLogs.refetch()}
										size="sm"
										variant="outline"
									>
										Reintentar
									</Button>
								</div>
							) : (
								<DataTable
									columns={INTEGRACION_LOGS_COLUMNS}
									data={integracionLogsRows}
									hideSearch
									isLoading={integracionLogs.isPending}
									serverPagination={{
										onPageChange: setLogsPage,
										onPageSizeChange: (size) => {
											setLogsPageSize(size);
											setLogsPage(1);
										},
										page: logsPage,
										pageSize: logsPageSize,
										totalItems: integracionLogs.data?.total ?? 0,
										totalPages: Math.max(
											1,
											Math.ceil(
												(integracionLogs.data?.total ?? 0) / logsPageSize,
											),
										),
									}}
								/>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>

			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						setAlertaAResolver(null);
						setNotaResolucion("");
					}
				}}
				open={alertaAResolver !== null}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Resolver alerta</DialogTitle>
						<DialogDescription>
							{alertaAResolver &&
								`${TIPO_ALERTA_LABEL[alertaAResolver.tipo]}: describa qué se hizo para resolverla.`}
						</DialogDescription>
					</DialogHeader>
					<Textarea
						onChange={(e) => setNotaResolucion(e.target.value)}
						placeholder="Ej: se renovó el token de Wialon y se confirmó conexión."
						value={notaResolucion}
					/>
					<DialogFooter>
						<Button
							disabled={resolverAlerta.isPending}
							onClick={() => setAlertaAResolver(null)}
							variant="outline"
						>
							Cancelar
						</Button>
						<Button
							disabled={
								resolverAlerta.isPending || notaResolucion.trim().length < 5
							}
							onClick={() => {
								if (!alertaAResolver) return;
								resolverAlerta.mutate({
									alertaId: alertaAResolver.id,
									nota: notaResolucion.trim(),
								});
							}}
						>
							{resolverAlerta.isPending && (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							)}
							Confirmar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
