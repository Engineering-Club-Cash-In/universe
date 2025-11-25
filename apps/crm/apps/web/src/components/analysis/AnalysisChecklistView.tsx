import { useQuery } from "@tanstack/react-query";
import {
	CheckCircle2,
	Circle,
	FileText,
	ShieldCheck,
	Truck,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { client, orpc } from "@/utils/orpc";

interface AnalysisChecklistViewProps {
	opportunityId: string;
	onUpdate?: () => void;
}

interface ChecklistItem {
	description?: string;
	name?: string;
	type?: string;
	documentType?: string;
	uploaded?: boolean;
	required: boolean;
	completed?: boolean;
	verifiedBy?: string;
	verifiedAt?: string;
}

interface ChecklistSubsection {
	completed: boolean;
	items: ChecklistItem[];
}

interface ChecklistSection {
	completed: boolean;
	items?: ChecklistItem[];
	inspected?: boolean;
	vehicleId?: string;
	inspectionId?: string;
	ownerType?: string;
	// Vehicle subsections
	documentos?: ChecklistSubsection;
	verificaciones?: ChecklistSubsection;
}

interface Checklist {
	overallProgress: number;
	canApprove: boolean;
	sections: {
		documentos: ChecklistSection;
		verificaciones: ChecklistSection;
		vehiculo: ChecklistSection;
	};
}

export function AnalysisChecklistView({
	opportunityId,
	onUpdate,
}: AnalysisChecklistViewProps) {
	const [openSections, setOpenSections] = useState({
		documentos: true,
		verificaciones: true,
		vehiculo: true,
	});

	const toggleSection = (section: keyof typeof openSections) => {
		setOpenSections((prev) => ({
			...prev,
			[section]: !prev[section],
		}));
	};

	// Fetch checklist data
	const {
		data: checklist,
		isLoading,
		refetch,
	} = useQuery<Checklist>({
		queryKey: ["getAnalysisChecklist", opportunityId],
		queryFn: async () => {
			return (await client.getAnalysisChecklist({
				opportunityId,
			})) as Checklist;
		},
	});

	const handleVerificationChange = async (
		verificationType: string,
		completed: boolean,
	) => {
		try {
			await client.updateAnalysisChecklistVerification({
				opportunityId,
				verificationType,
				completed,
			});
			await refetch();
			onUpdate?.();
		} catch (error) {
			console.error("Error updating verification:", error);
		}
	};

	const handleVehicleVerificationChange = async (
		verificationType: string,
		completed: boolean,
	) => {
		try {
			await client.updateAnalysisChecklistVehicleVerification({
				opportunityId,
				verificationType,
				completed,
			});
			await refetch();
			onUpdate?.();
		} catch (error) {
			console.error("Error updating vehicle verification:", error);
		}
	};

	if (isLoading) {
		return (
			<div className="space-y-4">
				<div className="h-20 animate-pulse rounded-lg bg-muted" />
				<div className="h-40 animate-pulse rounded-lg bg-muted" />
				<div className="h-40 animate-pulse rounded-lg bg-muted" />
			</div>
		);
	}

	if (!checklist) {
		return (
			<div className="py-8 text-center text-muted-foreground">
				No se pudo cargar el checklist
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Progress Overview */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle className="text-lg">Progreso de Análisis</CardTitle>
						<Badge variant={checklist.canApprove ? "default" : "secondary"}>
							{checklist.overallProgress}% Completado
						</Badge>
					</div>
				</CardHeader>
				<CardContent>
					<Progress value={checklist.overallProgress} className="h-2" />
					<p className="mt-2 text-muted-foreground text-sm">
						{checklist.canApprove
							? "✅ Todos los requisitos completados"
							: "⚠️ Pendiente de completar requisitos"}
					</p>
				</CardContent>
			</Card>

			{/* Documentos Section */}
			<Collapsible
				open={openSections.documentos}
				onOpenChange={() => toggleSection("documentos")}
			>
				<Card>
					<CollapsibleTrigger asChild>
						<CardHeader className="cursor-pointer transition-colors hover:bg-muted/50">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<FileText className="h-5 w-5" />
									<CardTitle className="text-lg">
										Recepción de Documentos
									</CardTitle>
								</div>
								<div className="flex items-center gap-2">
									{checklist.sections.documentos.completed ? (
										<CheckCircle2 className="h-5 w-5 text-green-600" />
									) : (
										<Circle className="h-5 w-5 text-muted-foreground" />
									)}
									<Badge variant="outline">
										{checklist.sections.documentos.items?.filter(
											(i: any) => i.uploaded,
										).length ?? 0}{" "}
										/ {checklist.sections.documentos.items?.length ?? 0}
									</Badge>
								</div>
							</div>
						</CardHeader>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<CardContent>
							<div className="space-y-3">
								{checklist.sections.documentos.items?.map(
									(item: any, index: number) => (
										<div
											key={index}
											className="flex items-center justify-between border-b py-2 last:border-0"
										>
											<div className="flex items-center gap-3">
												{item.uploaded ? (
													<CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
												) : (
													<Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
												)}
												<div>
													<p className="font-medium text-sm">
														{item.description}
													</p>
													{item.required && (
														<span className="text-muted-foreground text-xs">
															Requerido
														</span>
													)}
												</div>
											</div>
											<Badge variant={item.uploaded ? "default" : "secondary"}>
												{item.uploaded ? "Subido" : "Pendiente"}
											</Badge>
										</div>
									),
								)}
							</div>
						</CardContent>
					</CollapsibleContent>
				</Card>
			</Collapsible>

			{/* Verificaciones Section */}
			<Collapsible
				open={openSections.verificaciones}
				onOpenChange={() => toggleSection("verificaciones")}
			>
				<Card>
					<CollapsibleTrigger asChild>
						<CardHeader className="cursor-pointer transition-colors hover:bg-muted/50">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<ShieldCheck className="h-5 w-5" />
									<CardTitle className="text-lg">
										Verificaciones y Revisión
									</CardTitle>
								</div>
								<div className="flex items-center gap-2">
									{checklist.sections.verificaciones.completed ? (
										<CheckCircle2 className="h-5 w-5 text-green-600" />
									) : (
										<Circle className="h-5 w-5 text-muted-foreground" />
									)}
									<Badge variant="outline">
										{checklist.sections.verificaciones.items?.filter(
											(i: any) => i.required && i.completed,
										).length ?? 0}{" "}
										/{" "}
										{checklist.sections.verificaciones.items?.filter(
											(i: any) => i.required,
										).length ?? 0}
									</Badge>
								</div>
							</div>
						</CardHeader>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<CardContent>
							<div className="space-y-3">
								{checklist.sections.verificaciones.items?.map(
									(item: any, index: number) => (
										<div
											key={index}
											className="flex items-start gap-3 border-b py-2 last:border-0"
										>
											<Checkbox
												checked={item.completed}
												onCheckedChange={(checked) =>
													handleVerificationChange(
														item.type,
														checked as boolean,
													)
												}
												disabled={!item.required}
												className="mt-1"
											/>
											<div className="flex-1">
												<p className="font-medium text-sm">{item.name}</p>
												{item.required ? (
													<span className="text-muted-foreground text-xs">
														Requerido
													</span>
												) : (
													<span className="text-muted-foreground text-xs">
														Opcional
													</span>
												)}
												{item.verifiedBy && (
													<p className="mt-1 text-muted-foreground text-xs">
														Verificado{" "}
														{item.verifiedAt &&
															`el ${new Date(item.verifiedAt).toLocaleDateString()}`}
													</p>
												)}
											</div>
										</div>
									),
								)}
							</div>
						</CardContent>
					</CollapsibleContent>
				</Card>
			</Collapsible>

			{/* Vehículo Section */}
			<Collapsible
				open={openSections.vehiculo}
				onOpenChange={() => toggleSection("vehiculo")}
			>
				<Card>
					<CollapsibleTrigger asChild>
						<CardHeader className="cursor-pointer transition-colors hover:bg-muted/50">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Truck className="h-5 w-5" />
									<CardTitle className="text-lg">Vehículo</CardTitle>
								</div>
								<div className="flex items-center gap-2">
									{checklist.sections.vehiculo.completed ? (
										<CheckCircle2 className="h-5 w-5 text-green-600" />
									) : (
										<Circle className="h-5 w-5 text-muted-foreground" />
									)}
									<Badge
										variant={
											checklist.sections.vehiculo.completed
												? "default"
												: "secondary"
										}
									>
										{checklist.sections.vehiculo.completed
											? "Completo"
											: "Pendiente"}
									</Badge>
								</div>
							</div>
						</CardHeader>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<CardContent>
							{checklist.sections.vehiculo.vehicleId ? (
								<div className="space-y-4">
									{/* Inspección */}
									<div className="border-b pb-4">
										<h4 className="mb-2 font-medium text-sm">Inspección</h4>
										<div className="flex items-center gap-2">
											{checklist.sections.vehiculo.inspected ? (
												<CheckCircle2 className="h-4 w-4 text-green-600" />
											) : (
												<Circle className="h-4 w-4 text-muted-foreground" />
											)}
											<span className="text-muted-foreground text-sm">
												{checklist.sections.vehiculo.inspected
													? "✅ El vehículo ha sido inspeccionado y aprobado"
													: "⚠️ El vehículo está pendiente de inspección"}
											</span>
										</div>
										{checklist.sections.vehiculo.inspectionId && (
											<Button
												variant="outline"
												size="sm"
												className="mt-2"
												asChild
											>
												<a
													href={`/crm/vehicles?inspectionId=${checklist.sections.vehiculo.inspectionId}`}
													target="_blank"
													rel="noopener noreferrer"
												>
													Ver inspección
												</a>
											</Button>
										)}
									</div>

									{/* Documentos del Vehículo */}
									{checklist.sections.vehiculo.documentos &&
										checklist.sections.vehiculo.documentos.items.length > 0 && (
											<div className="border-b pb-4">
												<div className="mb-3 flex items-center justify-between">
													<h4 className="font-medium text-sm">
														Documentos del Vehículo
													</h4>
													<Badge variant="outline">
														{checklist.sections.vehiculo.documentos.items.filter(
															(i: any) => i.uploaded,
														).length ?? 0}{" "}
														/{" "}
														{checklist.sections.vehiculo.documentos.items
															.length ?? 0}
													</Badge>
												</div>
												<div className="space-y-2">
													{checklist.sections.vehiculo.documentos.items.map(
														(item: any, index: number) => (
															<div
																key={index}
																className="flex items-center justify-between border-b py-2 last:border-0"
															>
																<div className="flex items-center gap-3">
																	{item.uploaded ? (
																		<CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
																	) : (
																		<Circle className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
																	)}
																	<div>
																		<p className="font-medium text-sm">
																			{item.documentType
																				.replace(/_/g, " ")
																				.replace(/\b\w/g, (l: string) =>
																					l.toUpperCase(),
																				)}
																		</p>
																		{item.required && (
																			<span className="text-muted-foreground text-xs">
																				Requerido
																			</span>
																		)}
																	</div>
																</div>
																<Badge
																	variant={
																		item.uploaded ? "default" : "secondary"
																	}
																>
																	{item.uploaded ? "Subido" : "Pendiente"}
																</Badge>
															</div>
														),
													)}
												</div>
											</div>
										)}

									{/* Verificaciones del Vehículo */}
									{checklist.sections.vehiculo.verificaciones &&
										checklist.sections.vehiculo.verificaciones.items.length >
											0 && (
											<div>
												<div className="mb-3 flex items-center justify-between">
													<h4 className="font-medium text-sm">
														Verificaciones Externas
													</h4>
													<Badge variant="outline">
														{checklist.sections.vehiculo.verificaciones.items.filter(
															(i: any) => i.required && i.completed,
														).length ?? 0}{" "}
														/{" "}
														{checklist.sections.vehiculo.verificaciones.items.filter(
															(i: any) => i.required,
														).length ?? 0}
													</Badge>
												</div>
												<div className="space-y-2">
													{checklist.sections.vehiculo.verificaciones.items.map(
														(item: any, index: number) => (
															<div
																key={index}
																className="flex items-start gap-3 border-b py-2 last:border-0"
															>
																<Checkbox
																	checked={item.completed}
																	onCheckedChange={(checked) =>
																		handleVehicleVerificationChange(
																			item.type,
																			checked as boolean,
																		)
																	}
																	disabled={!item.required}
																	className="mt-1"
																/>
																<div className="flex-1">
																	<p className="font-medium text-sm">
																		{item.name}
																	</p>
																	{item.required ? (
																		<span className="text-muted-foreground text-xs">
																			Requerido
																		</span>
																	) : (
																		<span className="text-muted-foreground text-xs">
																			Opcional
																		</span>
																	)}
																	{item.verifiedBy && (
																		<p className="mt-1 text-muted-foreground text-xs">
																			Verificado{" "}
																			{item.verifiedAt &&
																				`el ${new Date(item.verifiedAt).toLocaleDateString()}`}
																		</p>
																	)}
																</div>
															</div>
														),
													)}
												</div>
											</div>
										)}
								</div>
							) : (
								<p className="text-muted-foreground text-sm">
									No hay vehículo asociado a esta oportunidad
								</p>
							)}
						</CardContent>
					</CollapsibleContent>
				</Card>
			</Collapsible>
		</div>
	);
}
