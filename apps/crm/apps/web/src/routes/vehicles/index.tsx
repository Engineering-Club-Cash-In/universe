import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	AlertTriangle,
	Camera,
	Car,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
	Eye,
	FileText,
	FolderOpen,
	Pencil,
	Plus,
	Search,
	Sparkles,
	Wrench,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { VehicleDocumentUpload } from "@/components/vehicles/VehicleDocumentUpload";
import {
	renderInspectionStatusBadge,
	renderNewVehicleBadges,
} from "@/lib/vehicle-utils";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/vehicles/")({
	component: VehiclesDashboard,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			vehicleId: search.vehicleId as string | undefined,
			inspectionId: search.inspectionId as string | undefined,
		};
	},
});

// Nota: renderInspectionStatusBadge ahora se importa desde @/lib/vehicle-utils

function VehiclesDashboard() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const search = useSearch({ from: "/vehicles/" });
	const [searchTerm, setSearchTerm] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const [filterStatus, setFilterStatus] = useState("all");
	const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
	const [isDetailsOpen, setIsDetailsOpen] = useState(false);
	const [activeTab, setActiveTab] = useState("general");
	const [page, setPage] = useState(0);
	const pageSize = 20;

	// Refs to track processed URL params
	const processedVehicleIdRef = useRef<string | null>(null);
	const processedInspectionIdRef = useRef<string | null>(null);
	const prevDetailsOpenRef = useRef(false);

	// Debounce search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	// Reset page when filter changes
	useEffect(() => {
		setPage(0);
	}, [filterStatus]);

	// Fetch vehicles with pagination
	const { data: vehicles, isLoading } = useQuery({
		...orpc.getVehicles.queryOptions({
			input: {
				limit: pageSize,
				offset: page * pageSize,
				query: debouncedSearch || undefined,
				status: filterStatus !== "all" ? filterStatus : undefined,
			},
		}),
		queryKey: ["getVehicles", page, pageSize, debouncedSearch, filterStatus],
	});
	const { data: statistics } = useQuery(
		orpc.getVehicleStatistics.queryOptions(),
	);

	// Get vehicles data from paginated response
	const vehiclesList = vehicles?.data || [];
	const totalRecords = vehicles?.total || 0;
	const totalPages = Math.ceil(totalRecords / pageSize);

	// Query to fetch specific vehicle by ID (from URL param)
	const specificVehicleQuery = useQuery({
		queryKey: ["getVehicleById", search.vehicleId],
		queryFn: search.vehicleId
			? () => client.getVehicleById({ id: search.vehicleId! })
			: () => Promise.resolve(null),
		enabled:
			!!search.vehicleId && processedVehicleIdRef.current !== search.vehicleId,
	});

	// Query to fetch inspection by ID (to get vehicleId, then fetch vehicle)
	const specificInspectionQuery = useQuery({
		queryKey: ["getVehicleInspectionById", search.inspectionId],
		queryFn: search.inspectionId
			? () => client.getVehicleInspectionById({ id: search.inspectionId! })
			: () => Promise.resolve(null),
		enabled:
			!!search.inspectionId &&
			processedInspectionIdRef.current !== search.inspectionId,
	});

	// Query to fetch vehicle from inspection's vehicleId
	const vehicleFromInspectionQuery = useQuery({
		queryKey: ["getVehicleById", specificInspectionQuery.data?.vehicleId],
		queryFn: specificInspectionQuery.data?.vehicleId
			? () =>
					client.getVehicleById({ id: specificInspectionQuery.data!.vehicleId })
			: () => Promise.resolve(null),
		enabled:
			!!specificInspectionQuery.data?.vehicleId &&
			processedInspectionIdRef.current !== search.inspectionId,
	});

	// Handle opening details modal from URL param (vehicleId)
	useEffect(() => {
		if (
			search.vehicleId &&
			specificVehicleQuery.data &&
			processedVehicleIdRef.current !== search.vehicleId
		) {
			setSelectedVehicle(specificVehicleQuery.data);
			setActiveTab("general");
			setIsDetailsOpen(true);
			processedVehicleIdRef.current = search.vehicleId;
		}
	}, [search.vehicleId, specificVehicleQuery.data]);

	// Handle opening details modal from URL param (inspectionId)
	useEffect(() => {
		if (
			search.inspectionId &&
			vehicleFromInspectionQuery.data &&
			processedInspectionIdRef.current !== search.inspectionId
		) {
			setSelectedVehicle(vehicleFromInspectionQuery.data);
			setActiveTab("inspections");
			setIsDetailsOpen(true);
			processedInspectionIdRef.current = search.inspectionId;
		}
	}, [search.inspectionId, vehicleFromInspectionQuery.data]);

	// Clear search params when details modal closes
	useEffect(() => {
		const wasOpen = prevDetailsOpenRef.current;
		prevDetailsOpenRef.current = isDetailsOpen;

		if (wasOpen && !isDetailsOpen) {
			if (processedVehicleIdRef.current || processedInspectionIdRef.current) {
				processedVehicleIdRef.current = null;
				processedInspectionIdRef.current = null;
				if (search.vehicleId || search.inspectionId) {
					navigate({
						to: "/vehicles",
						search: { vehicleId: undefined, inspectionId: undefined },
						replace: true,
					});
				}
			}
		}
	}, [isDetailsOpen, navigate, search.vehicleId, search.inspectionId]);

	// auction vehicles
	const [isAuctionOpen, setIsAuctionOpen] = useState(false);
	const [auctionVehicle, setAuctionVehicle] = useState<any>(null);
	const createAuctionMutation = useMutation(
		orpc.createAuction.mutationOptions(),
	);
	const [auctionInspection, setAuctionInspection] = useState<any>(null);

	const [auctionPrice, setAuctionPrice] = useState<number | null>(null);

	// Estado para crear vehículo nuevo
	const [isNewVehicleOpen, setIsNewVehicleOpen] = useState(false);
	const [newVehicleForm, setNewVehicleForm] = useState({
		make: "",
		model: "",
		year: new Date().getFullYear(),
		color: "",
		vehicleType: "",
		// Campos opcionales
		licensePlate: "",
		vinNumber: "",
		origin: "",
		fuelType: "",
		transmission: "",
	});

	const createNewVehicleMutation = useMutation({
		mutationFn: (data: typeof newVehicleForm) =>
			client.createNewVehicle({
				make: data.make,
				model: data.model,
				year: data.year,
				color: data.color,
				vehicleType: data.vehicleType,
				licensePlate: data.licensePlate || undefined,
				vinNumber: data.vinNumber || undefined,
				origin: data.origin || undefined,
				fuelType: data.fuelType || undefined,
				transmission: data.transmission || undefined,
			}),
		onSuccess: () => {
			toast.success("Vehículo nuevo creado exitosamente");
			queryClient.invalidateQueries({ queryKey: ["getVehicles"] });
			queryClient.invalidateQueries({ queryKey: ["getVehicleStatistics"] });
			setIsNewVehicleOpen(false);
			setNewVehicleForm({
				make: "",
				model: "",
				year: new Date().getFullYear(),
				color: "",
				vehicleType: "",
				licensePlate: "",
				vinNumber: "",
				origin: "",
				fuelType: "",
				transmission: "",
			});
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al crear el vehículo");
		},
	});

	// Estado para editar vehículo
	const [isEditVehicleOpen, setIsEditVehicleOpen] = useState(false);
	const [editVehicleForm, setEditVehicleForm] = useState({
		id: "",
		make: "",
		model: "",
		year: new Date().getFullYear(),
		color: "",
		vehicleType: "",
		licensePlate: "",
		vinNumber: "",
		origin: "",
		fuelType: "",
		transmission: "",
		kmMileage: 0,
		isNew: false,
		// Campos para contratos legales
		seats: null as number | null,
		doors: null as number | null,
		axles: 2 as number | null,
		vehicleUse: "",
		series: "",
		iscvCode: "",
	});

	const updateVehicleMutation = useMutation({
		mutationFn: (data: typeof editVehicleForm) =>
			client.updateVehicle({
				id: data.id,
				data: {
					make: data.make,
					model: data.model,
					year: data.year,
					color: data.color,
					vehicleType: data.vehicleType,
					licensePlate: data.licensePlate || null,
					vinNumber: data.vinNumber || null,
					origin: data.origin || null,
					fuelType: data.fuelType || null,
					transmission: data.transmission || null,
					kmMileage: data.kmMileage,
					// Campos para contratos legales
					seats: data.seats,
					doors: data.doors,
					axles: data.axles,
					vehicleUse: data.vehicleUse || null,
					series: data.series || null,
					iscvCode: data.iscvCode || null,
				},
			}),
		onSuccess: () => {
			toast.success("Vehículo actualizado exitosamente");
			queryClient.invalidateQueries({ queryKey: ["getVehicles"] });
			queryClient.invalidateQueries({ queryKey: ["getVehicleStatistics"] });
			setIsEditVehicleOpen(false);
		},
		onError: (err: any) => {
			toast.error(err.message || "Error al actualizar el vehículo");
		},
	});

	if (isLoading) {
		return (
			<div className="flex flex-col gap-4 p-6">
				<Skeleton className="h-10 w-64" />
				<div className="grid grid-cols-1 gap-4 md:grid-cols-4">
					{[1, 2, 3, 4].map((i) => (
						<Card key={i}>
							<CardHeader className="pb-2">
								<Skeleton className="h-4 w-32" />
							</CardHeader>
							<CardContent>
								<Skeleton className="h-8 w-16" />
							</CardContent>
						</Card>
					))}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4 p-6">
			<div className="flex w-full items-center justify-between">
				<h1 className="font-bold text-4xl">Panel de Vehículos</h1>
				<Button onClick={() => setIsNewVehicleOpen(true)}>
					<Plus className="mr-2 h-4 w-4" />
					Nuevo Vehículo
				</Button>
			</div>

			{/* Stats Cards */}
			<div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Total de Vehículos
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl">
							{statistics?.totalVehicles || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Disponibles
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl text-green-500">
							{statistics?.availableVehicles || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Pendientes
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl text-yellow-500">
							{statistics?.pendingInspections || 0}
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="font-medium text-muted-foreground text-sm">
							Con Alertas
						</CardTitle>
					</CardHeader>
					<CardContent>
						<div className="font-bold text-2xl text-red-500">
							{statistics?.vehiclesWithAlerts || 0}
						</div>
					</CardContent>
				</Card>
			</div>

			<Tabs defaultValue="all" className="w-full">
				<TabsList className="mb-4">
					<TabsTrigger value="all">Todos</TabsTrigger>
					<TabsTrigger value="alerts">
						Con Alertas ({statistics?.vehiclesWithAlerts || 0})
					</TabsTrigger>
					<TabsTrigger value="commercial">
						Comerciales ({statistics?.commercialVehicles || 0})
					</TabsTrigger>
					<TabsTrigger value="non-commercial">
						No Comerciales ({statistics?.nonCommercialVehicles || 0})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="all" className="space-y-4">
					<Card>
						<CardHeader>
							<CardTitle>Listado de Vehículos</CardTitle>
							<CardDescription>
								Información sobre los vehículos inspeccionados
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="mb-4 flex justify-between">
								<div className="flex w-full gap-2 md:w-auto">
									<div className="relative">
										<Search className="absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
										<Input
											type="search"
											placeholder="Buscar vehículo..."
											className="w-full pl-8 md:w-[300px]"
											value={searchTerm}
											onChange={(e) => setSearchTerm(e.target.value)}
										/>
									</div>
									<Select value={filterStatus} onValueChange={setFilterStatus}>
										<SelectTrigger className="w-[180px]">
											<SelectValue placeholder="Filtrar por estado" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">Todos</SelectItem>
											<SelectItem value="pending">Pendientes</SelectItem>
											<SelectItem value="available">Disponibles</SelectItem>
											<SelectItem value="sold">Vendidos</SelectItem>
											<SelectItem value="maintenance">Mantenimiento</SelectItem>
											<SelectItem value="auction">Remate</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Vehículo</TableHead>
											<TableHead>Placa</TableHead>
											<TableHead>Valor Comercial</TableHead>
											<TableHead>Fecha</TableHead>
											<TableHead>Estado</TableHead>
											<TableHead>Alertas</TableHead>
											<TableHead className="text-right">Acciones</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{vehiclesList.length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="h-24 text-center">
													No se encontraron resultados.
												</TableCell>
											</TableRow>
										) : (
											vehiclesList.map((vehicle: any) => {
												const latestInspection = vehicle.inspections?.[0];
												return (
													<TableRow key={vehicle.id}>
														<TableCell>
															<div className="font-medium">
																{vehicle.make} {vehicle.model}
															</div>
															<div className="text-muted-foreground text-sm">
																{vehicle.year} - {vehicle.color}
															</div>
														</TableCell>
														<TableCell>
															{vehicle.licensePlate || (
																<span className="text-muted-foreground">
																	Sin placa
																</span>
															)}
														</TableCell>
														<TableCell>
															{latestInspection ? (
																<>
																	<div className="font-medium">
																		Q
																		{Number(
																			latestInspection.suggestedCommercialValue,
																		).toLocaleString("es-GT")}
																	</div>
																	<div
																		className={
																			latestInspection.vehicleRating ===
																			"Comercial"
																				? "text-green-500 text-sm"
																				: "text-red-500 text-sm"
																		}
																	>
																		{latestInspection.vehicleRating}
																	</div>
																</>
															) : (
																<span className="text-muted-foreground">
																	Sin inspección
																</span>
															)}
														</TableCell>
														<TableCell>
															{latestInspection
																? format(
																		new Date(latestInspection.inspectionDate),
																		"dd MMM yyyy",
																		{ locale: es },
																	)
																: "-"}
														</TableCell>
														<TableCell>
															<div className="flex flex-col gap-1">
																{renderNewVehicleBadges(vehicle)}
																{latestInspection
																	? renderInspectionStatusBadge(
																			latestInspection.status,
																		)
																	: !vehicle.isNew &&
																		renderInspectionStatusBadge("pending")}
																{(vehicle as any).hasPaymentAgreement && (
																	<Badge
																		variant="outline"
																		className="border-blue-300 bg-blue-100 text-blue-800 text-xs"
																	>
																		Convenio de Pago
																	</Badge>
																)}
															</div>
														</TableCell>
														<TableCell>
															{latestInspection?.alerts?.length > 0 ? (
																<Badge
																	variant="outline"
																	className="border-red-300 bg-red-100 text-red-800"
																>
																	{latestInspection.alerts.length}{" "}
																	{latestInspection.alerts.length === 1
																		? "alerta"
																		: "alertas"}
																</Badge>
															) : (
																<Badge
																	variant="outline"
																	className="border-green-300 bg-green-100 text-green-800"
																>
																	Sin alertas
																</Badge>
															)}
														</TableCell>
														<TableCell className="text-right">
															<DropdownMenu modal={false}>
																<DropdownMenuTrigger asChild>
																	<Button
																		variant="ghost"
																		className="h-8 w-8 p-0"
																	>
																		<span className="sr-only">Abrir menú</span>
																		<Eye className="h-4 w-4" />
																	</Button>
																</DropdownMenuTrigger>
																<DropdownMenuContent align="end">
																	<DropdownMenuLabel>
																		Acciones
																	</DropdownMenuLabel>
																	<DropdownMenuItem
																		onClick={() => {
																			setSelectedVehicle(vehicle);
																			setActiveTab("general");
																			setIsDetailsOpen(true);
																		}}
																	>
																		<Eye className="mr-2 h-4 w-4" />
																		Ver detalles completos
																	</DropdownMenuItem>
																	<DropdownMenuItem
																		onClick={() => {
																			setEditVehicleForm({
																				id: vehicle.id,
																				make: vehicle.make || "",
																				model: vehicle.model || "",
																				year:
																					vehicle.year ||
																					new Date().getFullYear(),
																				color: vehicle.color || "",
																				vehicleType: vehicle.vehicleType || "",
																				licensePlate:
																					vehicle.licensePlate || "",
																				vinNumber: vehicle.vinNumber || "",
																				origin: vehicle.origin || "",
																				fuelType: vehicle.fuelType || "",
																				transmission:
																					vehicle.transmission || "",
																				kmMileage: vehicle.kmMileage || 0,
																				isNew: vehicle.isNew || false,
																				// Campos para contratos legales
																				seats: vehicle.seats ?? null,
																				doors: vehicle.doors ?? null,
																				axles: vehicle.axles ?? 2,
																				vehicleUse: vehicle.vehicleUse || "",
																				series: vehicle.series || "",
																				iscvCode: vehicle.iscvCode || "",
																			});
																			setIsEditVehicleOpen(true);
																		}}
																	>
																		<Pencil className="mr-2 h-4 w-4" />
																		Editar vehículo
																	</DropdownMenuItem>
																	<DropdownMenuSeparator />
																	<DropdownMenuItem
																		onClick={() => {
																			setSelectedVehicle(vehicle);
																			setActiveTab("photos");
																			setIsDetailsOpen(true);
																		}}
																	>
																		<Camera className="mr-2 h-4 w-4" />
																		Ver fotografías
																	</DropdownMenuItem>
																	<DropdownMenuItem
																		onClick={() => {
																			setSelectedVehicle(vehicle);
																			setActiveTab("documents");
																			setIsDetailsOpen(true);
																		}}
																	>
																		<FolderOpen className="mr-2 h-4 w-4" />
																		Ver documentos
																	</DropdownMenuItem>
																	{latestInspection?.scannerUsed &&
																		latestInspection?.scannerResultUrl && (
																			<DropdownMenuItem
																				onClick={() => {
																					window.open(
																						latestInspection.scannerResultUrl,
																						"_blank",
																					);
																				}}
																			>
																				<FileText className="mr-2 h-4 w-4" />
																				Ver reporte de scanner
																			</DropdownMenuItem>
																		)}
																	<DropdownMenuSeparator />
																	<DropdownMenuItem
																		onClick={() => {
																			// Copy VIN to clipboard
																			navigator.clipboard.writeText(
																				vehicle.vinNumber,
																			);
																			toast.success(
																				"VIN copiado al portapapeles",
																			);
																		}}
																	>
																		<FileText className="mr-2 h-4 w-4" />
																		Copiar VIN
																	</DropdownMenuItem>
																	<DropdownMenuSeparator />
																	<DropdownMenuSeparator />
																	<DropdownMenuItem
																		onClick={() => {
																			setAuctionVehicle(vehicle);
																			setIsAuctionOpen(true);
																			setAuctionInspection(latestInspection);
																		}}
																	>
																		<Car className="mr-2 h-4 w-4" />
																		Rematar Carro
																	</DropdownMenuItem>
																</DropdownMenuContent>
															</DropdownMenu>
														</TableCell>
													</TableRow>
												);
											})
										)}
									</TableBody>
								</Table>
							</div>

							{/* Pagination Controls */}
							{totalPages > 1 && (
								<div className="flex items-center justify-between border-t px-4 py-3">
									<div className="text-muted-foreground text-sm">
										Mostrando {page * pageSize + 1} -{" "}
										{Math.min((page + 1) * pageSize, totalRecords)} de{" "}
										{totalRecords} vehículos
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => setPage((p) => Math.max(0, p - 1))}
											disabled={page === 0}
										>
											<ChevronLeft className="h-4 w-4" />
											Anterior
										</Button>
										<span className="text-sm">
											Página {page + 1} de {totalPages}
										</span>
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setPage((p) => Math.min(totalPages - 1, p + 1))
											}
											disabled={page >= totalPages - 1}
										>
											Siguiente
											<ChevronRight className="h-4 w-4" />
										</Button>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
			<Dialog open={isAuctionOpen} onOpenChange={setIsAuctionOpen}>
				<DialogContent className="max-h-[90vh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Rematar Vehículo</DialogTitle>
						<DialogDescription>
							Ingresa los detalles para rematar {auctionVehicle?.make}{" "}
							{auctionVehicle?.model} {auctionVehicle?.year}
						</DialogDescription>
					</DialogHeader>

					{auctionVehicle && (
						<>
							{/* Obtenemos la última inspección */}
							{(() => {
								const auctionInspection = auctionVehicle.inspections?.[0];
								return (
									auctionInspection && (
										<div className="mb-4 space-y-1 rounded-md bg-muted/40 p-3">
											<p className="text-sm">
												<span className="font-medium">Valor Comercial: </span>Q
												{Number(
													auctionInspection.suggestedCommercialValue,
												).toLocaleString("es-GT")}
											</p>
											{auctionPrice !== null && auctionPrice > 0 && (
												<p
													className={`font-medium text-sm ${
														Number(auctionInspection.suggestedCommercialValue) -
															auctionPrice >
														0
															? "text-red-600"
															: "text-green-600"
													}`}
												>
													Pérdida estimada: Q
													{Math.max(
														Number(auctionInspection.suggestedCommercialValue) -
															auctionPrice,
														0,
													).toLocaleString("es-GT")}
												</p>
											)}
										</div>
									)
								);
							})()}
						</>
					)}

					<form
						onSubmit={(e) => {
							e.preventDefault();
							const formData = new FormData(e.currentTarget);
							const description = formData.get("description") as string;

							createAuctionMutation.mutate(
								{
									vehicleId: auctionVehicle.id,
									description,
									auctionPrice: auctionPrice?.toString() ?? "0",
								},
								{
									onSuccess: () => {
										toast.success("Vehículo rematado con éxito 🚗🔥");
										setIsAuctionOpen(false);
										setAuctionPrice(null);
									},
									onError: (err: any) => {
										toast.error(err.message || "Error al rematar el carro");
									},
								},
							);
						}}
						className="space-y-6"
					>
						<div className="space-y-2">
							<Label htmlFor="description">Motivo del Remate</Label>
							<Textarea id="description" name="description" required />
						</div>

						<div className="space-y-2">
							<Label htmlFor="auctionPrice">Precio Final de Remate</Label>
							<Input
								id="auctionPrice"
								name="auctionPrice"
								type="number"
								step="0.01"
								value={auctionPrice ?? ""}
								onChange={(e) => setAuctionPrice(Number(e.target.value))}
								required
							/>
						</div>

						<DialogFooter className="pt-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsAuctionOpen(false)}
							>
								Cancelar
							</Button>
							<Button type="submit" disabled={createAuctionMutation.isPending}>
								{createAuctionMutation.isPending
									? "Procesando..."
									: "Confirmar Remate"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Vehicle Details Dialog */}
			<Dialog
				open={isDetailsOpen}
				onOpenChange={(open) => {
					setIsDetailsOpen(open);
					if (!open) {
						setActiveTab("general");
						setSelectedVehicle(null); // Limpiar vehículo seleccionado
					}
				}}
			>
				<DialogContent className="max-h-[90vh] min-w-[90vw] max-w-7xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalles del Vehículo</DialogTitle>
						<DialogDescription>
							Información completa del vehículo {selectedVehicle?.make}{" "}
							{selectedVehicle?.model} {selectedVehicle?.year}
						</DialogDescription>
					</DialogHeader>

					{selectedVehicle && (
						<Tabs
							value={activeTab}
							onValueChange={setActiveTab}
							className="w-full"
						>
							<TabsList className="grid w-full grid-cols-4">
								<TabsTrigger value="general">Información General</TabsTrigger>
								<TabsTrigger value="inspections">Inspecciones</TabsTrigger>
								<TabsTrigger value="photos">Fotografías</TabsTrigger>
								<TabsTrigger value="documents">
									<FolderOpen className="mr-2 h-4 w-4" />
									Documentos
								</TabsTrigger>
							</TabsList>

							<TabsContent value="general" className="mt-4 space-y-4">
								<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
									<Card>
										<CardHeader>
											<CardTitle className="text-lg">
												Datos del Vehículo
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="grid grid-cols-2 gap-3">
												<div className="font-medium text-sm">Marca:</div>
												<div className="text-sm">{selectedVehicle.make}</div>
												<div className="font-medium text-sm">Modelo:</div>
												<div className="text-sm">{selectedVehicle.model}</div>
												<div className="font-medium text-sm">Año:</div>
												<div className="text-sm">{selectedVehicle.year}</div>
												<div className="font-medium text-sm">Placa:</div>
												<div className="text-sm">
													{selectedVehicle.licensePlate}
												</div>
												<div className="font-medium text-sm">VIN:</div>
												<div className="text-sm">
													{selectedVehicle.vinNumber}
												</div>
												<div className="font-medium text-sm">Color:</div>
												<div className="text-sm">{selectedVehicle.color}</div>
												<div className="font-medium text-sm">Tipo:</div>
												<div className="text-sm">
													{selectedVehicle.vehicleType}
												</div>
											</div>
										</CardContent>
									</Card>

									<Card>
										<CardHeader>
											<CardTitle className="text-lg">
												Especificaciones Técnicas
											</CardTitle>
										</CardHeader>
										<CardContent>
											<div className="grid grid-cols-2 gap-3">
												<div className="font-medium text-sm">Kilometraje:</div>
												<div className="text-sm">
													{selectedVehicle.kmMileage?.toLocaleString()} km
												</div>
												{selectedVehicle.milesMileage && (
													<>
														<div className="font-medium text-sm">Millaje:</div>
														<div className="text-sm">
															{selectedVehicle.milesMileage?.toLocaleString()}{" "}
															mi
														</div>
													</>
												)}
												<div className="font-medium text-sm">Origen:</div>
												<div className="text-sm">{selectedVehicle.origin}</div>
												<div className="font-medium text-sm">Cilindros:</div>
												<div className="text-sm">
													{selectedVehicle.cylinders}
												</div>
												<div className="font-medium text-sm">Motor (CC):</div>
												<div className="text-sm">
													{selectedVehicle.engineCC}
												</div>
												<div className="font-medium text-sm">Combustible:</div>
												<div className="text-sm">
													{selectedVehicle.fuelType}
												</div>
												<div className="font-medium text-sm">Transmisión:</div>
												<div className="text-sm">
													{selectedVehicle.transmission}
												</div>
											</div>
										</CardContent>
									</Card>
								</div>
							</TabsContent>

							<TabsContent value="inspections" className="mt-4 space-y-4">
								{selectedVehicle.inspections &&
								selectedVehicle.inspections.length > 0 ? (
									<div className="space-y-4">
										{selectedVehicle.inspections.map(
											(inspection: any, index: number) => {
												return (
													<Card key={inspection.id || index}>
														<CardHeader>
															<div className="flex items-center justify-between">
																<CardTitle className="text-lg">
																	Inspección #{index + 1}
																</CardTitle>
																<Badge
																	variant={
																		inspection.status === "approved"
																			? "default"
																			: inspection.status === "rejected"
																				? "destructive"
																				: "secondary"
																	}
																>
																	{inspection.status === "approved"
																		? "Aprobada"
																		: inspection.status === "rejected"
																			? "Rechazada"
																			: "Pendiente"}
																</Badge>
															</div>
															<CardDescription>
																Realizada por {inspection.technicianName} el{" "}
																{inspection.inspectionDate
																	? format(
																			new Date(inspection.inspectionDate),
																			"PPP",
																			{ locale: es },
																		)
																	: "N/A"}
															</CardDescription>
														</CardHeader>
														<CardContent>
															<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
																<div className="space-y-4">
																	<div>
																		<h4 className="mb-2 font-semibold">
																			Valoración
																		</h4>
																		<div className="grid grid-cols-2 gap-2 text-sm">
																			<div className="font-medium">
																				Calificación:
																			</div>
																			<div
																				className={
																					inspection.vehicleRating ===
																					"Comercial"
																						? "font-semibold text-green-600"
																						: "font-semibold text-red-600"
																				}
																			>
																				{inspection.vehicleRating}
																			</div>
																			<div className="font-medium">
																				Valor de mercado:
																			</div>
																			<div>
																				Q
																				{Number(
																					inspection.marketValue,
																				).toLocaleString("es-GT")}
																			</div>
																			<div className="font-medium">
																				Valor comercial:
																			</div>
																			<div>
																				Q
																				{Number(
																					inspection.suggestedCommercialValue,
																				).toLocaleString("es-GT")}
																			</div>
																			<div className="font-medium">
																				Valor bancario:
																			</div>
																			<div>
																				Q
																				{Number(
																					inspection.bankValue,
																				).toLocaleString("es-GT")}
																			</div>
																			<div className="font-medium">
																				Valor actual:
																			</div>
																			<div>
																				Q
																				{Number(
																					inspection.currentConditionValue,
																				).toLocaleString("es-GT")}
																			</div>
																		</div>
																	</div>

																	<div>
																		<h4 className="mb-2 font-semibold">
																			Diagnóstico
																		</h4>
																		<div className="grid grid-cols-2 gap-2 text-sm">
																			<div className="font-medium">
																				Escáner usado:
																			</div>
																			<div>
																				{inspection.scannerUsed ? "Sí" : "No"}
																			</div>
																			<div className="font-medium">
																				Testigo airbag:
																			</div>
																			<div>
																				{inspection.airbagWarning ? "Sí" : "No"}
																			</div>
																			{inspection.missingAirbag && (
																				<>
																					<div className="font-medium">
																						Airbag faltante:
																					</div>
																					<div>{inspection.missingAirbag}</div>
																				</>
																			)}
																			<div className="font-medium">
																				Prueba de manejo:
																			</div>
																			<div>
																				{inspection.testDrive ? "Sí" : "No"}
																			</div>
																			{inspection.noTestDriveReason && (
																				<>
																					<div className="font-medium">
																						Razón sin prueba:
																					</div>
																					<div>
																						{inspection.noTestDriveReason}
																					</div>
																				</>
																			)}
																		</div>
																	</div>
																</div>

																<div className="space-y-4">
																	<div>
																		<h4 className="mb-2 font-semibold">
																			Equipamiento
																		</h4>
																		<p className="text-muted-foreground text-sm">
																			{inspection.vehicleEquipment ||
																				"No especificado"}
																		</p>
																	</div>

																	<div>
																		<h4 className="mb-2 font-semibold">
																			Consideraciones Importantes
																		</h4>
																		<p className="text-muted-foreground text-sm">
																			{inspection.importantConsiderations ||
																				"Sin observaciones adicionales"}
																		</p>
																	</div>

																	<div>
																		<h4 className="mb-2 font-semibold">
																			Resultado de Inspección
																		</h4>
																		<p className="rounded-md bg-muted/50 p-3 text-sm">
																			{inspection.inspectionResult}
																		</p>
																	</div>

																	{inspection.alerts &&
																		inspection.alerts.length > 0 && (
																			<div>
																				<h4 className="mb-2 font-semibold text-red-600">
																					Alertas
																				</h4>
																				<div className="space-y-1">
																					{inspection.alerts.map(
																						(alert: string, idx: number) => (
																							<Badge
																								key={idx}
																								variant="destructive"
																								className="mr-2"
																							>
																								{alert}
																							</Badge>
																						),
																					)}
																				</div>
																			</div>
																		)}
																</div>
															</div>

															{/* Checklist Section */}
															{inspection.checklistItems &&
																inspection.checklistItems.length > 0 && (
																	<div className="mt-6 border-t pt-6">
																		<h4 className="mb-4 font-semibold">
																			Evaluación de Criterios
																		</h4>
																		<div className="space-y-4">
																			{/* Group checklist items by category */}
																			{Object.entries(
																				inspection.checklistItems.reduce(
																					(acc: any, item: any) => {
																						if (!acc[item.category]) {
																							acc[item.category] = [];
																						}
																						acc[item.category].push(item);
																						return acc;
																					},
																					{},
																				),
																			).map(
																				([category, items]: [string, any]) => (
																					<div
																						key={category}
																						className="space-y-2"
																					>
																						<h5 className="font-medium text-muted-foreground text-sm capitalize">
																							{category.replace(/_/g, " ")}
																						</h5>
																						<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
																							{items.map(
																								(item: any, idx: number) => (
																									<div
																										key={idx}
																										className="flex items-center justify-between rounded-md border bg-muted/20 p-2"
																									>
																										<span className="text-sm">
																											{item.item}
																										</span>
																										<Badge
																											variant={
																												item.checked
																													? "default"
																													: !item.checked &&
																															item.severity ===
																																"critical"
																														? "destructive"
																														: "secondary"
																											}
																											className="text-xs"
																										>
																											{item.checked
																												? "✓ Cumple"
																												: "✗ No cumple"}
																										</Badge>
																									</div>
																								),
																							)}
																						</div>
																					</div>
																				),
																			)}

																			{/* Summary of critical issues */}
																			{inspection.checklistItems.some(
																				(item: any) =>
																					!item.checked &&
																					item.severity === "critical",
																			) && (
																				<div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
																					<h5 className="mb-2 font-semibold text-red-900 text-sm">
																						Criterios Críticos de Rechazo
																					</h5>
																					<ul className="space-y-1 text-red-700 text-sm">
																						{inspection.checklistItems
																							.filter(
																								(item: any) =>
																									!item.checked &&
																									item.severity === "critical",
																							)
																							.map((item: any, idx: number) => (
																								<li
																									key={idx}
																									className="flex items-start"
																								>
																									<span className="mr-2">
																										•
																									</span>
																									<span>{item.item}</span>
																								</li>
																							))}
																					</ul>
																				</div>
																			)}
																		</div>
																	</div>
																)}
														</CardContent>
													</Card>
												);
											},
										)}
									</div>
								) : (
									<Card>
										<CardContent className="py-8 text-center">
											<p className="text-muted-foreground">
												No hay inspecciones registradas para este vehículo
											</p>
										</CardContent>
									</Card>
								)}
							</TabsContent>

							<TabsContent value="photos" className="mt-4 space-y-4">
								{selectedVehicle.photos && selectedVehicle.photos.length > 0 ? (
									<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
										{selectedVehicle.photos.map((photo: any, index: number) => (
											<Card key={photo.id || index}>
												<CardContent className="p-2">
													<img
														src={photo.url || "/placeholder.svg"}
														alt={photo.title || `Foto ${index + 1}`}
														className="h-40 w-full rounded-md object-cover"
													/>
													<p className="mt-2 font-medium text-sm">
														{photo.title}
													</p>
													<p className="text-muted-foreground text-xs">
														{photo.category}
													</p>
												</CardContent>
											</Card>
										))}
									</div>
								) : (
									<Card>
										<CardContent className="py-8 text-center">
											<Camera className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
											<p className="text-muted-foreground">
												No hay fotografías disponibles
											</p>
										</CardContent>
									</Card>
								)}
							</TabsContent>

							<TabsContent value="documents" className="mt-4 space-y-4">
								<Card>
									<CardHeader>
										<CardTitle className="text-lg">
											Documentos del Vehículo
										</CardTitle>
										<CardDescription>
											Gestiona los documentos legales asociados al vehículo
										</CardDescription>
									</CardHeader>
									<CardContent>
										<VehicleDocumentUpload
											vehicleId={selectedVehicle.id}
											ownerType="individual"
										/>
									</CardContent>
								</Card>
							</TabsContent>
						</Tabs>
					)}

					<DialogFooter>
						<Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
							Cerrar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Dialog para crear vehículo nuevo */}
			<Dialog open={isNewVehicleOpen} onOpenChange={setIsNewVehicleOpen}>
				<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Sparkles className="h-5 w-5 text-blue-500" />
							Registrar Vehículo Nuevo
						</DialogTitle>
						<DialogDescription>
							Ingresa los datos básicos del vehículo nuevo. Los datos
							adicionales (VIN, placa, etc.) pueden completarse después cuando
							lleguen del dealer.
						</DialogDescription>
					</DialogHeader>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (
								!newVehicleForm.make ||
								!newVehicleForm.model ||
								!newVehicleForm.color ||
								!newVehicleForm.vehicleType
							) {
								toast.error("Por favor completa todos los campos requeridos");
								return;
							}
							createNewVehicleMutation.mutate(newVehicleForm);
						}}
						className="space-y-6"
					>
						{/* Campos Requeridos */}
						<div className="space-y-4">
							<h4 className="font-medium text-sm">
								Información Básica (Requerida)
							</h4>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="make">Marca *</Label>
									<Input
										id="make"
										value={newVehicleForm.make}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												make: e.target.value,
											})
										}
										placeholder="Ej: Toyota"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="model">Modelo/Línea *</Label>
									<Input
										id="model"
										value={newVehicleForm.model}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												model: e.target.value,
											})
										}
										placeholder="Ej: Corolla"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="year">Año *</Label>
									<Input
										id="year"
										type="number"
										value={newVehicleForm.year}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												year:
													Number.parseInt(e.target.value) ||
													new Date().getFullYear(),
											})
										}
										min={2000}
										max={new Date().getFullYear() + 1}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="color">Color *</Label>
									<Input
										id="color"
										value={newVehicleForm.color}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												color: e.target.value,
											})
										}
										placeholder="Ej: Blanco"
										required
									/>
								</div>
								<div className="col-span-2 space-y-2">
									<Label htmlFor="vehicleType">Tipo de Vehículo *</Label>
									<Select
										value={newVehicleForm.vehicleType}
										onValueChange={(value) =>
											setNewVehicleForm({
												...newVehicleForm,
												vehicleType: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar tipo" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Sedan">Sedan</SelectItem>
											<SelectItem value="Hatchback">Hatchback</SelectItem>
											<SelectItem value="SUV">SUV</SelectItem>
											<SelectItem value="Pickup">Pickup</SelectItem>
											<SelectItem value="Minivan">Minivan</SelectItem>
											<SelectItem value="Deportivo">Deportivo</SelectItem>
											<SelectItem value="Otro">Otro</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>

						{/* Campos Opcionales */}
						<div className="space-y-4">
							<h4 className="font-medium text-muted-foreground text-sm">
								Información Adicional (Opcional - puede completarse después)
							</h4>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="licensePlate">Placa</Label>
									<Input
										id="licensePlate"
										value={newVehicleForm.licensePlate}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												licensePlate: e.target.value,
											})
										}
										placeholder="Ej: P-123ABC"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="vinNumber">VIN</Label>
									<Input
										id="vinNumber"
										value={newVehicleForm.vinNumber}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												vinNumber: e.target.value,
											})
										}
										placeholder="Número de identificación"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="origin">Origen</Label>
									<Select
										value={newVehicleForm.origin}
										onValueChange={(value) =>
											setNewVehicleForm({ ...newVehicleForm, origin: value })
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar origen" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Nacional">Nacional</SelectItem>
											<SelectItem value="Importado">Importado</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="fuelType">Tipo de Combustible</Label>
									<Select
										value={newVehicleForm.fuelType}
										onValueChange={(value) =>
											setNewVehicleForm({ ...newVehicleForm, fuelType: value })
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar combustible" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Gasolina">Gasolina</SelectItem>
											<SelectItem value="Diesel">Diesel</SelectItem>
											<SelectItem value="Eléctrico">Eléctrico</SelectItem>
											<SelectItem value="Híbrido">Híbrido</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="col-span-2 space-y-2">
									<Label htmlFor="transmission">Transmisión</Label>
									<Select
										value={newVehicleForm.transmission}
										onValueChange={(value) =>
											setNewVehicleForm({
												...newVehicleForm,
												transmission: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar transmisión" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Automático">Automático</SelectItem>
											<SelectItem value="Manual">Manual</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsNewVehicleOpen(false)}
							>
								Cancelar
							</Button>
							<Button
								type="submit"
								disabled={createNewVehicleMutation.isPending}
							>
								{createNewVehicleMutation.isPending
									? "Creando..."
									: "Crear Vehículo"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			{/* Dialog para editar vehículo */}
			<Dialog open={isEditVehicleOpen} onOpenChange={setIsEditVehicleOpen}>
				<DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Pencil className="h-5 w-5 text-blue-500" />
							Editar Vehículo
							{editVehicleForm.isNew && (
								<Badge
									variant="outline"
									className="ml-2 border-blue-300 bg-blue-100 text-blue-800"
								>
									<Sparkles className="mr-1 h-3 w-3" />
									Nuevo
								</Badge>
							)}
						</DialogTitle>
						<DialogDescription>
							Modifica los datos del vehículo.{" "}
							{editVehicleForm.isNew &&
								"Completa los datos faltantes del vehículo nuevo."}
						</DialogDescription>
					</DialogHeader>

					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (
								!editVehicleForm.make ||
								!editVehicleForm.model ||
								!editVehicleForm.color ||
								!editVehicleForm.vehicleType
							) {
								toast.error("Por favor completa todos los campos requeridos");
								return;
							}
							updateVehicleMutation.mutate(editVehicleForm);
						}}
						className="space-y-6"
					>
						{/* Campos Principales */}
						<div className="space-y-4">
							<h4 className="font-medium text-sm">Información Básica</h4>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="edit-make">Marca *</Label>
									<Input
										id="edit-make"
										value={editVehicleForm.make}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												make: e.target.value,
											})
										}
										placeholder="Ej: Toyota"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-model">Modelo/Línea *</Label>
									<Input
										id="edit-model"
										value={editVehicleForm.model}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												model: e.target.value,
											})
										}
										placeholder="Ej: Corolla"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-year">Año *</Label>
									<Input
										id="edit-year"
										type="number"
										value={editVehicleForm.year}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												year:
													Number.parseInt(e.target.value) ||
													new Date().getFullYear(),
											})
										}
										min={1990}
										max={new Date().getFullYear() + 1}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-color">Color *</Label>
									<Input
										id="edit-color"
										value={editVehicleForm.color}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												color: e.target.value,
											})
										}
										placeholder="Ej: Blanco"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-vehicleType">Tipo de Vehículo *</Label>
									<Select
										value={editVehicleForm.vehicleType}
										onValueChange={(value) =>
											setEditVehicleForm({
												...editVehicleForm,
												vehicleType: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar tipo" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Sedan">Sedan</SelectItem>
											<SelectItem value="Hatchback">Hatchback</SelectItem>
											<SelectItem value="SUV">SUV</SelectItem>
											<SelectItem value="Pickup">Pickup</SelectItem>
											<SelectItem value="Minivan">Minivan</SelectItem>
											<SelectItem value="Deportivo">Deportivo</SelectItem>
											<SelectItem value="Otro">Otro</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-kmMileage">Kilometraje</Label>
									<Input
										id="edit-kmMileage"
										type="number"
										value={editVehicleForm.kmMileage}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												kmMileage: Number.parseInt(e.target.value) || 0,
											})
										}
										min={0}
										placeholder="0"
									/>
								</div>
							</div>
						</div>

						{/* Campos de Identificación */}
						<div className="space-y-4">
							<h4 className="font-medium text-sm">
								Identificación del Vehículo
								{editVehicleForm.isNew && (
									<span className="ml-2 font-normal text-amber-600 text-xs">
										(requeridos para completar la oportunidad)
									</span>
								)}
							</h4>
							<div className="grid grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="edit-licensePlate">Placa</Label>
									<Input
										id="edit-licensePlate"
										value={editVehicleForm.licensePlate}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												licensePlate: e.target.value,
											})
										}
										placeholder="Ej: P-123ABC"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-vinNumber">VIN</Label>
									<Input
										id="edit-vinNumber"
										value={editVehicleForm.vinNumber}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												vinNumber: e.target.value,
											})
										}
										placeholder="Número de identificación"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-origin">Origen</Label>
									<Select
										value={editVehicleForm.origin}
										onValueChange={(value) =>
											setEditVehicleForm({ ...editVehicleForm, origin: value })
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar origen" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Nacional">Nacional</SelectItem>
											<SelectItem value="Importado">Importado</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-fuelType">Tipo de Combustible</Label>
									<Select
										value={editVehicleForm.fuelType}
										onValueChange={(value) =>
											setEditVehicleForm({
												...editVehicleForm,
												fuelType: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar combustible" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Gasolina">Gasolina</SelectItem>
											<SelectItem value="Diesel">Diesel</SelectItem>
											<SelectItem value="Eléctrico">Eléctrico</SelectItem>
											<SelectItem value="Híbrido">Híbrido</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="col-span-2 space-y-2">
									<Label htmlFor="edit-transmission">Transmisión</Label>
									<Select
										value={editVehicleForm.transmission}
										onValueChange={(value) =>
											setEditVehicleForm({
												...editVehicleForm,
												transmission: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar transmisión" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Automático">Automático</SelectItem>
											<SelectItem value="Manual">Manual</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>

						{/* Campos para Contratos Legales */}
						<div className="space-y-4">
							<h4 className="font-medium text-sm">
								Datos Técnicos para Contratos
								<span className="ml-2 font-normal text-muted-foreground text-xs">
									(requeridos para generar contratos legales)
								</span>
							</h4>
							<div className="grid grid-cols-3 gap-4">
								<div className="space-y-2">
									<Label htmlFor="edit-seats">Asientos</Label>
									<Input
										id="edit-seats"
										type="number"
										value={editVehicleForm.seats ?? ""}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												seats: e.target.value
													? Number.parseInt(e.target.value)
													: null,
											})
										}
										min={1}
										max={50}
										placeholder="Ej: 5"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-doors">Puertas</Label>
									<Input
										id="edit-doors"
										type="number"
										value={editVehicleForm.doors ?? ""}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												doors: e.target.value
													? Number.parseInt(e.target.value)
													: null,
											})
										}
										min={2}
										max={6}
										placeholder="Ej: 4"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-axles">Ejes</Label>
									<Input
										id="edit-axles"
										type="number"
										value={editVehicleForm.axles ?? ""}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												axles: e.target.value
													? Number.parseInt(e.target.value)
													: null,
											})
										}
										min={2}
										max={10}
										placeholder="Ej: 2"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-vehicleUse">Uso del Vehículo</Label>
									<Select
										value={editVehicleForm.vehicleUse}
										onValueChange={(value) =>
											setEditVehicleForm({
												...editVehicleForm,
												vehicleUse: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar uso" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="Particular">Particular</SelectItem>
											<SelectItem value="Comercial">Comercial</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-series">Serie</Label>
									<Input
										id="edit-series"
										value={editVehicleForm.series}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												series: e.target.value,
											})
										}
										placeholder="Serie del vehículo"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-iscvCode">Código ISCV</Label>
									<Input
										id="edit-iscvCode"
										value={editVehicleForm.iscvCode}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												iscvCode: e.target.value,
											})
										}
										placeholder="Código ISCV"
									/>
								</div>
							</div>
						</div>

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsEditVehicleOpen(false)}
							>
								Cancelar
							</Button>
							<Button type="submit" disabled={updateVehicleMutation.isPending}>
								{updateVehicleMutation.isPending
									? "Guardando..."
									: "Guardar Cambios"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
