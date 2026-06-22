import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	AlertTriangle,
	Camera,
	Car,
	CheckCircle,
	Eye,
	FileText,
	Info,
	Sparkles,
	Wrench,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inspection360View } from "@/components/vehicles/inspection-360-view";
import { renderInspectionStatusBadge } from "@/lib/vehicle-utils";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/vehicles/auction-vehicles")({
	component: AuctionsDashboard,
});

function AuctionsDashboard() {
	const [selectedAuction, setSelectedAuction] = useState<any>(null);
	const [isDetailsOpen, setIsDetailsOpen] = useState(false);
	const [finalPrice, setFinalPrice] = useState<number | null>(null);
	const [isPhotosOpen, setIsPhotosOpen] = useState(false);
	const [photosVehicle, setPhotosVehicle] = useState<any>(null);
	const queryClient = useQueryClient();

	// Evidence modal state
	const [selectedEvidence, setSelectedEvidence] = useState<any[]>([]);
	const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
	const [evidenceItemName, setEvidenceItemName] = useState("");

	// Fetch auctions
	const { data: auctions, isLoading } = useQuery(
		orpc.getAuctions.queryOptions({
			input: { page: 1, limit: 20 },
		}),
	);

	// Mutation para cerrar subasta
	const closeAuctionMutation = useMutation(
		orpc.closeAuction.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.getAuctions.queryKey({
						input: { page: 1, limit: 20 },
					}),
				});
				setIsDetailsOpen(false);
				setFinalPrice(null);
			},
		}),
	);

	// Mutation para cancelar subasta
	const cancelAuctionMutation = useMutation(
		orpc.cancelAuction.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.getAuctions.queryKey({
						input: { page: 1, limit: 20 },
					}),
				});
				setIsDetailsOpen(false);
			},
		}),
	);

	const renderAuctionStatus = (status: string) => {
		switch (status) {
			case "pending":
				return (
					<Badge className="bg-yellow-500">
						<AlertTriangle className="mr-1 h-3.5 w-3.5" />
						Pendiente
					</Badge>
				);
			case "sold":
				return (
					<Badge className="bg-purple-500">
						<CheckCircle className="mr-1 h-3.5 w-3.5" />
						Vendido
					</Badge>
				);
			case "auction":
				return (
					<Badge className="bg-pink-500">
						<Car className="mr-1 h-3.5 w-3.5" />
						En Remate
					</Badge>
				);
			default:
				return (
					<Badge className="bg-gray-400">
						<XCircle className="mr-1 h-3.5 w-3.5" />
						{status}
					</Badge>
				);
		}
	};

	return (
		<div className="flex flex-col gap-4 p-6">
			<h1 className="mb-4 font-bold text-4xl">Vehículos en Remate</h1>

			<Card>
				<CardHeader>
					<CardTitle>Listado de Remates</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="rounded-md border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Vehículo</TableHead>
									<TableHead>Placa</TableHead>
									<TableHead>Valor Mercado</TableHead>
									<TableHead>Precio Remate</TableHead>
									<TableHead>Pérdida</TableHead>
									<TableHead>Estado</TableHead>
									<TableHead className="text-right">Acciones</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{isLoading ? (
									<TableRow>
										<TableCell colSpan={7} className="text-center">
											Cargando...
										</TableCell>
									</TableRow>
								) : auctions?.data?.length === 0 ? (
									<TableRow>
										<TableCell colSpan={7} className="text-center">
											No hay vehículos en remate
										</TableCell>
									</TableRow>
								) : (
									auctions?.data?.map((auction: any) => {
										const latestInspection = auction.inspections?.[0]; // la primera inspección o usa .at(-1) si quieres la última
										return (
											<TableRow key={auction.auctionId}>
												<TableCell>
													{auction.vehicle.model} ({auction.vehicle.year})
												</TableCell>
												<TableCell>{auction.vehicle.licensePlate}</TableCell>
												<TableCell>
													{latestInspection ? (
														<>
															Q
															{Number(
																latestInspection.marketValue,
															).toLocaleString("es-GT", {
																minimumFractionDigits: 2,
																maximumFractionDigits: 2,
															})}
														</>
													) : (
														<span className="text-gray-400">N/A</span>
													)}
												</TableCell>
												<TableCell>
													Q
													{Number(auction.auctionPrice).toLocaleString(
														"es-GT",
														{
															minimumFractionDigits: 2,
															maximumFractionDigits: 2,
														},
													)}
												</TableCell>
												<TableCell className="font-medium text-red-600">
													Q
													{Number(auction.lossValue).toLocaleString("es-GT", {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</TableCell>
												<TableCell>
													{renderAuctionStatus(auction.auctionStatus)}
												</TableCell>
												<TableCell className="text-right">
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button variant="ghost" className="h-8 w-8 p-0">
																<span className="sr-only">Abrir menú</span>
																<Eye className="h-4 w-4" />
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuLabel>Acciones</DropdownMenuLabel>
															<DropdownMenuItem
																onClick={() => {
																	setSelectedAuction(auction);
																	setIsDetailsOpen(true);
																}}
															>
																<Eye className="mr-2 h-4 w-4" />
																Ver detalles
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() => {
																	setPhotosVehicle(auction);
																	setIsPhotosOpen(true);
																}}
															>
																<Camera className="mr-2 h-4 w-4" />
																Ver fotografías / inspecciones
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

			{/* Modal de detalles */}
			<Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
				<DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Detalles del Remate</DialogTitle>
						<DialogDescription>
							Información completa del vehículo y opciones de gestión
						</DialogDescription>
					</DialogHeader>

					{selectedAuction && (
						<div className="space-y-6">
							<div className="rounded-md bg-muted/40 p-3">
								<h3 className="mb-2 font-semibold text-lg">
									{selectedAuction.vehicle.model} (
									{selectedAuction.vehicle.year}) -{" "}
									{selectedAuction.vehicle.licensePlate}
								</h3>
								<p>
									<strong>Descripción:</strong> {selectedAuction.description}
								</p>
								<p>
									<strong>Estado actual:</strong>{" "}
									{renderAuctionStatus(selectedAuction.auctionStatus)}
								</p>
							</div>

							<div className="rounded-md border p-3">
								{selectedAuction.auctionStatus === "sold" ? (
									<p className="font-medium text-green-600">
										<strong>Precio Final de Venta:</strong> Q
										{Number(selectedAuction.auctionPrice).toLocaleString(
											"es-GT",
											{ minimumFractionDigits: 2, maximumFractionDigits: 2 },
										)}
									</p>
								) : (
									<label className="mb-1 block font-medium">
										Precio Final de Venta
										<Input
											type="number"
											placeholder="Ingrese el precio final"
											value={finalPrice ?? ""}
											onChange={(e) => setFinalPrice(Number(e.target.value))}
										/>
									</label>
								)}
							</div>
						</div>
					)}

					<DialogFooter>
						<Button variant="outline" onClick={() => setIsDetailsOpen(false)}>
							Cerrar
						</Button>
						{selectedAuction && selectedAuction.auctionStatus !== "sold" && (
							<>
								<Button
									variant="default"
									disabled={!finalPrice}
									onClick={() =>
										closeAuctionMutation.mutate({
											vehicleId: selectedAuction.vehicle.id,
											auctionPrice: finalPrice!.toString(),
										})
									}
								>
									Confirmar Venta
								</Button>
								<Button
									variant="destructive"
									onClick={() =>
										cancelAuctionMutation.mutate({
											vehicleId: selectedAuction.vehicle.id,
										})
									}
								>
									Cancelar Remate
								</Button>
							</>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Modal con pestañas */}
			<Dialog open={isPhotosOpen} onOpenChange={setIsPhotosOpen}>
				<DialogContent className="max-h-[90vh] min-w-[90vw] max-w-7xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							Fotografías e Inspecciones de {photosVehicle?.vehicle?.make}{" "}
							{photosVehicle?.vehicle?.model} {photosVehicle?.vehicle?.year}
						</DialogTitle>
						<DialogDescription>
							Navega entre la galería de fotos y el historial de inspecciones
						</DialogDescription>
					</DialogHeader>

					<Tabs defaultValue="photos" className="w-full">
						<TabsList className="grid w-full grid-cols-2">
							<TabsTrigger value="photos">Fotografías</TabsTrigger>
							<TabsTrigger value="inspections">Inspecciones</TabsTrigger>
						</TabsList>

						{/* Tab Fotografías */}
						<TabsContent value="photos" className="mt-4 space-y-4">
							{photosVehicle?.photos?.length > 0 ? (
								<div className="grid grid-cols-2 gap-6 md:grid-cols-3 lg:grid-cols-4">
									{photosVehicle.photos.map((photo: any, index: number) => (
										<Card key={photo.id || index}>
											<CardContent className="p-2">
												<div className="flex h-[220px] w-full items-center justify-center overflow-hidden rounded-md bg-gray-100">
													<img
														src={photo.url || "/placeholder.svg"}
														alt={photo.title || `Foto ${index + 1}`}
														className="h-full w-full object-cover"
													/>
												</div>
												<p className="mt-2 text-center font-medium text-sm">
													{photo.title}
												</p>
												<p className="text-center text-muted-foreground text-xs">
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

						{/* Tab Inspecciones */}
						<TabsContent value="inspections" className="mt-4 space-y-4">
							{photosVehicle?.inspections?.length > 0 ? (
								<div className="space-y-4">
									{photosVehicle.inspections.map(
										(inspection: any, index: number) => (
											<Card key={inspection.id || index}>
												<CardHeader>
													<div className="flex items-center justify-between">
														<CardTitle className="text-base">
															Inspección #{index + 1}
														</CardTitle>
														{renderInspectionStatusBadge(inspection.status)}
													</div>
													<DialogDescription>
														Realizada por {inspection.technicianName || "N/A"}{" "}
														el{" "}
														{inspection.date
															? new Date(inspection.date).toLocaleDateString(
																	"es-GT",
																)
															: "N/A"}
													</DialogDescription>
												</CardHeader>
												<CardContent className="space-y-6">
													<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
														<div className="space-y-4">
															<div className="grid grid-cols-2 gap-2 text-sm">
																<p>
																	<strong>Valor mercado:</strong> Q
																	{Number(
																		inspection.marketValue,
																	).toLocaleString("es-GT", {
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	})}
																</p>
																<p>
																	<strong>Valor comercial:</strong> Q
																	{Number(
																		inspection.suggestedCommercialValue,
																	).toLocaleString("es-GT", {
																		minimumFractionDigits: 2,
																		maximumFractionDigits: 2,
																	})}
																</p>
																<p>
																	<strong>Valor bancario:</strong> Q
																	{Number(inspection.bankValue).toLocaleString(
																		"es-GT",
																		{
																			minimumFractionDigits: 2,
																			maximumFractionDigits: 2,
																		},
																	)}
																</p>
																<p>
																	<strong>Calificación:</strong>{" "}
																	{inspection.rating ||
																		inspection.vehicleRating}
																</p>
															</div>

															{inspection.aiSuggestedValue && (
																<div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
																	<div className="mb-1 flex items-center gap-2 text-blue-700">
																		<Sparkles className="h-3.5 w-3.5" />
																		<h4 className="font-semibold text-xs">
																			Valoración por IA
																		</h4>
																	</div>
																	<div className="space-y-2 text-[13px]">
																		<div>
																			<p className="font-medium text-blue-900 leading-tight">
																				Sugerencia:
																			</p>
																			<p className="font-bold text-blue-800">
																				Q
																				{Number(
																					inspection.aiSuggestedValue,
																				).toLocaleString("es-GT", {
																					minimumFractionDigits: 2,
																					maximumFractionDigits: 2,
																				})}
																			</p>
																		</div>
																		{inspection.aiReasoning && (
																			<p className="line-clamp-2 text-[11px] text-blue-800 italic leading-tight">
																				{inspection.aiReasoning}
																			</p>
																		)}
																	</div>
																</div>
															)}

															<div>
																<h4 className="mb-2 border-b pb-1 font-semibold text-xs">
																	Condición y Diagnóstico
																</h4>
																<div className="grid grid-cols-2 gap-y-1 text-xs">
																	<span className="text-muted-foreground">
																		Pintura:
																	</span>
																	<span>
																		{inspection.paintCondition
																			? `${inspection.paintCondition}%`
																			: "N/A"}
																	</span>
																	<span className="text-muted-foreground">
																		Historial Agencia:
																	</span>
																	<span>
																		{inspection.hasAgencyHistory === true
																			? "Sí"
																			: "No"}
																	</span>
																	<span className="whitespace-nowrap text-muted-foreground">
																		Llantas F (I/D):
																	</span>
																	<span>
																		{inspection.tireConditionFrontLeft || 0}% /{" "}
																		{inspection.tireConditionFrontRight || 0}%
																	</span>
																	<span className="whitespace-nowrap text-muted-foreground">
																		Llantas T (I/D):
																	</span>
																	<span>
																		{inspection.tireConditionRearLeft || 0}% /{" "}
																		{inspection.tireConditionRearRight || 0}%
																	</span>
																	<span className="text-muted-foreground">
																		Reporte Escáner:
																	</span>
																	<span className="flex items-center gap-6">
																		{inspection.scannerUsed ? "Sí" : "No"}
																		{inspection.scannerResultUrl && (
																			<Button
																				variant="outline"
																				size="sm"
																				className="h-6 px-2.5 text-[10px]"
																				onClick={() =>
																					window.open(
																						inspection.scannerResultUrl,
																						"_blank",
																					)
																				}
																			>
																				<FileText className="mr-1.5 h-3 w-3" />{" "}
																				Abrir PDF
																			</Button>
																		)}
																	</span>
																</div>
															</div>
														</div>

														<div className="space-y-4">
															<div>
																<h4 className="mb-1 flex items-center gap-1 font-semibold text-xs">
																	<FileText className="h-3 w-3" /> Resultado
																</h4>
																<p className="rounded bg-muted/30 p-2 text-xs italic">
																	{inspection.result ||
																		inspection.inspectionResult}
																</p>
															</div>
															{inspection.alerts &&
																inspection.alerts.length > 0 && (
																	<div>
																		<h4 className="mb-1 flex items-center gap-1 font-semibold text-red-600 text-xs">
																			<AlertTriangle className="h-3 w-3" />{" "}
																			Alertas
																		</h4>
																		<div className="flex flex-wrap gap-1">
																			{inspection.alerts.map(
																				(alert: string, idx: number) => (
																					<Badge
																						key={idx}
																						variant="destructive"
																						className="px-1 py-0 font-normal text-[9px]"
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
															<div className="mt-4 border-t pt-4">
																<div className="mb-3 flex items-center gap-2">
																	<Wrench className="h-4 w-4 text-primary" />
																	<h4 className="font-bold text-sm">
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
															<div className="mt-6 border-t pt-6">
																<div className="mb-3 flex items-center gap-2">
																	<CheckCircle className="h-4 w-4 text-green-600" />
																	<h4 className="font-bold text-sm">
																		Evaluación de Criterios (Checklist)
																	</h4>
																</div>
																<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
																	{Object.entries(
																		inspection.checklistItems.reduce(
																			(acc: any, item: any) => {
																				if (!acc[item.category])
																					acc[item.category] = [];
																				acc[item.category].push(item);
																				return acc;
																			},
																			{},
																		),
																	).map(([category, items]: [string, any]) => (
																		<div
																			key={category}
																			className="space-y-2 rounded-md border bg-muted/5 p-3"
																		>
																			<h5 className="font-bold text-[10px] text-primary uppercase tracking-wider">
																				{category.replace(/_/g, " ")}
																			</h5>
																			<div className="space-y-1.5">
																				{items.map((item: any, idx: number) => (
																					<div
																						key={idx}
																						className="flex items-start justify-between gap-3 border-muted/50 border-b py-1 last:border-0"
																					>
																						<div className="space-y-0.5">
																							<p className="font-medium text-[13px] leading-tight">
																								{item.item}
																							</p>
																							{item.notes && (
																								<p className="text-[11px] text-muted-foreground italic">
																									{item.notes}
																								</p>
																							)}
																						</div>
																						<div className="flex items-center gap-1.5">
																							{item.evidence &&
																								item.evidence.length > 0 && (
																									<Button
																										variant="outline"
																										size="icon"
																										className="h-6 w-6 border-blue-200 text-blue-600 hover:bg-blue-50"
																										onClick={() => {
																											setSelectedEvidence(
																												item.evidence,
																											);
																											setEvidenceItemName(
																												item.item,
																											);
																											setIsEvidenceOpen(true);
																										}}
																									>
																										<Camera className="h-3 w-3" />
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
																								className="h-4.5 shrink-0 px-1 text-[9px]"
																							>
																								{!item.checked
																									? "Cumple"
																									: "No cumple"}
																							</Badge>
																						</div>
																					</div>
																				))}
																			</div>
																		</div>
																	))}
																</div>
															</div>
														)}
												</CardContent>
											</Card>
										),
									)}
								</div>
							) : (
								<Card>
									<CardContent className="py-8 text-center">
										<p className="text-muted-foreground">
											No hay inspecciones registradas
										</p>
									</CardContent>
								</Card>
							)}
						</TabsContent>
					</Tabs>

					<DialogFooter>
						<Button variant="outline" onClick={() => setIsPhotosOpen(false)}>
							Cerrar
						</Button>
					</DialogFooter>
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
