import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
	AlertTriangle,
	Camera,
	Car,
	CheckCircle,
	Eye,
	FileText,
	Search,
	Wrench,
	XCircle,
} from "lucide-react";
import { useState } from "react";
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
import { renderInspectionStatusBadge } from "@/lib/vehicle-utils";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/vehicles/")({
	component: VehiclesDashboard,
});

// Nota: renderInspectionStatusBadge ahora se importa desde @/lib/vehicle-utils

function VehiclesDashboard() {
	const navigate = useNavigate();
	const [searchTerm, setSearchTerm] = useState("");
	const [filterStatus, setFilterStatus] = useState("all");
	const [selectedVehicle, setSelectedVehicle] = useState<any>(null);
	const [isDetailsOpen, setIsDetailsOpen] = useState(false);
	const [activeTab, setActiveTab] = useState("general");

	// Fetch vehicles
	const { data: vehicles, isLoading } = useQuery(
		orpc.getVehicles.queryOptions(),
	);
	const { data: statistics } = useQuery(
		orpc.getVehicleStatistics.queryOptions(),
	);

	// Filter vehicles based on search term and filter status
	const filteredVehicles = vehicles?.filter((vehicle: any) => {
		const latestInspection = vehicle.inspections?.[0];

		const matchesSearch =
			vehicle.make.toLowerCase().includes(searchTerm.toLowerCase()) ||
			vehicle.model.toLowerCase().includes(searchTerm.toLowerCase()) ||
			vehicle.licensePlate.toLowerCase().includes(searchTerm.toLowerCase()) ||
			vehicle.vinNumber.toLowerCase().includes(searchTerm.toLowerCase());

		const matchesStatus =
			filterStatus === "all" ||
			(latestInspection && latestInspection.status === filterStatus);

		return matchesSearch && matchesStatus;
	});
	// auction vehicles
	const [isAuctionOpen, setIsAuctionOpen] = useState(false);
	const [auctionVehicle, setAuctionVehicle] = useState<any>(null);
	const createAuctionMutation = useMutation(
		orpc.createAuction.mutationOptions(),
	);
	const [auctionInspection, setAuctionInspection] = useState<any>(null);

	const [auctionPrice, setAuctionPrice] = useState<number | null>(null);

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
											<SelectItem value="approved">Aprobados</SelectItem>
											<SelectItem value="pending">Pendientes</SelectItem>
											<SelectItem value="rejected">Rechazados</SelectItem>
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
										{filteredVehicles?.length === 0 ? (
											<TableRow>
												<TableCell colSpan={7} className="h-24 text-center">
													No se encontraron resultados.
												</TableCell>
											</TableRow>
										) : (
											filteredVehicles?.map((vehicle: any) => {
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
														<TableCell>{vehicle.licensePlate}</TableCell>
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
																{latestInspection
																	? renderInspectionStatusBadge(
																			latestInspection.status,
																		)
																	: renderInspectionStatusBadge("pending")}
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
						</CardContent>
					</Card>
				</TabsContent>
			</Tabs>
			<Dialog open={isAuctionOpen} onOpenChange={setIsAuctionOpen}>
				<DialogContent>
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
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger value="general">Información General</TabsTrigger>
								<TabsTrigger value="inspections">Inspecciones</TabsTrigger>
								<TabsTrigger value="photos">Fotografías</TabsTrigger>
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
						</Tabs>
					)}

					<DialogFooter>
						<Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
							Cerrar
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
