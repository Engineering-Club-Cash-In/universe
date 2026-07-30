import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	ChevronLeft,
	ChevronRight,
	Handshake,
	Loader2,
	Search,
	UserRound,
} from "lucide-react";
import { useState } from "react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import {
	bucketDeNumero,
	estiloBucket,
	useBucketsCatalogo,
} from "@/lib/cobros/buckets-catalogo";
import { PERMISSIONS } from "@/lib/roles";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cobros/convenios")({
	component: ConveniosPage,
});

interface ConvenioItem {
	convenio_id: number;
	credito_id: number;
	numero_credito_sifco: string;
	cliente_nombre: string;
	asesor_id: number | null;
	asesor_nombre: string | null;
	asesor_email: string | null;
	monto_total_convenio: string;
	cuota_mensual: string;
	numero_meses: number;
	monto_pagado: string;
	monto_pendiente: string;
	pagos_realizados: number;
	pagos_pendientes: number;
	fecha_convenio: string;
	activo: boolean;
	completado: boolean;
	motivo: string | null;
	progreso: string;
	/** Último bucket registrado antes de entrar en convenio. null = sin traza. */
	bucket_previo: number | null;
	bucket_previo_prefijo: string | null;
}

interface ConveniosResponse {
	sinAsesor: boolean;
	asesorForzado: { asesorId: number; nombre: string } | null;
	items: ConvenioItem[];
	total: number;
	page: number;
	perPage: number;
	totalPages: number;
}

interface AsesorOption {
	asesorId: number;
	nombre: string;
	activo: boolean;
	email: string;
	isActive: boolean;
}

type Estado = "active" | "completed" | "inactive" | "all";

const PER_PAGE_CONVENIOS = 25;

const ESTADOS: Array<{ value: Estado; label: string }> = [
	{ value: "active", label: "Activos" },
	{ value: "completed", label: "Cumplidos" },
	{ value: "inactive", label: "Inactivos" },
	{ value: "all", label: "Todos" },
];

function formatMoneda(valor: string) {
	return `Q${Number(valor).toLocaleString("es-GT", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

function fechaLegible(v: string | null) {
	if (!v) return "—";
	const [y, m, d] = v.split("T")[0].split("-");
	return y && m && d ? `${d}/${m}/${y}` : v;
}

function EstadoBadge({ item }: { item: ConvenioItem }) {
	if (item.completado) {
		return <Badge className="bg-green-100 text-green-800">Cumplido</Badge>;
	}
	return (
		<Badge variant={item.activo ? "default" : "secondary"}>
			{item.activo ? "Activo" : "Inactivo"}
		</Badge>
	);
}

/**
 * Último bucket registrado en buckets_historial ANTES de que el crédito
 * saliera del funnel por el convenio. El motor deja de escribir para
 * créditos EN_CONVENIO, así que esta fila queda congelada en el bucket real
 * previo a la salida — null = sin traza (crédito nunca procesado por el
 * motor, típico en ambientes sin backfill de COBROS-02).
 */
function UltimoBucketBadge({
	item,
	catalogo,
}: {
	item: ConvenioItem;
	catalogo: ReturnType<typeof useBucketsCatalogo>["data"];
}) {
	if (item.bucket_previo === null) {
		return <span className="text-muted-foreground text-xs">Sin traza</span>;
	}
	const ui = bucketDeNumero(item.bucket_previo, catalogo);
	const prefijo = item.bucket_previo_prefijo || `B${item.bucket_previo}`;
	return (
		<Badge
			variant="outline"
			className="whitespace-nowrap text-[10px]"
			style={estiloBucket(ui.colorHex)}
			title={ui.label}
		>
			{prefijo} · {ui.label}
		</Badge>
	);
}

function ConveniosPage() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const userRole = session?.user?.role;
	const esSupervisor = !!userRole && PERMISSIONS.canAssignCobros(userRole);
	const bucketsCatalogo = useBucketsCatalogo();

	const [asesorSel, setAsesorSel] = useState("todos");
	const [estado, setEstado] = useState<Estado>("active");
	const [busquedaInput, setBusquedaInput] = useState("");
	const [busqueda, setBusqueda] = useState("");
	const [page, setPage] = useState(1);

	const asesorIdInput =
		esSupervisor && asesorSel !== "todos" ? Number(asesorSel) : undefined;

	const conveniosQuery = useQuery({
		...orpc.getConveniosListado.queryOptions({
			input: {
				estado,
				// Búsqueda libre: matchea SIFCO o cliente (cartera-back combina
				// ambos con OR, ver getConveniosListado en el server).
				busqueda: busqueda || undefined,
				asesorId: asesorIdInput,
				page,
				perPage: PER_PAGE_CONVENIOS,
			},
		}),
		enabled: !!session,
		placeholderData: keepPreviousData,
	});

	const asesoresQuery = useQuery({
		...orpc.getAsesores.queryOptions({
			input: { page: 1, perPage: 100 },
		}),
		enabled: !!session && esSupervisor,
	});

	if (!userRole || !PERMISSIONS.canAccessCobros(userRole)) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<div className="text-center">
					<h1 className="mb-4 font-bold text-2xl text-gray-800">
						Acceso Denegado
					</h1>
					<p className="text-gray-600">
						Solo el equipo de cobros puede ver los convenios de pago.
					</p>
				</div>
			</div>
		);
	}

	const data = conveniosQuery.data as ConveniosResponse | undefined;
	const items = data?.items ?? [];
	const total = data?.total ?? 0;
	const totalPages = data?.totalPages ?? 1;
	const sinAsesor = !!data?.sinAsesor;
	const asesorForzado = data?.asesorForzado ?? null;

	const asesores = (
		(asesoresQuery.data as { asesores?: AsesorOption[] } | undefined)
			?.asesores ?? []
	).filter((a) => a.activo);

	const cambiarAsesor = (v: string) => {
		setAsesorSel(v);
		setPage(1);
	};

	const cambiarEstado = (v: string) => {
		setEstado(v as Estado);
		setPage(1);
	};

	const aplicarBusqueda = () => {
		setBusqueda(busquedaInput.trim());
		setPage(1);
	};

	const irAlDetalle = (sifco: string) => {
		navigate({
			to: "/cobros/$id",
			params: { id: sifco },
			search: { tipo: "caso" },
		});
	};

	return (
		<div className="container mx-auto space-y-4 p-4 lg:p-6">
			<Card>
				<CardHeader className="pb-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
								<Handshake className="h-5 w-5" />
							</div>
							<div>
								<CardTitle className="text-xl">Convenios de Pago</CardTitle>
								<CardDescription>
									Convenios de pago creados desde cartera para regularizar
									créditos en mora
									{asesorForzado
										? ` · Convenios de ${asesorForzado.nombre}`
										: ""}
								</CardDescription>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Badge variant="secondary">{total} convenios</Badge>
							{conveniosQuery.isFetching && (
								<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
							)}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-2 pt-3">
						<div className="flex items-center gap-1.5">
							{ESTADOS.map((e) => (
								<Button
									key={e.value}
									type="button"
									size="sm"
									variant={estado === e.value ? "default" : "outline"}
									className="h-7 rounded-full px-3 text-xs"
									onClick={() => cambiarEstado(e.value)}
								>
									{e.label}
								</Button>
							))}
						</div>
						<div className="flex flex-1 items-center gap-2 sm:max-w-xs">
							<Input
								placeholder="Buscar por SIFCO o cliente..."
								value={busquedaInput}
								onChange={(e) => setBusquedaInput(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && aplicarBusqueda()}
								className="h-8"
							/>
							<Button
								variant="outline"
								size="sm"
								className="h-8"
								onClick={aplicarBusqueda}
							>
								<Search className="h-3.5 w-3.5" />
							</Button>
						</div>
						{esSupervisor && (
							<Select value={asesorSel} onValueChange={cambiarAsesor}>
								<SelectTrigger className="h-8 w-52">
									<UserRound className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
									<SelectValue placeholder="Asesor" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="todos">Todos los asesores</SelectItem>
									{asesoresQuery.isError && (
										<div className="px-2 py-1.5 text-destructive text-xs">
											Error al cargar asesores
										</div>
									)}
									{asesores.map((a) => (
										<SelectItem key={a.asesorId} value={String(a.asesorId)}>
											{a.nombre}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
					</div>
				</CardHeader>
			</Card>

			{conveniosQuery.isPending && (
				<div className="flex items-center justify-center py-16">
					<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
				</div>
			)}

			{!conveniosQuery.isPending && conveniosQuery.isError && (
				<Card>
					<CardContent className="py-10 text-center text-destructive">
						Error al cargar los convenios de pago. Intentá recargar la página.
					</CardContent>
				</Card>
			)}

			{!conveniosQuery.isPending && !conveniosQuery.isError && sinAsesor && (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground">
						Tu usuario no está vinculado a un asesor de cartera (por correo).
						Pedile al supervisor que revise tu correo de asesor.
					</CardContent>
				</Card>
			)}

			{!conveniosQuery.isPending &&
				!conveniosQuery.isError &&
				!sinAsesor &&
				total === 0 && (
					<Card>
						<CardContent className="py-10 text-center text-muted-foreground">
							No hay convenios de pago para los filtros seleccionados.
						</CardContent>
					</Card>
				)}

			{!conveniosQuery.isPending &&
				!conveniosQuery.isError &&
				!sinAsesor &&
				total > 0 && (
					<Card>
						<CardContent className="pt-6">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Cliente</TableHead>
											<TableHead>Crédito</TableHead>
											<TableHead>Monto total</TableHead>
											<TableHead>Cuota</TableHead>
											<TableHead>Progreso</TableHead>
											<TableHead>Pendiente</TableHead>
											<TableHead>Fecha convenio</TableHead>
											<TableHead>Estado</TableHead>
											<TableHead>Último Bucket</TableHead>
											{esSupervisor && asesorSel === "todos" && (
												<TableHead>Asesor</TableHead>
											)}
										</TableRow>
									</TableHeader>
									<TableBody>
										{items.map((item) => (
											<TableRow
												key={item.convenio_id}
												className="cursor-pointer"
												onClick={() => irAlDetalle(item.numero_credito_sifco)}
											>
												<TableCell className="font-medium">
													{item.cliente_nombre}
												</TableCell>
												<TableCell className="max-w-45 truncate font-mono text-muted-foreground text-xs">
													{item.numero_credito_sifco}
												</TableCell>
												<TableCell>
													{formatMoneda(item.monto_total_convenio)}
												</TableCell>
												<TableCell>
													{formatMoneda(item.cuota_mensual)}
												</TableCell>
												<TableCell className="text-sm">
													{item.pagos_realizados}/{item.numero_meses} (
													{Number(item.progreso).toFixed(0)}%)
												</TableCell>
												<TableCell className="text-red-600 text-sm">
													{formatMoneda(item.monto_pendiente)}
												</TableCell>
												<TableCell className="text-sm">
													{fechaLegible(item.fecha_convenio)}
												</TableCell>
												<TableCell>
													<EstadoBadge item={item} />
												</TableCell>
												<TableCell>
													<UltimoBucketBadge
														item={item}
														catalogo={bucketsCatalogo.data}
													/>
												</TableCell>
												{esSupervisor && asesorSel === "todos" && (
													<TableCell className="text-sm">
														{item.asesor_nombre ?? "—"}
													</TableCell>
												)}
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>

							{totalPages > 1 && (
								<div className="flex items-center justify-between pt-3">
									<span className="text-muted-foreground text-xs">
										Mostrando {items.length} de {total} · página {page} de{" "}
										{totalPages}
									</span>
									<div className="flex items-center gap-1">
										<Button
											variant="outline"
											size="sm"
											className="h-8"
											disabled={page <= 1 || conveniosQuery.isFetching}
											onClick={() => setPage((p) => p - 1)}
										>
											<ChevronLeft className="h-4 w-4" />
											Anterior
										</Button>
										<Button
											variant="outline"
											size="sm"
											className="h-8"
											disabled={page >= totalPages || conveniosQuery.isFetching}
											onClick={() => setPage((p) => p + 1)}
										>
											Siguiente
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				)}
		</div>
	);
}
