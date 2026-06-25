import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
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
	Info,
	MessageCircle,
	Pencil,
	Plus,
	Search,
	Sparkles,
	Wrench,
	X,
	XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Progress } from "@/components/ui/progress";
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
import { Inspection360View } from "@/components/vehicles/inspection-360-view";
import { VehicleDocumentUpload } from "@/components/vehicles/VehicleDocumentUpload";
import { ROLES } from "@/lib/roles";
import {
	isValidVehicleConditionOrigin,
	VEHICLE_BODY_TYPE_OPTIONS,
	VEHICLE_CONDITION_OPTIONS,
	VEHICLE_PROVENANCE_OPTIONS,
	VEHICLE_USE_OPTIONS,
} from "@/lib/vehicle-form-options";
import {
	renderInspectionStatusBadge,
	renderNewVehicleBadges,
} from "@/lib/vehicle-utils";
import { usePersistedState } from "@/hooks/usePersistedState";
import { client, orpc } from "@/utils/orpc";

// Helper para renderizar el badge del estado del vehículo
const renderVehicleStatusBadge = (status: string) => {
	const statusConfig: Record<string, { label: string; className: string }> = {
		pending: {
			label: "Pendiente",
			className: "border-yellow-300 bg-yellow-100 text-yellow-800",
		},
		available: {
			label: "Disponible",
			className: "border-green-300 bg-green-100 text-green-800",
		},
		sold: {
			label: "Vendido",
			className: "border-purple-300 bg-purple-100 text-purple-800",
		},
		maintenance: {
			label: "Mantenimiento",
			className: "border-orange-300 bg-orange-100 text-orange-800",
		},
		auction: {
			label: "En Remate",
			className: "border-red-300 bg-red-100 text-red-800",
		},
	};

	const config = statusConfig[status] || statusConfig.pending;
	return (
		<Badge variant="outline" className={config.className}>
			{config.label}
		</Badge>
	);
};

export const Route = createFileRoute("/vehicles/")({
	component: VehiclesDashboard,
	validateSearch: (search: Record<string, unknown>) => {
		return {
			vehicleId: search.vehicleId as string | undefined,
			inspectionId: search.inspectionId as string | undefined,
			tab: search.tab as string | undefined,
		};
	},
});

// Nota: renderInspectionStatusBadge ahora se importa desde @/lib/vehicle-utils

function VehiclesDashboard() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const search = useSearch({ from: "/vehicles/" });
	const [searchTerm, setSearchTerm] = usePersistedState<string>("vehicles/searchTerm", "");
	const [debouncedSearch, setDebouncedSearch] = useState(searchTerm);
	const [filterStatus, setFilterStatus] = usePersistedState<string>("vehicles/filterStatus", "all");
	const [filterOwnership, setFilterOwnership] = usePersistedState<string>("vehicles/filterOwnership", "all");
	const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
	const [isDetailsOpen, setIsDetailsOpen] = useState(false);
	const [activeTab, setActiveTab] = usePersistedState<string>("vehicles/activeTab", "general");
	const [page, setPage] = usePersistedState<number>("vehicles/page", 0);
	const pageSize = 20;

	// Refs to track processed URL params
	const processedVehicleIdRef = useRef<string | null>(null);
	const processedInspectionIdRef = useRef<string | null>(null);
	const prevDetailsOpenRef = useRef(false);
	const isTransitioningToEditRef = useRef(false);

	// Debounce search
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchTerm);
			setPage(0);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchTerm]);

	// Fetch vehicles with pagination
	const {
		data: vehicles,
		isLoading,
		isFetching,
	} = useQuery({
		...orpc.getVehicles.queryOptions({
			input: {
				limit: pageSize,
				offset: page * pageSize,
				query: debouncedSearch || undefined,
				status: filterStatus !== "all" ? filterStatus : undefined,
				ownership: filterOwnership !== "all" ? (filterOwnership as "owned" | "not_owned") : undefined,
			},
		}),
		queryKey: ["getVehicles", page, pageSize, debouncedSearch, filterStatus, filterOwnership],
		placeholderData: keepPreviousData,
	});
	const { data: statistics } = useQuery(
		orpc.getVehicleStatistics.queryOptions(),
	);
	const { data: userProfile } = useQuery(orpc.getUserProfile.queryOptions());

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
		enabled: !!search.vehicleId,
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
			setActiveTab(search.tab || "general");
			setIsDetailsOpen(true);
			processedVehicleIdRef.current = search.vehicleId;
		}
	}, [search.vehicleId, specificVehicleQuery.data, search.tab]);

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

	// Clear search params when details modal closes (unless transitioning to edit)
	useEffect(() => {
		const wasOpen = prevDetailsOpenRef.current;
		prevDetailsOpenRef.current = isDetailsOpen;

		if (wasOpen && !isDetailsOpen) {
			// Skip cleanup if transitioning to edit modal
			if (isTransitioningToEditRef.current) {
				isTransitioningToEditRef.current = false;
				return;
			}
			if (processedVehicleIdRef.current || processedInspectionIdRef.current) {
				processedVehicleIdRef.current = null;
				processedInspectionIdRef.current = null;
				navigate({
					to: "/vehicles",
					search: {
						vehicleId: undefined,
						inspectionId: undefined,
						tab: undefined,
					},
					replace: true,
				});
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
		motorNumber: "",
		origin: "",
		fuelType: "",
		transmission: "",
		kmMileage: 0,
		isNew: false,
		isOwned: false,
		// Datos técnicos para contratos
		seats: null as number | null,
		doors: null as number | null,
		axles: 2 as number | null,
		vehicleUse: "",
		series: "",
		iscvCode: "",
	});

	// Evidence modal state
	const [selectedEvidence, setSelectedEvidence] = useState<any[]>([]);
	const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
	const [evidenceItemName, setEvidenceItemName] = useState("");
	const [photoCategoryFilter, setPhotoCategoryFilter] = usePersistedState<string>("vehicles/photoCategoryFilter", "all");

	const hasActiveFilters = searchTerm !== "" || filterStatus !== "all" || filterOwnership !== "all" || photoCategoryFilter !== "all";
	const resetFilters = () => {
		setSearchTerm("");
		setFilterStatus("all");
		setFilterOwnership("all");
		setPhotoCategoryFilter("all");
		setPage(0);
	};
	const [selectedPhoto, setSelectedPhoto] = useState<{
		id: string;
		url: string;
		title: string;
		category: string;
		valuatorComment?: string | null;
		noCommentsChecked?: boolean;
	} | null>(null);

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
				motorNumber: data.motorNumber || undefined,
				origin: data.origin || undefined,
				fuelType: data.fuelType || undefined,
				transmission: data.transmission || undefined,
				kmMileage: data.kmMileage ?? undefined,
				vehicleIsNew: data.isNew,
				isOwned: data.isOwned,
				seats: data.seats ?? undefined,
				doors: data.doors ?? undefined,
				axles: data.axles ?? undefined,
				vehicleUse: data.vehicleUse || undefined,
				series: data.series || undefined,
				iscvCode: data.iscvCode || undefined,
			}),
		onSuccess: () => {
			toast.success("Vehículo creado exitosamente");
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
				motorNumber: "",
				origin: "",
				fuelType: "",
				transmission: "",
				kmMileage: 0,
				isNew: false,
				isOwned: false,
				seats: null,
				doors: null,
				axles: 2,
				vehicleUse: "",
				series: "",
				iscvCode: "",
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
		motorNumber: "",
		origin: "",
		fuelType: "",
		transmission: "",
		kmMileage: 0,
		isNew: false,
		isOwned: false,
		status: "pending" as
			| "pending"
			| "available"
			| "sold"
			| "maintenance"
			| "auction",
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
					motorNumber: data.motorNumber || null,
					origin: data.origin || null,
					fuelType: data.fuelType || null,
					transmission: data.transmission || null,
					kmMileage: data.kmMileage,
					isNew: data.isNew,
					isOwned: data.isOwned,
					status: data.status,
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

	if (isLoading && !vehicles) {
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
					Registrar Vehículo
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
									<Select
										value={filterStatus}
										onValueChange={(value) => {
											setFilterStatus(value);
											setPage(0);
										}}
									>
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
									<div className="flex items-center rounded-md border">
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className={`rounded-none rounded-l-md px-3 text-xs ${filterOwnership === "all" ? "bg-muted font-semibold" : ""}`}
											onClick={() => { setFilterOwnership("all"); setPage(0); }}
										>
											Todos
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className={`rounded-none border-x px-3 text-xs ${filterOwnership === "owned" ? "font-semibold" : ""}`}
											style={filterOwnership === "owned" ? { backgroundColor: "#4E57EA15", color: "#4E57EA" } : {}}
											onClick={() => { setFilterOwnership("owned"); setPage(0); }}
										>
											Cash In
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className={`rounded-none rounded-r-md px-3 text-xs ${filterOwnership === "not_owned" ? "bg-muted font-semibold" : ""}`}
											onClick={() => { setFilterOwnership("not_owned"); setPage(0); }}
										>
											Externos
										</Button>
									</div>
									{hasActiveFilters && (
										<Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0 text-muted-foreground">
											<X className="mr-1 h-3 w-3" />
											Limpiar filtros
											<Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
												{[searchTerm !== "", filterStatus !== "all", filterOwnership !== "all", photoCategoryFilter !== "all"].filter(Boolean).length}
											</Badge>
										</Button>
									)}
								</div>
							</div>

							<div
								className={`rounded-md border transition-opacity ${isFetching ? "opacity-50" : ""}`}
							>
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
															<div className="flex items-center gap-2 font-medium">
																{vehicle.make} {vehicle.model}
																{vehicle.isOwned && (
																	<Badge variant="outline" className="text-xs" style={{ borderColor: "#4E57EA50", backgroundColor: "#4E57EA15", color: "#4E57EA" }}>
																		CashIn
																	</Badge>
																)}
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
																		).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
																{renderVehicleStatusBadge(
																	vehicle.status || "pending",
																)}
																{latestInspection && (
																	<span className="text-muted-foreground text-xs">
																		Inspección:{" "}
																		{latestInspection.status === "approved"
																			? "Aprobada"
																			: latestInspection.status === "rejected"
																				? "Rechazada"
																				: "Pendiente"}
																	</span>
																)}
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
																			navigate({
																				to: "/vehicles",
																				search: {
																					vehicleId: vehicle.id,
																					inspectionId: undefined,
																					tab: "general",
																				},
																			});
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
																				motorNumber: vehicle.motorNumber || "",
																				origin: vehicle.origin || "",
																				fuelType: vehicle.fuelType || "",
																				transmission:
																					vehicle.transmission || "",
																				kmMileage: vehicle.kmMileage || 0,
																				isNew: vehicle.isNew || false,
																				isOwned: vehicle.isOwned || false,
																				status: vehicle.status || "pending",
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
																			navigate({
																				to: "/vehicles",
																				search: {
																					vehicleId: vehicle.id,
																					inspectionId: undefined,
																					tab: "photos",
																				},
																			});
																		}}
																	>
																		<Camera className="mr-2 h-4 w-4" />
																		Ver fotografías
																	</DropdownMenuItem>
																	<DropdownMenuItem
																		onClick={() => {
																			navigate({
																				to: "/vehicles",
																				search: {
																					vehicleId: vehicle.id,
																					inspectionId: undefined,
																					tab: "documents",
																				},
																			});
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
												).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
													).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
						<div className="flex items-center justify-between">
							<div>
								<DialogTitle>Detalles del Vehículo</DialogTitle>
								<DialogDescription>
									Información completa del vehículo {selectedVehicle?.make}{" "}
									{selectedVehicle?.model} {selectedVehicle?.year}
								</DialogDescription>
							</div>
							{selectedVehicle && (
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										setEditVehicleForm({
											id: selectedVehicle.id,
											make: selectedVehicle.make || "",
											model: selectedVehicle.model || "",
											year: selectedVehicle.year || new Date().getFullYear(),
											color: selectedVehicle.color || "",
											vehicleType: selectedVehicle.vehicleType || "",
											licensePlate: selectedVehicle.licensePlate || "",
											vinNumber: selectedVehicle.vinNumber || "",
											motorNumber: selectedVehicle.motorNumber || "",
											origin: selectedVehicle.origin || "",
											fuelType: selectedVehicle.fuelType || "",
											transmission: selectedVehicle.transmission || "",
											kmMileage: selectedVehicle.kmMileage || 0,
											isNew: selectedVehicle.isNew || false,
											isOwned: selectedVehicle.isOwned || false,
											status: selectedVehicle.status || "pending",
											seats: selectedVehicle.seats ?? null,
											doors: selectedVehicle.doors ?? null,
											axles: selectedVehicle.axles ?? 2,
											vehicleUse: selectedVehicle.vehicleUse || "",
											series: selectedVehicle.series || "",
											iscvCode: selectedVehicle.iscvCode || "",
										});
										isTransitioningToEditRef.current = true;
										setIsDetailsOpen(false);
										setIsEditVehicleOpen(true);
									}}
								>
									<Pencil className="mr-2 h-4 w-4" />
									Editar
								</Button>
							)}
						</div>
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
																		<div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
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
																			<div className="font-medium text-muted-foreground">
																				Valor de mercado:
																			</div>
																			<div className="font-medium">
																				Q
																				{Number(
																					inspection.marketValue,
																				).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
																			</div>
																			<div className="font-medium text-muted-foreground">
																				Valor comercial sugerido:
																			</div>
																			<div className="font-medium">
																				Q
																				{Number(
																					inspection.suggestedCommercialValue,
																				).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
																			</div>
																			<div className="text-pretty font-medium text-muted-foreground">
																				Valor actual condición:
																			</div>
																			<div className="font-bold text-lg">
																				Q
																				{Number(
																					inspection.currentConditionValue,
																				).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
																			</div>
																		</div>

																		{/* AI Valuation History Area */}
																		{inspection.aiSuggestedValue && (
																			<div className="mt-4 border-muted border-t pt-4">
																				<div className="mb-3 flex items-center gap-1.5">
																					<Sparkles className="h-4 w-4 text-blue-500" />
																					<h4 className="font-bold text-blue-700 text-xs uppercase tracking-tight">
																						Valoración IA
																					</h4>
																				</div>
																				<div className="grid grid-cols-2 gap-4 text-sm">
																					<div>
																						<p className="font-bold text-[10px] text-blue-600/80 uppercase tracking-tight">
																							Valor de Mercado
																						</p>
																						<p className="font-bold text-blue-700 text-lg">
																							Q
																							{Number(
																								inspection.aiSuggestedValue,
																							).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
																						</p>
																					</div>
																					<div className="flex flex-col items-end">
																						<p className="mb-1 font-bold text-[10px] text-blue-600/80 uppercase tracking-tight">
																							Clasificación
																						</p>
																						<Badge
																							variant="outline"
																							className="border-blue-200 bg-blue-50/50 font-bold text-[10px] text-blue-700 uppercase"
																						>
																							{inspection.aiCommercialClassification ||
																								"N/A"}
																						</Badge>
																					</div>
																				</div>
																			</div>
																		)}
																	</div>

																	<div>
																		<h4 className="mb-2 border-b pb-1 font-semibold text-lg">
																			Datos de Inspección
																		</h4>
																		<div className="grid grid-cols-2 gap-x-6 gap-y-3 py-2 text-sm">
																			<div className="flex flex-col gap-1">
																				<span className="font-bold text-[10px] text-muted-foreground uppercase tracking-tight">
																					Escáner
																				</span>
																				<div className="flex items-center gap-6">
																					<span className="font-medium">
																						{inspection.scannerUsed ? "Sí" : "No"}
																					</span>
																					{inspection.scannerResultUrl && (
																						<Button
																							variant="outline"
																							size="sm"
																							className="h-6 px-2.5 text-[10px]"
																							onClick={() => window.open(inspection.scannerResultUrl, "_blank")}
																						>
																							<FileText className="mr-1.5 h-3 w-3" /> Ver Reporte
																						</Button>
																					)}
																				</div>
																			</div>
																			<div className="flex flex-col gap-0.5">
																				<span className="font-bold text-[10px] text-muted-foreground uppercase tracking-tight">
																					Testigo Airbag
																				</span>
																				<span className="font-medium">
																					{inspection.airbagWarning
																						? "Sí"
																						: "No"}
																				</span>
																			</div>

																			<div className="col-span-2 space-y-4 pt-1">
																				{/* Painting Condition Bar */}
																				<div className="space-y-1.5">
																					<div className="flex items-end justify-between">
																						<span className="font-bold text-[10px] text-muted-foreground uppercase tracking-tight">
																							Pintura
																						</span>
																						<span className="font-bold text-xs">
																							{inspection.paintCondition || 0}%
																						</span>
																					</div>
																					<Progress
																						value={
																							inspection.paintCondition || 0
																						}
																						className="h-2 bg-muted transition-all"
																					/>
																				</div>

																				{/* Tires Detailed View */}
																				<div className="space-y-2">
																					<div className="flex items-end justify-between border-muted border-b pb-0.5">
																						<span className="font-bold text-[10px] text-muted-foreground uppercase tracking-tight">
																							Estado de 4 Llantas
																						</span>
																						<span className="rounded bg-muted px-1.5 font-bold text-[10px]">
																							{inspection.tiresCondition || 0}%
																							Promedio
																						</span>
																					</div>

																					<div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1">
																						<div className="space-y-1">
																							<div className="flex justify-between px-0.5 font-medium text-[9px]">
																								<span>Front. Izq.</span>
																								<span>
																									{inspection.tireConditionFrontLeft ||
																										0}
																									%
																								</span>
																							</div>
																							<Progress
																								value={
																									inspection.tireConditionFrontLeft ||
																									0
																								}
																								className="h-1.5"
																							/>
																						</div>
																						<div className="space-y-1">
																							<div className="flex justify-between px-0.5 font-medium text-[9px]">
																								<span>Front. Der.</span>
																								<span>
																									{inspection.tireConditionFrontRight ||
																										0}
																									%
																								</span>
																							</div>
																							<Progress
																								value={
																									inspection.tireConditionFrontRight ||
																									0
																								}
																								className="h-1.5"
																							/>
																						</div>
																						<div className="space-y-1">
																							<div className="flex justify-between px-0.5 font-medium text-[9px]">
																								<span>Tras. Izq.</span>
																								<span>
																									{inspection.tireConditionRearLeft ||
																										0}
																									%
																								</span>
																							</div>
																							<Progress
																								value={
																									inspection.tireConditionRearLeft ||
																									0
																								}
																								className="h-1.5"
																							/>
																						</div>
																						<div className="space-y-1">
																							<div className="flex justify-between px-0.5 font-medium text-[9px]">
																								<span>Tras. Der.</span>
																								<span>
																									{inspection.tireConditionRearRight ||
																										0}
																									%
																								</span>
																							</div>
																							<Progress
																								value={
																									inspection.tireConditionRearRight ||
																									0
																								}
																								className="h-1.5"
																							/>
																						</div>
																					</div>

																					{inspection.hasSpareTire && (
																						<div className="mt-2 rounded border border-muted/50 bg-muted/30 p-2">
																							<div className="flex items-center justify-between">
																								<span className="font-bold text-[9px] uppercase">
																									Llanta de Repuesto
																								</span>
																								<Badge
																									variant="secondary"
																									className="h-4 text-[9px] leading-none"
																								>
																									{inspection.tireConditionSpare ||
																										0}
																									%
																								</Badge>
																							</div>
																						</div>
																					)}
																				</div>

																				<div className="flex items-center justify-between rounded-lg border border-dashed bg-muted/20 p-2">
																					<span className="font-bold text-[10px] text-muted-foreground uppercase">
																						Historial Agencia
																					</span>
																					<Badge
																						variant={
																							inspection.hasAgencyHistory
																								? "default"
																								: "secondary"
																						}
																						className="h-5 text-[10px]"
																					>
																						{inspection.hasAgencyHistory
																							? "Sí posee"
																							: "No posee"}
																					</Badge>
																				</div>
																			</div>
																		</div>
																	</div>
																</div>

																<div className="space-y-4">
																	<div>
																		<h4 className="mb-2 flex items-center gap-2 font-semibold">
																			<FileText className="h-4 w-4 text-muted-foreground" />
																			Equipamiento
																		</h4>
																		<p className="text-muted-foreground text-sm leading-relaxed">
																			{inspection.vehicleEquipment ||
																				"No especificado"}
																		</p>
																	</div>

																	<div>
																		<h4 className="mb-2 flex items-center gap-2 font-semibold">
																			<Info className="h-4 w-4 text-muted-foreground" />
																			Consideraciones
																		</h4>
																		<p className="text-muted-foreground text-sm leading-relaxed">
																			{inspection.importantConsiderations ||
																				"Sin observaciones adicionales"}
																		</p>
																	</div>

																	<div>
																		<h4 className="mb-2 font-semibold">
																			Resultado de Inspección
																		</h4>
																		<p className="rounded-md border bg-muted/50 p-3 text-sm italic leading-relaxed">
																			"{inspection.inspectionResult}"
																		</p>
																	</div>

																	{inspection.alerts &&
																		inspection.alerts.length > 0 && (
																			<div>
																				<h4 className="mb-2 flex items-center gap-2 font-semibold text-red-600">
																					<AlertTriangle className="h-4 w-4" />
																					Alertas Detectadas
																				</h4>
																				<div className="flex flex-wrap gap-2">
																					{inspection.alerts.map(
																						(alert: string, idx: number) => (
																							<Badge
																								key={idx}
																								variant="destructive"
																								className="text-[10px]"
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

															{/* Inspection 360 Section */}
															{inspection.inspection360Items &&
																inspection.inspection360Items.length > 0 && (
																	<div className="mt-8 border-t pt-8">
																		<div className="mb-4 flex items-center gap-2">
																			<Wrench className="h-5 w-5 text-primary" />
																			<h4 className="font-bold text-lg">
																				Inspección Técnica 360°
																			</h4>
																		</div>
																		<Inspection360View
																			items={inspection.inspection360Items}
																		/>
																	</div>
																)}

															{/* Checklist Section */}
															{inspection.checklistItems &&
																inspection.checklistItems.length > 0 && (
																	<div className="mt-10 border-t pt-8">
																		<div className="mb-4 flex items-center gap-2">
																			<CheckCircle className="h-5 w-5 text-green-600" />
																			<h4 className="font-bold text-lg">
																				Evaluación de Criterios (Checklist)
																			</h4>
																		</div>
																		<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
																						className="space-y-3 rounded-lg border border-muted bg-muted/5 p-4"
																					>
																						<h5 className="font-bold text-primary text-xs uppercase tracking-wider">
																							{category.replace(/_/g, " ")}
																						</h5>
																						<div className="space-y-2">
																							{items.map(
																								(item: any, idx: number) => (
																									<div
																										key={idx}
																										className="flex items-start justify-between gap-4 border-muted border-b py-1 last:border-0"
																									>
																										<div className="space-y-0.5">
																											<p className="font-medium text-sm leading-none">
																												{item.item}
																											</p>
																											{item.notes && (
																												<p className="text-muted-foreground text-xs italic">
																													{item.notes}
																												</p>
																											)}
																										</div>
																										<div className="flex items-center gap-2">
																											{item.evidence &&
																												item.evidence.length >
																													0 && (
																													<Button
																														variant="outline"
																														size="icon"
																														className="h-7 w-7 border-blue-200 text-blue-600 hover:bg-blue-50"
																														onClick={() => {
																															setSelectedEvidence(
																																item.evidence,
																															);
																															setEvidenceItemName(
																																item.item,
																															);
																															setIsEvidenceOpen(
																																true,
																															);
																														}}
																													>
																														<Camera className="h-4 w-4" />
																													</Button>
																												)}
																										<Badge
																											variant={
																												!item.checked
																													? "default"
																													: item.checked &&
																															item.severity ===
																																"critical"
																														? "destructive"
																														: "secondary"
																											}
																											className="h-5 shrink-0 px-1.5 text-[10px]"
																										>
																											{!item.checked
																												? "Cumple"
																												: "No cumple"}
																										</Badge>
																										</div>
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
																					item.checked &&
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
																									item.checked &&
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

							<TabsContent value="photos" className="mt-4 space-y-6">
								{selectedVehicle.photos && selectedVehicle.photos.length > 0 ? (
									<div className="space-y-6">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Label
													htmlFor="photo-category"
													className="font-medium text-sm"
												>
													Categoría:
												</Label>
												<Select
													value={photoCategoryFilter}
													onValueChange={setPhotoCategoryFilter}
												>
													<SelectTrigger
														id="photo-category"
														className="w-[180px]"
													>
														<SelectValue placeholder="Todas" />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="all">Todas</SelectItem>
														<SelectItem value="exterior">Exterior</SelectItem>
														<SelectItem value="interior">Interior</SelectItem>
														<SelectItem value="engine">Motor</SelectItem>
														<SelectItem value="wheels">Ruedas</SelectItem>
														<SelectItem value="damage">Daños</SelectItem>
														<SelectItem value="others">Otros</SelectItem>
													</SelectContent>
												</Select>
											</div>
											<Badge variant="outline">
												{selectedVehicle.photos.length} fotos
											</Badge>
										</div>

										{/* Render grouped or filtered photos */}
										{(() => {
											const categories = [
												{ id: "exterior", label: "Exterior" },
												{ id: "interior", label: "Interior" },
												{ id: "engine", label: "Motor" },
												{ id: "wheels", label: "Ruedas y Neumáticos" },
												{ id: "damage", label: "Daños y Áreas Específicas" },
												{ id: "others", label: "Otros" },
											];

											const filteredPhotos =
												photoCategoryFilter === "all"
													? selectedVehicle.photos
													: selectedVehicle.photos.filter(
															(p: any) => p.category === photoCategoryFilter,
														);

											if (photoCategoryFilter !== "all") {
												return (
													<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
														{filteredPhotos.map((photo: any, index: number) => (
															<Card
																key={photo.id || index}
																className="cursor-pointer overflow-hidden"
																onClick={() => setSelectedPhoto(photo)}
															>
																<CardContent className="p-0">
																	<div className="relative aspect-square">
																		<img
																			src={photo.url || "/placeholder.svg"}
																			alt={photo.title || `Foto ${index + 1}`}
																			className="h-full w-full object-cover transition-transform hover:scale-105"
																		/>
																		{photo.valuatorComment &&
																			!photo.noCommentsChecked && (
																				<div className="absolute top-1.5 right-1.5 rounded-full bg-amber-500 p-1">
																					<MessageCircle className="h-3 w-3 text-white" />
																				</div>
																			)}
																	</div>
																	<div className="p-2">
																		<p className="line-clamp-1 font-medium text-xs">
																			{photo.title}
																		</p>
																	</div>
																</CardContent>
															</Card>
														))}
													</div>
												);
											}

											// Grouped view for "All"
											return (
												<div className="space-y-8">
													{categories.map((cat) => {
														const catPhotos = selectedVehicle.photos.filter(
															(p: any) => p.category === cat.id,
														);
														if (catPhotos.length === 0) return null;

														return (
															<div key={cat.id} className="space-y-3">
																<div className="flex items-center gap-2 border-b pb-1">
																	<h4 className="font-semibold text-sm">
																		{cat.label}
																	</h4>
																	<Badge
																		variant="secondary"
																		className="px-1.5 py-0 text-[10px]"
																	>
																		{catPhotos.length}
																	</Badge>
																</div>
																<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
																	{catPhotos.map(
																		(photo: any, index: number) => (
																			<Card
																				key={photo.id || index}
																				className="cursor-pointer overflow-hidden"
																				onClick={() => setSelectedPhoto(photo)}
																			>
																				<CardContent className="p-0">
																					<div className="relative aspect-square">
																						<img
																							src={
																								photo.url || "/placeholder.svg"
																							}
																							alt={
																								photo.title ||
																								`Foto ${index + 1}`
																							}
																							className="h-full w-full object-cover transition-transform hover:scale-105"
																						/>
																						{photo.valuatorComment &&
																							!photo.noCommentsChecked && (
																								<div className="absolute top-1.5 right-1.5 rounded-full bg-amber-500 p-1">
																									<MessageCircle className="h-3 w-3 text-white" />
																								</div>
																							)}
																					</div>
																					<div className="p-2">
																						<p className="line-clamp-1 font-medium text-xs">
																							{photo.title}
																						</p>
																					</div>
																				</CardContent>
																			</Card>
																		),
																	)}
																</div>
															</div>
														);
													})}
												</div>
											);
										})()}
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
								{/* Photo detail dialog */}
								<Dialog
									open={!!selectedPhoto}
									onOpenChange={(open) => !open && setSelectedPhoto(null)}
								>
									<DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
										{selectedPhoto && (
											<>
												<img
													src={selectedPhoto.url}
													alt={selectedPhoto.title}
													className="max-h-[60vh] w-full bg-black object-contain"
												/>
												<div className="space-y-2 p-4">
													<DialogHeader>
														<DialogTitle className="text-sm">
															{selectedPhoto.title}
														</DialogTitle>
													</DialogHeader>
													{selectedPhoto.valuatorComment &&
														!selectedPhoto.noCommentsChecked && (
															<div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
																<MessageCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
																<p className="text-amber-900 text-sm">
																	{selectedPhoto.valuatorComment}
																</p>
															</div>
														)}
												</div>
											</>
										)}
									</DialogContent>
								</Dialog>
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

			{/* Dialog para crear vehículo */}
			<Dialog open={isNewVehicleOpen} onOpenChange={setIsNewVehicleOpen}>
				<DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Sparkles className="h-5 w-5 text-blue-500" />
							Registrar Vehículo
						</DialogTitle>
						<DialogDescription>
							Selecciona si es usado/rodado o nuevo de agencia. Los campos con * son requeridos.
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
							if (
								!isValidVehicleConditionOrigin(
									newVehicleForm.isNew,
									newVehicleForm.origin,
								)
							) {
								toast.error(
									"Un vehículo nuevo de agencia no puede ser importado/rodado",
								);
								return;
							}
							createNewVehicleMutation.mutate(newVehicleForm);
						}}
						className="space-y-5"
					>
						{/* Información Básica */}
						<div className="space-y-3">
							<h4 className="font-medium text-sm">Información Básica</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
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
								<div className="space-y-2">
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
											{VEHICLE_BODY_TYPE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="vehicleCondition">Condición *</Label>
									<Select
										value={String(newVehicleForm.isNew)}
										onValueChange={(value) =>
											setNewVehicleForm({
												...newVehicleForm,
												isNew: value === "true",
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar condición" />
										</SelectTrigger>
										<SelectContent>
											{VEHICLE_CONDITION_OPTIONS.map((option) => (
												<SelectItem key={String(option.value)} value={String(option.value)}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
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
											{VEHICLE_PROVENANCE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>

						{/* Identificación y Mecánica */}
						<div className="space-y-3">
							<h4 className="font-medium text-muted-foreground text-sm">Identificación y Mecánica</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
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
									<Label htmlFor="motorNumber">No. Motor</Label>
									<Input
										id="motorNumber"
										value={newVehicleForm.motorNumber}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												motorNumber: e.target.value,
											})
										}
										placeholder="Número de motor"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="fuelType">Combustible</Label>
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
								<div className="space-y-2">
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
								<div className="space-y-2">
									<Label htmlFor="kmMileage">Kilometraje</Label>
									<Input
										id="kmMileage"
										type="number"
										value={newVehicleForm.kmMileage}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												kmMileage: Number.parseInt(e.target.value) || 0,
											})
										}
										min={0}
										placeholder="0"
									/>
								</div>
							</div>
						</div>

						{/* Datos para Contratos */}
						<div className="space-y-3">
							<h4 className="font-medium text-muted-foreground text-sm">Datos para Contratos</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
								<div className="space-y-2">
									<Label htmlFor="seats">Asientos</Label>
									<Input
										id="seats"
										type="number"
										value={newVehicleForm.seats ?? ""}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												seats: e.target.value
													? Number.parseInt(e.target.value)
													: null,
											})
										}
										min={1}
										max={50}
										placeholder="5"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="doors">Puertas</Label>
									<Input
										id="doors"
										type="number"
										value={newVehicleForm.doors ?? ""}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												doors: e.target.value
													? Number.parseInt(e.target.value)
													: null,
											})
										}
										min={2}
										max={6}
										placeholder="4"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="axles">Ejes</Label>
									<Input
										id="axles"
										type="number"
										value={newVehicleForm.axles ?? ""}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												axles: e.target.value
													? Number.parseInt(e.target.value)
													: null,
											})
										}
										min={2}
										max={10}
										placeholder="2"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="vehicleUse">Uso</Label>
									<Select
										value={newVehicleForm.vehicleUse}
										onValueChange={(value) =>
											setNewVehicleForm({
												...newVehicleForm,
												vehicleUse: value,
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar" />
										</SelectTrigger>
										<SelectContent>
											{VEHICLE_USE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="series">Serie</Label>
									<Input
										id="series"
										value={newVehicleForm.series}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												series: e.target.value,
											})
										}
										placeholder="Serie"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="iscvCode">Código ISCV</Label>
									<Input
										id="iscvCode"
										value={newVehicleForm.iscvCode}
										onChange={(e) =>
											setNewVehicleForm({
												...newVehicleForm,
												iscvCode: e.target.value,
											})
										}
										placeholder="ISCV"
									/>
								</div>
							</div>
						</div>

						<div className="flex items-center space-x-2">
							<Checkbox
								id="isOwned"
								checked={newVehicleForm.isOwned}
								onCheckedChange={(checked) =>
									setNewVehicleForm({
										...newVehicleForm,
										isOwned: checked === true,
									})
								}
							/>
							<Label htmlFor="isOwned" className="cursor-pointer text-sm">
								Vehículo propiedad de Cash In
							</Label>
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
				<DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
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
							if (
								!isValidVehicleConditionOrigin(
									editVehicleForm.isNew,
									editVehicleForm.origin,
								)
							) {
								toast.error(
									"Un vehículo nuevo de agencia no puede ser importado/rodado",
								);
								return;
							}
							updateVehicleMutation.mutate(editVehicleForm);
						}}
						className="space-y-5"
					>
						{/* Estado del Vehículo - fila completa */}
						<div className="space-y-2">
							<h4 className="font-medium text-sm">Estado del Vehículo</h4>
							{editVehicleForm.status === "sold" &&
							userProfile?.role &&
							userProfile.role !== ROLES.ADMIN &&
							userProfile.role !== ROLES.SALES_SUPERVISOR ? (
								<div className="space-y-1">
									<div className="flex h-10 w-full items-center rounded-md border bg-muted px-3 py-2 text-sm opacity-60">
										<span className="font-medium">Vendido</span>
									</div>
									<p className="text-muted-foreground text-xs">
										Solo un administrador o supervisor de ventas puede cambiar
										el estado de un vehículo vendido.
									</p>
								</div>
							) : (
								<Select
									value={editVehicleForm.status}
									onValueChange={(
										value:
											| "pending"
											| "available"
											| "sold"
											| "maintenance"
											| "auction",
									) => {
										const wasVendido = editVehicleForm.status === "sold";
										setEditVehicleForm({
											...editVehicleForm,
											status: value,
											...(wasVendido && value !== "sold"
												? { isOwned: true }
												: {}),
										});
									}}
								>
									<SelectTrigger>
										<SelectValue placeholder="Seleccionar estado" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="pending">
											<div className="flex flex-col">
												<span className="font-medium">Pendiente</span>
												<span className="text-muted-foreground text-xs">
													En espera o Próximo a la venta
												</span>
											</div>
										</SelectItem>
										<SelectItem value="available">
											<div className="flex flex-col">
												<span className="font-medium">Disponible</span>
												<span className="text-muted-foreground text-xs">
													Listo para venta o financiamiento
												</span>
											</div>
										</SelectItem>
										<SelectItem value="sold">
											<div className="flex flex-col">
												<span className="font-medium">Vendido</span>
												<span className="text-muted-foreground text-xs">
													Vehículo ya fue vendido/financiado
												</span>
											</div>
										</SelectItem>
										<SelectItem value="maintenance">
											<div className="flex flex-col">
												<span className="font-medium">En Mantenimiento</span>
												<span className="text-muted-foreground text-xs">
													En reparación o servicio técnico
												</span>
											</div>
										</SelectItem>
										<SelectItem value="auction">
											<div className="flex flex-col">
												<span className="font-medium">En Remate</span>
												<span className="text-muted-foreground text-xs">
													Disponible para subasta/remate
												</span>
											</div>
										</SelectItem>
									</SelectContent>
								</Select>
							)}
						</div>

						{/* Información Básica */}
						<div className="space-y-3">
							<h4 className="font-medium text-sm">Información Básica</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
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
											{VEHICLE_BODY_TYPE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-vehicleCondition">Condición *</Label>
									<Select
										value={String(editVehicleForm.isNew)}
										onValueChange={(value) =>
											setEditVehicleForm({
												...editVehicleForm,
												isNew: value === "true",
											})
										}
									>
										<SelectTrigger>
											<SelectValue placeholder="Seleccionar condición" />
										</SelectTrigger>
										<SelectContent>
											{VEHICLE_CONDITION_OPTIONS.map((option) => (
												<SelectItem key={String(option.value)} value={String(option.value)}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
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
											{VEHICLE_PROVENANCE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
						</div>

						{/* Identificación y Mecánica */}
						<div className="space-y-3">
							<h4 className="font-medium text-muted-foreground text-sm">
								Identificación y Mecánica
								{editVehicleForm.isNew && (
									<span className="ml-2 font-normal text-amber-600 text-xs">
										(requeridos para completar la oportunidad)
									</span>
								)}
							</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
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
									<Label htmlFor="edit-motorNumber">No. Motor</Label>
									<Input
										id="edit-motorNumber"
										value={editVehicleForm.motorNumber}
										onChange={(e) =>
											setEditVehicleForm({
												...editVehicleForm,
												motorNumber: e.target.value,
											})
										}
										placeholder="Número de motor"
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="edit-fuelType">Combustible</Label>
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
								<div className="space-y-2">
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

						{/* Datos para Contratos */}
						<div className="space-y-3">
							<h4 className="font-medium text-muted-foreground text-sm">
								Datos para Contratos
								<span className="ml-2 font-normal text-muted-foreground text-xs">
									(requeridos para generar contratos legales)
								</span>
							</h4>
							<div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
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
											{VEHICLE_USE_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
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

						<div className="flex items-center space-x-2">
							<Checkbox
								id="edit-isOwned"
								checked={editVehicleForm.isOwned}
								onCheckedChange={(checked) =>
									setEditVehicleForm({
										...editVehicleForm,
										isOwned: checked === true,
									})
								}
							/>
							<Label htmlFor="edit-isOwned" className="cursor-pointer text-sm">
								Vehículo propiedad de Cash In
							</Label>
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

			{/* Evidence Photos Modal */}
			<Dialog open={isEvidenceOpen} onOpenChange={setIsEvidenceOpen}>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 font-bold text-xl">
							<Camera className="h-5 w-5 text-blue-600" />
							Evidencia: {evidenceItemName}
						</DialogTitle>
						<DialogDescription>
							Fotografías adjuntas a este punto de inspección
						</DialogDescription>
					</DialogHeader>
					<div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
						{selectedEvidence.map((ev, idx) => (
							<div key={idx} className="group space-y-2">
								<div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
									<img
										src={ev.url}
										alt={`Evidencia ${idx + 1}`}
										className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
									<a
										href={ev.url}
										target="_blank"
										rel="noreferrer"
										className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100"
									>
										<Button variant="secondary" size="sm">
											<Eye className="mr-2 h-4 w-4" />
											Ver original
										</Button>
									</a>
								</div>
								<div className="flex items-center justify-between rounded bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
									<span className="max-w-[150px] truncate">
										{ev.originalName}
									</span>
									<span className="uppercase">{ev.mimeType.split("/")[1]}</span>
								</div>
							</div>
						))}
					</div>
					<DialogFooter className="mt-6 border-t pt-4">
						<Button onClick={() => setIsEvidenceOpen(false)}>Cerrar</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
