import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { shouldRedirectToLogin } from "@/lib/auth-session";
import { orpc } from "@/utils/orpc";
import {
	ESTADO_CONEXION_CONFIG,
	formatLatency,
	formatSessionExpiry,
	resolveEstado,
} from "./-gps-format";

export const Route = createFileRoute("/admin/gps")({
	component: RouteComponent,
});

interface UnidadCatalogo {
	id: number;
	nm: string;
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
];

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
		},
	});

	const unitRows: UnidadCatalogo[] = useMemo(
		() => units.data?.items.map((u) => ({ id: u.id, nm: u.nm })) ?? [],
		[units.data],
	);

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
						Estado de conexión, configuración y catálogo de unidades
						sincronizadas
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

			{diagnostics.isPending ? (
				<Card>
					<CardContent className="flex items-center gap-2 p-6 text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Consultando estado de la conexión...
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
								Las credenciales se administran mediante variables de entorno
								del servidor y no son editables desde el CRM.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-3 sm:grid-cols-2">
							<div>
								<div className="text-muted-foreground text-xs">Ambiente</div>
								<div className="font-medium capitalize">
									{d?.environment ?? "—"}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground text-xs">
									Token configurado
								</div>
								<Badge variant={d?.tokenConfigured ? "default" : "destructive"}>
									{d?.tokenConfigured ? "Sí" : "No"}
								</Badge>
							</div>
							<div>
								<div className="text-muted-foreground text-xs">Base URL</div>
								<div className="break-all font-mono text-sm">
									{d?.baseUrl ?? "—"}
								</div>
							</div>
							<div>
								<div className="text-muted-foreground text-xs">Locator URL</div>
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
									{formatSessionExpiry(d?.sessionExpiresAt ?? null)}
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
					<DataTable
						columns={UNIT_COLUMNS}
						data={unitRows}
						isLoading={units.isPending}
						hideSearch
					/>
				</CardContent>
			</Card>
		</div>
	);
}
