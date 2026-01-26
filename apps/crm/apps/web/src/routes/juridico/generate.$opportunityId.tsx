import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, FileSignature, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ContractWizard } from "@/components/contracts/ContractWizard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useJuridicoPermissions } from "@/hooks/usePermissions";
import { client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/juridico/generate/$opportunityId")({
	component: RouteComponent,
});

// Contract type descriptions for UI
const CONTRACT_DESCRIPTIONS: Record<string, string> = {
	compraventa: "Contrato principal de compraventa del vehículo",
	credito_prendario: "Contrato de crédito con garantía prendaria",
	pagare: "Pagaré que respalda el crédito otorgado",
	mandato_especial: "Mandato para representación legal",
	reconocimiento_deuda: "Documento de reconocimiento de deuda",
	contrato_gps: "Contrato de instalación y servicio GPS",
	contrato_seguro: "Contrato de seguro vehicular",
	poder_especial: "Poder especial para trámites",
	declaracion_jurada: "Declaración jurada del cliente",
	acta_entrega: "Acta de entrega del vehículo",
	contrato_fianza: "Contrato de fianza o garantía",
	carta_compromiso: "Carta compromiso del cliente",
	autorizacion_desembolso: "Autorización para desembolso",
};

// Contract categories
const CONTRACT_CATEGORIES: Record<string, "principal" | "garantia" | "otro"> = {
	compraventa: "principal",
	credito_prendario: "principal",
	pagare: "garantia",
	mandato_especial: "otro",
	reconocimiento_deuda: "garantia",
	contrato_gps: "otro",
	contrato_seguro: "otro",
	poder_especial: "otro",
	declaracion_jurada: "otro",
	acta_entrega: "otro",
	contrato_fianza: "garantia",
	carta_compromiso: "otro",
	autorizacion_desembolso: "otro",
};

function RouteComponent() {
	const { opportunityId } = Route.useParams();
	const navigate = useNavigate();
	const { canViewLegal, isLoading: isLoadingPermissions } =
		useJuridicoPermissions();

	// Get contract types
	const contractTypesQuery = useQuery({
		queryKey: ["getContractTypes"],
		queryFn: () => client.getContractTypes(),
		enabled: canViewLegal,
	});

	// Validate if opportunity has all required data
	const validationQuery = useQuery({
		queryKey: ["validateForContractGeneration", opportunityId],
		queryFn: () => client.validateForContractGeneration({ opportunityId }),
		enabled: canViewLegal && !!opportunityId,
	});

	// Get preview data for contracts
	const previewQuery = useQuery({
		...orpc.getContractPreviewData.queryOptions({
			input: { opportunityId },
		}),
		enabled:
			canViewLegal && !!opportunityId && validationQuery.data?.isValid === true,
	});

	// Get opportunities to find the current one
	const opportunitiesQuery = useQuery({
		...orpc.getOpportunitiesForContracts.queryOptions(),
		enabled: canViewLegal,
	});

	// Generate contracts mutation
	const generateMutation = useMutation({
		mutationFn: async (data: {
			selectedContracts: string[];
			contractDate: { day: string; month: string; year: string };
			beneficiarios: Array<{ cuenta: string; monto: string }>;
		}) => {
			return await client.generateContracts({
				opportunityId,
				contractTypes: data.selectedContracts,
				contractDate: data.contractDate,
				beneficiarios: data.beneficiarios,
			});
		},
		onSuccess: (data) => {
			if (data.success) {
				toast.success(data.message);
			} else {
				toast.warning(data.message);
			}
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al generar contratos");
		},
	});

	// Redirect if no permissions
	if (!isLoadingPermissions && !canViewLegal) {
		navigate({ to: "/dashboard" });
		return null;
	}

	// Loading state
	if (
		isLoadingPermissions ||
		contractTypesQuery.isLoading ||
		validationQuery.isLoading ||
		opportunitiesQuery.isLoading
	) {
		return (
			<div className="container mx-auto flex h-[60vh] items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="h-12 w-12 animate-spin text-primary" />
					<p className="text-muted-foreground">Cargando información...</p>
				</div>
			</div>
		);
	}

	// Find the opportunity from the list
	const opportunity = opportunitiesQuery.data?.find(
		(opp) => opp.id === opportunityId,
	);
	const validation = validationQuery.data;
	const contractTypes = contractTypesQuery.data || [];

	// Map contract types to the format expected by the wizard
	const mappedContractTypes = contractTypes.map((ct) => ({
		id: ct.id,
		name: ct.name,
		description: CONTRACT_DESCRIPTIONS[ct.id] || ct.name,
		category: CONTRACT_CATEGORIES[ct.id] || "otro",
		requiresBeneficiarios: ct.requiresBeneficiary,
	}));

	// Map preview data - adjusting field names from backend
	const previewData = previewQuery.data
		? {
				cliente: {
					nombre: previewQuery.data.cliente?.nombreCompleto,
					dpi: previewQuery.data.cliente?.dpi,
					direccion: previewQuery.data.cliente?.direccion,
					nacionalidad: previewQuery.data.cliente?.nacionalidad,
					estadoCivil: previewQuery.data.cliente?.estadoCivil,
				},
				vehiculo: {
					marca: previewQuery.data.vehiculo?.marca,
					linea: previewQuery.data.vehiculo?.linea,
					modelo: String(previewQuery.data.vehiculo?.anio || ""),
					color: previewQuery.data.vehiculo?.color,
					placa: previewQuery.data.vehiculo?.placas,
					vin: previewQuery.data.vehiculo?.vin,
				},
				credito: {
					montoCredito: String(previewQuery.data.credito?.montoTotal || ""),
					plazo: String(previewQuery.data.credito?.numeroCuotas || ""),
					cuotaMensual: String(previewQuery.data.credito?.cuotaMensual || ""),
					tasaInteres: String(previewQuery.data.credito?.tasaInteres || ""),
				},
			}
		: null;

	const handleBack = () => {
		if (opportunity?.lead?.id) {
			navigate({
				to: "/juridico/$leadId",
				params: { leadId: opportunity.lead.id },
				search: { opportunityId },
			});
		} else {
			navigate({ to: "/juridico" });
		}
	};

	const handleGenerate = async (data: {
		selectedContracts: string[];
		contractDate: { day: string; month: string; year: string };
		beneficiarios: Array<{ cuenta: string; monto: string }>;
	}) => {
		const result = await generateMutation.mutateAsync(data);
		return result;
	};

	return (
		<div className="container mx-auto space-y-6 py-8">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<Button variant="ghost" size="icon" onClick={handleBack}>
						<ArrowLeft className="h-5 w-5" />
					</Button>
					<div className="flex items-center gap-3">
						<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-100">
							<FileSignature className="h-6 w-6 text-amber-600" />
						</div>
						<div>
							<h1 className="font-bold text-2xl">Generar Contratos</h1>
							<p className="text-muted-foreground">
								{opportunity?.title || "Oportunidad"}
							</p>
						</div>
					</div>
				</div>
				{opportunity?.stage && (
					<Badge
						style={{
							backgroundColor: opportunity.stage.color,
							color: "white",
						}}
					>
						{opportunity.stage.name} ({opportunity.stage.closurePercentage}%)
					</Badge>
				)}
			</div>

			{/* Validation Errors */}
			{validation && !validation.isValid && (
				<Card className="border-amber-200 bg-amber-50">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-amber-800">
							<AlertTriangle className="h-5 w-5" />
							Datos Incompletos
						</CardTitle>
						<CardDescription className="text-amber-700">
							Faltan datos necesarios para generar los contratos. Por favor
							complete los siguientes campos antes de continuar.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
							{validation.missingVehicleFields.length > 0 && (
								<div>
									<h4 className="mb-2 font-semibold text-amber-800">
										Vehículo
									</h4>
									<ul className="list-inside list-disc space-y-1 text-amber-700 text-sm">
										{validation.missingVehicleFields.map((field) => (
											<li key={field}>{field}</li>
										))}
									</ul>
									<button
										type="button"
										onClick={() =>
											navigate({
												to: "/vehicles",
												search: { vehicleId: undefined, inspectionId: undefined },
											})
										}
										className="mt-2 inline-block text-primary text-sm hover:underline"
									>
										Ir a editar vehículo →
									</button>
								</div>
							)}
							{validation.missingLeadFields.length > 0 && (
								<div>
									<h4 className="mb-2 font-semibold text-amber-800">Cliente</h4>
									<ul className="list-inside list-disc space-y-1 text-amber-700 text-sm">
										{validation.missingLeadFields.map((field) => (
											<li key={field}>{field}</li>
										))}
									</ul>
									<button
										type="button"
										onClick={() => navigate({ to: "/crm/leads" })}
										className="mt-2 inline-block text-primary text-sm hover:underline"
									>
										Ir a editar lead →
									</button>
								</div>
							)}
							{validation.missingCreditFields.length > 0 && (
								<div>
									<h4 className="mb-2 font-semibold text-amber-800">Crédito</h4>
									<ul className="list-inside list-disc space-y-1 text-amber-700 text-sm">
										{validation.missingCreditFields.map((field) => (
											<li key={field}>{field}</li>
										))}
									</ul>
								</div>
							)}
						</div>

						<div className="mt-4 flex gap-2">
							<Button variant="outline" onClick={handleBack}>
								Volver
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Contract Wizard */}
			{validation?.isValid && (
				<Card>
					<CardHeader>
						<CardTitle>Wizard de Generación de Contratos</CardTitle>
						<CardDescription>
							Seleccione los contratos a generar, configure los parámetros y
							obtenga los links de firma.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<ContractWizard
							contractTypes={mappedContractTypes}
							previewData={previewData}
							isLoadingPreview={previewQuery.isLoading}
							onGenerate={handleGenerate}
							onBack={handleBack}
							isGenerating={generateMutation.isPending}
						/>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
