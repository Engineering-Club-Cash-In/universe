import { useQuery } from "@tanstack/react-query";
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Circle,
	FileText,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc } from "@/utils/orpc";

interface DocumentValidationChecklistProps {
	opportunityId: string;
}

const documentTypeLabels: Record<string, string> = {
	identification: "Identificación (DPI/Pasaporte)",
	income_proof: "Comprobante de Ingresos",
	bank_statement: "Estado de Cuenta Bancario",
	business_license: "Patente de Comercio",
	property_deed: "Escrituras de Propiedad",
	vehicle_title: "Tarjeta de Circulación",
	credit_report: "Reporte Crediticio",
	other: "Otro",
};

const creditTypeLabels = {
	autocompra: "Autocompra",
	sobre_vehiculo: "Sobre Vehículo",
};

export function DocumentValidationChecklist({
	opportunityId,
}: DocumentValidationChecklistProps) {
	const validation = useQuery({
		...orpc.validateOpportunityDocuments.queryOptions({
			input: { opportunityId },
		}),
		enabled: !!opportunityId,
	});

	if (validation.isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Validación de Requisitos</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="space-y-2">
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-full" />
						<Skeleton className="h-4 w-full" />
					</div>
				</CardContent>
			</Card>
		);
	}

	if (validation.error) {
		return (
			<Alert variant="destructive">
				<AlertCircle className="h-4 w-4" />
				<AlertDescription>
					Error al cargar la validación: {String(validation.error)}
				</AlertDescription>
			</Alert>
		);
	}

	if (!validation.data) {
		return null;
	}

	const {
		creditType,
		vehicleInspected,
		allDocumentsPresent,
		canApprove,
		requiredDocuments,
		uploadedDocuments,
		missingDocuments,
		vehicleInfo,
	} = validation.data;

	return (
		<Card className="w-full">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="text-lg">Validación de Requisitos</CardTitle>
					<Badge
						variant={canApprove ? "default" : "secondary"}
						className={
							canApprove
								? "bg-green-600 hover:bg-green-700"
								: "bg-yellow-600 hover:bg-yellow-700"
						}
					>
						{creditTypeLabels[creditType as keyof typeof creditTypeLabels] ||
							creditType}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="w-full space-y-4">
				{/* Estado general */}
				<div className="flex items-center gap-2">
					{canApprove ? (
						<CheckCircle2 className="h-5 w-5 text-green-600" />
					) : (
						<AlertTriangle className="h-5 w-5 text-yellow-600" />
					)}
					<span className="font-medium">
						{canApprove
							? "Todos los requisitos están completos"
							: "Faltan requisitos por completar"}
					</span>
				</div>

				<Separator />

				{/* Validación de vehículo */}
				<div>
					<div className="mb-2 flex items-center gap-2">
						<FileText className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium text-sm">Inspección de Vehículo</span>
					</div>
					<div className="flex items-center gap-2 pl-6">
						{!vehicleInfo?.id ? (
							<>
								<AlertTriangle className="h-4 w-4 text-red-600" />
								<span className="text-red-600 text-sm">
									No hay vehículo asociado a la oportunidad
								</span>
							</>
						) : vehicleInspected ? (
							<>
								<CheckCircle2 className="h-4 w-4 text-green-600" />
								<span className="text-sm">
									Vehículo inspeccionado y aprobado
								</span>
							</>
						) : (
							<>
								<AlertTriangle className="h-4 w-4 text-red-600" />
								<span className="text-red-600 text-sm">
									El vehículo no ha sido inspeccionado
								</span>
							</>
						)}
					</div>
				</div>

				<Separator />

				{/* Checklist de documentos */}
				<div>
					<div className="mb-2 flex items-center justify-between">
						<div className="flex items-center gap-2">
							<FileText className="h-4 w-4 text-muted-foreground" />
							<span className="font-medium text-sm">Documentos Requeridos</span>
						</div>
						<Badge variant={allDocumentsPresent ? "default" : "secondary"}>
							{uploadedDocuments.length} / {requiredDocuments.length}
						</Badge>
					</div>

					<div className="space-y-2 pl-6">
						{requiredDocuments.map((req) => {
							const uploaded = uploadedDocuments.find(
								(d) => d.documentType === req.documentType,
							);

							return (
								<div key={req.documentType} className="flex items-center gap-2">
									{uploaded ? (
										<CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
									) : (
										<Circle className="h-4 w-4 flex-shrink-0 text-gray-400" />
									)}
									<span
										className={
											uploaded ? "text-sm" : "text-muted-foreground text-sm"
										}
									>
										{documentTypeLabels[req.documentType] || req.documentType}
									</span>
									{req.description && (
										<span className="text-muted-foreground text-xs">
											({req.description})
										</span>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* Alerta si faltan requisitos */}
				{!canApprove && (
					<Alert variant="destructive">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>
							{!vehicleInfo?.id && (
								<span className="block">
									• Debe asociar un vehículo a la oportunidad
								</span>
							)}
							{vehicleInfo?.id && !vehicleInspected && (
								<span className="block">
									• El vehículo debe ser inspeccionado
								</span>
							)}
							{!allDocumentsPresent && (
								<span className="block">
									• Faltan {missingDocuments.length} documentos obligatorios
								</span>
							)}
						</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
}
