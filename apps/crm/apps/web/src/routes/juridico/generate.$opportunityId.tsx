import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	Eye,
	FileSignature,
	Loader2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type CRMData,
	DynamicContractWizard,
} from "@/components/contracts/DynamicContractWizard";
import {
	OpportunityDetailModal,
	type OpportunityForModal,
} from "@/components/opportunity-detail-modal";
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

function RouteComponent() {
	const { opportunityId } = Route.useParams();
	const navigate = useNavigate();
	const { canViewLegal, isLoading: isLoadingPermissions } =
		useJuridicoPermissions();
	const [isOpportunityModalOpen, setIsOpportunityModalOpen] = useState(false);

	// Get contract types from API (dynamic)
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

	// Get preview data for contracts (contains CRM data)
	const previewQuery = useQuery({
		...orpc.getContractPreviewData.queryOptions({
			input: { opportunityId },
		}),
		enabled:
			canViewLegal && !!opportunityId && validationQuery.data?.isValid === true,
	});

	// Get co-debtors for this opportunity
	const coDebtorsQuery = useQuery({
		queryKey: ["coDebtors", opportunityId],
		queryFn: () => client.getCoDebtorsByOpportunity({ opportunityId }),
		enabled: canViewLegal && !!opportunityId,
	});

	// Get opportunity directly by ID
	const opportunityQuery = useQuery({
		...orpc.getOpportunities.queryOptions({
			input: { opportunityId },
		}),
		enabled: canViewLegal && !!opportunityId,
	});

	// Mutation to get documents by DPI
	const getDocsByDpiMutation = useMutation({
		mutationFn: async ({
			dpi,
			documentNames,
		}: {
			dpi: string;
			documentNames: string[];
		}) => {
			return await client.getDocumentsByDpi({
				dpi: dpi.replace(/\s/g, ""),
				documentNames,
			});
		},
	});

	// Generate contracts mutation (direct to API - does NOT link to opportunity)
	const generateMutation = useMutation({
		mutationFn: async (data: {
			contracts: Array<{
				contractType: string;
				data: Record<string, string>;
				emails?: string[];
				options: {
					gender: "male" | "female";
					generatePdf: boolean;
					isPlural?: boolean;
					filenamePrefix: string;
				};
			}>;
		}) => {
			return await client.generateContractsDirect({
				...data,
			});
		},
		onSuccess: (data) => {
			if (data.success) {
				toast.success(data.message || "Contratos generados exitosamente");
			} else {
				toast.warning(data.message || "Algunos contratos fallaron");
			}
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al generar contratos");
		},
	});

	// Link contracts to opportunity mutation
	const linkContractsMutation = useMutation({
		mutationFn: async (data: {
			opportunityId: string;
			leadId: string;
			contracts: Array<{
				contractType: string;
				contractName: string;
				documentLink?: string;
				signingLinks?: string[];
				templateId?: number;
				apiResponse?: unknown;
			}>;
		}) => {
			return await client.linkContractsToOpportunity(data);
		},
		onSuccess: (data) => {
			toast.success(
				data.message || "Contratos enlazados a la oportunidad exitosamente",
			);
		},
		onError: (error: Error) => {
			toast.error(error.message || "Error al enlazar contratos");
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
		opportunityQuery.isLoading
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

	// Get the opportunity directly (first result from filtered query)
	const opportunity = opportunityQuery.data?.[0];
	const validation = validationQuery.data;
	const contractTypes = contractTypesQuery.data?.data || [];

	// Map preview data to CRM data format for the wizard
	const crmData: CRMData = previewQuery.data
		? {
				cliente: {
					nombreCompleto: previewQuery.data.cliente?.nombreCompleto,
					dpi: previewQuery.data.cliente?.dpi,
					direccion: previewQuery.data.cliente?.direccion,
					nacionalidad: previewQuery.data.cliente?.nacionalidad,
					estadoCivil: previewQuery.data.cliente?.estadoCivil,
					profesion: previewQuery.data.cliente?.profesion,
					correo: previewQuery.data.cliente?.email,
					edad: previewQuery.data.cliente?.edad,
					genero: previewQuery.data.cliente?.genero === "femenino" ? "F" : "M",
				},
				vehiculo: {
					tipo: previewQuery.data.vehiculo?.tipoVehiculo,
					marca: previewQuery.data.vehiculo?.marca,
					linea: previewQuery.data.vehiculo?.linea,
					modelo: String(previewQuery.data.vehiculo?.anio || ""),
					color: previewQuery.data.vehiculo?.color,
					uso: previewQuery.data.vehiculo?.uso,
					chasis: previewQuery.data.vehiculo?.vin,
					combustible: previewQuery.data.vehiculo?.combustible,
					motor: previewQuery.data.vehiculo?.motor,
					serie: previewQuery.data.vehiculo?.serie,
					cm3: previewQuery.data.vehiculo?.cilindraje,
					asientos: previewQuery.data.vehiculo?.asientos
						? String(previewQuery.data.vehiculo.asientos)
						: undefined,
					cilindros: previewQuery.data.vehiculo?.cilindros,
					iscv: previewQuery.data.vehiculo?.codigoIscv,
				},
				credito: {
					capitalAdeudado: previewQuery.data.credito?.montoTotal,
					mesesPrestamo: previewQuery.data.credito?.numeroCuotas,
					cuotaMensual: previewQuery.data.credito?.cuotaMensual,
					porcentajeInteres: previewQuery.data.credito?.tasaInteres,
				},
				coDebtors: coDebtorsQuery.data?.map((cd) => ({
					id: cd.id,
					fullName: cd.fullName,
					dpi: cd.dpi,
					age: cd.age,
					gender: cd.gender,
					maritalStatus: cd.maritalStatus,
					profession: cd.profession,
					nationality: cd.nationality,
					email: cd.email,
				})),
			}
		: {
				cliente: {},
				vehiculo: {},
				credito: {},
			};

	// Transformar datos de oportunidad para el modal
	const selectedOpportunity: OpportunityForModal | null = opportunity
		? {
				id: opportunity.id,
				title: opportunity.title,
				value: opportunity.value,
				creditType: opportunity.creditType,
				status: opportunity.status,
				expectedCloseDate: opportunity.expectedCloseDate,
				createdAt: opportunity.createdAt,
				lead: opportunity.lead
					? {
							id: opportunity.lead.id,
							firstName: opportunity.lead.firstName,
							lastName: opportunity.lead.lastName,
							dpi: null,
							email: opportunity.lead.email,
							phone: null,
						}
					: null,
				stage: opportunity.stage,
				assignedUser: opportunity.assignedUser,
				vehicle: opportunity.vehicle?.id
					? {
							id: opportunity.vehicle.id,
							make: opportunity.vehicle.make,
							model: opportunity.vehicle.model,
							year: opportunity.vehicle.year,
							licensePlate: opportunity.vehicle.licensePlate,
							color: opportunity.vehicle.color,
							isNew: opportunity.vehicle.isNew,
						}
					: null,
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

	const handleGetDocumentsByDpi = async (
		dpi: string,
		documentNames: string[],
	) => {
		const result = await getDocsByDpiMutation.mutateAsync({
			dpi,
			documentNames,
		});
		return result;
	};

	const handleGenerate = async (data: {
		contracts: Array<{
			contractType: string;
			data: Record<string, string>;
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				isPlural?: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => {
		const result = await generateMutation.mutateAsync(data);
		return result;
	};

	const handleLinkContracts = async (data: {
		opportunityId: string;
		leadId: string;
		contracts: Array<{
			contractType: string;
			contractName: string;
			documentLink?: string;
			signingLinks?: string[];
			templateId?: number;
			apiResponse?: unknown;
		}>;
		contractDate?: Date;
		generationData?: Array<{
			contractType: string;
			data: Record<string, string>;
			emails?: string[];
			options: {
				gender: "male" | "female";
				generatePdf: boolean;
				isPlural?: boolean;
				filenamePrefix: string;
			};
		}>;
	}) => {
		const result = await linkContractsMutation.mutateAsync(data);
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
												search: {
													vehicleId: opportunity?.vehicle?.id,
													inspectionId: undefined,
												},
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
										onClick={() =>
											navigate({
												to: "/crm/leads",
												search: { leadId: opportunity?.lead?.id },
											})
										}
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
			{validation?.isValid && crmData.cliente.dpi && (
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle>Generación de Documentos Legales</CardTitle>
								<CardDescription>
									Seleccione los documentos a generar. Los datos serán
									pre-llenados automáticamente con la información del CRM.
								</CardDescription>
							</div>
							<Button
								variant="outline"
								className="border-blue-500 text-blue-500 hover:bg-blue-50"
								onClick={() => setIsOpportunityModalOpen(true)}
							>
								<Eye className="mr-2 h-4 w-4" />
								Ver detalle de la oportunidad
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<DynamicContractWizard
							documentTypes={contractTypes}
							crmData={crmData}
							opportunityId={opportunityId}
							leadId={opportunity?.lead?.id}
							onGetDocumentsByDpi={handleGetDocumentsByDpi}
							onGenerate={handleGenerate}
							onLinkContracts={handleLinkContracts}
							onBack={handleBack}
							isGenerating={generateMutation.isPending}
							isLinking={linkContractsMutation.isPending}
						/>
					</CardContent>
				</Card>
			)}

			{/* Modal de detalle de oportunidad */}
			<OpportunityDetailModal
				open={isOpportunityModalOpen}
				onOpenChange={setIsOpportunityModalOpen}
				opportunity={selectedOpportunity}
				userRole="juridico"
				readOnly
			/>
		</div>
	);
}
